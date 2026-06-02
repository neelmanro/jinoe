#########################################################################################################################
# TASK WORKFLOW — Git worktrees, task editor sessions, review approval
#########################################################################################################################

from __future__ import annotations

import os
import re
import asyncio
import json
import secrets
import shlex
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import CurrentUser, _ensure_membership
from main import (
    BASE_DIR,
    Db,
    GitEvent,
    Project,
    ProjectSetupEditorOut,
    ReviewChangedFileOut,
    ReviewDecisionIn,
    Task,
    TaskAttempt,
    TaskAttemptOut,
    TaskReview,
    TaskReviewOut,
    User,
)
from project import _get_project_for_member, _project_main_repo_path, _require_project_roster

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback for local dev only.
    fcntl = None  # type: ignore[assignment]


router = APIRouter(tags=["task-workflow"])

MAX_GIT_OUTPUT = 20_000
MAX_REVIEW_DIFF = 120_000
CODE_SERVER_IMAGE = os.environ.get("JINOE_CODE_SERVER_IMAGE") or os.environ.get("CODE_SERVER_IMAGE", "jinoe-workspace:latest")
EDITOR_PUBLIC_HOST = (os.environ.get("JINOE_EDITOR_PUBLIC_HOST") or os.environ.get("EDITOR_PUBLIC_HOST", "127.0.0.1")).strip() or "127.0.0.1"
EDITOR_BIND_HOST = (os.environ.get("JINOE_EDITOR_BIND_HOST") or os.environ.get("EDITOR_HOST_PORT_BIND_ADDRESS", "127.0.0.1")).strip() or "127.0.0.1"
EDITOR_PORT_BASE = int(os.environ.get("JINOE_TASK_EDITOR_PORT_BASE") or os.environ.get("EDITOR_HTTP_HOST_PORT_BASE", "41000"))
SETUP_EDITOR_PORT_BASE = int(
    os.environ.get("JINOE_SETUP_EDITOR_PORT_BASE")
    or str(int(os.environ.get("EDITOR_HTTP_HOST_PORT_BASE", "41000")) + 10_000)
)

_process_locks: dict[int, threading.Lock] = {}
_process_locks_guard = threading.Lock()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _safe_env() -> dict[str, str]:
    keep = {
        "HOME",
        "PATH",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "USER",
        "LOGNAME",
        "DOCKER_HOST",
    }
    env = {key: value for key, value in os.environ.items() if key in keep}
    env.setdefault("CI", "1")
    env.setdefault("NO_COLOR", "1")
    return env


def _truncate(text: str | None, limit: int = MAX_GIT_OUTPUT) -> str | None:
    if not text:
        return None
    return text[-limit:] if len(text) > limit else text


def _friendly_git_cli_failure(stderr: str, stdout: str) -> str:
    raw = ((stderr or "") + "\n" + (stdout or "")).strip()
    lower = raw.lower()
    if "could not lock" in lower or ("unable to" in lower and "lock" in lower):
        return "Another update is in progress. Wait a few seconds and try again."
    if "merge conflict" in lower or "automatic merge failed" in lower:
        return "These changes overlap with other project changes. Resolve them in the editor, then try again."
    if "nothing to commit" in lower or "nothing added to commit" in lower:
        return "There’s nothing new to save yet."
    if "not a git repository" in lower:
        return "The project isn’t ready yet. Try again shortly."
    if "already exists" in lower and "worktree" in lower:
        return "A previous editor session is still cleaning up. Wait a moment and try again."
    if "would be overwritten" in lower or "untracked working tree files" in lower:
        return "Pending files are blocking this step. Finish or discard them in the editor, then try again."
    return "We couldn’t save those changes. Try again in a moment."


def _friendly_docker_cli_failure(stderr: str, stdout: str) -> str:
    raw = ((stderr or "") + "\n" + (stdout or "")).strip()
    lower = raw.lower()
    if "cannot connect to the docker daemon" in lower or "is the docker daemon running" in lower:
        return "We couldn’t reach Docker. Start Docker Desktop (or the Docker service), then try again."
    if "port is already allocated" in lower or "address already in use" in lower:
        return "That editor port is busy. Close another editor window or wait a minute and try again."
    if raw and len(raw) < 220 and raw.count("\n") < 4:
        return raw
    return "The browser editor didn’t start. Check Docker, then try again."


def _project_lock(project_id: int) -> threading.Lock:
    with _process_locks_guard:
        lock = _process_locks.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _process_locks[project_id] = lock
        return lock


