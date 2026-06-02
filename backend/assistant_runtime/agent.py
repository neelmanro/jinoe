from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from main import AssistantSession

from .config import AssistantConfig
from .events import event, text_chunk
from .model import ModelClient
from .prompts import build_system_prompt
from .schemas import AssistantMessageIn
from .sessions import save_session_state
from .tokens import estimate_tokens, tail_by_token_budget
from .tools import ToolContext, ToolRegistry

if TYPE_CHECKING:
    from .targets import AssistantTarget


class AssistantAgent:
    def __init__(self, config: AssistantConfig) -> None:
        self.config = config
        self.model = ModelClient(config)
        self.tools = ToolRegistry(config)

    async def stream(
        self,
        *,
        db: Session,
        session: AssistantSession,
        target: AssistantTarget | None,
        request_messages: list[AssistantMessageIn],
    ) -> AsyncGenerator[dict[str, Any], None]:
        messages = _hydrate_messages(session.messages)
        ui_messages = _hydrate_ui_messages(session.ui_messages)
        todos = _hydrate_todos(session.todos)
        messages = _merge_user_input(messages, request_messages)
        ui_messages = _merge_ui_user_input(ui_messages, request_messages)
        summary = session.summary
        tools = self.tools.specs(workspace_enabled=target is not None)

        yield event(
            "session",
            session_id=session.id,
            project_id=session.project_id,
            task_id=session.task_id,
            attempt_id=session.attempt_id,
            target_kind=session.target_kind,
        )

        messages, summary = await self._compact_if_needed(
            messages=messages,
            summary=summary,
            target=target,
            todos=todos,
        )
        save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
        yield event(
            "context_status",
            status="ready",
            usedTokens=estimate_tokens(messages) + estimate_tokens(summary or ""),
            maxTokens=self.config.compact_trigger_tokens,
        )

        tool_context = ToolContext(config=self.config, target=target, db=db, user_id=session.user_id, todos=todos)
        for turn in range(1, self.config.max_turns + 1):
            system_prompt = build_system_prompt(target, summary, todos)
            model_messages = [{"role": "system", "content": system_prompt}, *messages]
            assistant_message: dict[str, Any] | None = None
            try:
                async for model_event in self.model.stream(messages=model_messages, tools=tools):
                    if model_event.get("type") == "content_delta":
                        content_delta = model_event.get("content")
                        if isinstance(content_delta, str) and content_delta:
                            _append_ui_text(ui_messages, content_delta)
                            yield text_chunk(content_delta)
                    elif model_event.get("type") == "tool_call_delta":
                        _upsert_ui_activity(
                            ui_messages,
                            tool_id=str(model_event.get("id") or ""),
                            name=str(model_event.get("name") or ""),
                            input_value=_safe_json_or_raw(model_event.get("arguments") or ""),
                            status="running",
                        )
                        yield event(
                            "tool_delta",
                            id=str(model_event.get("id") or ""),
                            name=str(model_event.get("name") or ""),
                            arguments=model_event.get("arguments") or "",
                            arguments_delta=model_event.get("arguments_delta") or "",
                        )
                    elif model_event.get("type") == "message" and isinstance(model_event.get("message"), dict):
                        assistant_message = model_event["message"]
            except Exception as exc:  # noqa: BLE001 - endpoint should surface model failures cleanly.
                _finish_ui_assistant(ui_messages, "error")
                save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
                yield event("error", error=str(exc))
                return
            if assistant_message is None:
                _finish_ui_assistant(ui_messages, "error")
                save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
                yield event("error", error="Model stream ended without an assistant message.")
                return

            normalized = _normalize_assistant_message(assistant_message)
            messages.append(normalized)
            save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)

            tool_calls = normalized.get("tool_calls")
            if not isinstance(tool_calls, list) or not tool_calls:
                _finish_ui_assistant(ui_messages, "done")
                save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
                yield event("done", session_id=session.id, turns=turn)
                return

            for tool_call in tool_calls:
                call_id, name, raw_args = _tool_call_parts(tool_call)
                if not call_id or not name:
                    continue
                _upsert_ui_activity(ui_messages, tool_id=call_id, name=name, input_value=_safe_json_or_raw(raw_args), status="running")
                save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
                yield event("tool_start", id=call_id, name=name, input=_safe_json(raw_args))
                if name == "run_command":
                    result_payload = {"ok": False, "error": "Command execution did not return a result."}
                    async for command_event in self.tools.stream_command(raw_args, tool_context):
                        if command_event.get("kind") == "log":
                            _append_ui_activity_log(ui_messages, call_id, command_event.get("chunk") or "")
                            save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
                            yield event(
                                "tool_log",
                                id=call_id,
                                name=name,
                                stream=command_event.get("stream"),
                                chunk=command_event.get("chunk") or "",
                            )
                            continue
                        if command_event.get("kind") == "result" and isinstance(command_event.get("result"), dict):
                            result_payload = command_event["result"]
                else:
                    execution = await self.tools.execute(name, raw_args, tool_context)
                    result_payload = execution.result
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": json.dumps(result_payload, ensure_ascii=False, default=str),
                    }
                )
                _complete_ui_activity(ui_messages, call_id, result_payload)
                yield event("tool_result", id=call_id, name=name, result=result_payload)
                if name == "todo_update":
                    _merge_ui_todos(ui_messages, todos)
                    yield event("todo_update", todos=todos)
                save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)

            messages, summary = await self._compact_if_needed(
                messages=messages,
                summary=summary,
                target=target,
                todos=todos,
            )
            save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)

        _finish_ui_assistant(ui_messages, "error")
        save_session_state(db, session, messages=messages, ui_messages=ui_messages, todos=todos, summary=summary)
        yield event("error", error=f"Assistant stopped after {self.config.max_turns} turns to avoid an unbounded loop.")

    async def _compact_if_needed(
        self,
        *,
        messages: list[dict[str, Any]],
        summary: str | None,
        target: AssistantTarget | None,
        todos: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], str | None]:
        token_estimate = estimate_tokens(messages) + estimate_tokens(summary or "")
        if token_estimate < self.config.compact_trigger_tokens:
            return messages, summary

        kept = tail_by_token_budget(messages, self.config.compact_keep_tokens)
        old_count = max(0, len(messages) - len(kept))
        if old_count == 0:
            return messages, summary

        earlier = messages[:old_count]
        summary_prompt = [
            {
                "role": "system",
                "content": (
                    "Summarize this coding assistant conversation for exact continuation. "
                    "Preserve user intent, completed work, files changed, commands run, failures, "
                    "important tool outputs, open todos, and the next best action. No prose fluff."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "previous_summary": summary,
                        "workspace": target.prompt_context() if target else None,
                        "todos": todos,
                        "messages": earlier,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            },
        ]
        try:
            compacted = await self.model.complete(messages=summary_prompt, tools=None, temperature=0.0)
            new_summary = str(compacted.get("content") or "").strip() or summary
        except Exception:
            new_summary = summary or "Earlier conversation context was compacted after reaching the configured context budget."
        return kept, new_summary


def _hydrate_messages(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict) and isinstance(item.get("role"), str)]


