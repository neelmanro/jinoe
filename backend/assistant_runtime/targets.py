from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from main import Project, Task, TaskAttempt
from project import _get_project_for_member, _project_main_repo_path, _require_project_roster


@dataclass(frozen=True)
class AssistantTarget:
    kind: str
    project: Project
    root_path: Path
    container_name: str | None
    task: Task | None = None
    attempt: TaskAttempt | None = None

    def prompt_context(self) -> str:
        lines = [
            "Workspace context:",
            f"- Project: {self.project.name}",
            f"- Mode: {self.kind}",
            "- Workspace root inside tools and terminal commands: /home/coder/project",
        ]
        if self.task is not None:
            lines.extend(
                [
                    f"- Task ref: {self.task.ref}",
                    f"- Task title: {self.task.title}",
                    f"- Task description: {self.task.body or 'No description provided.'}",
                ]
            )
        if self.attempt is not None:
            lines.extend(
                [
                    f"- Task branch: {self.attempt.branch_name}",
                    f"- Task attempt id: {self.attempt.id}",
                ]
            )
        return "\n".join(lines)


def resolve_target(
    db: Session,
    *,
    member,
    user_id: int,
    project_id: int | None,
    task_id: int | None,
    attempt_id: int | None,
) -> AssistantTarget | None:
    if project_id is None:
        return None

    project = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, project, member)

    if attempt_id is not None:
        attempt = db.get(TaskAttempt, attempt_id)
        if attempt is None or attempt.project_id != project.id or attempt.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant task workspace not found.")
        return _attempt_target(db, project, attempt)

    if task_id is not None:
        attempt = db.scalars(
            select(TaskAttempt)
            .where(
                TaskAttempt.project_id == project.id,
                TaskAttempt.task_id == task_id,
                TaskAttempt.user_id == user_id,
                TaskAttempt.status == "active",
            )
            .order_by(TaskAttempt.updated_at.desc(), TaskAttempt.id.desc())
        ).first()
        if attempt is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Start this task before using its assistant.")
        return _attempt_target(db, project, attempt)

    active = db.scalars(
        select(TaskAttempt)
        .where(
            TaskAttempt.project_id == project.id,
            TaskAttempt.user_id == user_id,
            TaskAttempt.status == "active",
        )
        .order_by(TaskAttempt.updated_at.desc(), TaskAttempt.id.desc())
    ).first()
    if active is not None:
        return _attempt_target(db, project, active)

    if project.setup_status != "ready":
        repo = _project_main_repo_path(project)
        return AssistantTarget(
            kind="setup",
            project=project,
            root_path=repo,
            container_name=project.setup_container_name,
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Open a setup or task editor before using the coding assistant for this project.",
    )


def _attempt_target(db: Session, project: Project, attempt: TaskAttempt) -> AssistantTarget:
    task = db.get(Task, attempt.task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found for this assistant workspace.")
    root = Path(attempt.worktree_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The task workspace folder is no longer available.")
    return AssistantTarget(
        kind="task",
        project=project,
        root_path=root,
        container_name=attempt.container_name,
        task=task,
        attempt=attempt,
    )