@contextmanager
def _git_project_lock(project: Project) -> Generator[None, None, None]:
    process_lock = _project_lock(project.id)
    process_lock.acquire()
    lock_file = None
    try:
        if project.workspace_path and fcntl is not None:
            lock_dir = Path(project.workspace_path).expanduser() / ".jinoe"
            lock_dir.mkdir(parents=True, exist_ok=True)
            lock_file = (lock_dir / "git.lock").open("w", encoding="utf-8")
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        if lock_file is not None:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            finally:
                lock_file.close()
        process_lock.release()


def _record_git_event(
    db: Session,
    *,
    project_id: int,
    action: str,
    cwd: Path,
    argv: list[str] | None,
    exit_code: int,
    stdout: str | None = None,
    stderr: str | None = None,
    task_id: int | None = None,
    attempt_id: int | None = None,
    actor_user_id: int | None = None,
) -> None:
    db.add(
        GitEvent(
            project_id=project_id,
            task_id=task_id,
            attempt_id=attempt_id,
            actor_user_id=actor_user_id,
            action=action,
            cwd=str(cwd),
            argv=argv,
            exit_code=exit_code,
            stdout=_truncate(stdout),
            stderr=_truncate(stderr),
        )
    )
    db.commit()


def _run(
    db: Session,
    *,
    project: Project,
    action: str,
    cwd: Path,
    argv: list[str],
    task_id: int | None = None,
    attempt_id: int | None = None,
    actor_user_id: int | None = None,
    timeout: int = 120,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        argv,
        cwd=str(cwd),
        env=_safe_env(),
        timeout=timeout,
        check=False,
        capture_output=True,
        text=True,
    )
    _record_git_event(
        db,
        project_id=project.id,
        task_id=task_id,
        attempt_id=attempt_id,
        actor_user_id=actor_user_id,
        action=action,
        cwd=cwd,
        argv=argv,
        exit_code=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )
    if check and result.returncode != 0:
        cmd0 = Path(argv[0]).name if argv else ""
        if cmd0 == "git":
            detail = _friendly_git_cli_failure(result.stderr or "", result.stdout or "")
        elif cmd0 == "docker":
            detail = _friendly_docker_cli_failure(result.stderr or "", result.stdout or "")
        else:
            tail = (result.stderr or result.stdout or "").strip()
            detail = tail[-1_200:] if tail else "Something went wrong"
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return result


