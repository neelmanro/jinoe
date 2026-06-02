from __future__ import annotations

import asyncio
import json
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from assistant_runtime.agent import AssistantAgent
from assistant_runtime.config import AssistantConfig
from assistant_runtime.schemas import AssistantMessageIn
from assistant_runtime.sessions import load_or_create_session, replace_target_snapshot
from assistant_runtime.targets import AssistantTarget
from auth import CurrentUser, _ensure_membership
from main import (
    AiTaskRun,
    AiTaskRunOut,
    AssistantSession,
    Db,
    Project,
    SessionLocal,
    Task,
    TaskAttempt,
    TaskReview,
    User,
)
from project import _get_project_for_member, _project_main_repo_path, _require_project_roster
from task_workflow import (
    MAX_GIT_OUTPUT,
    MAX_REVIEW_DIFF,
    _branch_name,
    _changed_files_from_numstat,
    _current_branch,
    _docker_rm,
    _ensure_git_repo_ready,
    _git,
    _git_project_lock,
    _head_commit,
    _repo_clean,
    _start_editor_container,
    _task_for_project,
    _utcnow,
    _worktree_path,
)
from tasks import ai_run_to_out

router = APIRouter(tags=["ai-tasks"])

MAX_AI_RUN_LOG_CHARS = 120_000
MAX_AI_RUN_EVENTS = 240
AI_ASSIGNEE_LABEL = "Jinoe AI"

_runner_lock = threading.Lock()
_running_run_ids: set[int] = set()


def _system_ai_email(team_id: int) -> str:
    return f"jinoe-ai+team-{team_id}@system.local"


def _ensure_system_ai_user(db: Session, team_id: int) -> User:
    email = _system_ai_email(team_id)
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is not None:
        return user
    user = User(
        full_name=AI_ASSIGNEE_LABEL,
        company_name="Jinoe",
        email=email,
        password_hash="system-ai-user",
        email_verified_at=_utcnow(),
    )
    db.add(user)
    db.flush()
    return user


def _run_to_out(run: AiTaskRun) -> AiTaskRunOut:
    return ai_run_to_out(run)


