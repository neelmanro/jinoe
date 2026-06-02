"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { pageBg } from "@/components/auth/JinoeAuthChrome";
import { useProject } from "@/components/sidebar/project-context";
import { SelectProjectFirst } from "@/components/ui/SelectProjectFirst";
type ReviewFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

type TaskReviewOut = {
  id: number;
  project_id: number;
  task_id: number;
  attempt_id: number;
  task_ref: string;
  task_title: string;
  submitted_by_user_id: number;
  submitted_by_name: string;
  status: string;
  branch_name: string;
  base_commit: string;
  head_commit: string;
  changed_files: ReviewFile[];
  diff_text?: string | null;
  merge_commit?: string | null;
  decision_note?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  decided_at?: string | null;
};

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-[#0b0a08] transition hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";

const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-[12.5px] font-medium text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)] disabled:pointer-events-none disabled:opacity-45";

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "Pending",
    approved: "Approved",
    declined: "Declined",
    conflict: "Conflict",
  };
  return map[status] ?? status;
}

function statusClass(status: string) {
  if (status === "approved") return "border-[var(--pos)] bg-[var(--pos-soft)] text-[var(--pos)]";
  if (status === "declined") return "border-[var(--neg)] bg-[var(--neg-soft)] text-[var(--neg)]";
  if (status === "conflict") return "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]";
  return "border-[var(--line)] bg-[var(--accent-soft)] text-[#0b0a08] dark:border-[var(--line)] dark:text-[var(--ink-strong)]";
}

function changedTotals(files: ReviewFile[]) {
  return files.reduce(
    (acc, file) => {
      acc.additions += file.additions;
      acc.deletions += file.deletions;
      return acc;
    },
    { additions: 0, deletions: 0 }
  );
}

/** Parse `diff --git a/... b/...` first line into [aPath, bPath] (paths without a/ or b/ prefix). */
function parseDiffGitLine(line: string): [string, string] | null {
  if (!line.startsWith("diff --git ")) return null;
  const rest = line.slice("diff --git ".length);
  const bMarker = " b/";
  const bIdx = rest.indexOf(bMarker);
  if (!rest.startsWith("a/") || bIdx === -1) return null;
  const aPath = rest.slice(2, bIdx);
  const bPath = rest.slice(bIdx + bMarker.length);
  return aPath && bPath ? [aPath, bPath] : null;
}

/** Split full `git diff --patch` text into one string per file (key = path as in `changed_files`, usually the `b/` path). */
function diffChunksByPath(diffText: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!diffText?.trim()) return map;
  const parts = diffText.split(/\n(?=diff --git )/);
  for (const raw of parts) {
    const chunk = raw.startsWith("diff --git ") ? raw : raw.replace(/^\n+/, "");
    if (!chunk.startsWith("diff --git ")) continue;
    const nl = chunk.indexOf("\n");
    const first = nl === -1 ? chunk : chunk.slice(0, nl);
    const paths = parseDiffGitLine(first);
    if (!paths) continue;
    const [aPath, bPath] = paths;
    const body = chunk.trimEnd();
    map.set(bPath, body);
    if (aPath !== bPath) map.set(aPath, body);
  }
  return map;
}

