"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

export type AssistantTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type AssistantActivityStatus = "running" | "success" | "error";

export type AssistantActivity = {
  id: string;
  toolId: string;
  name: string;
  input: Record<string, unknown>;
  status: AssistantActivityStatus;
  result?: Record<string, unknown>;
  logs: string;
};

export type AssistantContextUsage = {
  usedTokens: number;
  maxTokens: number;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function toText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function todoItemsFrom(value: unknown): AssistantTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toRecord(item))
    .filter((item) => typeof item.id === "string" && typeof item.content === "string")
    .map((item) => ({
      id: String(item.id),
      content: String(item.content),
      status:
        item.status === "completed" || item.status === "in_progress" || item.status === "pending"
          ? item.status
          : "pending",
    }));
}

function resultOk(result?: Record<string, unknown>) {
  return result?.ok !== false;
}

function StatusBadge({ status }: { status: AssistantActivityStatus }) {
  const tone =
    status === "success"
      ? "border-[var(--pos)]/35 bg-[var(--pos-soft)] text-[var(--pos)]"
      : status === "error"
        ? "border-[var(--neg)]/35 bg-[var(--neg-soft)] text-[var(--neg)]"
        : "border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[var(--ink-4)]";
  const label = status === "success" ? "Succeeded" : status === "error" ? "Errored" : "Running";

  return <span className={`rounded-[5px] border px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.05em] ${tone}`}>{label}</span>;
}

function ToolGlyph({ name }: { name: string }) {
  const shared = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "run_command") {
    return (
      <svg {...shared}>
        <path d="M4 17l6-6-6-6" />
        <path d="M12 19h8" />
      </svg>
    );
  }
  if (name === "write_file" || name === "edit_file") {
    return (
      <svg {...shared}>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="M13 7l4 4" />
      </svg>
    );
  }
  if (name === "web_search" || name === "web_fetch") {
    return (
      <svg {...shared}>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.2-4.2" />
      </svg>
    );
  }
  if (name === "todo_update") {
    return (
      <svg {...shared}>
        <path d="M5 7h14" />
        <path d="M5 12h14" />
        <path d="M5 17h9" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="M12 4v16" />
      <path d="M4 12h16" />
    </svg>
  );
}

export function AssistantContextMeter({ usage }: { usage: AssistantContextUsage | null }) {
  if (!usage) return null;
  const pct = clampPercent(Math.round((usage.usedTokens / Math.max(usage.maxTokens, 1)) * 100));
  const usedK = Math.round(usage.usedTokens / 1000);
  const maxK = Math.round(usage.maxTokens / 1000);
  const remaining = Math.max(0, 100 - pct);

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-[8px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] px-2.5 text-[11px] font-extrabold text-[var(--ink-4)] transition hover:border-[var(--ink-strong)] hover:text-[var(--ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
        aria-label={`${pct}% context used`}
      >
        <span
          className="relative inline-flex h-4 w-4 rounded-full"
          style={{ background: `conic-gradient(var(--ink-strong) ${pct}%, var(--line) ${pct}% 100%)` }}
          aria-hidden
        >
          <span className="absolute inset-[3px] rounded-full bg-[var(--bg-raised)]" />
        </span>
        <span>{pct}% context</span>
      </button>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-20 hidden w-[240px] rounded-[10px] border border-[var(--line-strong)] bg-[var(--ink-strong)] p-3 text-left text-white shadow-[var(--sh-pop)] group-hover:block group-focus-within:block">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-white/60">Context window</p>
        <p className="mt-2 text-[15px] font-extrabold">{pct}% used ({remaining}% left)</p>
        <p className="mt-1 text-[12.5px] font-bold text-white/85">{usedK}k / {maxK}k tokens used</p>
        <p className="mt-3 text-[12px] font-semibold leading-snug text-white/80">Jinoe automatically compacts context when needed.</p>
      </div>
    </div>
  );
}

export function PreparingNextActions() {
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2 text-[12px] font-bold text-[var(--ink-4)]">
      <span className="relative inline-flex h-3 w-3" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-50" />
        <span className="relative h-3 w-3 rounded-full bg-[var(--ink-strong)]" />
      </span>
      Preparing next actions
    </div>
  );
}

function AutoScrollPre({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [children]);

  return (
    <pre ref={ref} className={className}>
      {children}
    </pre>
  );
}

function LiveTextPreview({ text }: { text: string }) {
  return (
    <AutoScrollPre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--line)] bg-[var(--surface-muted)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
      {text || "Preparing code update..."}
    </AutoScrollPre>
  );
}

function TerminalActivity({ activity }: { activity: AssistantActivity }) {
  const result = activity.result;
  const output = activity.logs || toText(result?.output);
  const command = toText(activity.input.command);
  const cwd = toText(activity.input.cwd) || ".";

  return (
    <ActivityShell activity={activity} title={activity.status === "running" ? "Running terminal command" : "Terminal command complete"}>
      <div className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-2)]">
        <div className="border-b border-[var(--line)] px-3 py-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span className="text-[var(--ink-5)]">[{cwd}]</span> {command}
        </div>
        <AutoScrollPre className="max-h-[240px] overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
          {output || "Waiting for terminal output…"}
        </AutoScrollPre>
      </div>
    </ActivityShell>
  );
}

