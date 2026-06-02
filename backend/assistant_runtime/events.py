from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any


def sse(payload: Mapping[str, Any] | str) -> str:
    if isinstance(payload, str):
        return f"data: {payload}\n\n"
    return f"data: {json.dumps(dict(payload), ensure_ascii=False)}\n\n"


def text_chunk(text: str) -> dict[str, str]:
    return {"c": text}


def event(event_type: str, **payload: Any) -> dict[str, Any]:
    """Build a stream payload. First arg is the SSE `event` field; use **payload for fields (e.g. tool `name`)."""
    return {"event": event_type, **payload}

