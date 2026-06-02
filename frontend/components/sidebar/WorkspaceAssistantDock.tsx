"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import {
  activityStatusFromResult,
  AssistantActivityFeed,
  AssistantContextMeter,
  PreparingNextActions,
  type AssistantActivity,
  type AssistantContextUsage,
} from "@/components/assistant/AssistantActivityFeed";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { apiRequest } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { CompactPickerDropdown } from "@/components/ui/CompactPickerDropdown";
import { useProject } from "@/components/sidebar/project-context";
import { useWorkspaceChrome } from "@/components/sidebar/workspace-chrome-context";
import {
  ASSISTANT_MODEL_ITEMS,
  persistAssistantModelKey,
  readStoredAssistantModelKey,
  type AssistantModelKey,
} from "@/lib/assistant-models";
import { streamAssistantChat, type AssistantStreamEvent } from "@/lib/assistant-stream";
import type { TaskOut } from "@/lib/project-api";

const iconStroke = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24" as const,
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeWidth: 2.35,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function AssistantGlyph({ size = "md" }: { size?: "xs" | "sm" | "md" }) {
  const dim = size === "xs" ? 12 : size === "sm" ? 14 : 18;
  const sw = size === "xs" ? 1.85 : size === "sm" ? 2 : 2.35;
  return (
    <svg
      {...iconStroke}
      width={dim}
      height={dim}
      strokeWidth={sw}
    >
      <path d="M12 3v2" />
      <path d="M8.5 4.5l1.4 1.4" />
      <path d="M15.5 4.5l-1.4 1.4" />
      <path d="M6 10c0-3.3 2.7-6 6-6s6 2.7 6 6v3c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2v-3z" />
      <path d="M9 18h6" />
      <path d="M10 21h4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconStroke} width={16} height={16}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconStroke} width={16} height={16}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SubmitGlyph() {
  return (
    <svg {...iconStroke} width={18} height={18}>
      <path d="M5 7l6 5-6 5" />
      <path d="M11 7l6 5-6 5" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg {...iconStroke} width={18} height={18}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

type ChatRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  phase?: "thinking" | "working" | "responding" | "done" | "error" | "stopped";
  activities?: AssistantActivity[];
  blocks?: AssistantBlock[];
};

type AssistantBlock =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "activity"; activityId: string };

type AssistantSessionOut = {
  id: string;
  project_id?: number | null;
  task_id?: number | null;
  attempt_id?: number | null;
  target_kind?: string | null;
  title: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  ui_messages?: Array<Partial<ChatRow> & { role?: string; content?: string }>;
  created_at: string;
  updated_at: string;
};

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`;
}

type WorkspaceIntro = {
  mode: "setup" | "task" | "idle";
  eyebrow: string;
  title: string;
  description?: string;
  hint: string;
  refLabel?: string | null;
};

function AssistantWorkspaceIntro({ intro }: { intro: WorkspaceIntro }) {
  return (
    <section className="mx-auto w-full max-w-[min(100%,22rem)] px-1">
      {intro.eyebrow ? (
        <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">{intro.eyebrow}</p>
      ) : null}
      {intro.refLabel ? (
        <span className="ari-num mt-3 inline-flex rounded-[4px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] px-1.5 py-px text-[10.5px] font-extrabold text-[var(--ink-4)]">
          {intro.refLabel}
        </span>
      ) : null}
      <h3 className="mt-2 text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[var(--ink-strong)]">{intro.title}</h3>
      {intro.description ? (
        <p className="mt-2 text-[13px] font-semibold leading-6 text-[var(--ink-4)]">{intro.description}</p>
      ) : null}
      <p className="mt-4 text-[12.5px] font-bold text-[var(--ink-strong)]">{intro.hint}</p>
    </section>
  );
}

function normalizeSavedUiMessages(rows: AssistantSessionOut["ui_messages"]): ChatRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row?.role === "user" || row?.role === "assistant")
    .map((row) => {
      if (row.role === "user") {
        return {
          id: typeof row.id === "string" ? row.id : newId(),
          role: "user" as const,
          content: typeof row.content === "string" ? row.content : "",
        };
      }
      const activities = Array.isArray(row.activities) ? row.activities : [];
      const blocks = Array.isArray(row.blocks) ? row.blocks : [];
      return {
        id: typeof row.id === "string" ? row.id : newId(),
        role: "assistant" as const,
        content: typeof row.content === "string" ? row.content : "",
        phase: "done" as const,
        activities,
        blocks,
      };
    });
}

export function WorkspaceAssistantDock({ children }: { children: ReactNode }) {
  const { assistantOpen, setAssistantOpen } = useWorkspaceChrome();
  const { projectId, current } = useProject();
  const pathname = usePathname();
  /** The assistant UI is tied to the in-app code editor, but active streams can continue while users browse elsewhere. */
  const assistantEnabled = pathname === "/editor";
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionLoadSeq = useRef(0);
  const titleId = useId();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<AssistantContextUsage | null>(null);
  const [modelKey, setModelKey] = useState<AssistantModelKey>(() => readStoredAssistantModelKey());
  const [workspaceIntro, setWorkspaceIntro] = useState<WorkspaceIntro | null>(null);

  useEffect(() => {
    persistAssistantModelKey(modelKey);
  }, [modelKey]);

  const canSubmit = draft.trim().length > 0 && !sending;
  const numericProjectId = useMemo(() => {
    const parsed = Number(projectId);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [projectId]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!assistantOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAssistantOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [assistantOpen, setAssistantOpen]);

  useEffect(() => {
    if (!assistantOpen) return;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }, 180);
    return () => window.clearTimeout(t);
  }, [assistantOpen]);

  useEffect(() => {
    if (!assistantEnabled) setAssistantOpen(false);
  }, [assistantEnabled, setAssistantOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!assistantEnabled || !numericProjectId) {
      setWorkspaceIntro(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (current?.setup_status && current.setup_status !== "ready") {
            if (cancelled) return;
            setWorkspaceIntro({
              mode: "setup",
              eyebrow: "Project setup",
              title: current.name || "Setting up project",
              description:
                current.description?.trim() ||
                "Add starter files, structure the repo, and finish setup before tasks and reviews begin.",
              hint: "Let's get started — ask what to scaffold, explain the stack, or request a specific file change.",
            });
            return;
          }
          const [activeAttempt, tasks] = await Promise.all([
            apiRequest<{ task_id: number } | null>(`/team/projects/${numericProjectId}/task-attempts/active`),
            apiRequest<TaskOut[]>(`/team/projects/${numericProjectId}/tasks`),
          ]);
          if (cancelled) return;
          const activeTask = activeAttempt ? tasks.find((task) => task.id === activeAttempt.task_id) ?? null : null;
          if (activeTask) {
            setWorkspaceIntro({
              mode: "task",
              eyebrow: "",
              refLabel: activeTask.ref,
              title: activeTask.title,
              ...(activeTask.body?.trim() ? { description: activeTask.body.trim() } : {}),
              hint: "Let's get started — ask for a plan, a code change, or help understanding this task.",
            });
            return;
          }
          setWorkspaceIntro({
            mode: "idle",
            eyebrow: "Workspace assistant",
            title: "No active task",
            description: "Open a task from the board to work in this editor with the assistant.",
            hint: "Start a task, then come back here to collaborate.",
          });
        } catch {
          if (!cancelled) setWorkspaceIntro(null);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assistantEnabled, current, numericProjectId]);

  useEffect(() => {
    if (!assistantEnabled || sending) return;
    const seq = ++sessionLoadSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMessages([]);
        setSessionId(null);
        setContextUsage(null);
        if (!numericProjectId) return;
        try {
          const session = await apiRequest<AssistantSessionOut | null>(
            `/assistant/sessions/current?project_id=${numericProjectId}`,
          );
          if (seq !== sessionLoadSeq.current || !session) return;
          setSessionId(session.id);
          const savedUiMessages = normalizeSavedUiMessages(session.ui_messages);
          setMessages(
            savedUiMessages.length
              ? savedUiMessages
              : session.messages.map((message) => ({
                  id: newId(),
                  role: message.role,
                  content: message.content,
                  phase: "done",
                })),
          );
        } catch {
          if (seq !== sessionLoadSeq.current) return;
          setMessages([]);
          setSessionId(null);
        }
      })();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [assistantEnabled, numericProjectId, pathname, sending]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDraft("");
    setMessages([]);
    setSessionId(null);
    setContextUsage(null);
    setSending(false);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const userMsg: ChatRow = { id: newId(), role: "user", content: text };
    const asstMsg: ChatRow = {
      id: newId(),
      role: "assistant",
      content: "",
      streaming: true,
      phase: "thinking",
      activities: [],
      blocks: [],
    };

    const historyForApi = [
      ...messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.content.trim().length > 0)),
      { role: "user" as const, content: text },
    ];

    setDraft("");
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setSending(true);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    await streamAssistantChat(historyForApi, {
      sessionId,
      projectId: numericProjectId,
      signal: ac.signal,
      modelKey,
      onChunk: (c) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = appendTextToAssistant(last, c);
          }
          return next;
        });
      },
      onEvent: (event) => {
        handleStreamEvent(event, {
          setSessionId,
          setContextUsage,
          setMessages,
        });
      },
      onError: (msg) => {
        showDashboardToast(msg);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              streaming: false,
              phase: "error",
              content: last.content || `*Could not complete reply.* ${msg}`,
            };
          }
          return next;
        });
      },
      onAbort: () => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              streaming: false,
              phase: "stopped",
              content: last.content || "*Stopped.*",
            };
          }
          return next;
        });
        abortRef.current = null;
        setSending(false);
      },
      onDone: () => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, streaming: false, phase: last.phase === "error" ? "error" : "done" };
          }
          return next;
        });
        abortRef.current = null;
        setSending(false);
      },
    });
  }, [draft, messages, numericProjectId, sending, sessionId, modelKey]);

  const hasThread = messages.length > 0;

  const composerInner = (
    <div
      className={[
        "group/composer relative flex flex-col overflow-visible rounded-[14px] border border-[var(--line)] bg-[var(--bg-raised)] shadow-[0_1px_0_rgba(11,10,8,0.04),0_10px_28px_-16px_rgba(11,10,8,0.18)] transition-[border-color,box-shadow] duration-200 ease-out focus-within:border-[var(--ink-6)] focus-within:shadow-[0_1px_0_rgba(11,10,8,0.06),0_22px_48px_-20px_rgba(11,10,8,0.22),0_0_0_4px_var(--accent-soft)]",
        !hasThread ? "rounded-[20px] shadow-[0_1px_0_rgba(11,10,8,0.04),0_26px_60px_-26px_rgba(11,10,8,0.22)]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(11,10,8,0.10),transparent)] opacity-70"
      />
      <label htmlFor="workspace-assistant-composer" className="sr-only">
        Message assistant
      </label>
      <div className={hasThread ? "px-3 pt-2.5" : "px-4 pt-3.5"}>
        <textarea
          id="workspace-assistant-composer"
          rows={hasThread ? 2 : 4}
          placeholder={hasThread ? "Message…" : "Ask anything · @ for context"}
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) void send();
            }
          }}
          className={[
            "ari-workspace-composer w-full min-w-0 resize-none border-0 bg-transparent p-0 text-[13.5px] font-medium leading-[1.55] tracking-[-0.005em] text-[var(--ink-1)] shadow-none placeholder:font-medium placeholder:text-[var(--ink-5)] focus:outline-none focus:ring-0 disabled:opacity-50",
            hasThread ? "min-h-[48px]" : "min-h-[5.5rem]",
          ].join(" ")}
        />
      </div>
      <div
        className={[
          "flex shrink-0 items-center gap-2",
          hasThread ? "px-2.5 pb-2 pt-1.5" : "px-3 pb-3 pt-2",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={startNewChat}
          disabled={sending}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-transparent text-[var(--ink-3)] transition-[background-color,border-color,color] duration-150 hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] disabled:pointer-events-none disabled:opacity-40"
          aria-label="New assistant chat"
          title="New chat"
        >
          <PlusIcon />
        </button>
        <div className="min-w-0 flex-1 [&_button]:!h-9 [&_button]:min-h-[36px] [&_button]:!rounded-full [&_button]:!border-[var(--line)] [&_button]:!bg-[var(--bg-raised)] [&_button]:!px-3.5 [&_button]:!text-[12.5px] [&_button]:!font-semibold [&_button]:!tracking-[-0.005em] [&_button]:!text-[var(--ink-2)] [&_button]:!shadow-[0_1px_0_rgba(11,10,8,0.03)] [&_button:hover]:!border-[var(--line-strong)] [&_button:hover]:!bg-[var(--bg-sunken)]">
          <CompactPickerDropdown
            id="workspace-assistant-model"
            ariaLabel="Assistant model"
            value={modelKey}
            onChange={(id) => setModelKey(id as AssistantModelKey)}
            items={ASSISTANT_MODEL_ITEMS}
            disabled={sending}
            fallbackTriggerLabel="Select model"
            menuPlacement="top"
          />
        </div>
        <button
          type="button"
          disabled={!sending && !canSubmit}
          title={sending ? "Stop assistant" : canSubmit ? "Send message" : "Write a message to send"}
          onClick={() => (sending ? stopStreaming() : void send())}
          className={[
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(11,10,8,0.10)] text-[var(--ink-strong)] transition-[transform,box-shadow,background-color] duration-150 ease-out",
            "bg-[linear-gradient(180deg,var(--accent)_0%,var(--accent-hover)_100%)]",
            "shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_-1px_0_rgba(11,10,8,0.06)_inset,0_10px_22px_-8px_var(--accent-soft),0_2px_6px_-2px_rgba(11,10,8,0.10)]",
            sending || canSubmit
              ? "cursor-pointer hover:-translate-y-[0.5px] hover:shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_-1px_0_rgba(11,10,8,0.06)_inset,0_14px_28px_-10px_var(--accent-soft),0_3px_8px_-2px_rgba(11,10,8,0.14)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-raised)]"
              : "cursor-not-allowed opacity-55",
          ].join(" ")}
          aria-label={sending ? "Stop assistant" : "Send message"}
        >
          {sending ? <StopGlyph /> : <SubmitGlyph />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
        {assistantEnabled ? (
          <button
            type="button"
            aria-expanded={assistantOpen}
            aria-controls="workspace-assistant-panel"
            aria-label={assistantOpen ? "Close workspace assistant" : "Open workspace assistant"}
            title={assistantOpen ? undefined : "Assist"}
            onClick={() => setAssistantOpen(!assistantOpen)}
            className={[
              "absolute z-20 flex cursor-pointer items-center justify-center gap-0 border border-[var(--line-strong)] bg-[var(--bg-raised)] text-[var(--ink-strong)] shadow-[var(--sh-3)] transition-[transform,opacity,background-color] duration-200 ease-out",
              "hover:bg-[var(--bg-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2",
              assistantOpen
                ? "pointer-events-none top-[min(28%,9.5rem)] right-0 translate-x-full opacity-0"
                : "top-[min(28%,9.5rem)] right-0 rounded-l-[6px] border-r-0 px-0.5 py-1",
            ].join(" ")}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_3px_10px_rgba(11,10,8,0.06)]">
              <AssistantGlyph size="xs" />
            </span>
          </button>
        ) : null}
      </div>

      {assistantEnabled ? (
      <div
        id="workspace-assistant-panel"
        ref={panelRef}
        role="complementary"
        aria-hidden={!assistantOpen}
        aria-labelledby={titleId}
        className={[
          "flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l bg-[var(--bg-raised)] transition-[width] duration-200 ease-out",
          assistantOpen
            ? "w-[min(420px,100%)] max-w-[420px] border-[var(--ink-strong)]"
            : "pointer-events-none w-0 border-transparent",
        ].join(" ")}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line-strong)] px-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)]">
            <AssistantGlyph />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[14px] font-extrabold tracking-[-0.01em] text-[var(--ink-strong)]">
              Assistant
            </h2>
          </div>
          <AssistantContextMeter usage={contextUsage} />
          <button
            type="button"
            onClick={() => setAssistantOpen(false)}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-4)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
            aria-label="Close assistant"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {hasThread ? (
            <>
              <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="flex w-full min-w-0 flex-col">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="w-full min-w-0 pb-4">
                        <div className="w-full rounded-[10px] border border-[var(--line-strong)] bg-[var(--bg-raised)] px-3.5 py-3 shadow-none">
                          <p className="whitespace-pre-wrap text-[13px] font-semibold leading-relaxed text-[var(--ink-2)]">{m.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="w-full min-w-0 pb-4">
                        <div className="w-full min-w-0 px-1 text-left">
                          <div className="space-y-3">
                            <AssistantMessageTimeline message={m} />
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
              <footer className="shrink-0 overflow-visible border-t border-[var(--line-strong)] bg-[var(--bg-raised)] px-4 py-3">
                {composerInner}
              </footer>
            </>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-6">
                {workspaceIntro ? <AssistantWorkspaceIntro intro={workspaceIntro} /> : null}
              </div>
              <footer className="shrink-0 overflow-visible border-t border-[var(--line-strong)] bg-[var(--bg-raised)] px-4 py-3">
                {composerInner}
              </footer>
            </div>
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}

function handleStreamEvent(
  event: AssistantStreamEvent,
  setters: {
    setSessionId: (sessionId: string | null) => void;
    setContextUsage: (usage: AssistantContextUsage | null) => void;
    setMessages: Dispatch<SetStateAction<ChatRow[]>>;
  },
) {
  if (event.event === "session" && event.session_id) {
    setters.setSessionId(event.session_id);
    return;
  }

  if (event.event === "context_status") {
    if (typeof event.usedTokens === "number" && typeof event.maxTokens === "number") {
      setters.setContextUsage({ usedTokens: event.usedTokens, maxTokens: event.maxTokens });
    }
    return;
  }

  setters.setMessages((prev) => {
    if (prev.length === 0) return prev;
    const next = [...prev];
    const last = next[next.length - 1];
    if (!last || last.role !== "assistant" || !last.streaming) return prev;
    let working = last;
    const activities = [...(working.activities ?? [])];

    if (event.event === "tool_start") {
      const existingIndex = activities.findIndex((activity) => activity.toolId === event.id);
      const activity =
        existingIndex >= 0
          ? {
              ...activities[existingIndex]!,
              name: event.name,
              input: { ...activities[existingIndex]!.input, ...(event.input ?? {}) },
              status: "running" as const,
            }
          : {
              id: newId(),
              toolId: event.id,
              name: event.name,
              input: event.input ?? {},
              status: "running" as const,
              logs: "",
            };
      if (existingIndex >= 0) {
        activities[existingIndex] = activity;
      } else {
        activities.push(activity);
      }
      working = ensureActivityBlock({ ...working, activities }, activity.id);
      next[next.length - 1] = { ...working, phase: "working" };
      return next;
    }

    if (event.event === "tool_delta") {
      const name = event.name || inferToolNameFromArguments(event.arguments);
      if (name !== "write_file" && name !== "edit_file") return prev;
      const input = parsePartialToolInput(event.arguments);
      const index = activities.findIndex((activity) => activity.toolId === event.id);
      const activity =
        index >= 0
          ? {
              ...activities[index]!,
              name: activities[index]!.name || name,
              input: { ...activities[index]!.input, ...input },
              status: "running" as const,
            }
          : {
              id: newId(),
              toolId: event.id,
              name,
              input,
              status: "running" as const,
              logs: "",
            };
      if (index >= 0) {
        activities[index] = activity;
      } else {
        activities.push(activity);
      }
      working = ensureActivityBlock({ ...working, activities }, activity.id);
      next[next.length - 1] = { ...working, phase: "working" };
      return next;
    }

    if (event.event === "tool_log") {
      const index = activities.findIndex((activity) => activity.toolId === event.id);
      if (index >= 0) {
        const current = activities[index]!;
        activities[index] = { ...current, logs: current.logs + (event.chunk ?? "") };
        next[next.length - 1] = { ...last, activities, phase: "working" };
        return next;
      }
      return prev;
    }

    if (event.event === "tool_result") {
      const index = activities.findIndex((activity) => activity.toolId === event.id);
      if (index >= 0) {
        const current = activities[index]!;
        activities[index] = {
          ...current,
          result: event.result ?? {},
          status: activityStatusFromResult(event.result),
        };
        next[next.length - 1] = { ...last, activities, phase: "thinking" };
        return next;
      }
      return prev;
    }

    if (event.event === "todo_update") {
      const index = [...activities].reverse().findIndex((activity) => activity.name === "todo_update");
      if (index >= 0) {
        const actualIndex = activities.length - 1 - index;
        const current = activities[actualIndex]!;
        activities[actualIndex] = {
          ...current,
          result: { ...(current.result ?? {}), todos: event.todos ?? [] },
        };
        next[next.length - 1] = { ...last, activities, phase: last.phase ?? "thinking" };
        return next;
      }
      return prev;
    }

    if (event.event === "done") {
      next[next.length - 1] = { ...last, phase: "done" };
      return next;
    }

    return prev;
  });
}

function AssistantMessageTimeline({ message }: { message: ChatRow }) {
  const activities = message.activities ?? [];
  const blocks = message.blocks?.length
    ? message.blocks
    : message.content.trim().length > 0
      ? [{ id: `${message.id}-text`, type: "text" as const, content: message.content }]
      : [];

  return (
    <>
      {blocks.map((block) => {
        if (block.type === "text") {
          return (
            <div key={block.id} className="px-2.5">
              <AssistantMarkdown content={block.content} />
            </div>
          );
        }
        const activity = activities.find((item) => item.id === block.activityId);
        return activity ? <AssistantActivityFeed key={block.id} activities={[activity]} /> : null;
      })}
      {message.streaming && message.phase === "thinking" ? <PreparingNextActions /> : null}
    </>
  );
}

function appendTextToAssistant(row: ChatRow, chunk: string): ChatRow {
  const blocks = [...(row.blocks ?? [])];
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock?.type === "text") {
    blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + chunk };
  } else {
    blocks.push({ id: newId(), type: "text", content: chunk });
  }
  return { ...row, content: row.content + chunk, blocks, phase: "responding" };
}

function ensureActivityBlock(row: ChatRow, activityId: string): ChatRow {
  const blocks = [...(row.blocks ?? [])];
  if (!blocks.some((block) => block.type === "activity" && block.activityId === activityId)) {
    blocks.push({ id: newId(), type: "activity", activityId });
  }
  return { ...row, blocks };
}

function parsePartialToolInput(raw: string | undefined): Record<string, unknown> {
  const fallback: Record<string, unknown> = raw ? { __rawArguments: raw } : {};
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { __rawArguments: raw, ...(parsed as Record<string, unknown>) };
    }
  } catch {
    const path = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
    const content = raw.match(/"(?:content|new_text)"\s*:\s*"((?:\\.|[^"\\])*)$/)?.[1];
    return {
      ...fallback,
      ...(path ? { path: safeJsonStringFragment(path) } : {}),
      ...(content ? { content: safeJsonStringFragment(content) } : {}),
    };
  }
  return fallback;
}

function inferToolNameFromArguments(raw: string | undefined) {
  if (!raw) return "write_file";
  if (raw.includes('"old_text"') || raw.includes('"new_text"')) return "edit_file";
  return "write_file";
}

function safeJsonStringFragment(value: string) {
  try {
    return JSON.parse(`"${value.replace(/\\?$/, "")}"`);
  } catch {
    return value.replaceAll("\\n", "\n").replaceAll('\\"', '"');
  }
}
