"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { apiRequest, getApiBase, getStoredToken, useAuth } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { useProject } from "@/components/sidebar/project-context";
import {
  formatChatDateTime,
  formatChatTimeGutter,
  type ChatMessageOut,
  type ChatReactionKind,
} from "@/lib/project-api";
import { inputClass, pageBg } from "@/components/auth/JinoeAuthChrome";
import { SelectProjectFirst } from "@/components/ui/SelectProjectFirst";
import { VoiceComposerPanel } from "./VoiceComposerPanel";

const chatPrimaryBtnSm =
  "inline-flex items-center justify-center rounded-md border border-black/10 bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0b0a08] transition hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] disabled:opacity-50";
const chatSecondaryBtnSm =
  "inline-flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-[12px] font-medium text-[var(--ink-2)] shadow-none transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] disabled:opacity-50";

/* ────────────────────────────────────────────────────────────
   People
   ──────────────────────────────────────────────────────────── */

type Person = { name: string; isAI?: boolean };

const PEOPLE: Record<string, Person> = {
  Neel: { name: "Neel" },
  Sarah: { name: "Sarah" },
  Arjun: { name: "Arjun" },
  Maya: { name: "Maya" },
  "AI Agent": { name: "AI Agent", isAI: true },
};

function avatarInitials(name: string) {
  if (name === "AI Agent") return "AI";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  const word = parts[0] ?? "?";
  return word.slice(0, 2).toUpperCase();
}

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const isAI = PEOPLE[name]?.isAI;
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center rounded-full ring-1 ring-[var(--line)]",
        isAI ? "bg-[var(--accent)] text-[#0b0a08] ring-black/5" : "bg-[var(--bg-sunken)] text-[var(--ink-strong)]",
      ].join(" ")}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        letterSpacing: "-0.01em",
      }}
    >
      {avatarInitials(name)}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────
   Embedded cards (rich messages from the agent)
   ──────────────────────────────────────────────────────────── */

function TaskCardEmbed() {
  return (
    <div className="mt-2 max-w-[560px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] shadow-none">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--ink-4)]">Tasks</p>
        <span className="ari-num text-[11px] font-medium text-[var(--ink-5)]">Preview</span>
      </div>
      <p className="px-3 py-5 text-center text-[12.5px] font-normal leading-relaxed text-[var(--ink-4)]">
        When the agent creates or updates tasks for this project, a summary can appear here.
      </p>
      <div className="border-t border-[var(--line)] px-3 py-2 text-right">
        <Link
          href="/tasks"
          className="text-[12px] font-semibold text-[var(--ink-strong)] underline decoration-1 underline-offset-2 decoration-[var(--line)] hover:decoration-[var(--ink-strong)]"
        >
          Open board →
        </Link>
      </div>
    </div>
  );
}

