from __future__ import annotations

import json
from typing import Any


def estimate_tokens(value: Any) -> int:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    return max(1, len(text) // 4)


def tail_by_token_budget(messages: list[dict[str, Any]], keep_tokens: int) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    used = 0
    for message in reversed(messages):
        cost = estimate_tokens(message)
        if kept and used + cost > keep_tokens:
            break
        kept.append(message)
        used += cost
    kept.reverse()
    return kept

