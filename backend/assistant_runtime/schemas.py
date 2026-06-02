from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AssistantMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1_000_000)


AssistantModelKey = Literal[
    "jinoe-1-0",
    "gpt-5-5",
    "codex-5-3",
    "sonnet-4-6",
    "opus-4-7",
    "gpt-5-4",
    "gpt-5-2",
]


class AssistantChatRequest(BaseModel):
    messages: list[AssistantMessageIn] = Field(default_factory=list, max_length=2_000)
    session_id: str | None = Field(default=None, max_length=36)
    project_id: int | None = Field(default=None, ge=1)
    task_id: int | None = Field(default=None, ge=1)
    attempt_id: int | None = Field(default=None, ge=1)
    model_key: AssistantModelKey | None = None


class AssistantTodo(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=500)
    status: Literal["pending", "in_progress", "completed"]