function WorkingCardEmbed() {
  return (
    <div className="mt-2 flex max-w-[560px] items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2.5 shadow-none">
      <div className="flex h-7 w-7 items-center justify-center">
        <svg className="ar-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
          <circle cx="12" cy="12" r="9" strokeWidth="2" strokeDasharray="14 60" strokeLinecap="round" className="text-[var(--ink-strong)]" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-[var(--ink-strong)]">Working on task…</p>
        <p className="truncate text-[11.5px] font-normal text-[var(--ink-4)]">Progress will show here when available</p>
      </div>
      <button type="button" className={`${chatSecondaryBtnSm} h-7 px-2.5`}>
        View progress
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Messages
   ──────────────────────────────────────────────────────────── */

/** Same four reactions everywhere (matches product picker / reference strip). */
const CHAT_REACTION_PICKER: { kind: ChatReactionKind; emoji: string; label: string }[] = [
  { kind: "thumbs_up", emoji: "👍", label: "Thumbs up" },
  { kind: "heart", emoji: "❤️", label: "Heart" },
  { kind: "laugh", emoji: "🤣", label: "Laugh" },
  { kind: "surprised", emoji: "😮", label: "Surprised" },
];

function replyPreviewFromBody(text: string, max = 120) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "…";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function copyMessagePlainText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showDashboardToast("Copied!");
  } catch {
    showDashboardToast("Could not copy");
  }
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconReply({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a6.5 6.5 0 0 1 6.5 6.5V20" />
    </svg>
  );
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconComposerMic({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 1 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 21h8" />
    </svg>
  );
}

function IconComposerSend({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function IconMessageDoubleTick({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="14"
      viewBox="0 0 28 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 10.5 7.5 15.5 17 5" />
      <path d="M10.5 14.5 13 17 25.5 3" />
    </svg>
  );
}

type ReplyToInMessage = {
  id: number;
  authorName: string;
  bodyPreview: string;
};

type MessageReceipt = {
  state: "sent" | "read";
  read_by_user_id?: number | null;
  read_by_name?: string | null;
  read_by?: { user_id: number; full_name: string }[];
};

type Message = {
  id: number;
  author: string;
  authorUserId: number | null;
  /** ISO from API , used for compact time in grouped rows */
  createdAt: string;
  /** Display: "1/23 2:14 PM" */
  time: string;
  text: string;
  edited: boolean;
  replyTo?: ReplyToInMessage;
  reactions: { kind: ChatReactionKind; count: number; mine: boolean }[];
  card?: "tasks" | "working";
  isAI?: boolean;
  receipt?: MessageReceipt;
};

function chatMessageToUi(m: ChatMessageOut): Message {
  return {
    id: m.id,
    author: m.author_name,
    authorUserId: m.author_user_id,
    createdAt: m.created_at,
    time: formatChatDateTime(m.created_at),
    text: m.body,
    edited: Boolean(m.edited_at ?? null),
    isAI: m.is_agent,
    replyTo:
      m.reply_to != null
        ? {
            id: m.reply_to.id,
            authorName: m.reply_to.author_name,
            bodyPreview: m.reply_to.body_preview,
          }
        : undefined,
    reactions: m.reactions ?? [],
    receipt: m.receipt ?? undefined,
  };
}

function isMessageMine(msg: Message, currentUserId: number | undefined) {
  if (msg.isAI) return false;
  if (currentUserId == null || msg.authorUserId == null) return false;
  return msg.authorUserId === currentUserId;
}

function sameSenderForGrouping(prev: Message | undefined, msg: Message) {
  if (!prev) return false;
  if (Boolean(prev.isAI) !== Boolean(msg.isAI)) return false;
  if (msg.isAI) return true;
  return prev.authorUserId === msg.authorUserId && prev.author === msg.author;
}

function getChatWsUrl(projectId: string, token: string) {
  const apiBase = getApiBase();
  const origin =
    apiBase ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(`/team/projects/${projectId}/chat/ws`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

/* ────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────── */

function renderMessageText(text: string) {
  const parts = text.split(/(@[A-Za-z][A-Za-z\s]*?)(?=[\s.,!?]|$)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="ari-mention rounded px-1 py-px font-medium">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function ChatEmptyState() {
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 py-16">
      <div className="max-w-[42ch] text-center">
        <p className="text-base font-medium text-[var(--ink-strong)]">No messages yet</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">
          Use the composer below to send your first message.
        </p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  /** After typing `@ai ` or `@ai assistant `, show a bold AI Assistant chip and compose the rest in the field. */
  const [aiMentionActive, setAiMentionActive] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  type ReplyTarget = { messageId: number; authorName: string; preview: string };
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reactionPending = useRef(new Set<string>());

  const fetchChatMessages = useCallback(async (pid: string) => {
    const list = await apiRequest<ChatMessageOut[]>(
      `/team/projects/${pid}/chat/messages?limit=200&offset=0`
    );
    setMessages(list.map(chatMessageToUi));
    if (list.length > 0) {
      const maxId = Math.max(...list.map((m) => m.id));
      try {
        await apiRequest(`/team/projects/${pid}/chat/read`, {
          method: "POST",
          body: JSON.stringify({ last_read_message_id: maxId }),
        });
      } catch {
        /* ignore mark-read failures */
      }
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const storedToken = getStoredToken();
    if (!storedToken) return;

    let closed = false;
    let retryTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(getChatWsUrl(projectId, storedToken));

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === "chat.refresh") {
            void fetchChatMessages(projectId).catch(() => {
              /* next websocket event or focus refresh will retry */
            });
          }
        } catch {
          /* ignore non-json websocket frames */
        }
      };

      socket.onclose = () => {
        if (closed) return;
        retryTimer = window.setTimeout(connect, 1500);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [projectId, fetchChatMessages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAiMentionActive(false);
    }, 0);
    if (!projectId) {
      const resetTimer = window.setTimeout(() => {
        setMessages([]);
        setChatLoading(false);
        setChatError(null);
        setEditingMessageId(null);
        setEditDraft("");
        setReplyTarget(null);
        setVoiceOpen(false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(resetTimer);
      };
    }
    let cancelled = false;
    const loadingTimer = window.setTimeout(() => {
      setChatLoading(true);
      setChatError(null);
    }, 0);
    void (async () => {
      try {
        await fetchChatMessages(projectId);
      } catch (e) {
        if (!cancelled) {
          setChatError(e instanceof Error ? e.message : "Could not load chat");
          setMessages([]);
        }
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(loadingTimer);
    };
  }, [projectId, fetchChatMessages]);

  useEffect(() => {
    if (!projectId) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          await fetchChatMessages(projectId);
        } catch {
          /* background refresh */
        }
      })();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [projectId, fetchChatMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function handleComposerChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    if (!aiMentionActive) {
      const aiPattern = /(^|\s)@(ai|ai assistant)\s$/i;
      if (aiPattern.test(v)) {
        const lastAt = v.lastIndexOf("@");
        setInput(v.slice(0, lastAt));
        setAiMentionActive(true);
        return;
      }
    }
    setInput(v);
  }

  async function send() {
    if (!projectId) return;
    const rest = input.trim();
    if (!rest) return;
    const body = (aiMentionActive ? "@AI Assistant " : "") + rest;
    setChatError(null);
    try {
      const payload: { body: string; reply_to_message_id?: number } = { body };
      if (replyTarget) payload.reply_to_message_id = replyTarget.messageId;
      const m = await apiRequest<ChatMessageOut>(`/team/projects/${projectId}/chat/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((prev) => {
        const next = chatMessageToUi(m);
        return prev.some((item) => item.id === next.id)
          ? prev.map((item) => (item.id === next.id ? next : item))
          : [...prev, next];
      });
      try {
        await apiRequest(`/team/projects/${projectId}/chat/read`, {
          method: "POST",
          body: JSON.stringify({ last_read_message_id: m.id }),
        });
      } catch {
        /* ignore */
      }
      setInput("");
      setAiMentionActive(false);
      setReplyTarget(null);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Send failed");
    }
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Backspace" && aiMentionActive && !input.length) {
      e.preventDefault();
      setAiMentionActive(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function toggleReaction(messageId: number, kind: ChatReactionKind) {
    if (!projectId) return;
    const key = `${messageId}:${kind}`;
    if (reactionPending.current.has(key)) return;
    reactionPending.current.add(key);
    setChatError(null);
    try {
      const m = await apiRequest<ChatMessageOut>(
        `/team/projects/${projectId}/chat/messages/${messageId}/reactions`,
        { method: "POST", body: JSON.stringify({ kind }) }
      );
      setMessages((prev) => prev.map((x) => (x.id === m.id ? chatMessageToUi(m) : x)));
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Could not update reaction");
    } finally {
      reactionPending.current.delete(key);
    }
  }

  async function saveMessageEdit(messageId: number) {
    if (!projectId) return;
    const next = editDraft.trim();
    if (!next) return;
    setChatError(null);
    try {
      const m = await apiRequest<ChatMessageOut>(
        `/team/projects/${projectId}/chat/messages/${messageId}`,
        { method: "PATCH", body: JSON.stringify({ body: next }) }
      );
      setMessages((prev) => prev.map((x) => (x.id === m.id ? chatMessageToUi(m) : x)));
      setEditingMessageId(null);
      setEditDraft("");
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Could not save edit");
    }
  }

  function cancelMessageEdit() {
    setEditingMessageId(null);
    setEditDraft("");
  }

  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <style>{`@keyframes ar-spin { to { transform: rotate(360deg); } } .ar-spinner { animation: ar-spin 1s linear infinite; transform-origin: 50% 50%; }`}</style>

      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Chat</h1>
        </div>
      </header>

      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--surface-app)]"
              >
            {chatError ? (
              <p className="p-4 text-[13px] font-medium text-[var(--neg)]">{chatError}</p>
            ) : null}
            {chatLoading && projectId ? (
              <p className="p-4 text-[13px] font-medium text-[var(--ink-4)]">Loading messages…</p>
            ) : null}
            {!projectId ? <SelectProjectFirst description="Select a project in the sidebar to use chat." /> : null}
            {projectId && !chatLoading && !chatError && messages.length === 0 ? (
              <ChatEmptyState />
            ) : null}
            {projectId && !chatLoading && messages.length > 0 ? (
            <ul className="flex flex-col gap-1 px-4 py-3 sm:px-6">
              {messages.map((msg, i) => {
                const prev = messages[i - 1];
                const grouped = sameSenderForGrouping(prev, msg);
                const isAI = msg.isAI || Boolean(PEOPLE[msg.author]?.isAI);
                const mine = isMessageMine(msg, user?.id);
                const bubbleClass = mine
                  ? "rounded-lg border border-[#0b0a08]/15 bg-[#0b0a08] text-zinc-50 [&_.ari-mention]:bg-white/15 [&_.ari-mention]:text-white dark:border-white/10 dark:bg-[#262626] dark:text-[#fafafa] dark:[&_.ari-mention]:bg-white/10 dark:[&_.ari-mention]:text-[#fafafa]"
                  : isAI
                    ? "rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] text-[#0b0a08] dark:border-[var(--line)] dark:bg-[rgba(223,255,0,0.08)] dark:text-[var(--ink-strong)] [&_.ari-mention]:bg-black/10 [&_.ari-mention]:text-[#0b0a08] dark:[&_.ari-mention]:bg-white/10 dark:[&_.ari-mention]:text-[var(--ink-strong)]"
                    : "rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--ink-2)] [&_.ari-mention]:bg-[var(--accent-soft)] [&_.ari-mention]:text-[var(--ink-strong)]";
                return (
                  <li
                    key={msg.id}
                    className={[
                      "group/msg flex w-full",
                      mine ? "justify-end" : "justify-start",
                      grouped ? "mt-0.5" : "mt-2",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex min-w-0 w-full max-w-none flex-1 items-end gap-2",
                        mine ? "flex-row-reverse" : "flex-row",
                      ].join(" ")}
                    >
                      <div className="flex w-7 shrink-0 justify-center self-end pb-0.5">
                        {grouped ? (
                          <span
                            title={`${msg.time}${msg.edited ? " (Edited)" : ""}`}
                            className="ari-num invisible max-w-[28px] whitespace-normal text-center text-[9px] leading-[1.15] text-[var(--ink-5)] group-hover/msg:visible"
                          >
                            {formatChatTimeGutter(msg.createdAt)}
                          </span>
                        ) : (
                          <Avatar name={mine ? (user?.full_name ?? msg.author) : msg.author} size={28} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {!grouped ? (
                          <div className={mine ? "mb-1 flex items-baseline justify-end gap-2" : "mb-1 flex items-baseline gap-2"}>
                            <span className="text-[12px] font-semibold tracking-tight text-[var(--ink-strong)]">
                              {mine ? user?.full_name ?? msg.author : msg.author}
                            </span>
                            {isAI ? (
                              <span className="rounded border border-[var(--line)] bg-[var(--accent-soft)] px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em] text-[#0b0a08] dark:text-[var(--ink-strong)]">
                                Agent
                              </span>
                            ) : null}
                            <span className="ari-num text-[11px] font-medium text-[var(--ink-5)]">{msg.time}</span>
                            {msg.edited ? (
                              <span className="text-[11px] font-medium text-[var(--ink-5)]">(Edited)</span>
                            ) : null}
                          </div>
                        ) : null}
                        {editingMessageId === msg.id ? (
                          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-2.5 shadow-none">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelMessageEdit();
                                }
                              }}
                              rows={3}
                              className={`${inputClass} min-h-[4.5rem] resize-y py-2.5 text-[13px]`}
                              aria-label="Edit message"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={cancelMessageEdit} className={`${chatSecondaryBtnSm} h-8`}>
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveMessageEdit(msg.id)}
                                disabled={!editDraft.trim()}
                                className={`${chatPrimaryBtnSm} h-8 disabled:opacity-50`}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {msg.replyTo ? (
                              <div
                                className={[
                                  "mb-1 max-w-full min-w-0",
                                  mine
                                    ? "ml-auto border-r-2 border-[var(--ink-strong)] pr-2 text-right"
                                    : "mr-auto border-l-2 border-[var(--ink-strong)] pl-2 text-left",
                                ].join(" ")}
                              >
                                <p className="text-[11px] font-medium leading-tight text-[var(--ink-4)]">
                                  Replied to{" "}
                                  <span className="font-semibold text-[var(--ink-strong)]">
                                    {msg.replyTo.authorName}
                                  </span>
                                </p>
                                <p className="mt-0.5 truncate text-[10.5px] font-normal leading-tight text-[var(--ink-5)]">
                                  {msg.replyTo.bodyPreview}
                                </p>
                              </div>
                            ) : null}
                            <div
                              className={[
                                "flex w-fit max-w-full min-w-0 flex-col-reverse gap-1",
                                mine ? "ml-auto items-end" : "mr-auto items-start",
                              ].join(" ")}
                            >
                              <div
                                className={`ari-chat-bubble px-3.5 py-2 text-[13px] font-normal leading-[1.55] ${bubbleClass}`}
                              >
                                {renderMessageText(msg.text)}
                              </div>
                              <div
                                className={[
                                  "pointer-events-none z-20 hidden items-center gap-0.5 rounded-[10px] px-1 py-0.5 shadow-lg",
                                  "group-hover/msg:flex group-hover/msg:pointer-events-auto",
                                  mine
                                    ? "border border-white/10 bg-[#1a1a1a] text-zinc-100 dark:border-white/10 dark:bg-[#333]"
                                    : "border border-[var(--line)] bg-[var(--bg-raised)] text-[var(--ink-2)]",
                                ].join(" ")}
                              >
                                {CHAT_REACTION_PICKER.map((def) => {
                                  const r = msg.reactions.find((x) => x.kind === def.kind);
                                  const active = r?.mine ?? false;
                                  return (
                                    <button
                                      key={def.kind}
                                      type="button"
                                      title={def.label}
                                      aria-label={def.label}
                                      aria-pressed={active}
                                      onClick={() => void toggleReaction(msg.id, def.kind)}
                                      className={[
                                        "rounded-md px-1 py-0.5 text-[18px] leading-none transition",
                                        mine ? "hover:bg-white/10" : "hover:bg-[var(--bg-sunken)]",
                                        active
                                          ? mine
                                            ? "bg-white/15 ring-1 ring-white/20"
                                            : "bg-[var(--accent-soft)] ring-1 ring-[var(--line)]"
                                          : "",
                                      ].join(" ")}
                                    >
                                      <span className="select-none" aria-hidden>
                                        {def.emoji}
                                      </span>
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  className={[
                                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                                    mine ? "text-zinc-200/90 hover:bg-white/10" : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]",
                                  ].join(" ")}
                                  title="Copy message"
                                  aria-label="Copy message"
                                  onClick={() => void copyMessagePlainText(msg.text)}
                                >
                                  <IconCopy />
                                </button>
                                <span
                                  className={["mx-0.5 h-5 w-px shrink-0", mine ? "bg-white/20" : "bg-[var(--line)]"].join(" ")}
                                  aria-hidden
                                />
                                <button
                                  type="button"
                                  className={[
                                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                                    mine
                                      ? "text-zinc-200/90 hover:bg-white/10"
                                      : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]",
                                  ].join(" ")}
                                  title="Reply"
                                  aria-label="Reply"
                                  onClick={() =>
                                    setReplyTarget({
                                      messageId: msg.id,
                                      authorName: msg.author,
                                      preview: replyPreviewFromBody(msg.text),
                                    })
                                  }
                                >
                                  <IconReply />
                                </button>
                                {mine && !isAI ? (
                                  <button
                                    type="button"
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-200/90 hover:bg-white/10"
                                    title="Edit message"
                                    aria-label="Edit message"
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditDraft(msg.text);
                                    }}
                                  >
                                    <IconPencil />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {grouped && msg.edited ? (
                              <p
                                className={[
                                  "mt-0.5 text-[10px] font-medium text-[var(--ink-5)]",
                                  mine ? "text-right" : "text-left",
                                ].join(" ")}
                              >
                                (Edited)
                              </p>
                            ) : null}
                            {msg.card === "tasks" ? (
                              <div className={mine ? "flex justify-end" : ""}>
                                <TaskCardEmbed />
                              </div>
                            ) : null}
                            {msg.card === "working" ? (
                              <div className={mine ? "flex justify-end" : ""}>
                                <WorkingCardEmbed />
                              </div>
                            ) : null}
                            {CHAT_REACTION_PICKER.some(
                              (def) => (msg.reactions.find((x) => x.kind === def.kind)?.count ?? 0) > 0
                            ) ? (
                              <div
                                className={[
                                  "mt-1 flex flex-wrap gap-1",
                                  mine ? "justify-end" : "justify-start",
                                ].join(" ")}
                              >
                                {CHAT_REACTION_PICKER.map((def) => {
                                  const r = msg.reactions.find((x) => x.kind === def.kind);
                                  const count = r?.count ?? 0;
                                  if (count === 0) return null;
                                  const active = r?.mine ?? false;
                                  return (
                                    <button
                                      key={def.kind}
                                      type="button"
                                      title={def.label}
                                      aria-label={`${def.label}, ${count}`}
                                      aria-pressed={active}
                                      onClick={() => void toggleReaction(msg.id, def.kind)}
                                      className={[
                                        "inline-flex min-h-7 items-center gap-1 rounded-full border px-2 py-0.5 text-[14px] leading-none transition",
                                        "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)]",
                                        active
                                          ? "border-[var(--line-strong)] bg-[var(--bg-sunken)] ring-1 ring-[var(--accent)]/30"
                                          : "",
                                      ].join(" ")}
                                    >
                                      <span className="select-none" aria-hidden>
                                        {def.emoji}
                                      </span>
                                      <span className="ari-num text-[11px] font-medium text-[var(--ink-4)]">
                                        {count}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {mine && msg.receipt ? (
                              <div
                                className="mt-1 flex justify-end pr-0.5"
                                title={
                                  msg.receipt.read_by?.length
                                    ? `Read by ${msg.receipt.read_by.map((reader) => reader.full_name).join(", ")}`
                                    : "Delivered"
                                }
                              >
                                <span
                                  className={[
                                    "inline-flex h-5 w-6 items-center justify-center",
                                    msg.receipt.read_by?.length ? "text-[var(--pos)]" : "text-[var(--ink-5)]",
                                  ].join(" ")}
                                  aria-label={msg.receipt.read_by?.length ? "Read" : "Delivered"}
                                >
                                  <IconMessageDoubleTick />
                                </span>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            ) : null}
              </div>

              {/* Composer , pinned to bottom; toolbar inside the message box */}
              <div className="mt-auto shrink-0 border-t border-[var(--line)] bg-[var(--bg-raised)] px-4 py-3 sm:px-6">
                <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-app)] shadow-none transition focus-within:border-[var(--line-strong)] focus-within:ring-1 focus-within:ring-[var(--accent)]/25">
                  {replyTarget ? (
                    <div className="flex items-start gap-2 border-b border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2">
                      <div className="min-w-0 flex-1 border-l-2 border-[var(--line-strong)] pl-2.5">
                        <p className="text-[11px] font-medium leading-tight text-[var(--ink-4)]">
                          Replied to{" "}
                          <span className="font-semibold text-[var(--ink-strong)]">{replyTarget.authorName}</span>
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-normal leading-tight text-[var(--ink-5)]">
                          {replyTarget.preview}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTarget(null)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-5)] transition hover:bg-[var(--bg-raised)] hover:text-[var(--ink-strong)]"
                        aria-label="Cancel reply"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  {voiceOpen && projectId ? (
                    <div className="px-2 pt-2">
                      <VoiceComposerPanel
                        onClose={() => setVoiceOpen(false)}
                        onTranscript={(text) =>
                          setInput((prev) => {
                            const t = text.trim();
                            if (!t) return prev;
                            const p = prev.trim();
                            return p ? `${p} ${t}` : t;
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[4.5rem] w-full items-start gap-2 px-3 pb-2 pt-2.5">
                      {aiMentionActive ? (
                        <span
                          className="mt-0.5 inline-flex shrink-0 select-none items-center rounded-md border border-[var(--line)] bg-[var(--accent-soft)] px-2 py-0.5 text-[13px] font-semibold tracking-tight text-[#0b0a08] dark:text-[var(--ink-strong)]"
                          aria-hidden
                        >
                          @AI Assistant
                        </span>
                      ) : null}
                      <textarea
                        value={input}
                        onChange={handleComposerChange}
                        onKeyDown={handleComposerKeyDown}
                        disabled={!projectId}
                        placeholder={
                          projectId
                            ? aiMentionActive
                              ? "Message"
                              : "Type a message or @AI Assistant"
                            : "Select a project to send messages"
                        }
                        rows={3}
                        className="block min-h-[3.5rem] min-w-0 flex-1 resize-y border-0 bg-transparent p-0 text-[13px] font-normal leading-[1.5] text-[var(--ink-2)] placeholder:font-normal placeholder:text-[var(--ink-5)] focus:outline-none focus:ring-0 disabled:opacity-45"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-0.5 border-t border-[var(--line)] px-1.5 py-1">
                    <button
                      type="button"
                      title={voiceOpen ? "Close voice" : "Voice message"}
                      aria-label={voiceOpen ? "Close voice input" : "Voice message"}
                      aria-pressed={voiceOpen}
                      disabled={!projectId}
                      onClick={() => setVoiceOpen((v) => !v)}
                      className={[
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-35",
                        voiceOpen
                          ? "bg-[var(--accent-soft)] text-[#0b0a08] ring-1 ring-[var(--accent-line)] dark:text-[var(--ink-strong)]"
                          : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]",
                      ].join(" ")}
                    >
                      <IconComposerMic />
                    </button>
                    <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" aria-hidden />
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={!projectId || !input.trim()}
                      title="Send"
                      aria-label="Send message"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-strong)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <IconComposerSend />
                    </button>
                  </div>
                </div>
              </div>
        </div>
      </section>
    </main>
  );
}
