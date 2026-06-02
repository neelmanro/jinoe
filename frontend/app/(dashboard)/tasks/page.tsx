"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { pageBg } from "@/components/auth/JinoeAuthChrome";
import { NewTaskModal } from "@/components/tasks/NewTaskModal";
import { SelectProjectFirst } from "@/components/ui/SelectProjectFirst";
import { useProject } from "@/components/sidebar/project-context";
import { tasksToColumns, type TaskOut } from "@/lib/project-api";
import { type AiTaskRun, type Column, type TaskCard, type TaskStatus, type Tag, type TagTone } from "@/lib/task-board";

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-[#0b0a08] transition hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";

const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-[12.5px] font-medium text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)] disabled:pointer-events-none disabled:opacity-45";

const btnPrimarySm =
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-black/10 bg-[var(--accent)] px-3 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";

/* ────────────────────────────────────────────────────────────
   Visual atoms: monochrome, hairline, no decorative styling
   ──────────────────────────────────────────────────────────── */

const TAG_STYLE: Record<TagTone, string> = {
  engineering: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_2px_8px_rgba(11,10,8,0.05)]",
  design: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_2px_8px_rgba(11,10,8,0.05)]",
  data: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_2px_8px_rgba(11,10,8,0.05)]",
  ops: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_2px_8px_rgba(11,10,8,0.05)]",
  ai: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_2px_8px_rgba(11,10,8,0.05)]",
};

function TagChip({ label, tone }: Tag) {
  return (
    <span
      className={[
        "inline-flex h-[18px] items-center rounded-[4px] border-2 px-1.5 text-[10.5px] font-bold tracking-[-0.005em]",
        TAG_STYLE[tone],
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function ColumnDot({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, string> = {
    todo: "bg-[var(--ink-5)]",
    doing: "bg-[var(--ink-strong)]",
    review: "bg-[var(--warn)]",
    shipped: "bg-[var(--pos)]",
  };
  return <span className={["h-1.5 w-1.5 rounded-full", map[status]].join(" ")} />;
}

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const initials = isAiAssignee(name) ? "AI" : name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const isAI = isAiAssignee(name);
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center rounded-full",
        isAI ? "bg-[var(--accent)] text-[var(--ink-strong)]" : "bg-[var(--ink-strong)] text-white",
      ].join(" ")}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        fontWeight: 600,
        letterSpacing: "-0.01em",
      }}
      title={isAI ? "Jinoe AI" : name}
    >
      {initials}
    </span>
  );
}

function AssigneeLabel({ name }: { name: string }) {
  const isAI = isAiAssignee(name);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--ink-4)]">
      <Avatar name={name} size={16} />
      {isAI ? "Jinoe AI" : name}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex h-[22px] flex-col justify-end">
      <div className="flex items-center gap-2">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full rounded-full bg-[var(--ink-strong)] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="ari-num shrink-0 text-[10.5px] font-bold text-[var(--ink-5)]">{pct}%</span>
      </div>
    </div>
  );
}

function isAiAssignee(name: string) {
  return name === "AI" || name === "AI Agent" || name === "Jinoe AI";
}

function isAiRunActive(run?: AiTaskRun | null) {
  return Boolean(run && (run.status === "queued" || run.status === "running"));
}

function aiRunLabel(run?: AiTaskRun | null) {
  if (!run) return "Ready for AI";
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Working";
  if (run.status === "submitted") return "In review";
  if (run.status === "failed") return "Needs attention";
  return run.status;
}

function aiRunTone(run?: AiTaskRun | null) {
  if (!run) return "border-[var(--line)] bg-[var(--bg-sunken)] text-[var(--ink-4)]";
  if (run.status === "failed") return "border-[var(--neg)] bg-[var(--neg-soft)] text-[var(--neg)]";
  if (run.status === "submitted") return "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]";
  return "border-black/10 bg-[var(--accent-soft)] text-[var(--ink-strong)]";
}

/* ────────────────────────────────────────────────────────────
   Card
   ──────────────────────────────────────────────────────────── */