def _git(
    db: Session,
    *,
    project: Project,
    action: str,
    cwd: Path,
    args: list[str],
    task_id: int | None = None,
    attempt_id: int | None = None,
    actor_user_id: int | None = None,
    timeout: int = 120,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return _run(
        db,
        project=project,
        action=action,
        cwd=cwd,
        argv=["git", *args],
        task_id=task_id,
        attempt_id=attempt_id,
        actor_user_id=actor_user_id,
        timeout=timeout,
        check=check,
    )


def _ensure_git_repo_ready(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> None:
    if not (repo_path / ".git").exists():
        _git(db, project=project, action="git.init", cwd=repo_path, args=["init"], actor_user_id=actor_user_id)
    _git(db, project=project, action="git.config.user_name", cwd=repo_path, args=["config", "user.name", "Jinoe"], actor_user_id=actor_user_id)
    _git(
        db,
        project=project,
        action="git.config.user_email",
        cwd=repo_path,
        args=["config", "user.email", "system@jinoe.local"],
        actor_user_id=actor_user_id,
    )
    status_result = _git(
        db,
        project=project,
        action="git.status.initial_commit_check",
        cwd=repo_path,
        args=["status", "--porcelain"],
        actor_user_id=actor_user_id,
    )
    head_result = _git(
        db,
        project=project,
        action="git.rev_parse.head_exists",
        cwd=repo_path,
        args=["rev-parse", "--verify", "HEAD"],
        actor_user_id=actor_user_id,
        check=False,
    )
    if head_result.returncode != 0:
        _git(db, project=project, action="git.add.initial", cwd=repo_path, args=["add", "-A"], actor_user_id=actor_user_id)
        if status_result.stdout.strip():
            _git(
                db,
                project=project,
                action="git.commit.initial",
                cwd=repo_path,
                args=["commit", "-m", "Initial project scaffold"],
                actor_user_id=actor_user_id,
            )
        _git(
            db,
            project=project,
            action="git.branch.main",
            cwd=repo_path,
            args=["branch", "-M", "main"],
            actor_user_id=actor_user_id,
            check=False,
        )


def _repo_clean(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> bool:
    result = _git(
        db,
        project=project,
        action="git.status.clean_check",
        cwd=repo_path,
        args=["status", "--porcelain"],
        actor_user_id=actor_user_id,
    )
    return not result.stdout.strip()


def _current_branch(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> str:
    result = _git(
        db,
        project=project,
        action="git.current_branch",
        cwd=repo_path,
        args=["rev-parse", "--abbrev-ref", "HEAD"],
        actor_user_id=actor_user_id,
    )
    branch = result.stdout.strip()
    return branch if branch and branch != "HEAD" else "main"


def _head_commit(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> str:
    result = _git(
        db,
        project=project,
        action="git.rev_parse.head",
        cwd=repo_path,
        args=["rev-parse", "HEAD"],
        actor_user_id=actor_user_id,
    )
    return result.stdout.strip()


def _task_for_project(db: Session, project_id: int, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if not task or task.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _ensure_can_work_task(member_role: str, task: Task, user_id: int) -> None:
    if member_role == "owner":
        return
    if task.assignee_user_id is None or task.assignee_user_id == user_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This task is assigned to someone else",
    )


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._/-]+", "-", value.strip()).strip("-").lower()
    slug = re.sub(r"/+", "/", slug)
    return slug or "task"


def _branch_name(task: Task, attempt_id: int) -> str:
    return f"task/{_slug(task.ref)}-{attempt_id}"


def _worktree_path(project: Project, attempt_id: int) -> Path:
    if not project.workspace_path:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your project isn’t ready for tasks yet.")
    return Path(project.workspace_path).expanduser().resolve() / "worktrees" / f"attempt-{attempt_id}"


def _docker_cli() -> str | None:
    return shutil.which("docker")


def _docker_available() -> bool:
    docker = _docker_cli()
    if not docker:
        return False
    try:
        return subprocess.run([docker, "info"], timeout=20, capture_output=True, text=True).returncode == 0
    except Exception:
        return False


def _image_exists(image: str) -> bool:
    docker = _docker_cli()
    if not docker:
        return False
    try:
        return subprocess.run([docker, "image", "inspect", image], timeout=20, capture_output=True, text=True).returncode == 0
    except Exception:
        return False


def _ensure_editor_image(db: Session, project: Project, cwd: Path, actor_user_id: int | None = None) -> None:
    if _image_exists(CODE_SERVER_IMAGE):
        return
    dockerfile = BASE_DIR.parent / "docker" / "jinoe-workspace" / "Dockerfile"
    context = dockerfile.parent
    if not dockerfile.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The editor image is missing. Ask your admin to build the workspace image, then try again.",
        )
    docker = _docker_cli()
    if not docker:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Docker isn’t installed or isn’t on your PATH.")
    _run(
        db,
        project=project,
        action="docker.build_editor_image",
        cwd=cwd,
        argv=[docker, "build", "-t", CODE_SERVER_IMAGE, "-f", str(dockerfile), str(context)],
        actor_user_id=actor_user_id,
        timeout=900,
    )


def _host_port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _port_free(port: int) -> bool:
    return _host_port_free(EDITOR_BIND_HOST, port)


def _attempt_port(attempt_id: int) -> int:
    port = EDITOR_PORT_BASE + attempt_id
    if port > 65535:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That task number is too large for the configured editor port range.")
    return port


def _editor_url_for_attempt(attempt_id: int) -> str:
    port = _attempt_port(attempt_id)
    return f"http://{EDITOR_PUBLIC_HOST}:{port}"


def _container_name(attempt_id: int) -> str:
    return f"jinoe-task-{attempt_id}"


def _setup_container_name(project_id: int) -> str:
    return f"jinoe-project-setup-{project_id}"


def _setup_editor_port(project_id: int) -> int:
    port = SETUP_EDITOR_PORT_BASE + project_id
    if port > 65535:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That project number is too large for the configured setup editor port range.")
    return port


def _setup_editor_url(project_id: int) -> str:
    return f"http://{EDITOR_PUBLIC_HOST}:{_setup_editor_port(project_id)}"


def _editor_health_url(port: int) -> str:
    host = EDITOR_BIND_HOST
    if host in {"0.0.0.0", "::", ""}:
        host = "127.0.0.1"
    return f"http://{host}:{port}"


def _container_running(name: str) -> bool:
    docker = _docker_cli()
    if not docker:
        return False
    result = subprocess.run(
        [docker, "inspect", "-f", "{{.State.Running}}", name],
        timeout=20,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def _wait_for_editor_ready(url: str, *, timeout_seconds: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "jinoe-healthcheck/1.0"})
            with urllib.request.urlopen(request, timeout=2) as response:
                if 200 <= response.status < 500:
                    return True
        except Exception as exc:  # noqa: BLE001 - startup readiness is best-effort polling.
            last_error = exc
        time.sleep(0.5)
    if last_error is not None:
        return False
    return False


def _docker_rm(db: Session, project: Project, attempt: TaskAttempt, actor_user_id: int | None = None) -> None:
    if not attempt.container_name:
        return
    docker = _docker_cli()
    if not docker:
        return
    _run(
        db,
        project=project,
        action="docker.rm_task_editor",
        cwd=Path(attempt.worktree_path),
        argv=[docker, "rm", "-f", attempt.container_name],
        task_id=attempt.task_id,
        attempt_id=attempt.id,
        actor_user_id=actor_user_id,
        timeout=60,
        check=False,
    )


def _start_setup_editor_container(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> str:
    if not _docker_available():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="We couldn’t reach Docker. Start Docker Desktop (or the Docker service), then open the setup editor again.",
        )
    _ensure_editor_image(db, project, repo_path, actor_user_id)
    container = _setup_container_name(project.id)
    if _container_running(container):
        editor_url = _setup_editor_url(project.id)
        if not _wait_for_editor_ready(_editor_health_url(_setup_editor_port(project.id))):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The setup editor is running but not responding yet. Try reopening it in a moment.")
        return editor_url
    port = _setup_editor_port(project.id)
    if not _port_free(port):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The setup editor port is already in use. Close another setup window or wait a minute and try again.",
        )
    docker = _docker_cli()
    assert docker is not None
    _run(
        db,
        project=project,
        action="docker.rm_stale_setup_editor",
        cwd=repo_path,
        argv=[docker, "rm", "-f", container],
        actor_user_id=actor_user_id,
        timeout=60,
        check=False,
    )
    _run(
        db,
        project=project,
        action="docker.chown_setup_workspace",
        cwd=repo_path,
        argv=[
            docker,
            "run",
            "--rm",
            "-v",
            f"{repo_path}:/home/coder/project",
            "--user",
            "root",
            CODE_SERVER_IMAGE,
            "sh",
            "-lc",
            "chown -R coder:coder /home/coder/project",
        ],
        actor_user_id=actor_user_id,
        timeout=120,
        check=False,
    )
    _run(
        db,
        project=project,
        action="docker.run_setup_editor",
        cwd=repo_path,
        argv=[
            docker,
            "run",
            "-d",
            "--name",
            container,
            "-p",
            f"{EDITOR_BIND_HOST}:{port}:8080",
            "-v",
            f"{repo_path}:/home/coder/project",
            "-w",
            "/home/coder/project",
            CODE_SERVER_IMAGE,
            "code-server",
            "--auth",
            "none",
            "--bind-addr",
            "0.0.0.0:8080",
            "/home/coder/project",
        ],
        actor_user_id=actor_user_id,
        timeout=120,
    )
    editor_url = _setup_editor_url(project.id)
    if not _wait_for_editor_ready(_editor_health_url(port)):
        _run(
            db,
            project=project,
            action="docker.rm_unready_setup_editor",
            cwd=repo_path,
            argv=[docker, "rm", "-f", container],
            actor_user_id=actor_user_id,
            timeout=60,
            check=False,
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The setup editor started but did not become ready. Try reopening it in a moment.")
    return editor_url


def _stop_setup_editor_container(db: Session, project: Project, repo_path: Path, actor_user_id: int | None = None) -> None:
    docker = _docker_cli()
    if not docker:
        return
    _run(
        db,
        project=project,
        action="docker.rm_setup_editor",
        cwd=repo_path,
        argv=[docker, "rm", "-f", _setup_container_name(project.id)],
        actor_user_id=actor_user_id,
        timeout=60,
        check=False,
    )


def _start_editor_container(db: Session, project: Project, attempt: TaskAttempt, actor_user_id: int | None = None) -> str:
    if _container_running(attempt.container_name or "") and attempt.editor_url:
        if not _wait_for_editor_ready(_editor_health_url(_attempt_port(attempt.id))):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The task editor is running but not responding yet. Try reopening it in a moment.")
        return attempt.editor_url
    if not _docker_available():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="We couldn’t reach Docker. Start Docker Desktop (or the Docker service), then open the task editor again.",
        )
    worktree = Path(attempt.worktree_path).resolve()
    _ensure_editor_image(db, project, worktree, actor_user_id)
    port = _attempt_port(attempt.id)
    if not _port_free(port):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The task editor port is already in use. Close another task editor or wait a minute and try again.",
        )
    docker = _docker_cli()
    assert docker is not None
    container = _container_name(attempt.id)
    _run(
        db,
        project=project,
        action="docker.rm_stale_task_editor",
        cwd=worktree,
        argv=[docker, "rm", "-f", container],
        task_id=attempt.task_id,
        attempt_id=attempt.id,
        actor_user_id=actor_user_id,
        timeout=60,
        check=False,
    )
    _run(
        db,
        project=project,
        action="docker.chown_task_worktree",
        cwd=worktree,
        argv=[
            docker,
            "run",
            "--rm",
            "-v",
            f"{worktree}:/home/coder/project",
            "--user",
            "root",
            CODE_SERVER_IMAGE,
            "sh",
            "-lc",
            "chown -R coder:coder /home/coder/project",
        ],
        task_id=attempt.task_id,
        attempt_id=attempt.id,
        actor_user_id=actor_user_id,
        timeout=120,
        check=False,
    )
    _run(
        db,
        project=project,
        action="docker.run_task_editor",
        cwd=worktree,
        argv=[
            docker,
            "run",
            "-d",
            "--name",
            container,
            "-p",
            f"{EDITOR_BIND_HOST}:{port}:8080",
            "-v",
            f"{worktree}:/home/coder/project",
            "-w",
            "/home/coder/project",
            CODE_SERVER_IMAGE,
            "code-server",
            "--auth",
            "none",
            "--bind-addr",
            "0.0.0.0:8080",
            "/home/coder/project",
        ],
        task_id=attempt.task_id,
        attempt_id=attempt.id,
        actor_user_id=actor_user_id,
        timeout=120,
    )
    attempt.container_name = container
    attempt.editor_url = _editor_url_for_attempt(attempt.id)
    if not _wait_for_editor_ready(_editor_health_url(port)):
        _run(
            db,
            project=project,
            action="docker.rm_unready_task_editor",
            cwd=worktree,
            argv=[docker, "rm", "-f", container],
            task_id=attempt.task_id,
            attempt_id=attempt.id,
            actor_user_id=actor_user_id,
            timeout=60,
            check=False,
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The task editor started but did not become ready. Try reopening it in a moment.")
    attempt.updated_at = _utcnow()
    db.commit()
    db.refresh(attempt)
    return attempt.editor_url or ""


def _changed_files_from_numstat(text: str, name_status: str) -> list[dict[str, Any]]:
    statuses: dict[str, str] = {}
    for line in name_status.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            statuses[parts[-1]] = parts[0]
    changed: list[dict[str, Any]] = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        adds_raw, dels_raw, path = parts[0], parts[1], parts[-1]
        additions = int(adds_raw) if adds_raw.isdigit() else 0
        deletions = int(dels_raw) if dels_raw.isdigit() else 0
        changed.append(
            {
                "path": path,
                "status": statuses.get(path, "M"),
                "additions": additions,
                "deletions": deletions,
            }
        )
    return changed


def _review_to_out(db: Session, review: TaskReview) -> TaskReviewOut:
    task = db.get(Task, review.task_id)
    attempt = db.get(TaskAttempt, review.attempt_id)
    user = db.get(User, review.submitted_by_user_id)
    raw_files = review.changed_files if isinstance(review.changed_files, list) else []
    return TaskReviewOut(
        id=review.id,
        project_id=review.project_id,
        task_id=review.task_id,
        attempt_id=review.attempt_id,
        task_ref=task.ref if task else "Task",
        task_title=task.title if task else "Task",
        submitted_by_user_id=review.submitted_by_user_id,
        submitted_by_name=user.full_name if user else "Unknown",
        status=review.status,
        branch_name=attempt.branch_name if attempt else "",
        base_commit=review.base_commit,
        head_commit=review.head_commit,
        changed_files=[ReviewChangedFileOut(**item) for item in raw_files if isinstance(item, dict)],
        diff_text=review.diff_text,
        merge_commit=review.merge_commit,
        decision_note=review.decision_note,
        error=review.error,
        created_at=review.created_at,
        updated_at=review.updated_at,
        decided_at=review.decided_at,
    )


@router.post("/team/projects/{project_id}/setup-editor", response_model=ProjectSetupEditorOut)
def start_project_setup_editor(project_id: int, current_user: CurrentUser, db: Db) -> ProjectSetupEditorOut:
    member = _ensure_membership(db, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can set up the project.")
    project = _get_project_for_member(db, member, project_id)
    if project.setup_status == "ready":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project setup is already finished.")
    if project.setup_status == "failed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=project.setup_error or "Project setup didn’t finish. You can try opening the setup editor again.",
        )
    repo_path = _project_main_repo_path(project)
    with _git_project_lock(project):
        _ensure_git_repo_ready(db, project, repo_path, current_user.id)
        editor_url = _start_setup_editor_container(db, project, repo_path, current_user.id)
        project.setup_status = "setup_required"
        project.setup_step = "Finish project setup in the editor, then press Done here"
        project.setup_editor_url = editor_url
        project.setup_container_name = _setup_container_name(project.id)
        db.commit()
    return ProjectSetupEditorOut(
        project_id=project.id,
        editor_url=editor_url,
        setup_status=project.setup_status,
        repo_path=str(repo_path),
    )


@router.post("/team/projects/{project_id}/setup-complete", response_model=ProjectSetupEditorOut)
def complete_project_setup(project_id: int, current_user: CurrentUser, db: Db) -> ProjectSetupEditorOut:
    member = _ensure_membership(db, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can finish project setup.")
    project = _get_project_for_member(db, member, project_id)
    repo_path = _project_main_repo_path(project)
    with _git_project_lock(project):
        _ensure_git_repo_ready(db, project, repo_path, current_user.id)
        status_result = _git(
            db,
            project=project,
            action="git.status.setup_complete",
            cwd=repo_path,
            args=["status", "--porcelain"],
            actor_user_id=current_user.id,
        )
        if status_result.stdout.strip():
            _git(
                db,
                project=project,
                action="git.add.setup_complete",
                cwd=repo_path,
                args=["add", "-A"],
                actor_user_id=current_user.id,
            )
            _git(
                db,
                project=project,
                action="git.commit.setup_complete",
                cwd=repo_path,
                args=["commit", "-m", "Set up project codebase"],
                actor_user_id=current_user.id,
                timeout=180,
            )
        project.setup_status = "ready"
        project.setup_step = "Project setup is ready"
        project.setup_error = ""
        project.setup_completed_at = _utcnow()
        project.setup_editor_url = None
        project.setup_container_name = None
        db.commit()
        _stop_setup_editor_container(db, project, repo_path, current_user.id)
    return ProjectSetupEditorOut(
        project_id=project.id,
        editor_url=_setup_editor_url(project.id),
        setup_status=project.setup_status,
        repo_path=str(repo_path),
    )


@router.get("/team/projects/{project_id}/task-attempts/active", response_model=TaskAttemptOut | None)
def get_active_task_attempt(project_id: int, current_user: CurrentUser, db: Db) -> TaskAttempt | None:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    return db.scalars(
        select(TaskAttempt)
        .where(
            TaskAttempt.project_id == project.id,
            TaskAttempt.user_id == current_user.id,
            TaskAttempt.status == "active",
        )
        .order_by(TaskAttempt.updated_at.desc(), TaskAttempt.id.desc())
    ).first()


@router.post("/team/projects/{project_id}/tasks/{task_id}/start", response_model=TaskAttemptOut)
def start_task_attempt(project_id: int, task_id: int, current_user: CurrentUser, db: Db) -> TaskAttempt:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    if project.setup_status != "ready":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your project is still being prepared. Try again in a few seconds.")
    task = _task_for_project(db, project.id, task_id)
    _ensure_can_work_task(member.role, task, current_user.id)

    active = db.scalars(
        select(TaskAttempt).where(
            TaskAttempt.project_id == project.id,
            TaskAttempt.task_id == task.id,
            TaskAttempt.user_id == current_user.id,
            TaskAttempt.status == "active",
        )
    ).first()
    if active is not None:
        with _git_project_lock(project):
            _start_editor_container(db, project, active, current_user.id)
        return active

    pending = db.scalars(
        select(TaskReview).where(
            TaskReview.project_id == project.id,
            TaskReview.task_id == task.id,
            TaskReview.status == "pending",
        )
    ).first()
    if pending is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This task is already waiting for review")

    repo_path = _project_main_repo_path(project)
    with _git_project_lock(project):
        _ensure_git_repo_ready(db, project, repo_path, current_user.id)
        if not _repo_clean(db, project, repo_path, current_user.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The project still has unsaved setup changes. Save or discard them in the editor, then start a task.",
            )
        base_branch = _current_branch(db, project, repo_path, current_user.id)
        base_commit = _head_commit(db, project, repo_path, current_user.id)
        attempt = TaskAttempt(
            project_id=project.id,
            task_id=task.id,
            user_id=current_user.id,
            branch_name=f"pending-{secrets.token_hex(8)}",
            base_branch=base_branch,
            base_commit=base_commit,
            worktree_path="pending",
            status="active",
        )
        db.add(attempt)
        db.flush()
        attempt.branch_name = _branch_name(task, attempt.id)
        worktree = _worktree_path(project, attempt.id)
        attempt.worktree_path = str(worktree)
        db.commit()
        db.refresh(attempt)
        worktree.parent.mkdir(parents=True, exist_ok=True)
        try:
            _git(
                db,
                project=project,
                action="git.worktree.add_task",
                cwd=repo_path,
                args=["worktree", "add", "-b", attempt.branch_name, str(worktree), base_commit],
                task_id=task.id,
                attempt_id=attempt.id,
                actor_user_id=current_user.id,
                timeout=180,
            )
            _start_editor_container(db, project, attempt, current_user.id)
        except Exception as exc:
            attempt.status = "failed"
            attempt.logs = str(exc)[:5_000]
            attempt.updated_at = _utcnow()
            db.commit()
            _git(
                db,
                project=project,
                action="git.worktree.remove_failed_start",
                cwd=repo_path,
                args=["worktree", "remove", "--force", str(worktree)],
                task_id=task.id,
                attempt_id=attempt.id,
                actor_user_id=current_user.id,
                check=False,
            )
            raise
        task.status = "doing"
        task.updated_at = _utcnow()
        attempt.updated_at = _utcnow()
        db.commit()
        db.refresh(attempt)
        return attempt


@router.post("/team/projects/{project_id}/tasks/{task_id}/done", response_model=TaskReviewOut)
def submit_task_attempt(project_id: int, task_id: int, current_user: CurrentUser, db: Db) -> TaskReviewOut:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    task = _task_for_project(db, project.id, task_id)
    _ensure_can_work_task(member.role, task, current_user.id)
    attempt = db.scalars(
        select(TaskAttempt)
        .where(
            TaskAttempt.project_id == project.id,
            TaskAttempt.task_id == task.id,
            TaskAttempt.user_id == current_user.id,
            TaskAttempt.status == "active",
        )
        .order_by(TaskAttempt.id.desc())
    ).first()
    if attempt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No open editor session for this task. Start the task again from the task board.")
    worktree = Path(attempt.worktree_path)
    if not worktree.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="We couldn’t find this task’s editor workspace. Start the task again from the task board.")

    with _git_project_lock(project):
        status_result = _git(
            db,
            project=project,
            action="git.status.submit_check",
            cwd=worktree,
            args=["status", "--porcelain"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        )
        if not status_result.stdout.strip():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There are no file changes to send for review yet.")
        _git(
            db,
            project=project,
            action="git.add.submit",
            cwd=worktree,
            args=["add", "-A"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        )
        message = f"{task.ref}: {task.title[:72]}"
        _git(
            db,
            project=project,
            action="git.commit.submit",
            cwd=worktree,
            args=["commit", "-m", message],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        )
        head = _head_commit(db, project, worktree, current_user.id)
        numstat = _git(
            db,
            project=project,
            action="git.diff.numstat_review",
            cwd=worktree,
            args=["diff", "--numstat", f"{attempt.base_commit}..{head}"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        ).stdout
        name_status = _git(
            db,
            project=project,
            action="git.diff.name_status_review",
            cwd=worktree,
            args=["diff", "--name-status", f"{attempt.base_commit}..{head}"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        ).stdout
        stat = _git(
            db,
            project=project,
            action="git.diff.stat_review",
            cwd=worktree,
            args=["diff", "--stat", f"{attempt.base_commit}..{head}"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
        ).stdout
        diff = _git(
            db,
            project=project,
            action="git.diff.review",
            cwd=worktree,
            args=["diff", "--patch", "--find-renames", f"{attempt.base_commit}..{head}"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
            timeout=180,
        ).stdout
        attempt.head_commit = head
        attempt.status = "submitted"
        attempt.commit_message = message
        attempt.diff_stat = stat[-MAX_GIT_OUTPUT:] if stat else None
        attempt.submitted_at = _utcnow()
        attempt.updated_at = _utcnow()
        task.status = "review"
        task.updated_at = _utcnow()
        review = TaskReview(
            project_id=project.id,
            task_id=task.id,
            attempt_id=attempt.id,
            submitted_by_user_id=current_user.id,
            status="pending",
            base_commit=attempt.base_commit,
            head_commit=head,
            changed_files=_changed_files_from_numstat(numstat, name_status),
            diff_text=diff[:MAX_REVIEW_DIFF],
        )
        db.add(review)
        db.commit()
        db.refresh(review)
        _docker_rm(db, project, attempt, current_user.id)
        return _review_to_out(db, review)


@router.get("/team/projects/{project_id}/reviews", response_model=list[TaskReviewOut])
def list_project_reviews(project_id: int, current_user: CurrentUser, db: Db) -> list[TaskReviewOut]:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    reviews = db.scalars(
        select(TaskReview)
        .where(TaskReview.project_id == project.id)
        .order_by(TaskReview.status.asc(), TaskReview.created_at.desc(), TaskReview.id.desc())
    ).all()
    return [_review_to_out(db, review) for review in reviews]


@router.get("/team/projects/{project_id}/reviews/{review_id}", response_model=TaskReviewOut)
def get_project_review(project_id: int, review_id: int, current_user: CurrentUser, db: Db) -> TaskReviewOut:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    review = db.get(TaskReview, review_id)
    if not review or review.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    return _review_to_out(db, review)


@router.post("/team/projects/{project_id}/reviews/{review_id}/approve", response_model=TaskReviewOut)
def approve_project_review(project_id: int, review_id: int, body: ReviewDecisionIn, current_user: CurrentUser, db: Db) -> TaskReviewOut:
    member = _ensure_membership(db, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can approve submitted work.")
    project = _get_project_for_member(db, member, project_id)
    review = db.get(TaskReview, review_id)
    if not review or review.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This review was already completed.")
    task = _task_for_project(db, project.id, review.task_id)
    attempt = db.get(TaskAttempt, review.attempt_id)
    if attempt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That submitted work could not be found.")
    repo_path = _project_main_repo_path(project)
    with _git_project_lock(project):
        _ensure_git_repo_ready(db, project, repo_path, current_user.id)
        if not _repo_clean(db, project, repo_path, current_user.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The project still has unsaved setup changes. Save or discard them in the editor, then approve.",
            )
        merge = _git(
            db,
            project=project,
            action="git.merge.review",
            cwd=repo_path,
            args=["merge", "--no-ff", attempt.branch_name, "-m", f"Merge {task.ref}: {task.title[:72]}"],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
            timeout=180,
            check=False,
        )
        if merge.returncode != 0:
            _git(
                db,
                project=project,
                action="git.merge.abort_review",
                cwd=repo_path,
                args=["merge", "--abort"],
                task_id=task.id,
                attempt_id=attempt.id,
                actor_user_id=current_user.id,
                check=False,
            )
            review.status = "conflict"
            review.error = "These changes couldn’t be added to the project. Ask the author to update their work and resubmit."
            review.updated_at = _utcnow()
            attempt.status = "conflict"
            attempt.updated_at = _utcnow()
            db.commit()
            db.refresh(review)
            return _review_to_out(db, review)
        review.status = "approved"
        review.decided_by_user_id = current_user.id
        review.decision_note = (body.note or "").strip() or None
        review.decided_at = _utcnow()
        review.updated_at = _utcnow()
        review.merge_commit = _head_commit(db, project, repo_path, current_user.id)
        attempt.status = "approved"
        attempt.updated_at = _utcnow()
        task.status = "shipped"
        task.shipped = True
        task.progress = 100
        task.updated_at = _utcnow()
        db.commit()
        db.refresh(review)
        _git(
            db,
            project=project,
            action="git.worktree.remove_approved",
            cwd=repo_path,
            args=["worktree", "remove", "--force", attempt.worktree_path],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=current_user.id,
            check=False,
        )
        return _review_to_out(db, review)


@router.post("/team/projects/{project_id}/reviews/{review_id}/decline", response_model=TaskReviewOut)
def decline_project_review(project_id: int, review_id: int, body: ReviewDecisionIn, current_user: CurrentUser, db: Db) -> TaskReviewOut:
    member = _ensure_membership(db, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can decline submitted work.")
    project = _get_project_for_member(db, member, project_id)
    review = db.get(TaskReview, review_id)
    if not review or review.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This review was already completed.")
    task = _task_for_project(db, project.id, review.task_id)
    attempt = db.get(TaskAttempt, review.attempt_id)
    review.status = "declined"
    review.decided_by_user_id = current_user.id
    review.decision_note = (body.note or "").strip() or None
    review.decided_at = _utcnow()
    review.updated_at = _utcnow()
    if attempt is not None:
        attempt.status = "declined"
        attempt.updated_at = _utcnow()
    task.status = "todo"
    task.shipped = False
    task.updated_at = _utcnow()
    db.commit()
    db.refresh(review)
    return _review_to_out(db, review)