def _hydrate_ui_messages(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    messages: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if role not in {"user", "assistant"}:
            continue
        if role == "user":
            content = item.get("content")
            if isinstance(content, str):
                messages.append({"id": str(item.get("id") or f"ui-user-{len(messages)}"), "role": "user", "content": content})
            continue
        activities = item.get("activities") if isinstance(item.get("activities"), list) else []
        blocks = item.get("blocks") if isinstance(item.get("blocks"), list) else []
        messages.append(
            {
                "id": str(item.get("id") or f"ui-assistant-{len(messages)}"),
                "role": "assistant",
                "content": str(item.get("content") or ""),
                "phase": item.get("phase") if item.get("phase") in {"thinking", "working", "responding", "done", "error", "stopped"} else "done",
                "activities": [activity for activity in activities if isinstance(activity, dict)],
                "blocks": [block for block in blocks if isinstance(block, dict)],
            }
        )
    return messages


def _hydrate_todos(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _merge_user_input(
    existing: list[dict[str, Any]],
    incoming: list[AssistantMessageIn],
) -> list[dict[str, Any]]:
    if not incoming:
        return existing
    simple_messages = [{"role": item.role, "content": item.content} for item in incoming]
    if not existing:
        return simple_messages
    last_user = next((item for item in reversed(simple_messages) if item["role"] == "user"), None)
    if last_user is None:
        return existing
    if existing and existing[-1].get("role") == "user" and existing[-1].get("content") == last_user["content"]:
        return existing
    return [*existing, last_user]


def _merge_ui_user_input(existing: list[dict[str, Any]], incoming: list[AssistantMessageIn]) -> list[dict[str, Any]]:
    if not incoming:
        return existing
    next_messages = [*existing]
    for item in incoming:
        if item.role != "user":
            continue
        if next_messages and next_messages[-1].get("role") == "user" and next_messages[-1].get("content") == item.content:
            continue
        next_messages.append({"id": f"ui-user-{len(next_messages) + 1}", "role": "user", "content": item.content})
    return next_messages


def _ensure_ui_assistant(messages: list[dict[str, Any]]) -> dict[str, Any]:
    if messages and messages[-1].get("role") == "assistant" and messages[-1].get("phase") != "done":
        return messages[-1]
    row = {
        "id": f"ui-assistant-{len(messages) + 1}",
        "role": "assistant",
        "content": "",
        "phase": "thinking",
        "activities": [],
        "blocks": [],
    }
    messages.append(row)
    return row


def _append_ui_text(messages: list[dict[str, Any]], chunk: str) -> None:
    row = _ensure_ui_assistant(messages)
    row["content"] = str(row.get("content") or "") + chunk
    row["phase"] = "responding"
    blocks = _ui_blocks(row)
    if blocks and blocks[-1].get("type") == "text":
        blocks[-1]["content"] = str(blocks[-1].get("content") or "") + chunk
    else:
        blocks.append({"id": f"ui-block-{len(blocks) + 1}", "type": "text", "content": chunk})


def _upsert_ui_activity(
    messages: list[dict[str, Any]],
    *,
    tool_id: str,
    name: str,
    input_value: Any,
    status: str,
) -> None:
    if not tool_id:
        return
    row = _ensure_ui_assistant(messages)
    row["phase"] = "working"
    activities = _ui_activities(row)
    activity = next((item for item in activities if item.get("toolId") == tool_id), None)
    input_record = input_value if isinstance(input_value, dict) else {"__rawArguments": input_value}
    if activity is None:
        activity = {
            "id": f"ui-activity-{tool_id}",
            "toolId": tool_id,
            "name": name,
            "input": input_record,
            "status": status,
            "logs": "",
        }
        activities.append(activity)
    else:
        activity["name"] = activity.get("name") or name
        activity["input"] = {**(activity.get("input") if isinstance(activity.get("input"), dict) else {}), **input_record}
        activity["status"] = status
    _ensure_ui_activity_block(row, str(activity["id"]))


def _append_ui_activity_log(messages: list[dict[str, Any]], tool_id: str, chunk: str) -> None:
    activity = _find_ui_activity(messages, tool_id)
    if activity is None:
        return
    activity["logs"] = str(activity.get("logs") or "") + chunk


def _complete_ui_activity(messages: list[dict[str, Any]], tool_id: str, result: dict[str, Any]) -> None:
    activity = _find_ui_activity(messages, tool_id)
    if activity is None:
        return
    activity["result"] = result
    activity["status"] = "success" if result.get("ok") is not False else "error"
    row = _ensure_ui_assistant(messages)
    row["phase"] = "thinking"


def _merge_ui_todos(messages: list[dict[str, Any]], todos: list[dict[str, Any]]) -> None:
    for row in reversed(messages):
        if row.get("role") != "assistant":
            continue
        for activity in reversed(_ui_activities(row)):
            if activity.get("name") == "todo_update":
                result = activity.get("result") if isinstance(activity.get("result"), dict) else {}
                activity["result"] = {**result, "todos": todos}
                return


def _finish_ui_assistant(messages: list[dict[str, Any]], phase: str) -> None:
    if messages and messages[-1].get("role") == "assistant":
        messages[-1]["phase"] = phase


def _ui_activities(row: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(row.get("activities"), list):
        row["activities"] = []
    return row["activities"]


def _ui_blocks(row: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(row.get("blocks"), list):
        row["blocks"] = []
    return row["blocks"]


def _ensure_ui_activity_block(row: dict[str, Any], activity_id: str) -> None:
    blocks = _ui_blocks(row)
    if not any(block.get("type") == "activity" and block.get("activityId") == activity_id for block in blocks):
        blocks.append({"id": f"ui-block-{len(blocks) + 1}", "type": "activity", "activityId": activity_id})


def _find_ui_activity(messages: list[dict[str, Any]], tool_id: str) -> dict[str, Any] | None:
    for row in reversed(messages):
        if row.get("role") != "assistant":
            continue
        for activity in _ui_activities(row):
            if activity.get("toolId") == tool_id:
                return activity
    return None


def _normalize_assistant_message(message: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {"role": "assistant", "content": message.get("content") or ""}
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list):
        normalized["tool_calls"] = tool_calls
    return normalized


def _tool_call_parts(tool_call: Any) -> tuple[str | None, str | None, str | dict[str, Any]]:
    if not isinstance(tool_call, dict):
        return None, None, {}
    function = tool_call.get("function")
    if not isinstance(function, dict):
        return None, None, {}
    return (
        str(tool_call.get("id") or "") or None,
        str(function.get("name") or "") or None,
        function.get("arguments") or {},
    )


def _safe_json(value: str | dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def _safe_json_or_raw(value: Any) -> dict[str, Any]:
    parsed = _safe_json(value if isinstance(value, (str, dict)) else str(value or ""))
    if isinstance(parsed, dict):
        return parsed
    return {"__rawArguments": parsed}
