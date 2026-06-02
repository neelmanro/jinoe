from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import datetime
from typing import Any, Literal

import asyncio

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from assistant_runtime.agent import AssistantAgent
from assistant_runtime.config import AssistantConfig, assistant_config_for_model_key
from assistant_runtime.events import sse
from assistant_runtime.schemas import AssistantChatRequest
from assistant_runtime.sessions import load_or_create_session, replace_target_snapshot
from assistant_runtime.targets import AssistantTarget, resolve_target
from auth import CurrentUser, _ensure_membership
from main import AssistantSession, Db
from project import _get_project_for_member, _require_project_roster


router = APIRouter(tags=["assistant"])


class AssistantSessionMessageOut(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantSessionOut(BaseModel):
    id: str
    project_id: int | None = None
    task_id: int | None = None
    attempt_id: int | None = None
    target_kind: str | None = None
    title: str
    messages: list[AssistantSessionMessageOut]
    ui_messages: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


def _visible_messages(raw: Any) -> list[AssistantSessionMessageOut]:
    if not isinstance(raw, list):
        return []
    messages: list[AssistantSessionMessageOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
            continue
        messages.append(AssistantSessionMessageOut(role=role, content=content))
    return messages


def _session_title(messages: list[AssistantSessionMessageOut]) -> str:
    for message in messages:
        if message.role == "user":
            title = " ".join(message.content.strip().split())
            return title[:72] if title else "New chat"
    return "New chat"


def _session_to_out(session: AssistantSession) -> AssistantSessionOut:
    messages = _visible_messages(session.messages)
    ui_messages = session.ui_messages if isinstance(session.ui_messages, list) else []
    return AssistantSessionOut(
        id=session.id,
        project_id=session.project_id,
        task_id=session.task_id,
        attempt_id=session.attempt_id,
        target_kind=session.target_kind,
        title=_session_title(messages),
        messages=messages,
        ui_messages=ui_messages,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def _target_session_filters(user_id: int, target: AssistantTarget) -> list[Any]:
    filters: list[Any] = [
        AssistantSession.user_id == user_id,
        AssistantSession.project_id == target.project.id,
        AssistantSession.target_kind == target.kind,
    ]
    if target.attempt is not None:
        filters.append(AssistantSession.attempt_id == target.attempt.id)
    else:
        filters.append(AssistantSession.attempt_id.is_(None))
    return filters


@router.get("/assistant/sessions/current", response_model=AssistantSessionOut | None)
def get_current_assistant_session(
    current_user: CurrentUser,
    db: Db,
    project_id: int = Query(ge=1),
    task_id: int | None = Query(default=None, ge=1),
    attempt_id: int | None = Query(default=None, ge=1),
) -> AssistantSessionOut | None:
    member = _ensure_membership(db, current_user)
    target = resolve_target(
        db,
        member=member,
        user_id=current_user.id,
        project_id=project_id,
        task_id=task_id,
        attempt_id=attempt_id,
    )
    if target is None:
        return None
    session = db.scalars(
        select(AssistantSession)
        .where(*_target_session_filters(current_user.id, target))
        .order_by(AssistantSession.updated_at.desc(), AssistantSession.created_at.desc())
        .limit(1)
    ).first()
    return _session_to_out(session) if session is not None else None


@router.get("/assistant/sessions", response_model=list[AssistantSessionOut])
def list_assistant_sessions(
    current_user: CurrentUser,
    db: Db,
    project_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[AssistantSessionOut]:
    member = _ensure_membership(db, current_user)
    query = select(AssistantSession).where(AssistantSession.user_id == current_user.id)
    if project_id is not None:
        project = _get_project_for_member(db, member, project_id)
        _require_project_roster(db, project, member)
        query = query.where(AssistantSession.project_id == project_id)
    sessions = db.scalars(
        query.order_by(AssistantSession.updated_at.desc(), AssistantSession.created_at.desc()).limit(limit)
    ).all()
    return [_session_to_out(session) for session in sessions]


@router.post("/assistant/chat/stream")
async def assistant_chat_stream(
    body: AssistantChatRequest,
    request: Request,
    current_user: CurrentUser,
    db: Db,
) -> StreamingResponse:
    member = _ensure_membership(db, current_user)
    target = resolve_target(
        db,
        member=member,
        user_id=current_user.id,
        project_id=body.project_id,
        task_id=body.task_id,
        attempt_id=body.attempt_id,
    )
    session = load_or_create_session(
        db,
        session_id=body.session_id,
        user_id=current_user.id,
        target=target,
    )
    replace_target_snapshot(db, session, target)
    base_cfg = AssistantConfig.from_env()
    cfg = assistant_config_for_model_key(base_cfg, body.model_key)
    agent = AssistantAgent(cfg)

    async def stream() -> AsyncGenerator[str, None]:
        try:
            async for payload in agent.stream(
                db=db,
                session=session,
                target=target,
                request_messages=body.messages,
            ):
                if await request.is_disconnected():
                    return
                yield sse(payload)
            yield sse("[DONE]")
        except asyncio.CancelledError:
            raise

    return StreamingResponse(stream(), media_type="text/event-stream")