function KanbanCard({
  task,
  columnStatus,
  selected,
  onClick,
  onStartTask,
  onStartAiTask,
  startingTaskId,
  startingAiTaskId,
  isOwner,
}: {
  task: TaskCard;
  columnStatus: TaskStatus;
  selected: boolean;
  onClick: () => void;
  onStartTask: (task: TaskCard) => void;
  onStartAiTask: (task: TaskCard) => void;
  startingTaskId: string | null;
  startingAiTaskId: string | null;
  isOwner: boolean;
}) {
  const desc = task.body?.trim();
  const showActionStrip = columnStatus === "todo" || columnStatus === "doing";
  const starting = startingTaskId === task.id;
  const startingAi = startingAiTaskId === task.id;
  const aiActive = isAiRunActive(task.ai_run);
  const showAiSummary = isAiAssignee(task.assignee) || Boolean(task.ai_run);

  return (
    <div
      className={[
        "group flex w-full shrink-0 flex-col overflow-hidden rounded-[7px] border border-[var(--line-strong)] bg-white shadow-none transition",
        selected
          ? "border-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] ring-2 ring-[var(--accent-soft)]"
          : "hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[148px] flex-1 cursor-pointer flex-col overflow-hidden p-2.5 text-left sm:min-h-[152px] sm:p-3"
      >
        <p className="line-clamp-2 shrink-0 text-[12.5px] font-bold leading-[1.35] tracking-[-0.005em] text-[var(--ink-strong)] sm:text-[13px]">
          {task.title}
        </p>
        <p
          className={[
            "mt-1 line-clamp-2 min-h-[2.5rem] shrink-0 text-[11px] font-medium leading-snug",
            desc ? "text-[var(--ink-4)]" : "text-[var(--ink-5)]",
          ].join(" ")}
        >
          {desc || "No description yet."}
        </p>
        <div className="mt-1.5 flex min-h-[22px] shrink-0 flex-wrap gap-1 overflow-hidden">
          {task.tags.length
            ? task.tags.slice(0, 3).map((t) => <TagChip key={t.label} {...t} />)
            : null}
        </div>
        <div className="mt-auto shrink-0 pt-1">
          {task.ai_run ? (
            <ProgressBar pct={task.ai_run.progress} />
          ) : task.progress !== undefined ? (
            <ProgressBar pct={task.progress} />
          ) : (
            <div className="h-[22px]" aria-hidden />
          )}
          {showAiSummary ? (
            <div className="mt-1.5 flex min-h-[22px] items-center gap-2 overflow-hidden">
              {aiActive ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)] ring-2 ring-[var(--accent-soft)]" /> : null}
              <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-extrabold ${aiRunTone(task.ai_run)}`}>
                {aiRunLabel(task.ai_run)}
              </span>
              <span className="min-w-0 truncate text-[10.5px] font-semibold text-[var(--ink-5)]">
                {task.ai_run?.current_step || "Assigned to Jinoe AI"}
              </span>
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate">
              <AssigneeLabel name={task.assignee} />
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px] font-semibold text-[var(--ink-5)]">
              {task.shipped ? (
                <span className="inline-flex items-center gap-1 text-[var(--pos)]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12l5 5 9-11" />
                  </svg>
                </span>
              ) : task.comments > 0 ? (
                <span className="ari-num inline-flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
                  </svg>
                  {task.comments}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
      {showActionStrip ? (
        <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg-sunken)]/50 px-2 py-1.5 sm:px-2.5">
          <div className="grid grid-cols-1 gap-1.5">
            {isOwner && columnStatus === "todo" ? (
              <button
                type="button"
                disabled={startingAi || aiActive}
                onClick={() => onStartAiTask(task)}
                className={`${btnPrimarySm} h-7 w-full justify-center gap-2 text-[11.5px]`}
              >
                {startingAi || aiActive ? (
                  <>
                    <AuthSubmitSpinner className="size-3.5" />
                    <span>{aiActive ? "Jinoe working…" : "Assigning AI…"}</span>
                  </>
                ) : (
                  "Assign Jinoe AI"
                )}
              </button>
            ) : null}
            <button
              type="button"
              disabled={starting || aiActive}
              onClick={() => onStartTask(task)}
              className={`${isOwner && columnStatus === "todo" ? btnGhost : btnPrimarySm} h-7 w-full justify-center gap-2 text-[11.5px]`}
            >
              {starting ? (
                <>
                  <AuthSubmitSpinner className="size-3.5" />
                  <span>Opening editor…</span>
                </>
              ) : columnStatus === "doing" ? (
                "Open editor"
              ) : (
                "Start myself"
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Column
   ──────────────────────────────────────────────────────────── */

function KanbanColumn({
  col,
  selectedId,
  onSelect,
  onRequestAdd,
  onStartTask,
  onStartAiTask,
  startingTaskId,
  startingAiTaskId,
  isOwner,
}: {
  col: Column;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestAdd: () => void;
  onStartTask: (task: TaskCard) => void;
  onStartAiTask: (task: TaskCard) => void;
  startingTaskId: string | null;
  startingAiTaskId: string | null;
  isOwner: boolean;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between gap-1.5 px-0.5 pb-2 sm:gap-2 sm:px-1">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <ColumnDot status={col.id} />
          <span className="min-w-0 truncate text-[11.5px] font-bold tracking-[-0.005em] text-[var(--ink-strong)] sm:text-[12.5px]">
            {col.title}
          </span>
          <span className="ari-num shrink-0 text-[10.5px] font-bold text-[var(--ink-5)] sm:text-[11px]">{col.tasks.length}</span>
        </div>
        <button
          type="button"
          aria-label="Add task"
          onClick={onRequestAdd}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--ink-5)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden pr-0.5">
        {col.tasks.map((t) => (
          <KanbanCard
            key={t.id}
            task={t}
            columnStatus={col.id}
            selected={selectedId === t.id}
            onClick={() => onSelect(t.id)}
            onStartTask={onStartTask}
            onStartAiTask={onStartAiTask}
            startingTaskId={startingTaskId}
            startingAiTaskId={startingAiTaskId}
            isOwner={isOwner}
          />
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Detail panel
   ──────────────────────────────────────────────────────────── */

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-3 border-b border-[var(--line)] py-2 last:border-b-0">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">{label}</span>
      <div className="text-[12.5px] font-semibold text-[var(--ink-2)]">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { tone: string; label: string }> = {
    todo: { tone: "border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[var(--ink-3)]", label: "To do" },
    doing: { tone: "border border-black/10 bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_4px_10px_rgba(11,10,8,0.06)]", label: "In progress" },
    review: { tone: "border-[var(--line-strong)] bg-[var(--warn-soft)] text-[var(--warn)]", label: "In review" },
    shipped: { tone: "border-[var(--line-strong)] bg-[var(--pos-soft)] text-[var(--pos)]", label: "Shipped" },
  };
  const v = map[status];
  return (
    <span className={["inline-flex items-center gap-1.5 rounded-full border-2 px-2 py-px text-[11px] font-bold", v.tone].join(" ")}>
      <ColumnDot status={status} />
      {v.label}
    </span>
  );
}

function formatTaskDue(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const taskDetailBackdrop = "absolute inset-0 cursor-default bg-[var(--ink-strong)]/30 backdrop-blur-[2px]";
const taskDetailShell =
  "relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-[480px] flex-col overflow-hidden rounded-[8px] border border-[var(--line-strong)] bg-white shadow-[var(--sh-pop)]";

function TaskDetailModal({
  task,
  status,
  onClose,
  onStartTask,
  onStartAiTask,
  startingTaskId,
  startingAiTaskId,
  isOwner,
}: {
  task: TaskCard;
  status: TaskStatus;
  onClose: () => void;
  onStartTask: (task: TaskCard) => void;
  onStartAiTask: (task: TaskCard) => void;
  startingTaskId: string | null;
  startingAiTaskId: string | null;
  isOwner: boolean;
}) {
  const desc = task.body?.trim();
  const canStart = status === "todo" || status === "doing";
  const aiRun = task.ai_run;
  const aiActive = isAiRunActive(aiRun);
  const logsRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!logsRef.current) return;
    logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [aiRun?.logs]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
      <button type="button" className={taskDetailBackdrop} onClick={onClose} aria-label="Close dialog" />
      <div className={taskDetailShell}>
        <header className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--line)] px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--ink-5)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3 sm:px-6">
          <h2 id="task-detail-title" className="text-[16px] font-extrabold leading-[1.3] tracking-[-0.012em] text-[var(--ink-strong)]">
            {task.title}
          </h2>
          {desc ? (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] font-semibold leading-[1.55] text-[var(--ink-4)]">{desc}</p>
          ) : (
            <p className="mt-2 text-[12.5px] font-semibold leading-[1.55] text-[var(--ink-5)]">No description.</p>
          )}

          <div className="mt-5">
            <FieldRow label="Status">
              <StatusBadge status={status} />
            </FieldRow>
            <FieldRow label="Assignee">
              <AssigneeLabel name={task.assignee} />
            </FieldRow>
            {task.reviewer ? (
              <FieldRow label="Reviewer">
                <AssigneeLabel name={task.reviewer} />
              </FieldRow>
            ) : null}
            {task.due_at ? (
              <FieldRow label="Due">
                <span className="ari-num">{formatTaskDue(task.due_at)}</span>
              </FieldRow>
            ) : null}
            {task.tags.length ? (
              <FieldRow label="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {task.tags.map((t) => (
                    <TagChip key={t.label} {...t} />
                  ))}
                </div>
              </FieldRow>
            ) : null}
          </div>

          {task.progress !== undefined ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Progress</span>
                <span className="ari-num text-[12.5px] font-bold text-[var(--ink-strong)]">{task.progress}%</span>
              </div>
              <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--ink-strong)]" style={{ width: `${task.progress}%` }} />
              </div>
            </div>
          ) : null}

          {isOwner || aiRun || isAiAssignee(task.assignee) ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Jinoe AI</p>
                  <p className="mt-1 text-[12.5px] font-bold text-[var(--ink-strong)]">
                    {aiRun ? aiRunLabel(aiRun) : "Ready to assign"}
                  </p>
                </div>
                {aiActive ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] ring-4 ring-[var(--accent-soft)]" /> : null}
              </div>
              {aiRun ? (
                <>
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[var(--ink-5)]">{aiRun.current_step}</span>
                      <span className="ari-num text-[11px] font-extrabold text-[var(--ink-strong)]">{aiRun.progress}%</span>
                    </div>
                    <div className="mt-1.5 h-[4px] overflow-hidden rounded-full bg-[var(--line)]">
                      <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${aiRun.progress}%` }} />
                    </div>
                  </div>

                  {aiRun.todos.length ? (
                    <div className="mt-4 rounded-[8px] border border-[var(--line)] bg-[var(--bg-sunken)] p-3">
                      <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Plan</p>
                      <div className="space-y-1.5">
                        {aiRun.todos.map((todo, index) => {
                          const done = todo.status === "completed";
                          const active = todo.status === "in_progress";
                          return (
                            <div key={todo.id || index} className="flex items-start gap-2 text-[12px] font-semibold text-[var(--ink-3)]">
                              <span
                                className={[
                                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-extrabold",
                                  done
                                    ? "border-[var(--pos)] bg-[var(--pos-soft)] text-[var(--pos)]"
                                    : active
                                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink-strong)]"
                                      : "border-[var(--line-strong)] bg-white text-[var(--ink-5)]",
                                ].join(" ")}
                              >
                                {done ? "✓" : active ? "•" : ""}
                              </span>
                              <span className={done ? "text-[var(--ink-5)] line-through decoration-[var(--ink-5)]/50" : ""}>
                                {todo.content || "Task step"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {aiRun.events.length ? (
                    <div className="mt-4 rounded-[8px] border border-[var(--line)] bg-white p-3">
                      <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Activity</p>
                      <div className="max-h-[180px] space-y-2 overflow-auto pr-1">
                        {aiRun.events.slice(-18).map((event, index) => (
                          <div key={event.id || index} className="flex gap-2">
                            <span
                              className={[
                                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                                event.status === "failed" ? "bg-[var(--neg)]" : event.status === "running" ? "bg-[var(--accent)]" : "bg-[var(--ink-5)]",
                              ].join(" ")}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-bold text-[var(--ink-strong)]">{event.title || "AI event"}</p>
                              {event.detail ? <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold text-[var(--ink-5)]">{event.detail}</p> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 overflow-hidden rounded-[8px] border border-[var(--line)] bg-slate-950">
                    <div className="border-b border-white/10 px-3 py-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-white/55">
                      Live logs
                    </div>
                    <pre ref={logsRef} className="max-h-[180px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-slate-100">
                      {aiRun.logs?.trim() || "No logs yet."}
                    </pre>
                  </div>

                  {aiRun.error ? (
                    <p className="mt-3 rounded-[7px] border border-[var(--neg)] bg-[var(--neg-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--neg)]">
                      {aiRun.error}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[12.5px] font-semibold leading-snug text-[var(--ink-4)]">
                  Jinoe AI will create its own sandbox, work on this task, and submit changes for owner review.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[var(--line)] bg-white px-5 py-3 sm:px-6">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-4 text-[12.5px] font-bold text-[var(--ink-3)] transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)]"
            >
              Close
            </button>
            {canStart ? (
              <button
                type="button"
                disabled={startingTaskId === task.id || aiActive}
                onClick={() => onStartTask(task)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[6px] border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45"
              >
                {startingTaskId === task.id ? (
                  <>
                    <AuthSubmitSpinner />
                    <span>Opening editor, one moment…</span>
                  </>
                ) : status === "doing" ? (
                  "Open editor"
                ) : (
                  "Start task"
                )}
              </button>
            ) : null}
            {isOwner && status === "todo" ? (
              <button
                type="button"
                disabled={startingAiTaskId === task.id || aiActive}
                onClick={() => onStartAiTask(task)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[6px] border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45"
              >
                {startingAiTaskId === task.id || aiActive ? (
                  <>
                    <AuthSubmitSpinner />
                    <span>{aiActive ? "Jinoe working…" : "Assigning…"}</span>
                  </>
                ) : (
                  "Assign Jinoe AI"
                )}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

const FILTERS = [
  { label: "All", count: 0 },
  { label: "My tasks", count: 0 },
  { label: "Assigned to AI", count: 0 },
  { label: "Needs review", count: 0 },
];

export default function TasksPage() {
  const router = useRouter();
  const { role } = useAuth();
  const { projectId, current } = useProject();
  const [columns, setColumns] = useState<Column[]>(() => tasksToColumns([]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<TaskStatus>("todo");
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [startingAiTaskId, setStartingAiTaskId] = useState<string | null>(null);
  const isOwner = role === "owner";

  const loadProjectTasks = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!projectId) {
        setColumns(tasksToColumns([]));
        setSelectedId(null);
        setTasksLoading(false);
        setTasksError(null);
        return;
      }
      const silent = Boolean(opts?.silent);
      if (!silent) {
        setTasksLoading(true);
        setTasksError(null);
      }
      try {
        const rows = await apiRequest<TaskOut[]>(`/team/projects/${projectId}/tasks`);
        setColumns(tasksToColumns(rows));
        if (!silent) setSelectedId(null);
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : "Could not load tasks");
        setColumns(tasksToColumns([]));
      } finally {
        if (!silent) setTasksLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProjectTasks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjectTasks]);

  const flat = columns.flatMap((c) => c.tasks.map((t) => ({ task: t, status: c.id })));
  const hasActiveAiRun = flat.some((x) => isAiRunActive(x.task.ai_run));

  useEffect(() => {
    if (!projectId || !hasActiveAiRun) return;
    const timer = window.setInterval(() => {
      void loadProjectTasks({ silent: true });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [projectId, hasActiveAiRun, loadProjectTasks]);

  const totalTasks = flat.length;
  const filterCounts = (() => {
    const all = totalTasks;
    return {
      All: all,
      "My tasks": 0,
      "Assigned to AI": flat.filter((x) => isAiAssignee(x.task.assignee) || x.task.ai_run).length,
      "Needs review": flat.filter((x) => x.status === "review").length,
    } as const;
  })();

  const selected = flat.find((x) => x.task.id === selectedId) ?? null;
  const showBoardChrome = Boolean(projectId && !tasksLoading && !tasksError && totalTasks > 0);

  const startTask = useCallback(
    async (task: TaskCard) => {
      if (!projectId) return;
      setStartingTaskId(task.id);
      try {
        await apiRequest(`/team/projects/${projectId}/tasks/${task.id}/start`, { method: "POST" });
        showDashboardToast("Task editor is ready.");
        router.push("/editor");
      } catch (e) {
        showDashboardToast(e instanceof Error ? e.message : "Could not start task");
      } finally {
        setStartingTaskId(null);
      }
    },
    [projectId, router]
  );

  const startAiTask = useCallback(
    async (task: TaskCard) => {
      if (!projectId) return;
      setStartingAiTaskId(task.id);
      try {
        await apiRequest(`/team/projects/${projectId}/tasks/${task.id}/ai/start`, { method: "POST" });
        showDashboardToast("Jinoe AI is working on this task.");
        await loadProjectTasks({ silent: true });
      } catch (e) {
        showDashboardToast(e instanceof Error ? e.message : "Could not assign Jinoe AI");
      } finally {
        setStartingAiTaskId(null);
      }
    },
    [projectId, loadProjectTasks]
  );

  if (projectId && current?.setup_status && current.setup_status !== "ready") {
    return (
      <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
        <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Tasks</h1>
        </header>
        <section className="flex min-h-0 flex-1 items-center justify-center px-4 py-12">
          <div className="max-w-[40ch] text-center">
            <p className="text-base font-medium text-[var(--ink-strong)]">Finish project setup first</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">
              Add starting files or skip setup. After that, you can create tasks for people or AI to work on.
            </p>
            <button type="button" onClick={() => router.push("/editor")} className={`${btnPrimary} mt-6`}>
              Open setup
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Tasks</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selected && (selected.status === "todo" || selected.status === "doing") ? (
              <button
                type="button"
                disabled={startingTaskId === selected.task.id || isAiRunActive(selected.task.ai_run)}
                onClick={() => startTask(selected.task)}
                className={`${btnGhost} justify-center gap-2`}
              >
                {startingTaskId === selected.task.id ? (
                  <>
                    <AuthSubmitSpinner />
                    <span>Opening editor…</span>
                  </>
                ) : selected.status === "doing" ? (
                  "Open editor"
                ) : (
                  "Start task"
                )}
              </button>
            ) : null}
            {isOwner && selected?.status === "todo" ? (
              <button
                type="button"
                disabled={startingAiTaskId === selected.task.id || isAiRunActive(selected.task.ai_run)}
                onClick={() => startAiTask(selected.task)}
                className={`${btnPrimary} justify-center gap-2`}
              >
                {startingAiTaskId === selected.task.id || isAiRunActive(selected.task.ai_run) ? (
                  <>
                    <AuthSubmitSpinner />
                    <span>{isAiRunActive(selected.task.ai_run) ? "Jinoe working…" : "Assigning…"}</span>
                  </>
                ) : (
                  "Assign Jinoe AI"
                )}
              </button>
            ) : null}
            {showBoardChrome ? (
              <div className="hidden items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-2.5 py-1 lg:flex">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden
                  className="shrink-0 text-[var(--ink-5)]"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M20 20l-4-4" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks"
                  className="h-8 w-44 bg-transparent text-[12.5px] font-medium text-[var(--ink-strong)] placeholder:text-[var(--ink-5)] focus:outline-none"
                />
                <span className="ari-num rounded border border-[var(--line)] bg-[var(--bg-sunken)] px-1.5 py-px text-[10px] font-medium text-[var(--ink-4)]">
                  ⌘K
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void loadProjectTasks({ silent: true })}
              disabled={!projectId}
              className={`${btnGhost} gap-2`}
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={!projectId}
              title={!projectId ? "Select a project in the sidebar first" : undefined}
              onClick={() => {
                setSelectedId(null);
                setNewTaskDefaultStatus("todo");
                setNewTaskOpen(true);
              }}
              className={`${btnPrimary} gap-2`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New task
            </button>
          </div>
        </div>
      </header>

      <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        {showBoardChrome ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--line)] pb-3">
            {FILTERS.map((f) => {
              const active = activeFilter === f.label;
              const c =
                f.label === "All"
                  ? filterCounts.All
                  : f.label === "My tasks"
                    ? filterCounts["My tasks"]
                    : f.label === "Assigned to AI"
                      ? filterCounts["Assigned to AI"]
                      : filterCounts["Needs review"];
              return (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setActiveFilter(f.label)}
                  className={[
                    "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold tracking-tight transition",
                    active
                      ? "border border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[var(--ink-strong)] ring-1 ring-[var(--accent)]/25"
                      : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]",
                  ].join(" ")}
                >
                  {f.label}
                  <span
                    className={["ari-num text-[10.5px] font-medium", active ? "text-[var(--ink-strong)]" : "text-[var(--ink-5)]"].join(" ")}
                  >
                    {c}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${showBoardChrome ? "pt-3" : ""}`}>
          {!projectId ? (
            <SelectProjectFirst description="Select a project in the sidebar to load tasks for that project." />
          ) : current?.setup_status && current.setup_status !== "ready" ? (
            <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 py-12">
              <div className="max-w-[40ch] text-center">
                <p className="text-base font-medium text-[var(--ink-strong)]">Finish project setup first</p>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">
                  Add starting files or skip setup. After that, you can create tasks for people or AI to work on.
                </p>
                <button type="button" onClick={() => router.push("/editor")} className={`${btnPrimary} mt-6`}>
                  Open setup
                </button>
              </div>
            </div>
          ) : tasksError ? (
            <div className="flex min-h-0 w-full flex-1 items-center justify-center p-10">
              <p className="max-w-[42ch] text-center text-[13px] font-semibold text-[var(--neg)]">{tasksError}</p>
            </div>
          ) : tasksLoading ? (
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3">
              <AuthSubmitSpinner className="size-5" />
              <p className="text-[13px] text-[var(--ink-5)]">Loading…</p>
            </div>
          ) : null}
          {projectId && !(current?.setup_status && current.setup_status !== "ready") && !tasksLoading && !tasksError ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden">
              {totalTasks === 0 ? (
                <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 py-16">
                  <div className="w-full max-w-[520px] rounded-[10px] border border-[var(--line-strong)] bg-white p-6 text-center shadow-none">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Ready to work</p>
                    <p className="mt-2 text-base font-extrabold text-[var(--ink-strong)]">Create the first task</p>
                    <p className="mx-auto mt-2 max-w-[44ch] text-[13px] font-semibold leading-relaxed text-[var(--ink-4)]">
                      Tasks give each person or AI a focused place to work. When the work is done, the owner reviews it before it becomes part of the project.
                    </p>
                    <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(null);
                          setNewTaskDefaultStatus("todo");
                          setNewTaskOpen(true);
                        }}
                        className={`${btnPrimary} h-10 justify-center`}
                      >
                        New task
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          router.push("/editor");
                          showDashboardToast("Use the assistant in the Editor to suggest tasks for this project.");
                        }}
                        className={`${btnGhost} h-10 justify-center`}
                      >
                        Suggest tasks with AI
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 grid-rows-[repeat(2,minmax(0,1fr))] gap-3 overflow-y-hidden sm:grid-cols-4 sm:grid-rows-1 sm:gap-4 md:gap-5">
                  {columns.map((col) => (
                    <KanbanColumn
                      key={col.id}
                      col={col}
                      selectedId={selectedId}
                      onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                      onRequestAdd={() => {
                        setSelectedId(null);
                        setNewTaskDefaultStatus(col.id);
                        setNewTaskOpen(true);
                      }}
                      onStartTask={(t) => void startTask(t)}
                      onStartAiTask={(t) => void startAiTask(t)}
                      startingTaskId={startingTaskId}
                      startingAiTaskId={startingAiTaskId}
                      isOwner={isOwner}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {projectId && !tasksLoading && !tasksError && selected ? (
        <TaskDetailModal
          task={selected.task}
          status={selected.status}
          onClose={() => setSelectedId(null)}
          onStartTask={startTask}
          onStartAiTask={startAiTask}
          startingTaskId={startingTaskId}
          startingAiTaskId={startingAiTaskId}
          isOwner={isOwner}
        />
      ) : null}

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        projectId={projectId}
        defaultStatus={newTaskDefaultStatus}
        onCreated={() => void loadProjectTasks({ silent: true })}
      />
    </main>
  );
}
