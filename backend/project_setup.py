#########################################################################################################################
# PROJECT SETUP — deterministic blank Git workspace
#########################################################################################################################

from __future__ import annotations

import os
import re
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from main import BASE_DIR, Project, SessionLocal

WORKSPACES_ROOT = Path(
    os.environ.get(
        "PROJECT_WORKSPACES_ROOT",
        str(BASE_DIR.parent / "jinoe-workspaces"),
    )
).expanduser()

MAX_LOG_CHARS = 60_000

_jobs_lock = threading.Lock()
_running_project_ids: set[int] = set()


def _slugify_project_name(name: str) -> str:
    raw = (name or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    return (raw or "project")[:80]


def _safe_env() -> dict[str, str]:
    keep = {
        "HOME",
        "PATH",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "USER",
        "LOGNAME",
    }
    env = {key: value for key, value in os.environ.items() if key in keep}
    env.setdefault("CI", "1")
    env.setdefault("NO_COLOR", "1")
    return env


def _append_log(project_id: int, message: str) -> None:
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        if project is None:
            return
        current = project.setup_logs or ""
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        project.setup_logs = f"{current}[{stamp}] {message.rstrip()}\n"[-MAX_LOG_CHARS:]
        db.commit()


def _set_status(
    project_id: int,
    *,
    status: str | None = None,
    step: str | None = None,
    error: str | None = None,
    workspace_path: str | None = None,
    completed_at: datetime | None = None,
) -> None:
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        if project is None:
            return
        if status is not None:
            project.setup_status = status
        if step is not None:
            project.setup_step = step
        if error is not None:
            project.setup_error = error
        if workspace_path is not None:
            project.workspace_path = workspace_path
        if completed_at is not None:
            project.setup_completed_at = completed_at
        db.commit()


def _project_paths(project: Project) -> tuple[Path, Path]:
    slug = _slugify_project_name(project.name)
    project_dir = WORKSPACES_ROOT / slug
    if project_dir.exists() and project.workspace_path and Path(project.workspace_path).expanduser() != project_dir:
        project_dir = WORKSPACES_ROOT / f"{slug}-{project.id}"
    if project_dir.exists() and not project.workspace_path and any(project_dir.iterdir()):
        project_dir = WORKSPACES_ROOT / f"{slug}-{project.id}"
    return project_dir, project_dir / "main"


def _run_logged(project_id: int, argv: list[str], cwd: Path, timeout_seconds: int = 120) -> None:
    _append_log(project_id, f"$ {' '.join(argv)}")
    result = subprocess.run(
        argv,
        cwd=str(cwd),
        timeout=timeout_seconds,
        check=False,
        capture_output=True,
        text=True,
        env=_safe_env(),
    )
    if result.stdout:
        _append_log(project_id, result.stdout[-6_000:])
    if result.stderr:
        _append_log(project_id, result.stderr[-6_000:])
    if result.returncode != 0:
        raise RuntimeError(
            "We couldn’t finish preparing your project folder. Check disk space and permissions, then try creating the project again."
        )


def _ensure_git_identity(project_id: int, repo_dir: Path) -> None:
    _run_logged(project_id, ["git", "config", "user.name", "Jinoe"], repo_dir, 30)
    _run_logged(project_id, ["git", "config", "user.email", "system@jinoe.local"], repo_dir, 30)


def _create_blank_repo(project_id: int, project: Project, project_dir: Path, repo_dir: Path) -> None:
    _set_status(
        project_id,
        status="creating",
        step="Preparing your project space",
        error="",
        workspace_path=str(project_dir),
    )
    _append_log(project_id, f"workspace: {project_dir}")
    project_dir.mkdir(parents=True, exist_ok=True)
    repo_dir.mkdir(parents=True, exist_ok=True)
    if any(repo_dir.iterdir()) and not (repo_dir / ".git").exists():
        raise RuntimeError("Main repository folder already exists and is not empty")

    readme = repo_dir / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# {project.name}\n\nSet up the starting files in Jinoe, then use tasks and reviews to ship changes.\n",
            encoding="utf-8",
        )
    gitignore = repo_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(
            "node_modules/\n.next/\ndist/\nbuild/\n.venv/\nvenv/\n__pycache__/\n.env\n.DS_Store\n",
            encoding="utf-8",
        )

    if not (repo_dir / ".git").exists():
        _run_logged(project_id, ["git", "init"], repo_dir, 30)
    _ensure_git_identity(project_id, repo_dir)
    _run_logged(project_id, ["git", "branch", "-M", "main"], repo_dir, 30)
    _run_logged(project_id, ["git", "add", "-A"], repo_dir, 60)
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(repo_dir),
        timeout=30,
        check=False,
        capture_output=True,
        text=True,
        env=_safe_env(),
    )
    if status.returncode != 0:
        raise RuntimeError("We couldn’t verify the new project folder. Try creating the project again.")
    if status.stdout.strip():
        _run_logged(project_id, ["git", "commit", "-m", "Initial empty project"], repo_dir, 90)

    _set_status(
        project_id,
        status="setup_workspace",
        step="Choose whether to add starting files or start from the simple project",
        error="",
        workspace_path=str(project_dir),
    )
    _append_log(project_id, "Your simple project is ready")


def _run_project_setup(project_id: int) -> None:
    try:
        with SessionLocal() as db:
            project = db.scalars(select(Project).where(Project.id == project_id)).first()
            if project is None:
                return
            project_dir, repo_dir = _project_paths(project)
            project.workspace_path = str(project_dir)
            project.setup_status = "creating"
            project.setup_step = "Preparing your project space"
            project.setup_error = None
            project.setup_logs = ""
            db.commit()

        with SessionLocal() as db:
            project = db.get(Project, project_id)
            if project is None:
                return
            _create_blank_repo(project_id, project, project_dir, repo_dir)
    except Exception as exc:  # noqa: BLE001 - setup errors must be visible in UI
        _append_log(project_id, f"ERROR: {exc}")
        _set_status(
            project_id,
            status="failed",
            step="Something went wrong while preparing your project",
            error=str(exc),
        )
    finally:
        with _jobs_lock:
            _running_project_ids.discard(project_id)


def start_project_setup_job(project_id: int) -> None:
    with _jobs_lock:
        if project_id in _running_project_ids:
            return
        _running_project_ids.add(project_id)

    thread = threading.Thread(
        target=_run_project_setup,
        args=(project_id,),
        daemon=True,
    )
    thread.start()


def create_empty_project_workspace(project_id: int) -> None:
    """Create the blank Git workspace synchronously for the create-project request."""
    _run_project_setup(project_id)


def suggest_build_notes(*, project_name: str | None, product_brief: str) -> dict[str, str]:
    """Legacy endpoint stub. V1 no longer asks owners to pick backend/frontend/database stack upfront."""
    return {
        "backend_notes": "",
        "frontend_notes": "",
        "database_notes": "",
        "additional_notes": "",
    }
