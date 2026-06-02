#########################################################################################################################
# IMPORTS
#########################################################################################################################

from __future__ import annotations
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Generator, Literal, Optional
from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

#########################################################################################################################
# END IMPORTS
#########################################################################################################################

#########################################################################################################################
# ENVIRONMENT
#########################################################################################################################

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
DATABASE_URL = os.environ["DATABASE_URL"]
SQLALCHEMY_ECHO = os.environ["SQLALCHEMY_ECHO"].strip().lower() in {"1", "true", "yes", "on"}
FRONTEND_URL = os.environ["FRONTEND_URL"].rstrip("/")
_cors_raw = os.environ["CORS_ALLOW_ORIGINS"]
_cors_from_env: set[str] = set()
for _cors_part in _cors_raw.split(","):
    _cors_part = _cors_part.strip().rstrip("/")
    if _cors_part:
        _cors_from_env.add(_cors_part)
_cors_from_env.add(FRONTEND_URL)
CORS_ORIGINS = sorted(_cors_from_env)
SMTP_HOST = os.environ["SMTP_HOST"]
SMTP_PORT = int(os.environ["SMTP_PORT"])
SMTP_USER = os.environ["SMTP_USER"]
SMTP_PASSWORD = os.environ["SMTP_PASSWORD"]
SMTP_FROM = os.environ["SMTP_FROM"]
OPENAI_TRANSCRIBE_URL = os.environ["OPENAI_TRANSCRIBE_URL"]
OPENAI_TRANSCRIBE_MODEL = os.environ["OPENAI_TRANSCRIBE_MODEL"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_SCAFFOLD_MODEL = os.environ.get("OPENAI_SCAFFOLD_MODEL", "gpt-5.2")
WORKSPACES_DIR = os.environ.get(
    "JINOE_WORKSPACES_DIR",
    str((BASE_DIR.parent / "jinoe-workspaces").resolve()),
)

#########################################################################################################################
# END ENVIRONMENT
#########################################################################################################################

#########################################################################################################################
# DATABASE & ENGINE
#########################################################################################################################

engine = create_engine(
    DATABASE_URL,
    echo=SQLALCHEMY_ECHO,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)

def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

Db = Annotated[Session, Depends(get_db)]

#########################################################################################################################
# END DATABASE & ENGINE
#########################################################################################################################

#########################################################################################################################
# ORM MODELS
#########################################################################################################################

class Base(DeclarativeBase):
    """Base SQLAlchemy declarative model."""
    pass


class User(Base):
    """Application user account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(200))
    company_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthChallenge(Base):
    """Email verification challenge for owner signup or login verification."""

    __tablename__ = "auth_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16))  # signup | login
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Team(Base):
    """Shared workspace team."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TeamMember(Base):
    """Membership linking a user to a team."""

    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="collaborator")
    last_selected_project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Invite(Base):
    """Workspace invite sent to a user email."""

    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    invited_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    invited_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="collaborator")
    token: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SessionToken(Base):
    """Persistent authentication session token."""

    __tablename__ = "session_tokens"

    token: Mapped[str] = mapped_column(String(96), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Project(Base):
    """Team project workspace."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(7))  # Hex color format: #RRGGBB
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    source_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    github_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    backend_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    frontend_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    database_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    additional_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    workspace_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    setup_status: Mapped[str] = mapped_column(String(24), default="ready", index=True)
    setup_step: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    setup_logs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    setup_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    setup_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    setup_editor_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    setup_container_name: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ProjectMember(Base):
    """Explicit project membership."""

    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Task(Base):
    """Project task item."""

    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("project_id", "ref", name="uq_task_project_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    ref: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True)  # todo | doing | review | shipped
    progress: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    assignee_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    assignee_label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # Example: "AI"
    due_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    shipped: Mapped[bool] = mapped_column(Boolean, default=False)
    comments_count: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)  # List of objects like: {label, tone}
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TaskAttempt(Base):
    """One isolated Git worktree/editor session for a task."""

    __tablename__ = "task_attempts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    branch_name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    base_branch: Mapped[str] = mapped_column(String(160), default="main")
    base_commit: Mapped[str] = mapped_column(String(64))
    head_commit: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    worktree_path: Mapped[str] = mapped_column(Text)
    container_name: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    editor_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    commit_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    diff_stat: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskReview(Base):
    """Submitted task changes waiting for owner decision."""

    __tablename__ = "task_reviews"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("task_attempts.id", ondelete="CASCADE"), unique=True, index=True)
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    decided_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    base_commit: Mapped[str] = mapped_column(String(64))
    head_commit: Mapped[str] = mapped_column(String(64))
    changed_files: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    diff_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    merge_commit: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class GitEvent(Base):
    """Auditable record of each server-side Git action."""

    __tablename__ = "git_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    attempt_id: Mapped[Optional[int]] = mapped_column(ForeignKey("task_attempts.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    cwd: Mapped[str] = mapped_column(Text)
    argv: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    exit_code: Mapped[int] = mapped_column(Integer, default=0)
    stdout: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stderr: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AssistantSession(Base):
    """Persisted coding-assistant conversation scoped to one workspace target."""

    __tablename__ = "assistant_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    attempt_id: Mapped[Optional[int]] = mapped_column(ForeignKey("task_attempts.id", ondelete="SET NULL"), nullable=True, index=True)
    target_kind: Mapped[Optional[str]] = mapped_column(String(24), nullable=True, index=True)
    target_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    container_name: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)
    messages: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    ui_messages: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    todos: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AiTaskRun(Base):
    """Autonomous Jinoe AI run for one assigned task attempt."""

    __tablename__ = "ai_task_runs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[Optional[int]] = mapped_column(ForeignKey("task_attempts.id", ondelete="SET NULL"), nullable=True, index=True)
    session_id: Mapped[Optional[str]] = mapped_column(ForeignKey("assistant_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ai_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    current_step: Mapped[str] = mapped_column(String(200), default="Queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    todos: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    events: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    logs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_id: Mapped[Optional[int]] = mapped_column(ForeignKey("task_reviews.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectChatMessage(Base):
    """Team chat message scoped to one project room."""

    __tablename__ = "project_chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reply_to_message_id: Mapped[Optional[int]] = mapped_column(ForeignKey("project_chat_messages.id", ondelete="SET NULL"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text)
    is_agent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectChatRead(Base):
    """Per-user high-water mark for project chat read receipts."""

    __tablename__ = "project_chat_reads"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_chat_read_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    last_read_message_id: Mapped[int] = mapped_column(ForeignKey("project_chat_messages.id", ondelete="CASCADE"), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ProjectChatReaction(Base):
    """Emoji reaction for a project chat message."""

    __tablename__ = "project_chat_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "kind", name="uq_project_chat_reaction_user_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("project_chat_messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


#########################################################################################################################
# END ORM MODELS
#########################################################################################################################

#########################################################################################################################
# PROJECT DEFAULTS
#########################################################################################################################


def _workspace_name_from_profile(
    *,
    full_name: str,
    company_name: str | None,
) -> str:
    """
    Generate a default workspace name.

    Priority:
        1. Company name
        2. Full name
        3. "My Workspace"
    """

    company = (company_name or "").strip()

    if company:
        return f"{company[:200]} Workspace"

    person = (full_name or "").strip() or "My"

    return f"{person[:200]} Workspace"


#########################################################################################################################
# END PROJECT DEFAULTS
#########################################################################################################################

#########################################################################################################################
# PYDANTIC SCHEMAS
#########################################################################################################################


class SignupIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    company_name: Optional[str] = Field(default=None, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    invite_token: Optional[str] = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    id: int
    full_name: str
    company_name: Optional[str]
    email: str

    model_config = {"from_attributes": True}


class TeamOut(BaseModel):
    id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class InviteOpenIn(BaseModel):
    token: str = Field(min_length=8, max_length=96)


class InviteOpenOut(BaseModel):
    status: str = "ok"
    email: str


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    team: TeamOut
    role: Literal["owner", "collaborator"]


class AuthResponse(BaseModel):
    """Login/signup response."""

    verification_required: bool = False
    challenge_id: str | None = None

    access_token: str | None = None
    token_type: str = "bearer"

    user: UserOut | None = None
    team: TeamOut | None = None
    role: Literal["owner", "collaborator"] | None = None


class VerifyCodeIn(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=36)
    code: str = Field(min_length=6, max_length=12)


class MeOut(BaseModel):
    user: UserOut
    team: TeamOut
    role: Literal["owner", "collaborator"]

    last_selected_project_id: Optional[int] = None


class MemberOut(BaseModel):
    id: int
    full_name: str
    email: str
    company_name: Optional[str]

    role: Literal["owner", "collaborator"]
    status: str = "active"

    joined_at: datetime


class InviteIn(BaseModel):
    email: EmailStr
    role: Literal["collaborator"] = "collaborator"


class InviteOut(BaseModel):
    id: int
    email: str
    invited_name: str |None = None

    role: str
    token: str

    accepted_at: Optional[datetime]
    opened_at: Optional[datetime] = None
    created_at: datetime

    invite_url: str


class WorkspacePrefsIn(BaseModel):
    """Persisted per account."""

    last_selected_project_id: Optional[int] = None


class WorkspaceUpdateIn(BaseModel):
    """Rename current workspace."""

    name: str = Field(min_length=1, max_length=120)


class ProjectOut(BaseModel):
    id: int
    team_id: int

    name: str
    description: Optional[str] = None
    color: str
    source_type: Optional[str] = None
    github_url: Optional[str] = None
    backend_notes: Optional[str] = None
    frontend_notes: Optional[str] = None
    database_notes: Optional[str] = None
    additional_notes: Optional[str] = None
    workspace_path: Optional[str] = None
    setup_status: str = "ready"
    setup_step: Optional[str] = None
    setup_logs: Optional[str] = None
    setup_error: Optional[str] = None
    setup_completed_at: Optional[datetime] = None
    setup_editor_url: Optional[str] = None

    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    color: str | None = Field(default=None, max_length=7)
    description: str | None = Field(default=None, max_length=20_000)

    member_user_ids: list[int] = Field(default_factory=list)


class ProjectPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    color: str | None = Field(default=None, max_length=7)


class ProjectSetupStatusOut(BaseModel):
    id: int
    setup_status: str
    setup_step: Optional[str] = None
    setup_logs: Optional[str] = None
    setup_error: Optional[str] = None
    setup_completed_at: Optional[datetime] = None
    workspace_path: Optional[str] = None


class RepoEntryOut(BaseModel):
    path: str
    name: str
    type: Literal["file", "directory"]
    size: Optional[int] = None


class RepoFileOut(BaseModel):
    path: str
    name: str
    content: str
    size: int


class TaskTagOut(BaseModel):
    label: str
    tone: str


class TaskOut(BaseModel):
    id: int
    project_id: int

    ref: str
    title: str
    body: Optional[str] = None

    status: Literal["todo", "doing", "review", "shipped"]

    tags: list[TaskTagOut] = []

    progress: Optional[int] = None

    assignee_user_id: Optional[int] = None
    assignee: str

    due_at: Optional[date] = None

    shipped: bool

    comments_count: int

    ai_run: Optional["AiTaskRunOut"] = None

    created_at: datetime
    updated_at: datetime


class AiTaskRunOut(BaseModel):
    id: int
    project_id: int
    task_id: int
    attempt_id: Optional[int] = None
    session_id: Optional[str] = None
    status: str
    current_step: str
    progress: int
    todos: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    logs: Optional[str] = None
    error: Optional[str] = None
    review_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TaskAttemptOut(BaseModel):
    id: int
    project_id: int
    task_id: int
    user_id: int
    branch_name: str
    base_branch: str
    base_commit: str
    head_commit: Optional[str] = None
    worktree_path: str
    editor_url: Optional[str] = None
    status: str
    diff_stat: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ProjectSetupEditorOut(BaseModel):
    project_id: int
    editor_url: str
    setup_status: str
    branch_name: str = "main"
    repo_path: str


class ReviewChangedFileOut(BaseModel):
    path: str
    status: str
    additions: int = 0
    deletions: int = 0


class TaskReviewOut(BaseModel):
    id: int
    project_id: int
    task_id: int
    attempt_id: int
    task_ref: str
    task_title: str
    submitted_by_user_id: int
    submitted_by_name: str
    status: str
    branch_name: str
    base_commit: str
    head_commit: str
    changed_files: list[ReviewChangedFileOut] = []
    diff_text: Optional[str] = None
    merge_commit: Optional[str] = None
    decision_note: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    decided_at: Optional[datetime] = None


class ReviewDecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=5_000)


class TaskCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    body: str | None = Field(default=None, max_length=50_000)

    status: Literal[
        "todo",
        "doing",
        "review",
        "shipped",
    ] = "todo"

    tags: list[TaskTagOut] = Field(default_factory=list)

    progress: Optional[int] = Field(
        default=None,
        ge=0,
        le=100,
    )

    assignee_user_id: Optional[int] = None
    assignee_label: str | None = Field(default=None, max_length=120)

    due_at: Optional[date] = None
    shipped: bool = False


class TaskUpdateIn(BaseModel):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=500,
    )

    body: str | None = None

    status: Optional[
        Literal["todo", "doing", "review", "shipped"]
    ] = None

    tags: list[TaskTagOut] | None = None

    progress: Optional[int] = Field(
        default=None,
        ge=0,
        le=100,
    )

    assignee_user_id: Optional[int] = None
    assignee_label: str | None = Field(default=None, max_length=120)

    due_at: Optional[date] = None

    shipped: bool | None = None


class TranscribeOut(BaseModel):
    text: str


class ProjectMemberOut(BaseModel):
    user_id: int
    full_name: str
    email: str

    role: Literal["owner", "collaborator"]


class ProjectMemberAddIn(BaseModel):
    user_id: int = Field(ge=1)


class ChatMessageCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    reply_to_message_id: Optional[int] = None


class ChatMessageUpdateIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)


class ChatReadIn(BaseModel):
    last_read_message_id: int = Field(ge=1)


class ChatReactionIn(BaseModel):
    kind: Literal["thumbs_up", "heart", "laugh", "surprised"]


class ChatReplyOut(BaseModel):
    id: int
    author_name: str
    body_preview: str


class ChatReactionOut(BaseModel):
    kind: Literal["thumbs_up", "heart", "laugh", "surprised"]
    count: int
    mine: bool


class ChatReaderOut(BaseModel):
    user_id: int
    full_name: str


class ChatReceiptOut(BaseModel):
    state: Literal["sent", "read"]
    read_by_user_id: Optional[int] = None
    read_by_name: Optional[str] = None
    read_by: list[ChatReaderOut] = []


class ChatMessageOut(BaseModel):
    id: int
    author_user_id: Optional[int]
    author_name: str
    body: str
    is_agent: bool
    edited_at: Optional[datetime] = None
    created_at: datetime
    reply_to: Optional[ChatReplyOut] = None
    reactions: list[ChatReactionOut] = []
    receipt: Optional[ChatReceiptOut] = None


#########################################################################################################################
# END PYDANTIC SCHEMAS
#########################################################################################################################

from auth import router as auth_router
from Assistant import router as assistant_router
from ai_tasks import router as ai_tasks_router
from project import router as project_router
from tasks import router as tasks_router
from task_workflow import router as task_workflow_router
from team import router as team_router
from chat import router as chat_router



app = FastAPI(title="API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(assistant_router)
app.include_router(ai_tasks_router)
app.include_router(project_router)
app.include_router(tasks_router)
app.include_router(task_workflow_router)
app.include_router(team_router)
app.include_router(chat_router)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_runtime_columns()


def _ensure_runtime_columns() -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("assistant_sessions")}
    if "ui_messages" in columns:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE assistant_sessions ADD COLUMN IF NOT EXISTS ui_messages JSON"))
        else:
            conn.execute(text("ALTER TABLE assistant_sessions ADD COLUMN ui_messages JSON"))
