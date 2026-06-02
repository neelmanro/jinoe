from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from .config import AssistantConfig


class ModelClient:
    def __init__(self, config: AssistantConfig) -> None:
        self.config = config

    async def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        if not self.config.api_key:
            raise RuntimeError("Missing assistant API key")

        payload = self._payload(messages=messages, tools=tools, temperature=temperature, stream=False)

        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=20.0)) as client:
            for attempt in range(1, self.config.max_model_retries + 1):
                try:
                    response = await client.post(
                        self.config.chat_url,
                        headers={
                            "Authorization": f"Bearer {self.config.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                    response.raise_for_status()
                    data = response.json()
                    choices = data.get("choices") or []
                    if not choices:
                        raise RuntimeError("Model returned no choices")
                    message = choices[0].get("message")
                    if not isinstance(message, dict):
                        raise RuntimeError("Model returned an invalid message")
                    return message
                except (httpx.HTTPStatusError, httpx.HTTPError, RuntimeError, ValueError) as exc:
                    last_error = exc
                    if attempt >= self.config.max_model_retries:
                        break
                    await asyncio.sleep(min(1.5 * attempt, 4.0))

        raise RuntimeError(str(last_error) if last_error else "Model request failed")

    async def stream(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float = 0.2,
    ) -> AsyncGenerator[dict[str, Any], None]:
        if not self.config.api_key:
            raise RuntimeError("Missing assistant API key")

        payload = self._payload(messages=messages, tools=tools, temperature=temperature, stream=True)
        last_error: Exception | None = None
        for attempt in range(1, self.config.max_model_retries + 1):
            content_parts: list[str] = []
            tool_calls: dict[int, dict[str, Any]] = {}
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=20.0)) as client:
                    async with client.stream(
                        "POST",
                        self.config.chat_url,
                        headers={
                            "Authorization": f"Bearer {self.config.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            raw = line.removeprefix("data:").strip()
                            if not raw:
                                continue
                            if raw == "[DONE]":
                                break
                            chunk = json.loads(raw)
                            choices = chunk.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}
                            if not isinstance(delta, dict):
                                continue
                            content = delta.get("content")
                            if isinstance(content, str) and content:
                                content_parts.append(content)
                                yield {"type": "content_delta", "content": content}
                            for tool_delta in _merge_tool_call_deltas(tool_calls, delta.get("tool_calls")):
                                yield {"type": "tool_call_delta", **tool_delta}

                yield {
                    "type": "message",
                    "message": {
                        "role": "assistant",
                        "content": "".join(content_parts),
                        "tool_calls": _finished_tool_calls(tool_calls),
                    },
                }
                return
            except asyncio.CancelledError:
                raise
            except (httpx.HTTPStatusError, httpx.HTTPError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt >= self.config.max_model_retries:
                    break
                await asyncio.sleep(min(1.5 * attempt, 4.0))

        raise RuntimeError(str(last_error) if last_error else "Model stream failed")

    def _payload(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float,
        stream: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": stream,
        }
        if not self._is_kimi():
            payload["temperature"] = temperature
        elif self.config.thinking_disabled:
            payload["thinking"] = {"type": "disabled"}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return payload

    def _is_kimi(self) -> bool:
        return self.config.provider == "kimi" or self.config.model.startswith("kimi-")


def _merge_tool_call_deltas(tool_calls: dict[int, dict[str, Any]], deltas: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not isinstance(deltas, list):
        return events
    for fallback_index, delta in enumerate(deltas):
        if not isinstance(delta, dict):
            continue
        raw_index = delta.get("index")
        index = raw_index if isinstance(raw_index, int) else fallback_index
        current = tool_calls.setdefault(index, {"type": "function", "function": {"name": "", "arguments": ""}})
        if isinstance(delta.get("id"), str):
            current["id"] = delta["id"]
        if isinstance(delta.get("type"), str):
            current["type"] = delta["type"]
        function_delta = delta.get("function")
        arguments_delta = ""
        if not isinstance(function_delta, dict):
            continue
        function = current.setdefault("function", {"name": "", "arguments": ""})
        if isinstance(function_delta.get("name"), str) and function_delta["name"]:
            function["name"] = function_delta["name"]
        if isinstance(function_delta.get("arguments"), str):
            arguments_delta = function_delta["arguments"]
            function["arguments"] = str(function.get("arguments") or "") + arguments_delta
        events.append(
            {
                "id": str(current.get("id") or f"tool-call-{index}"),
                "index": index,
                "name": str(function.get("name") or ""),
                "arguments_delta": arguments_delta,
                "arguments": str(function.get("arguments") or ""),
            }
        )
    return events


def _finished_tool_calls(tool_calls: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    finished: list[dict[str, Any]] = []
    for index in sorted(tool_calls):
        call = tool_calls[index]
        function = call.get("function")
        if not isinstance(function, dict) or not function.get("name"):
            continue
        finished.append(
            {
                "id": str(call.get("id") or f"tool-call-{index}"),
                "type": str(call.get("type") or "function"),
                "function": {
                    "name": str(function.get("name") or ""),
                    "arguments": str(function.get("arguments") or ""),
                },
            }
        )
    return finished

