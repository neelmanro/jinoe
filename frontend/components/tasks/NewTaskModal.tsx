"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { inputClass } from "@/components/auth/JinoeAuthChrome";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import type { TaskStatus } from "@/lib/task-board";
import { useProjectMembers } from "@/lib/useProjectMembers";

/** Optional title/body/assignee when opening the modal from another screen. */
export type NewTaskPrefill = {
  title?: string;
  description?: string;
  assigneeId?: number | "";
};

type NewTaskModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  /** Column the user started from, or "todo" from the header */
  defaultStatus: TaskStatus;
  /** Applied each time the modal opens */
  prefill?: NewTaskPrefill | null;
  onCreated: () => void;
};

function resetForm(defaultStatus: TaskStatus) {
  return {
    title: "",
    description: "",
    assigneeId: "" as "" | number,
    dueDate: "",
    status: defaultStatus,
  };
}

export function NewTaskModal({ open, onClose, projectId, defaultStatus, prefill, onCreated }: NewTaskModalProps) {
  const { members, error: membersError, loading: membersLoading } = useProjectMembers(
    projectId,
    open
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<"" | number>("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const f = resetForm(defaultStatus);
      const p = prefill ?? undefined;
      setTitle(p?.title ?? f.title);
      setDescription(p?.description ?? f.description);
      setAssigneeId(p?.assigneeId !== undefined ? p.assigneeId : f.assigneeId);
      setDueDate(f.dueDate);
      setStatus(f.status);
      setSubmitError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, defaultStatus, prefill]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  const assigneeOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: "", label: "Unassigned" },
      ...members.map((m) => ({
        value: String(m.user_id),
        label: m.full_name,
        subtitle: m.email,
      })),
    ],
    [members]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      if (!trimmed || !projectId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await apiRequest(`/team/projects/${projectId}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: trimmed,
            body: description.trim() || null,
            status,
            tags: [],
            assignee_user_id: assigneeId === "" ? null : assigneeId,
            assignee_label: null,
            due_at: dueDate || null,
            shipped: false,
          }),
        });
        onCreated();
        onClose();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Could not create task");
      } finally {
        setSubmitting(false);
      }
    },
    [title, description, status, assigneeId, dueDate, projectId, onCreated, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-dialog-heading"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-[var(--ink-strong)]/30 backdrop-blur-[2px]"
        onClick={() => !submitting && onClose()}
        aria-label="Close dialog"
      />
      <div className="relative z-10 w-full max-w-[440px] overflow-visible rounded-[8px] border border-[var(--line-strong)] bg-white p-5 shadow-[var(--sh-pop)]">
        <h2 id="new-task-dialog-heading" className="text-center text-[15px] font-extrabold tracking-tight text-[var(--ink-strong)]">
          New task
        </h2>
        <p className="mt-1 text-center text-[12px] font-semibold text-[var(--ink-4)]">Add a task to this project</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-3.5 overflow-visible">
          <div>
            <label htmlFor="new-task-title-input" className="mb-1 block text-[12px] font-bold text-[var(--ink-3)]">
              Task title <span className="text-[var(--neg)]">*</span>
            </label>
            <input
              id="new-task-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`${inputClass} h-10 py-2.5 text-[13px]`}
              placeholder="Short title"
              maxLength={500}
              autoComplete="off"
              disabled={submitting}
              required
            />
          </div>

          <div>
            <label htmlFor="new-task-desc" className="mb-1 block text-[12px] font-bold text-[var(--ink-3)]">
              Description
            </label>
            <textarea
              id="new-task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputClass} min-h-[56px] resize-none py-2 text-[13px] leading-[1.45]`}
              placeholder="Optional details"
              maxLength={50_000}
              disabled={submitting}
              rows={2}
            />
          </div>

          <div className="overflow-visible">
            <SearchableSelect
              id="new-task-assignee"
              fieldLabel="Assignee"
              value={assigneeId === "" ? "" : String(assigneeId)}
              onChange={(v) => setAssigneeId(v === "" ? "" : Number(v))}
              options={assigneeOptions}
              disabled={submitting || membersLoading}
              searchPlaceholder="Search teammates…"
            />
          </div>

          <div>
            <label htmlFor="new-task-due" className="mb-1 block text-[12px] font-bold text-[var(--ink-3)]">
              Due date <span className="font-semibold text-[var(--ink-5)]">(optional)</span>
            </label>
            <input
              id="new-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`${inputClass} h-10 py-2.5 text-[13px]`}
              disabled={submitting}
            />
          </div>

          {membersError ? (
            <p className="text-[12px] font-semibold text-[var(--warn)]" role="status">
              {membersError} Assignee list may be incomplete.
            </p>
          ) : null}
          {submitError ? (
            <p className="text-center text-[12.5px] font-semibold text-[var(--neg)]" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="flex justify-center gap-2 border-t border-[var(--line)] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-3 text-[12.5px] font-bold text-[var(--ink-strong)] shadow-none transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !projectId}
              className="inline-flex h-9 min-w-[120px] items-center justify-center gap-2 rounded-[6px] border border-black/10 bg-[var(--accent)] px-3 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {submitting ? <AuthSubmitSpinner /> : null}
              {submitting ? "Saving your task, one moment…" : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