def _append_run_event(
    db: Session,
    run: AiTaskRun,
    *,
    kind: str,
    title: str,
    detail: str | None = None,
    status_value: str | None = None,
    step: str | None = None,
    progress: int | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    now = _utcnow()
    event = {
        "id": f"{run.id}-{int(now.timestamp() * 1000)}-{len(run.events or [])}",
        "kind": kind,
        "title": title,
        "detail": detail,
        "status": status_value or "done",
        "created_at": now.isoformat(),
        "payload": payload or {},
    }
    events = list(run.events) if isinstance(run.events, list) else []
    events.append(event)
    run.events = events[-MAX_AI_RUN_EVENTS:]
    if step is not None:
        run.current_step = step
    if progress is not None:
        run.progress = max(0, min(100, int(progress)))
    run.updated_at = now
    db.commit()


def _append_run_log(db: Session, run: AiTaskRun, text: str) -> None:
    if not text:
        return
    current = run.logs or ""
    run.logs = f"{current}{text}"[-MAX_AI_RUN_LOG_CHARS:]
    run.updated_at = _utcnow()
    db.commit()


def _set_run_state(
    db: Session,
    run: AiTaskRun,
    *,
    status_value: str | None = None,
    step: str | None = None,
    progress: int | None = None,
    error: str | None = None,
    completed: bool = False,
) -> None:
    if status_value is not None:
        run.status = status_value
    if step is not None:
        run.current_step = step
    if progress is not None:
        run.progress = max(0, min(100, int(progress)))
    if error is not None:
        run.error = error
    if completed:
        run.completed_at = _utcnow()
    run.updated_at = _utcnow()
    db.commit()


def _tool_step(name: str) -> tuple[str, int]:
    if name in {"list_files", "glob", "grep", "read_file"}:
        return "Reading project files", 28
    if name in {"write_file", "edit_file", "delete_file", "move_file"}:
        return "Editing files", 52
    if name == "run_command":
        return "Running checks", 68
    if name == "todo_update":
        return "Updating plan", 22
    if name in {"web_search", "web_fetch"}:
        return "Researching", 35
    return "Working", 40


def _create_ai_attempt(db: Session, *, project: Project, task: Task, ai_user: User, requested_by_user_id: int) -> TaskAttempt:
    repo_path = _project_main_repo_path(project)
    _ensure_git_repo_ready(db, project, repo_path, requested_by_user_id)
    if not _repo_clean(db, project, repo_path, requested_by_user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The project has unsaved setup changes. Save or discard them before assigning AI.",
        )
    base_branch = _current_branch(db, project, repo_path, requested_by_user_id)
    base_commit = _head_commit(db, project, repo_path, requested_by_user_id)
    attempt = TaskAttempt(
        project_id=project.id,
        task_id=task.id,
        user_id=ai_user.id,
        branch_name="pending-ai",
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
            action="git.worktree.add_ai_task",
            cwd=repo_path,
            args=["worktree", "add", "-b", attempt.branch_name, str(worktree), base_commit],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=requested_by_user_id,
            timeout=180,
        )
        _start_editor_container(db, project, attempt, requested_by_user_id)
    except Exception:
        attempt.status = "failed"
        attempt.updated_at = _utcnow()
        db.commit()
        _git(
            db,
            project=project,
            action="git.worktree.remove_failed_ai_start",
            cwd=repo_path,
            args=["worktree", "remove", "--force", str(worktree)],
            task_id=task.id,
            attempt_id=attempt.id,
            actor_user_id=requested_by_user_id,
            check=False,
        )
        raise
    return attempt


def _submit_ai_attempt_for_review(
    db: Session,
    *,
    project: Project,
    task: Task,
    attempt: TaskAttempt,
    ai_user: User,
    run: AiTaskRun,
) -> TaskReview:
    worktree = Path(attempt.worktree_path)
    if not worktree.exists():
        raise RuntimeError("The AI task workspace folder disappeared before review submission.")

    status_result = _git(
        db,
        project=project,
        action="git.status.ai_submit_check",
        cwd=worktree,
        args=["status", "--porcelain"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
    )
    if not status_result.stdout.strip():
        raise RuntimeError("Jinoe AI finished without changing any files.")

    _git(
        db,
        project=project,
        action="git.add.ai_submit",
        cwd=worktree,
        args=["add", "-A"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
    )
    message = f"{task.ref}: {task.title[:72]}"
    _git(
        db,
        project=project,
        action="git.commit.ai_submit",
        cwd=worktree,
        args=["commit", "-m", message],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
        timeout=180,
    )
    head = _head_commit(db, project, worktree, ai_user.id)
    numstat = _git(
        db,
        project=project,
        action="git.diff.ai_numstat_review",
        cwd=worktree,
        args=["diff", "--numstat", f"{attempt.base_commit}..{head}"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
    ).stdout
    name_status = _git(
        db,
        project=project,
        action="git.diff.ai_name_status_review",
        cwd=worktree,
        args=["diff", "--name-status", f"{attempt.base_commit}..{head}"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
    ).stdout
    stat = _git(
        db,
        project=project,
        action="git.diff.ai_stat_review",
        cwd=worktree,
        args=["diff", "--stat", f"{attempt.base_commit}..{head}"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
    ).stdout
    diff = _git(
        db,
        project=project,
        action="git.diff.ai_review",
        cwd=worktree,
        args=["diff", "--patch", "--find-renames", f"{attempt.base_commit}..{head}"],
        task_id=task.id,
        attempt_id=attempt.id,
        actor_user_id=ai_user.id,
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
        submitted_by_user_id=ai_user.id,
        status="pending",
        base_commit=attempt.base_commit,
        head_commit=head,
        changed_files=_changed_files_from_numstat(numstat, name_status),
        diff_text=diff[:MAX_REVIEW_DIFF],
    )
    db.add(review)
    db.flush()
    run.review_id = review.id
    db.commit()
    db.refresh(review)
    _docker_rm(db, project, attempt, ai_user.id)
    return review


async def _run_ai_task(run_id: int) -> None:
    with SessionLocal() as db:
        run = db.get(AiTaskRun, run_id)
        if run is None:
            return
        try:
            project = db.get(Project, run.project_id)
            task = db.get(Task, run.task_id)
            ai_user = db.get(User, run.ai_user_id) if run.ai_user_id else None
            if project is None or task is None or ai_user is None:
                raise RuntimeError("AI run is missing project, task, or system user.")

            _set_run_state(db, run, status_value="running", step="Preparing sandbox", progress=8)
            _append_run_event(db, run, kind="sandbox", title="Created AI run", detail="Jinoe AI is preparing an isolated task workspace.", step="Preparing sandbox", progress=8)

            with _git_project_lock(project):
                attempt = _create_ai_attempt(
                    db,
                    project=project,
                    task=task,
                    ai_user=ai_user,
                    requested_by_user_id=run.requested_by_user_id,
                )
                run.attempt_id = attempt.id
                task.status = "doing"
                task.assignee_user_id = None
                task.assignee_label = AI_ASSIGNEE_LABEL
                task.progress = max(task.progress or 0, 10)
                task.updated_at = _utcnow()
                db.commit()

            _append_run_event(db, run, kind="sandbox", title="Opened AI sandbox", detail=attempt.branch_name, step="Planning work", progress=15)
            target = AssistantTarget(
                kind="task",
                project=project,
                root_path=Path(attempt.worktree_path).expanduser().resolve(),
                container_name=attempt.container_name,
                task=task,
                attempt=attempt,
            )
            session = load_or_create_session(db, session_id=None, user_id=ai_user.id, target=target)
            replace_target_snapshot(db, session, target)
            run.session_id = session.id
            db.commit()

            prompt = (
                "You have been assigned this Jinoe task as an autonomous coding worker.\n\n"
                f"Task: {task.title}\n\n"
                f"Details:\n{task.body or 'No additional details provided.'}\n\n"
                "Work end to end in this sandbox. First create a concise todo list. Inspect only what you need, "
                "make the code changes, and stop when the task is ready for review. Do not run lint, tests, builds, "
                "python compile checks, npm/pnpm install, or other verification unless the task "
                "explicitly asks for that. Do not ask the user to do anything. Do not commit or run Git write commands; "
                "Jinoe will submit your file changes for review after you finish."
            )
            agent = AssistantAgent(AssistantConfig.from_env())
            request_messages = [AssistantMessageIn(role="user", content=prompt)]

            async for payload in agent.stream(
                db=db,
                session=session,
                target=target,
                request_messages=request_messages,
            ):
                if "c" in payload:
                    _append_run_log(db, run, str(payload.get("c") or ""))
                    continue
                event_type = str(payload.get("event") or "")
                if event_type == "tool_start":
                    name = str(payload.get("name") or "tool")
                    step, progress = _tool_step(name)
                    _append_run_event(
                        db,
                        run,
                        kind="tool",
                        title=f"Started {name}",
                        detail=json.dumps(payload.get("input") or {}, ensure_ascii=False)[:500],
                        status_value="running",
                        step=step,
                        progress=max(progress, run.progress),
                        payload={"tool": name},
                    )
                elif event_type == "tool_result":
                    name = str(payload.get("name") or "tool")
                    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
                    ok = bool(result.get("ok", True)) if isinstance(result, dict) else True
                    _append_run_event(
                        db,
                        run,
                        kind="tool",
                        title=f"Finished {name}",
                        detail=None if ok else str(result.get("error") or "Tool failed")[:800],
                        status_value="done" if ok else "failed",
                        payload={"tool": name, "ok": ok},
                    )
                elif event_type == "tool_log":
                    chunk = str(payload.get("chunk") or "")
                    if chunk:
                        _append_run_log(db, run, chunk)
                elif event_type == "todo_update":
                    todos = payload.get("todos")
                    run.todos = todos if isinstance(todos, list) else []
                    run.current_step = "Working through plan"
                    run.progress = max(run.progress, 30)
                    run.updated_at = _utcnow()
                    db.commit()
                    _append_run_event(db, run, kind="plan", title="Updated plan", payload={"todos": run.todos})
                elif event_type == "error":
                    raise RuntimeError(str(payload.get("error") or "AI run failed"))

            db.refresh(run)
            db.refresh(project)
            db.refresh(task)
            db.refresh(attempt)
            _set_run_state(db, run, step="Submitting review", progress=88)
            _append_run_event(db, run, kind="review", title="Preparing review", step="Submitting review", progress=88)
            with _git_project_lock(project):
                review = _submit_ai_attempt_for_review(
                    db,
                    project=project,
                    task=task,
                    attempt=attempt,
                    ai_user=ai_user,
                    run=run,
                )
            task.progress = 100
            task.updated_at = _utcnow()
            run.review_id = review.id
            db.commit()
            _append_run_event(db, run, kind="review", title="Submitted for review", detail=f"Review #{review.id}", step="Submitted for review", progress=100)
            _set_run_state(db, run, status_value="submitted", step="Submitted for review", progress=100, completed=True)
        except Exception as exc:  # noqa: BLE001 - visible failure state is better than a stuck task.
            detail = str(exc) or "AI task failed"
            _append_run_log(db, run, f"\n\nAI run failed:\n{detail}\n{traceback.format_exc()[-4_000:]}")
            _set_run_state(db, run, status_value="failed", step="Needs attention", error=detail[:2_000], completed=True)
            task = db.get(Task, run.task_id)
            if task is not None and task.status == "doing":
                task.status = "todo"
                task.progress = None
                task.updated_at = _utcnow()
                db.commit()
            _append_run_event(db, run, kind="error", title="AI run failed", detail=detail[:800], status_value="failed")
        finally:
            with _runner_lock:
                _running_run_ids.discard(run_id)


def _start_background_run(run_id: int) -> None:
    with _runner_lock:
        if run_id in _running_run_ids:
            return
        _running_run_ids.add(run_id)
    thread = threading.Thread(target=lambda: asyncio.run(_run_ai_task(run_id)), daemon=True)
    thread.start()


def _latest_ai_run(db: Session, task_id: int) -> AiTaskRun | None:
    return db.scalars(
        select(AiTaskRun)
        .where(AiTaskRun.task_id == task_id)
        .order_by(AiTaskRun.updated_at.desc(), AiTaskRun.id.desc())
        .limit(1)
    ).first()


@router.post("/team/projects/{project_id}/tasks/{task_id}/ai/start", response_model=AiTaskRunOut)
def start_ai_task_run(project_id: int, task_id: int, current_user: CurrentUser, db: Db) -> AiTaskRunOut:
    member = _ensure_membership(db, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can assign work to Jinoe AI.")
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    if project.setup_status != "ready":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Finish project setup before assigning AI.")
    task = _task_for_project(db, project.id, task_id)
    if task.status in {"review", "shipped"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This task is already in review or shipped.")

    existing_run = _latest_ai_run(db, task.id)
    if existing_run and existing_run.status in {"queued", "running"}:
        _start_background_run(existing_run.id)
        return _run_to_out(existing_run)

    active_attempt = db.scalars(
        select(TaskAttempt).where(
            TaskAttempt.project_id == project.id,
            TaskAttempt.task_id == task.id,
            TaskAttempt.status.in_(["active", "submitted"]),
        )
    ).first()
    if active_attempt is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This task already has an active workspace or submitted review.")

    pending_review = db.scalars(
        select(TaskReview).where(
            TaskReview.project_id == project.id,
            TaskReview.task_id == task.id,
            TaskReview.status == "pending",
        )
    ).first()
    if pending_review is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This task is already waiting for review.")

    ai_user = _ensure_system_ai_user(db, member.team_id)
    run = AiTaskRun(
        project_id=project.id,
        task_id=task.id,
        requested_by_user_id=current_user.id,
        ai_user_id=ai_user.id,
        status="queued",
        current_step="Queued",
        progress=0,
        todos=[],
        events=[],
        logs="",
    )
    task.assignee_user_id = None
    task.assignee_label = AI_ASSIGNEE_LABEL
    task.progress = 0
    task.updated_at = _utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)
    _start_background_run(run.id)
    return _run_to_out(run)


@router.get("/team/projects/{project_id}/tasks/{task_id}/ai-run", response_model=AiTaskRunOut | None)
def get_latest_ai_task_run(project_id: int, task_id: int, current_user: CurrentUser, db: Db) -> AiTaskRunOut | None:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)
    _task_for_project(db, project.id, task_id)
    run = _latest_ai_run(db, task_id)
    return _run_to_out(run) if run is not None else None
