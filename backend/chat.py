#########################################################################################################################
# IMPORTS
#########################################################################################################################

from __future__ import annotations
from datetime import datetime, timezone
import json
from typing import Any
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from auth import CurrentUser, _ensure_membership
from project import _ensure_project_visible_to_member, _get_project_for_member
from main import (
    ChatMessageCreateIn,
    ChatMessageOut,
    ChatMessageUpdateIn,
    ChatReactionIn,
    ChatReactionOut,
    ChatReadIn,
    ChatReaderOut,
    ChatReceiptOut,
    ChatReplyOut,
    Db,
    Project,
    ProjectChatMessage,
    ProjectChatReaction,
    ProjectChatRead,
    ProjectMember,
    SessionLocal,
    SessionToken,
    TeamMember,
    User,
)

#########################################################################################################################
# END IMPORTS
#########################################################################################################################

router = APIRouter(tags=["chat"])

CHAT_LIMIT_MAX = 300


class ProjectChatSocketManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, project_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(project_id, set()).add(websocket)

    def disconnect(self, project_id: int, websocket: WebSocket) -> None:
        sockets = self._connections.get(project_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(project_id, None)

    async def broadcast(self, project_id: int, event: dict[str, Any]) -> None:
        sockets = list(self._connections.get(project_id, set()))
        if not sockets:
            return

        payload = json.dumps(event, default=str)
        stale: list[WebSocket] = []

        for socket in sockets:
            try:
                await socket.send_text(payload)
            except Exception:  # noqa: BLE001 - stale sockets are cleaned after best-effort broadcast.
                stale.append(socket)

        for socket in stale:
            self.disconnect(project_id, socket)


socket_manager = ProjectChatSocketManager()


def _body_preview(body: str, limit: int = 120) -> str:
    text = " ".join((body or "").split())
    if not text:
        return "..."
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1]}..."


def _project_participant_user_ids(db: Session, project: Project) -> set[int]:
    project_user_ids = set(
        db.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
        ).all()
    )
    owner_user_ids = set(
        db.scalars(
            select(TeamMember.user_id).where(
                TeamMember.team_id == project.team_id,
                TeamMember.role == "owner",
            )
        ).all()
    )
    return project_user_ids | owner_user_ids


