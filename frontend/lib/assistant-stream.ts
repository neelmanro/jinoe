import { getApiBase, getStoredToken } from "@/components/auth/auth-context";
import type { AssistantModelKey } from "@/lib/assistant-models";

export type AssistantApiMessage = { role: "user" | "assistant"; content: string };

export type AssistantStreamEvent =
  | {
      event: "session";
      session_id?: string;
      project_id?: number | null;
      task_id?: number | null;
      attempt_id?: number | null;
      target_kind?: string | null;
    }
  | {
      event: "context_status";
      status?: string;
      usedTokens?: number;
      maxTokens?: number;
    }
  | {
      event: "tool_start";
      id: string;
      name: string;
      input?: Record<string, unknown>;
    }
  | {
      event: "tool_delta";
      id: string;
      name?: string;
      arguments?: string;
      arguments_delta?: string;
    }
  | {
      event: "tool_log";
      id: string;
      name: string;
      stream?: string;
      chunk?: string;
    }
  | {
      event: "tool_result";
      id: string;
      name: string;
      result?: Record<string, unknown>;
    }
  | {
      event: "todo_update";
      todos?: Array<Record<string, unknown>>;
    }
  | {
      event: "done";
      session_id?: string;
      turns?: number;
    }
  | {
      event: "error";
      error?: string;
    };

export type StreamAssistantHandlers = {
  onChunk: (text: string) => void;
  onEvent?: (event: AssistantStreamEvent) => void;
  onError: (message: string) => void;
  onAbort?: () => void;
  onDone: () => void;
  sessionId?: string | null;
  projectId?: number | null;
  taskId?: number | null;
  attemptId?: number | null;
  signal?: AbortSignal;
  /** Sent as ``model_key``; server maps to provider model via env overrides. */
  modelKey?: AssistantModelKey | null;
};

/**
 * POST `/assistant/chat/stream` — SSE lines with text chunks, ordered activity events, and `[DONE]`.
 */
export async function streamAssistantChat(
  messages: AssistantApiMessage[],
  {
    onChunk,
    onEvent,
    onError,
    onAbort,
    onDone,
    sessionId,
    projectId,
    taskId,
    attemptId,
    signal,
    modelKey,
  }: StreamAssistantHandlers,
): Promise<void> {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onDone();
  };

  const base = getApiBase();
  const token = getStoredToken();

  try {
    const res = await fetch(`${base}/assistant/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(taskId ? { task_id: taskId } : {}),
        ...(attemptId ? { attempt_id: attemptId } : {}),
        ...(modelKey ? { model_key: modelKey } : {}),
      }),
      signal,
    });

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as { detail?: string };
        if (data.detail) message = data.detail;
      } catch {
        /* ignore */
      }
      onError(message);
      settle();
      return;
    }

    if (!res.body) {
      onError("No response body");
      settle();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        for (const rawLine of block.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            settle();
            return;
          }
          try {
            const obj = JSON.parse(payload) as { c?: string; error?: string; event?: string };
            if (obj.error) {
              onError(String(obj.error));
              settle();
              return;
            }
            if (obj.c) onChunk(obj.c);
            if (obj.event) onEvent?.(obj as AssistantStreamEvent);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload !== "[DONE]") {
          try {
            const obj = JSON.parse(payload) as { c?: string; error?: string; event?: string };
            if (obj.error) onError(String(obj.error));
            else if (obj.c) onChunk(obj.c);
            if (obj.event) onEvent?.(obj as AssistantStreamEvent);
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      onAbort?.();
      settle();
      return;
    }
    onError(e instanceof Error ? e.message : "Stream failed");
  } finally {
    settle();
  }
}