function CodeActivity({ activity }: { activity: AssistantActivity }) {
  const result = activity.result;
  const path = toText(result?.path) || toText(activity.input.path) || "Workspace file";
  const preview = toText(activity.input.content) || toText(activity.input.new_text) || toText(activity.input.__rawArguments);
  const diff = toText(result?.diff);
  const added = Number(result?.added ?? 0);
  const removed = Number(result?.removed ?? 0);

  return (
    <ActivityShell activity={activity} title={activity.status === "running" ? "Writing code" : "Code update complete"}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--line)] bg-white px-3 py-2">
        <p className="min-w-0 truncate font-mono text-[11.5px] font-bold text-[var(--ink-strong)]">{path}</p>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-extrabold">
          <span className="text-[var(--pos)]">+{added}</span>
          <span className="text-[var(--neg)]">-{removed}</span>
        </div>
      </div>
      {activity.status === "running" ? <LiveTextPreview text={preview} /> : null}
      {activity.status !== "running" ? (
        <AutoScrollPre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--line)] bg-[var(--surface-muted)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
          {diff || "No textual diff available."}
        </AutoScrollPre>
      ) : null}
    </ActivityShell>
  );
}

function SearchActivity({ activity }: { activity: AssistantActivity }) {
  const result = activity.result;
  const results = Array.isArray(result?.results) ? result.results.map((item) => toRecord(item)) : [];
  const query = toText(activity.input.query) || toText(activity.input.url) || "Web request";
  const title = activity.status === "running" ? "Searching the web" : "Searched the web";

  return (
    <ActivityShell activity={activity} title={title}>
      <div className="rounded-[8px] border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-bold text-[var(--ink-2)]">{query}</div>
      {activity.status !== "running" ? (
        <div className="rounded-[8px] border border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-[var(--ink-5)]">{results.length} results</p>
          <div className="mt-2 space-y-2">
            {results.slice(0, 4).map((item, index) => (
              <div key={`${activity.id}-${index}`} className="min-w-0">
                <p className="truncate text-[12px] font-bold text-[var(--ink-strong)]">{toText(item.title) || toText(item.url) || `Result ${index + 1}`}</p>
                {toText(item.url) ? <p className="truncate text-[11px] font-semibold text-[var(--ink-5)]">{toText(item.url)}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </ActivityShell>
  );
}

function TodoActivity({ activity }: { activity: AssistantActivity }) {
  const todos = todoItemsFrom(activity.result?.todos ?? activity.input.todos);
  const title = activity.status === "running" ? "Updating progress" : "Progress";

  return (
    <ActivityShell activity={activity} title={title}>
      <div className="space-y-2 rounded-[10px] border border-[var(--line)] bg-[var(--bg-sunken)] p-3">
        {todos.map((todo) => (
          <div key={todo.id} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2">
            <span
              className={[
                "mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[11px] font-extrabold",
                todo.status === "completed"
                  ? "border-[var(--ink-strong)] bg-[var(--ink-strong)] text-white"
                  : todo.status === "in_progress"
                    ? "border-[var(--ink-strong)] bg-white text-[var(--ink-strong)]"
                    : "border-[var(--line-strong)] bg-white text-transparent",
              ].join(" ")}
            >
              {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "•" : "."}
            </span>
            <p className="text-[12.5px] font-semibold leading-relaxed text-[var(--ink-2)]">{todo.content}</p>
          </div>
        ))}
      </div>
    </ActivityShell>
  );
}

function DefaultActivity({ activity }: { activity: AssistantActivity }) {
  const summary = useMemo(() => {
    const result = activity.result;
    if (!result) return "Waiting for tool output…";
    if (typeof result.error === "string") return result.error;
    if (typeof result.path === "string") return result.path;
    if (typeof result.count === "number") return `${result.count} items`;
    return JSON.stringify(result, null, 2);
  }, [activity.result]);

  return (
    <ActivityShell activity={activity} title={activity.name.replaceAll("_", " ")}>
      <AutoScrollPre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--line)] bg-[var(--surface-muted)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
        {summary}
      </AutoScrollPre>
    </ActivityShell>
  );
}

function ActivityShell({
  activity,
  title,
  children,
}: {
  activity: AssistantActivity;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--line-strong)] bg-white p-3 shadow-[var(--sh-1)]">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-sunken)] text-[var(--ink-strong)]">
            <ToolGlyph name={activity.name} />
          </span>
          <p className="truncate text-[12.5px] font-extrabold text-[var(--ink-strong)]">{title}</p>
        </div>
        <StatusBadge status={activity.status} />
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function AssistantActivityFeed({
  activities,
}: {
  activities: AssistantActivity[];
}) {
  return (
    <div className="space-y-3">
      {activities.map((activity) => {
        if (activity.name === "run_command") return <TerminalActivity key={activity.id} activity={activity} />;
        if (activity.name === "write_file" || activity.name === "edit_file") return <CodeActivity key={activity.id} activity={activity} />;
        if (activity.name === "web_search" || activity.name === "web_fetch") return <SearchActivity key={activity.id} activity={activity} />;
        if (activity.name === "todo_update") return <TodoActivity key={activity.id} activity={activity} />;
        return <DefaultActivity key={activity.id} activity={activity} />;
      })}
    </div>
  );
}

export function activityStatusFromResult(result: Record<string, unknown> | undefined): AssistantActivityStatus {
  return resultOk(result) ? "success" : "error";
}