def _serialize_messages(
    db: Session,
    *,
    project: Project,
    messages: list[ProjectChatMessage],
    current_user_id: int,
) -> list[ChatMessageOut]:
    if not messages:
        return []

    message_ids = [message.id for message in messages]
    reply_ids = [message.reply_to_message_id for message in messages if message.reply_to_message_id is not None]
    participant_user_ids = _project_participant_user_ids(db, project)

    user_ids: set[int] = {message.author_user_id for message in messages if message.author_user_id is not None}

    reply_messages: dict[int, ProjectChatMessage] = {}
    if reply_ids:
        reply_rows = db.scalars(
            select(ProjectChatMessage).where(
                ProjectChatMessage.project_id == project.id,
                ProjectChatMessage.id.in_(reply_ids),
            )
        ).all()
        reply_messages = {message.id: message for message in reply_rows}
        user_ids.update(message.author_user_id for message in reply_rows if message.author_user_id is not None)

    read_rows = db.execute(
        select(ProjectChatRead, User)
        .join(User, User.id == ProjectChatRead.user_id)
        .where(
            ProjectChatRead.project_id == project.id,
            ProjectChatRead.user_id.in_(participant_user_ids) if participant_user_ids else False,
        )
    ).all()

    reaction_rows = db.execute(
        select(ProjectChatReaction.message_id, ProjectChatReaction.kind, ProjectChatReaction.user_id, func.count(ProjectChatReaction.id))
        .where(ProjectChatReaction.message_id.in_(message_ids))
        .group_by(ProjectChatReaction.message_id, ProjectChatReaction.kind, ProjectChatReaction.user_id)
    ).all()

    if user_ids:
        users_by_id = {
            user.id: user
            for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
        }
    else:
        users_by_id = {}

    reads_by_message_id: dict[int, list[ChatReaderOut]] = {message_id: [] for message_id in message_ids}
    for read, user in read_rows:
        for message in messages:
            if user.id == message.author_user_id:
                continue
            if read.last_read_message_id >= message.id:
                reads_by_message_id[message.id].append(
                    ChatReaderOut(
                        user_id=user.id,
                        full_name=user.full_name,
                    )
                )

    reaction_counts: dict[int, dict[str, int]] = {}
    reaction_mine: dict[int, set[str]] = {}
    for message_id, kind, user_id, count in reaction_rows:
        reaction_counts.setdefault(message_id, {})
        reaction_counts[message_id][kind] = reaction_counts[message_id].get(kind, 0) + int(count)
        if user_id == current_user_id:
            reaction_mine.setdefault(message_id, set()).add(kind)

    out: list[ChatMessageOut] = []

    for message in messages:
        author = users_by_id.get(message.author_user_id)
        readers = reads_by_message_id.get(message.id, [])
        first_reader = readers[0] if readers else None
        reply_to: ChatReplyOut | None = None

        if message.reply_to_message_id is not None:
            reply = reply_messages.get(message.reply_to_message_id)
            if reply:
                reply_author = users_by_id.get(reply.author_user_id)
                reply_to = ChatReplyOut(
                    id=reply.id,
                    author_name=reply_author.full_name if reply_author else "Unknown",
                    body_preview=_body_preview(reply.body),
                )

        reactions = [
            ChatReactionOut(
                kind=kind,  # type: ignore[arg-type]
                count=count,
                mine=kind in reaction_mine.get(message.id, set()),
            )
            for kind, count in sorted(reaction_counts.get(message.id, {}).items())
        ]

        out.append(
            ChatMessageOut(
                id=message.id,
                author_user_id=message.author_user_id,
                author_name=author.full_name if author else "Unknown",
                body=message.body,
                is_agent=message.is_agent,
                edited_at=message.edited_at,
                created_at=message.created_at,
                reply_to=reply_to,
                reactions=reactions,
                receipt=ChatReceiptOut(
                    state="read" if readers else "sent",
                    read_by_user_id=first_reader.user_id if first_reader else None,
                    read_by_name=first_reader.full_name if first_reader else None,
                    read_by=readers,
                ),
            )
        )

    return out


def _serialize_message(
    db: Session,
    *,
    project: Project,
    message: ProjectChatMessage,
    current_user_id: int,
) -> ChatMessageOut:
    return _serialize_messages(db, project=project, messages=[message], current_user_id=current_user_id)[0]


def _require_project_chat_access(db: Session, current_user: User, project_id: int) -> Project:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)
    _ensure_project_visible_to_member(db, project, member)
    return project


def _auth_user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session_token = db.get(SessionToken, token.strip())
    if not session_token:
        return None
    return db.get(User, session_token.user_id)


async def _broadcast_refresh(project_id: int) -> None:
    await socket_manager.broadcast(project_id, {"type": "chat.refresh", "project_id": project_id})


