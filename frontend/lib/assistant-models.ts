const STORAGE_KEY = "Jinoe.assistantModelKey";

export const ASSISTANT_MODEL_OPTIONS = [
  { id: "jinoe-1-0", label: "Jinoe 1.0" },
  { id: "gpt-5-5", label: "GPT-5.5 · Medium" },
  { id: "codex-5-3", label: "Codex 5.3 · Medium" },
  { id: "sonnet-4-6", label: "Sonnet 4.6 · Medium" },
  { id: "opus-4-7", label: "Opus 4.7 · Extra high" },
  { id: "gpt-5-4", label: "GPT-5.4 · Medium" },
  { id: "gpt-5-2", label: "GPT-5.2 · Medium" },
] as const;

export type AssistantModelKey = (typeof ASSISTANT_MODEL_OPTIONS)[number]["id"];

export const ASSISTANT_MODEL_ITEMS = ASSISTANT_MODEL_OPTIONS.map(({ id, label }) => ({ id, label }));

const VALID = new Set<string>(ASSISTANT_MODEL_OPTIONS.map((o) => o.id));

export function readStoredAssistantModelKey(): AssistantModelKey {
  if (typeof window === "undefined") return "jinoe-1-0";
  const raw = localStorage.getItem(STORAGE_KEY)?.trim();
  if (raw && VALID.has(raw)) return raw as AssistantModelKey;
  return "jinoe-1-0";
}

export function persistAssistantModelKey(key: AssistantModelKey) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, key);
}
