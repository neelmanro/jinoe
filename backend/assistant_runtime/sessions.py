from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from main import AssistantSession

if TYPE_CHECKING:
    from .targets import AssistantTarget


def load_or_create_session(
    db: Session,
    *,
    session_id: str | None,
    user_id: int,
    target: AssistantTarget | None,
) -> AssistantSession:
    if session_id:
        session = db.get(AssistantSession, session_id)
        if session is None or session.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant session not found.")
        _assert_target_compatible(session, target)
        return session

    session = AssistantSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        messages=[],
        todos=[],
        **_target_fields(target),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def replace_target_snapshot(db: Session, session: AssistantSession, target: AssistantTarget | None) -> None:
    if target is None:
        return
    for field, value in _target_fields(target).items():
        setattr(session, field, value)
    session.updated_at = _utcnow()
    db.commit()


def save_session_state(
    db: Session,
    session: AssistantSession,
    *,
    messages: list[dict[str, Any]],
    ui_messages: list[dict[str, Any]] | None = None,
    todos: list[dict[str, Any]],
    summary: str | None,
) -> None:
    session.messages = messages
    if ui_messages is not None:
        session.ui_messages = ui_messages
    session.todos = todos
    session.summary = summary
    session.updated_at = _utcnow()
    db.commit()


def _target_fields(target: AssistantTarget | None) -> dict[str, Any]:
    if target is None:
        return {
            "project_id": None,
            "task_id": None,
            "attempt_id": None,
            "target_kind": None,
            "target_path": None,
            "container_name": None,
        }
    return {
        "project_id": target.project.id,
        "task_id": target.task.id if target.task else None,
        "attempt_id": target.attempt.id if target.attempt else None,
        "target_kind": target.kind,
        "target_path": str(target.root_path),
        "container_name": target.container_name,
    }


def _assert_target_compatible(session: AssistantSession, target: AssistantTarget | None) -> None:
    if target is None:
        return
    if session.project_id is not None and session.project_id != target.project.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assistant session belongs to a different project.")
    if session.target_kind is not None and session.target_kind != target.kind:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assistant session belongs to a different workspace mode.")
    if (session.attempt_id is not None or target.attempt is not None) and session.attempt_id != (target.attempt.id if target.attempt else None):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assistant session belongs to a different task workspace.")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