@router.get("/team/projects/{project_id}/chat/messages", response_model=list[ChatMessageOut])
def list_project_chat_messages(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
    limit: int = Query(default=200, ge=1, le=CHAT_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
) -> list[ChatMessageOut]:
    project = _require_project_chat_access(db, current_user, project_id)

    rows = list(
        db.scalars(
            select(ProjectChatMessage)
            .where(ProjectChatMessage.project_id == project.id)
            .order_by(ProjectChatMessage.created_at.desc(), ProjectChatMessage.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
    )
    rows.reverse()

    return _serialize_messages(db, project=project, messages=rows, current_user_id=current_user.id)


@router.post(
    "/team/projects/{project_id}/chat/messages",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_chat_message(
    project_id: int,
    body: ChatMessageCreateIn,
    current_user: CurrentUser,
    db: Db,
) -> ChatMessageOut:
    project = _require_project_chat_access(db, current_user, project_id)
    text = body.body.strip()

    reply_to: ProjectChatMessage | None = None
    if body.reply_to_message_id is not None:
        reply_to = db.get(ProjectChatMessage, body.reply_to_message_id)
        if not reply_to or reply_to.project_id != project.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reply message not found")

    message = ProjectChatMessage(
        project_id=project.id,
        author_user_id=current_user.id,
        reply_to_message_id=reply_to.id if reply_to else None,
        body=text,
        is_agent=False,
    )
    db.add(message)
    db.flush()

    existing_read = db.scalars(
        select(ProjectChatRead).where(
            ProjectChatRead.project_id == project.id,
            ProjectChatRead.user_id == current_user.id,
        )
    ).first()

    if existing_read:
        existing_read.last_read_message_id = max(existing_read.last_read_message_id, message.id)
        existing_read.updated_at = datetime.now(timezone.utc)
    else:
        db.add(
            ProjectChatRead(
                project_id=project.id,
                user_id=current_user.id,
                last_read_message_id=message.id,
                updated_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    db.refresh(message)

    out = _serialize_message(db, project=project, message=message, current_user_id=current_user.id)
    await _broadcast_refresh(project.id)
    return out


@router.patch("/team/projects/{project_id}/chat/messages/{message_id}", response_model=ChatMessageOut)
async def update_project_chat_message(
    project_id: int,
    message_id: int,
    body: ChatMessageUpdateIn,
    current_user: CurrentUser,
    db: Db,
) -> ChatMessageOut:
    project = _require_project_chat_access(db, current_user, project_id)
    message = db.get(ProjectChatMessage, message_id)

    if not message or message.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if message.author_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own messages")

    message.body = body.body.strip()
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)

    out = _serialize_message(db, project=project, message=message, current_user_id=current_user.id)
    await _broadcast_refresh(project.id)
    return out


@router.post("/team/projects/{project_id}/chat/messages/{message_id}/reactions", response_model=ChatMessageOut)
async def toggle_project_chat_reaction(
    project_id: int,
    message_id: int,
    body: ChatReactionIn,
    current_user: CurrentUser,
    db: Db,
) -> ChatMessageOut:
    project = _require_project_chat_access(db, current_user, project_id)
    message = db.get(ProjectChatMessage, message_id)

    if not message or message.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    existing = db.scalars(
        select(ProjectChatReaction).where(
            ProjectChatReaction.message_id == message.id,
            ProjectChatReaction.user_id == current_user.id,
            ProjectChatReaction.kind == body.kind,
        )
    ).first()

    if existing:
        db.delete(existing)
    else:
        db.add(
            ProjectChatReaction(
                message_id=message.id,
                user_id=current_user.id,
                kind=body.kind,
            )
        )

    db.commit()
    db.refresh(message)

    out = _serialize_message(db, project=project, message=message, current_user_id=current_user.id)
    await _broadcast_refresh(project.id)
    return out


@router.post("/team/projects/{project_id}/chat/read")
async def mark_project_chat_read(
    project_id: int,
    body: ChatReadIn,
    current_user: CurrentUser,
    db: Db,
) -> dict[str, str]:
    project = _require_project_chat_access(db, current_user, project_id)
    message = db.get(ProjectChatMessage, body.last_read_message_id)

    if not message or message.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    existing = db.scalars(
        select(ProjectChatRead).where(
            ProjectChatRead.project_id == project.id,
            ProjectChatRead.user_id == current_user.id,
        )
    ).first()

    changed = False
    now = datetime.now(timezone.utc)

    if existing:
        if body.last_read_message_id > existing.last_read_message_id:
            existing.last_read_message_id = body.last_read_message_id
            existing.updated_at = now
            changed = True
    else:
        db.add(
            ProjectChatRead(
                project_id=project.id,
                user_id=current_user.id,
                last_read_message_id=body.last_read_message_id,
                updated_at=now,
            )
        )
        changed = True

    if changed:
        db.commit()
        await _broadcast_refresh(project.id)
    else:
        db.rollback()

    return {"status": "ok"}


@router.websocket("/team/projects/{project_id}/chat/ws")
async def project_chat_ws(websocket: WebSocket, project_id: int) -> None:
    token = websocket.query_params.get("token")
    db = SessionLocal()
    try:
        user = _auth_user_from_token(db, token)
        if not user:
            await websocket.close(code=1008)
            return
        _require_project_chat_access(db, user, project_id)
    except Exception:
        await websocket.close(code=1008)
        return
    finally:
        db.close()

    await socket_manager.connect(project_id, websocket)
    try:
        await websocket.send_json({"type": "chat.connected", "project_id": project_id})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        socket_manager.disconnect(project_id, websocket)