export default function ReviewsPage() {
  const router = useRouter();
  const { role } = useAuth();
  const { projectId, current } = useProject();
  const [reviews, setReviews] = useState<TaskReviewOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!reviews.length) return null;
    return reviews.find((review) => review.id === selectedId) ?? reviews[0] ?? null;
  }, [reviews, selectedId]);

  const isOwner = role === "owner";
  const selectedReviewId = selected?.id ?? null;
  const load = useCallback(async () => {
    if (!projectId) {
      setReviews([]);
      setSelectedId(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<TaskReviewOut[]>(`/team/projects/${projectId}/reviews`);
      setReviews(rows);
      setSelectedId((currentId) => (currentId && rows.some((r) => r.id === currentId) ? currentId : rows[0]?.id ?? null));
    } catch (e) {
      setReviews([]);
      setSelectedId(null);
      setError(e instanceof Error ? e.message : "Could not load reviews");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const decide = useCallback(
    async (review: TaskReviewOut, action: "approve" | "decline") => {
      if (!projectId) return;
      setActing(`${action}:${review.id}`);
      try {
        const updated = await apiRequest<TaskReviewOut>(
          `/team/projects/${projectId}/reviews/${review.id}/${action}`,
          { method: "POST", body: JSON.stringify({ note: "" }) }
        );
        setReviews((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        showDashboardToast(action === "approve" ? "Approved. The project is updated." : "Review declined.");
      } catch (e) {
        showDashboardToast(e instanceof Error ? e.message : `Could not ${action} review`);
      } finally {
        setActing(null);
      }
    },
    [projectId]
  );

  const totals = selected ? changedTotals(selected.changed_files) : { additions: 0, deletions: 0 };
  const selectedChangedFiles = useMemo(() => selected?.changed_files ?? [], [selected?.changed_files]);
  const activeFilePath = useMemo(() => {
    if (!selectedChangedFiles.length) return null;
    if (selectedFilePath && selectedChangedFiles.some((file) => file.path === selectedFilePath)) {
      return selectedFilePath;
    }
    return selectedChangedFiles[0]!.path;
  }, [selectedChangedFiles, selectedFilePath]);

  const diffByPath = useMemo(() => diffChunksByPath(selected?.diff_text), [selected?.diff_text]);

  const displayedDiff = useMemo(() => {
    if (!selected) return "";
    const raw = selected.diff_text;
    if (!raw?.trim()) return "No text diff available.";
    if (!activeFilePath) return raw;
    const chunk = diffByPath.get(activeFilePath);
    return chunk ?? raw;
  }, [selected, activeFilePath, diffByPath]);

  if (projectId && current?.setup_status && current.setup_status !== "ready") {
    return (
      <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
        <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Reviews</h1>
        </header>
        <section className="flex min-h-0 flex-1 items-center justify-center px-4 py-12">
          <div className="max-w-[40ch] text-center">
            <p className="text-base font-medium text-[var(--ink-strong)]">Finish project setup first</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">
              Add starting files or skip setup. Completed task work will appear here for approval.
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
            <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Reviews</h1>
          </div>
          <button type="button" onClick={() => void load()} disabled={!projectId || loading} className={`${btnGhost} gap-2`}>
            {loading ? <AuthSubmitSpinner /> : null}
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        {!projectId ? (
          <SelectProjectFirst description="Select a project in the sidebar to review submitted task changes." />
        ) : error ? (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center p-10">
            <p className="text-center text-[13px] font-semibold text-[var(--neg)]">{error}</p>
          </div>
        ) : loading ? (
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3">
            <AuthSubmitSpinner className="size-5" />
            <p className="text-[13px] text-[var(--ink-5)]">Loading…</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center px-4 py-16">
            <div className="max-w-[42ch] text-center">
              <p className="text-base font-medium text-[var(--ink-strong)]">Nothing to review yet</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">
                When someone marks a task done, Jinoe shows what changed here before the owner approves it.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-auto border-y border-[var(--line)] py-2 lg:border-y-0 lg:border-r lg:pr-5">
              <div className="flex flex-col gap-2">
                {reviews.map((review) => {
                  const active = selected?.id === review.id;
                  const fileTotals = changedTotals(review.changed_files);
                  return (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() => setSelectedId(review.id)}
                      className={[
                        "w-full rounded-lg border p-3 text-left transition",
                        active
                          ? "border-[var(--line-strong)] bg-[var(--bg-sunken)] ring-1 ring-[var(--accent)]/25"
                          : "border-[var(--line)] bg-[var(--bg-raised)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)]",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-end gap-2">
                        <span className={`shrink-0 rounded-full border px-2 py-px text-[10.5px] font-semibold ${statusClass(review.status)}`}>
                          {statusLabel(review.status)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--ink-strong)]">{review.task_title}</p>
                      <p className="mt-2 truncate text-[11.5px] text-[var(--ink-5)]">Submitted by {review.submitted_by_name}</p>
                      <p className="ari-num mt-2 text-[11px] font-medium text-[var(--ink-4)]">
                        +{fileTotals.additions} / -{fileTotals.deletions} · {review.changed_files.length} files
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selected ? (
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-[var(--line)] pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-px text-[11px] font-semibold ${statusClass(selected.status)}`}>
                          {statusLabel(selected.status)}
                        </span>
                        <span className="text-[11px] font-medium text-[var(--ink-5)]">Update</span>
                      </div>
                      <h2 className="mt-2 text-[17px] font-semibold tracking-tight text-[var(--ink-strong)]">{selected.task_title}</h2>
                      <p className="mt-1 truncate text-[12px] text-[var(--ink-4)]">Diff and files below</p>
                    </div>
                    {isOwner && selected.status === "pending" ? (
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={() => void decide(selected, "decline")}
                          className={`${btnGhost} gap-2`}
                        >
                          {acting === `decline:${selected.id}` ? <AuthSubmitSpinner /> : null}
                          {acting === `decline:${selected.id}` ? "Please wait…" : "Decline"}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={() => void decide(selected, "approve")}
                          className={`${btnPrimary} gap-2`}
                        >
                          {acting === `approve:${selected.id}` ? <AuthSubmitSpinner /> : null}
                          {acting === `approve:${selected.id}` ? "Please wait…" : "Approve"}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-5)]">Files</p>
                      <p className="ari-num mt-1 text-[17px] font-semibold text-[var(--ink-strong)]">{selected.changed_files.length}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-5)]">Added</p>
                      <p className="ari-num mt-1 text-[17px] font-semibold text-[var(--pos)]">+{totals.additions}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-5)]">Removed</p>
                      <p className="ari-num mt-1 text-[17px] font-semibold text-[var(--neg)]">-{totals.deletions}</p>
                    </div>
                  </div>
                  {selected.error ? (
                    <p className="mt-3 rounded-[7px] border border-[var(--warn)] bg-[var(--warn-soft)] p-3 text-[12px] font-semibold leading-snug text-[var(--warn)]">
                      {selected.error}
                    </p>
                  ) : null}
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden pt-4 xl:grid-cols-[minmax(220px,340px)_minmax(0,1fr)]">
                  <div className="flex min-h-[160px] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-raised)]">
                    <p className="shrink-0 border-b border-[var(--line)] px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-[var(--ink-5)]">
                      Files
                    </p>
                    <div className="min-h-0 flex-1 overflow-auto">
                      {selected.changed_files.map((file) => {
                        const active = activeFilePath === file.path;
                        return (
                          <button
                            key={`${file.status}:${file.path}`}
                            type="button"
                            onClick={() => setSelectedFilePath(file.path)}
                            aria-pressed={active}
                            className={[
                              "flex w-full items-center gap-2 border-b border-[var(--line)] px-3 py-2.5 text-left transition last:border-b-0",
                              active
                                ? "bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--accent-line)]"
                                : "hover:bg-[var(--bg-sunken)]",
                            ].join(" ")}
                          >
                            <span className="ari-num w-8 shrink-0 rounded px-0.5 border border-[var(--line)] bg-[var(--bg-sunken)] py-px text-center text-[10px] font-medium text-[var(--ink-4)]">
                              {file.status}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink-strong)]">{file.path}</span>
                            <span className="ari-num shrink-0 text-[11px] font-medium text-[var(--pos)]">+{file.additions}</span>
                            <span className="ari-num shrink-0 text-[11px] font-medium text-[var(--neg)]">-{file.deletions}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-app)]">
                    {activeFilePath ? (
                      <div className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-5)]">Diff</p>
                        <p className="mt-0.5 truncate font-mono text-[12px] font-medium text-[var(--ink-strong)]">{activeFilePath}</p>
                      </div>
                    ) : null}
                    <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-[1.55] text-[var(--ink-2)]">
                      <code>{displayedDiff}</code>
                    </pre>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
