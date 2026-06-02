from __future__ import annotations

import os
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class AssistantConfig:
    api_key: str | None
    chat_url: str
    model: str
    provider: str
    thinking_disabled: bool
    tavily_api_key: str | None
    max_turns: int
    max_model_retries: int
    max_tool_output_chars: int
    max_file_read_bytes: int
    max_file_write_bytes: int
    max_command_seconds: int
    compact_trigger_tokens: int
    compact_keep_tokens: int

    @classmethod
    def from_env(cls) -> "AssistantConfig":
        kimi_api_key = os.getenv("KIMI_API_KEY") or os.getenv("MOONSHOT_API_KEY")
        provider = os.getenv("JINOE_ASSISTANT_PROVIDER") or ("kimi" if kimi_api_key else "deepseek")
        provider = provider.strip().lower()
        use_kimi_defaults = provider == "kimi"
        use_deepseek_defaults = provider == "deepseek"
        return cls(
            api_key=(kimi_api_key if use_kimi_defaults else None)
            or (os.getenv("DEEPSEEK_API_KEY") if use_deepseek_defaults else None)
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("DEEPSEEK_API_KEY"),
            chat_url=os.getenv("JINOE_ASSISTANT_CHAT_URL")
            or (os.getenv("KIMI_CHAT_URL", "https://api.moonshot.ai/v1/chat/completions") if use_kimi_defaults else None)
            or (os.getenv("DEEPSEEK_CHAT_URL", "https://api.deepseek.com/chat/completions") if use_deepseek_defaults else None)
            or os.getenv("OPENAI_CHAT_URL")
            or os.getenv("DEEPSEEK_CHAT_URL")
            or "https://api.openai.com/v1/chat/completions",
            model=os.getenv("JINOE_ASSISTANT_MODEL")
            or (os.getenv("KIMI_CHAT_MODEL", "kimi-k2.6") if use_kimi_defaults else None)
            or (os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat") if use_deepseek_defaults else None)
            or os.getenv("OPENAI_CHAT_MODEL")
            or os.getenv("DEEPSEEK_CHAT_MODEL")
            or "gpt-4o",
            provider=provider,
            thinking_disabled=_env_bool("JINOE_ASSISTANT_DISABLE_THINKING", True),
            tavily_api_key=os.getenv("TAVILY_API_KEY"),
            max_turns=_env_int("JINOE_ASSISTANT_MAX_TURNS", 48, minimum=1, maximum=200),
            max_model_retries=_env_int("JINOE_ASSISTANT_MODEL_RETRIES", 3, minimum=1, maximum=8),
            max_tool_output_chars=_env_int("JINOE_ASSISTANT_TOOL_OUTPUT_CHARS", 32_000, minimum=2_000, maximum=200_000),
            max_file_read_bytes=_env_int("JINOE_ASSISTANT_MAX_READ_BYTES", 240_000, minimum=16_000, maximum=2_000_000),
            max_file_write_bytes=_env_int("JINOE_ASSISTANT_MAX_WRITE_BYTES", 2_000_000, minimum=16_000, maximum=20_000_000),
            max_command_seconds=_env_int("JINOE_ASSISTANT_COMMAND_TIMEOUT", 180, minimum=5, maximum=3_600),
            compact_trigger_tokens=_env_int("JINOE_ASSISTANT_COMPACT_TRIGGER", 220_000, minimum=20_000, maximum=1_000_000),
            compact_keep_tokens=_env_int("JINOE_ASSISTANT_COMPACT_KEEP", 40_000, minimum=5_000, maximum=250_000),
        )


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


MODEL_KEY_ENV_VARS: dict[str, str] = {
    "jinoe-1-0": "JINOE_ASSISTANT_MODEL_JINOE_1_0",
    "gpt-5-5": "JINOE_ASSISTANT_MODEL_GPT_55",
    "codex-5-3": "JINOE_ASSISTANT_MODEL_CODEX_53",
    "sonnet-4-6": "JINOE_ASSISTANT_MODEL_SONNET_46",
    "opus-4-7": "JINOE_ASSISTANT_MODEL_OPUS_47",
    "gpt-5-4": "JINOE_ASSISTANT_MODEL_GPT_54",
    "gpt-5-2": "JINOE_ASSISTANT_MODEL_GPT_52",
}


def assistant_config_for_model_key(base: AssistantConfig, model_key: str | None) -> AssistantConfig:
    """
    Map UI model keys to provider model ids via env vars.
    Unknown keys or missing env overrides keep ``base.model``.
    """

    if not model_key:
        return base
    env_var = MODEL_KEY_ENV_VARS.get(model_key)
    if not env_var:
        return base
    raw = os.getenv(env_var, "").strip()
    if not raw:
        return base
    return replace(base, model=raw)
