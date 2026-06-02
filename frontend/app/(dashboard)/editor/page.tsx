"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { pageBg } from "@/components/auth/JinoeAuthChrome";
import { SelectProjectFirst } from "@/components/ui/SelectProjectFirst";
import { useProject } from "@/components/sidebar/project-context";
import { useWorkspaceChrome } from "@/components/sidebar/workspace-chrome-context";
import type { TaskOut } from "@/lib/project-api";

type TaskAttemptOut = {
  id: number;
  project_id: number;
  task_id: number;
  user_id: number;
  branch_name: string;
  base_branch: string;
  base_commit: string;
  head_commit?: string | null;
  worktree_path: string;
  editor_url?: string | null;
  status: string;
  diff_stat?: string | null;
  created_at: string;
  updated_at: string;
  submitted_at?: string | null;
};

type ProjectSetupEditorOut = {
  project_id: number;
  editor_url: string;
  setup_status: string;
};

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-[#0b0a08] transition hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";

const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] px-3 text-[12.5px] font-medium text-[var(--ink-2)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)] disabled:pointer-events-none disabled:opacity-45";

function Loader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center bg-[var(--surface-app)] px-6 text-center">
      <div className="relative h-12 w-12" role="status" aria-label={title}>
        <div className="absolute inset-0 rounded-full border-[3px] border-[var(--line)] opacity-50" />
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-r-[var(--accent)] border-t-[var(--accent)]" />
      </div>
      <p className="mt-5 text-[14px] font-extrabold text-[var(--ink-strong)]">{title}</p>
      {hint ? <p className="mt-1 max-w-[42ch] text-[12.5px] font-semibold leading-snug text-[var(--ink-5)]">{hint}</p> : null}
    </div>
  );
}

function SetupIntroModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/18 p-4 backdrop-blur-[2px] sm:p-8">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="starter-setup-title"
        className="relative w-full max-w-[560px] rounded-[10px] border border-[var(--ink-strong)] bg-white p-6 text-left shadow-[var(--sh-pop)] sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-[7px] text-[var(--ink-4)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
          aria-label="Close setup note"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Project setup</p>
        <h2 id="starter-setup-title" className="mt-2 max-w-[22rem] text-[22px] font-extrabold leading-tight tracking-[-0.025em] text-[var(--ink-strong)]">
          Set up the starting files before tasks begin
        </h2>
        <p className="mt-3 text-[13px] font-semibold leading-relaxed text-[var(--ink-3)]">
          This editor is for the first version of your project. Add the files your team should start from, choose the tech stack, install dependencies, or keep the simple starter files.
        </p>
        <p className="mt-3 text-[13px] font-semibold leading-relaxed text-[var(--ink-3)]">
          When it looks ready, press <span className="font-extrabold text-[var(--ink-strong)]">Done setting up project</span>. After that, people can start tasks from this project.
        </p>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className={btnPrimary}>
            Continue to editor
          </button>
        </div>
      </section>
    </div>
  );
}

function SetupChoiceScreen({
  projectName,
  opening,
  skipping,
  onOpenEditor,
  onSkipSetup,
}: {
  projectName: string;
  opening: boolean;
  skipping: boolean;
  onOpenEditor: () => void;
  onSkipSetup: () => void;
}) {
  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Project setup</h1>
        <p className="mt-0.5 text-[13px] text-[var(--ink-4)]">{projectName}</p>
      </header>
      <section className="flex min-h-0 flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[560px] rounded-[10px] border border-[var(--line-strong)] bg-white p-6 shadow-none sm:p-7">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-5)]">Before tasks</p>
          <h2 className="mt-2 text-[22px] font-extrabold leading-tight tracking-[-0.025em] text-[var(--ink-strong)]">
            Set the starting point for this project
          </h2>
          <p className="mt-3 text-[13px] font-semibold leading-relaxed text-[var(--ink-3)]">
            Open the setup editor if you want to add starter files now. You can also skip this and start with the simple project that Jinoe already created.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={opening || skipping} onClick={onOpenEditor} className={`${btnPrimary} h-10`}>
              {opening ? <AuthSubmitSpinner /> : null}
              {opening ? "Opening editor…" : "Open setup editor"}
            </button>
            <button type="button" disabled={opening || skipping} onClick={onSkipSetup} className={`${btnGhost} h-10 justify-center`}>
              {skipping ? <AuthSubmitSpinner /> : null}
              {skipping ? "Saving setup…" : "Skip setup"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function EditorPage() {
  const router = useRouter();
  const { projectId, current, refreshProjects } = useProject();
  const { setAssistantOpen } = useWorkspaceChrome();
  const [attempt, setAttempt] = useState<TaskAttemptOut | null>(null);
  const [setupEditor, setSetupEditor] = useState<ProjectSetupEditorOut | null>(null);
  const [tasks, setTasks] = useState<TaskOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [setupAction, setSetupAction] = useState<"open" | "skip" | "complete" | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPort, setPreviewPort] = useState<number>(3000);
  const [previewKind, setPreviewKind] = useState<"proxy" | "absproxy">("proxy");
  const [setupIntroOpen, setSetupIntroOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTask = useMemo(() => {
    if (!attempt) return null;
    return tasks.find((task) => task.id === attempt.task_id) ?? null;
  }, [attempt, tasks]);

  const previewUrl = useMemo(() => {
    const base = (setupEditor?.editor_url || attempt?.editor_url || "").trim().replace(/\/+$/, "");
    if (!base) return null;
    const port = Number.isFinite(previewPort) ? Math.max(1, Math.min(65535, previewPort)) : 3000;
    return `${base}/${previewKind}/${port}/`;
  }, [attempt?.editor_url, previewKind, previewPort, setupEditor?.editor_url]);

  const load = useCallback(async () => {
    if (!projectId) {
      setAttempt(null);
      setSetupEditor(null);
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (current?.setup_status && current.setup_status !== "ready") {
        if (current.setup_status === "failed") {
          throw new Error(current.setup_error || "Project setup failed");
        }
        setIframeLoaded(false);
        setPreviewLoaded(false);
        if (current.setup_status === "setup_required") {
          const setup = await apiRequest<ProjectSetupEditorOut>(`/team/projects/${projectId}/setup-editor`, { method: "POST" });
          setSetupEditor(setup);
        } else {
          setSetupEditor(null);
        }
        setAttempt(null);
        setTasks([]);
        return;
      }
      const [active, rows] = await Promise.all([
        apiRequest<TaskAttemptOut | null>(`/team/projects/${projectId}/task-attempts/active`),
        apiRequest<TaskOut[]>(`/team/projects/${projectId}/tasks`),
      ]);
      setIframeLoaded(false);
      setPreviewLoaded(false);
      setSetupEditor(null);
      setAttempt(active);
      setTasks(rows);
    } catch (e) {
      setAttempt(null);
      setSetupEditor(null);
      setError(e instanceof Error ? e.message : "Could not load editor session");
    } finally {
      setLoading(false);
    }
  }, [current, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (setupEditor || attempt?.editor_url) {
      setAssistantOpen(true);
    }
  }, [attempt?.editor_url, setAssistantOpen, setupEditor]);

  useEffect(() => {
    setPreviewLoaded(false);
  }, [previewUrl]);

  const submitDone = useCallback(async () => {
    if (!projectId || !attempt) return;
    setSubmitting(true);
    try {
      await apiRequest(`/team/projects/${projectId}/tasks/${attempt.task_id}/done`, { method: "POST" });
      showDashboardToast("Task submitted for review.");
      router.push("/tasks");
    } catch (e) {
      showDashboardToast(e instanceof Error ? e.message : "Could not submit task");
    } finally {
      setSubmitting(false);
    }
  }, [attempt, projectId, router]);

  const completeSetup = useCallback(async () => {
    if (!projectId) return;
    setSubmitting(true);
    setSetupAction("complete");
    try {
      await apiRequest<ProjectSetupEditorOut>(`/team/projects/${projectId}/setup-complete`, { method: "POST" });
      await refreshProjects();
      showDashboardToast("Project setup saved. Tasks and reviews are ready.");
      router.push("/tasks");
    } catch (e) {
      showDashboardToast(e instanceof Error ? e.message : "Could not finish setup");
    } finally {
      setSubmitting(false);
      setSetupAction(null);
    }
  }, [projectId, refreshProjects, router]);

  const openSetupEditor = useCallback(async () => {
    if (!projectId) return;
    setSubmitting(true);
    setSetupAction("open");
    try {
      const setup = await apiRequest<ProjectSetupEditorOut>(`/team/projects/${projectId}/setup-editor`, { method: "POST" });
      setIframeLoaded(false);
      setSetupIntroOpen(true);
      setSetupEditor(setup);
      await refreshProjects();
    } catch (e) {
      showDashboardToast(e instanceof Error ? e.message : "Could not open setup editor");
    } finally {
      setSubmitting(false);
      setSetupAction(null);
    }
  }, [projectId, refreshProjects]);

  const skipSetup = useCallback(async () => {
    if (!projectId) return;
    setSubmitting(true);
    setSetupAction("skip");
    try {
      await apiRequest<ProjectSetupEditorOut>(`/team/projects/${projectId}/setup-complete`, { method: "POST" });
      await refreshProjects();
      showDashboardToast("Project setup skipped. Tasks and reviews are ready.");
      router.push("/tasks");
    } catch (e) {
      showDashboardToast(e instanceof Error ? e.message : "Could not skip setup");
    } finally {
      setSubmitting(false);
      setSetupAction(null);
    }
  }, [projectId, refreshProjects, router]);

  if (!current) {
    return (
      <main className={`flex min-h-0 w-full flex-1 flex-col ${pageBg}`}>
        <SelectProjectFirst description="Select a project, then start a task from the task board." />
      </main>
    );
  }

  if (loading) {
    return <Loader title="Opening editor" hint="Checking the current workspace state." />;
  }

  if (error) {
    return (
      <main className={`flex min-h-0 w-full flex-1 items-center justify-center ${pageBg} p-6`}>
        <div className="max-w-[460px] rounded-[8px] border border-[var(--line-strong)] bg-white p-6 text-center">
          <p className="text-[14px] font-extrabold text-[var(--ink-strong)]">Editor unavailable</p>
          <p className="mt-2 text-[12.5px] font-semibold leading-snug text-[var(--neg)]">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnPrimary} mt-4`}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (current.setup_status && current.setup_status !== "ready" && !setupEditor) {
    return (
      <SetupChoiceScreen
        projectName={current.name || "Current project"}
        opening={setupAction === "open"}
        skipping={setupAction === "skip"}
        onOpenEditor={() => void openSetupEditor()}
        onSkipSetup={() => void skipSetup()}
      />
    );
  }

  if (setupEditor) {
    return (
      <main className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--surface-app)]">
        <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-[var(--ink-strong)] bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-[4px] border border-[var(--line-strong)] bg-[var(--accent)] px-1.5 py-px text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--ink-strong)]">
                Setup
              </span>
              <h1 className="min-w-0 truncate text-[15px] font-extrabold text-[var(--ink-strong)] sm:text-[18px]">Setting up project</h1>
            </div>
            <p className="mt-1.5 truncate text-[12px] font-semibold text-[var(--ink-5)]">These starting files are what people will work from.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {previewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewOpen((v) => !v);
                    setPreviewLoaded(false);
                  }}
                  className={btnGhost}
                >
                  {previewOpen ? "Hide preview" : "Preview"}
                </button>
                <a href={previewUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                  Open preview
                </a>
              </>
            ) : null}
            <button type="button" disabled={submitting} onClick={() => void completeSetup()} className={btnPrimary}>
              {setupAction === "complete" ? <AuthSubmitSpinner /> : null}
              {setupAction === "complete" ? "Saving, one moment…" : "Done setting up project"}
            </button>
          </div>
        </header>
        <section className="relative min-h-0 flex-1 overflow-hidden">
          {setupIntroOpen ? <SetupIntroModal onClose={() => setSetupIntroOpen(false)} /> : null}
          <div className="absolute right-3 top-3 z-20 flex flex-wrap items-center justify-end gap-2 rounded-[10px] border border-[var(--line)] bg-white/90 p-2 shadow-[var(--sh-pop)] backdrop-blur">
            <label className="flex items-center gap-2 text-[11px] font-extrabold text-[var(--ink-4)]">
              Port
              <input
                value={String(previewPort)}
                onChange={(e) => setPreviewPort(Number.parseInt(e.target.value || "3000", 10) || 3000)}
                inputMode="numeric"
                className="h-8 w-[90px] rounded-[7px] border border-[var(--line)] bg-white px-2 text-[12px] font-semibold text-[var(--ink-strong)] outline-none focus:border-[var(--line-strong)]"
              />
            </label>
            <div className="flex overflow-hidden rounded-[8px] border border-[var(--line)] bg-white">
              <button type="button" onClick={() => setPreviewKind("proxy")} className={`h-8 px-2 text-[12px] font-extrabold ${previewKind === "proxy" ? "bg-[var(--bg-sunken)] text-[var(--ink-strong)]" : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]"}`}>
                proxy
              </button>
              <button
                type="button"
                onClick={() => setPreviewKind("absproxy")}
                className={`h-8 px-2 text-[12px] font-extrabold ${previewKind === "absproxy" ? "bg-[var(--bg-sunken)] text-[var(--ink-strong)]" : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]"}`}
                title="Use absproxy for CRA / when /proxy breaks due to path assumptions"
              >
                absproxy
              </button>
            </div>
          </div>

          <div className="flex h-full w-full min-h-0">
            <div className={`relative min-h-0 ${previewOpen ? "flex-[1.25]" : "flex-1"}`}>
              {!iframeLoaded ? (
                <div className="absolute inset-0 z-10 flex bg-[var(--surface-app)]">
                  <Loader title="Loading VS Code" hint="Connecting to your setup editor." />
                </div>
              ) : null}
              <iframe
                title="Project setup editor"
                src={setupEditor.editor_url}
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write"
                onLoad={() => setIframeLoaded(true)}
              />
            </div>

            {previewOpen && previewUrl ? (
              <div className="relative min-h-0 flex-1 border-l border-[var(--line)] bg-white">
                {!previewLoaded ? (
                  <div className="absolute inset-0 z-10 flex bg-[var(--surface-app)]">
                    <Loader title="Loading preview" hint={`Opening ${previewKind} on port ${previewPort}.`} />
                  </div>
                ) : null}
                <iframe title="Preview" src={previewUrl} className="h-full w-full border-0" onLoad={() => setPreviewLoaded(true)} />
              </div>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  if (!attempt) {
    return (
      <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
        <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--ink-strong)]">Editor</h1>
        </header>
        <section className="flex min-h-0 w-full flex-1 flex-col items-center justify-center px-4 py-16">
          <div className="max-w-[42ch] text-center">
            <p className="text-base font-medium text-[var(--ink-strong)]">No task open yet</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-4)]">When you start work from Tasks, the editor opens here.</p>
            <Link href="/tasks" className={`${btnPrimary} mt-6`}>
              Go to tasks
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--surface-app)]">
      <header className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-[var(--ink-strong)] bg-white px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="ari-num shrink-0 rounded-[4px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] px-1.5 py-px text-[10.5px] font-extrabold text-[var(--ink-4)]">
              {activeTask?.ref ?? `Task ${attempt.task_id}`}
            </span>
            <h1 className="min-w-0 truncate text-[15px] font-extrabold text-[var(--ink-strong)] sm:text-[18px]">
              {activeTask?.title ?? "Active task"}
            </h1>
          </div>
          <p className="mt-1.5 truncate text-[12px] font-semibold text-[var(--ink-5)]">Your edits stay in this session until you press Done.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {previewUrl ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setPreviewOpen((v) => !v);
                  setPreviewLoaded(false);
                }}
                className={btnGhost}
              >
                {previewOpen ? "Hide preview" : "Preview"}
              </button>
              <a href={previewUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                Open preview
              </a>
            </>
          ) : null}
          <Link href="/tasks" className={btnGhost}>
            Tasks
          </Link>
          <button type="button" disabled={submitting} onClick={() => void submitDone()} className={btnPrimary}>
            {submitting ? <AuthSubmitSpinner /> : null}
            {submitting ? "Sending for review, one moment…" : "Done"}
          </button>
        </div>
      </header>
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {previewUrl ? (
          <div className="absolute right-3 top-3 z-20 flex flex-wrap items-center justify-end gap-2 rounded-[10px] border border-[var(--line)] bg-white/90 p-2 shadow-[var(--sh-pop)] backdrop-blur">
            <label className="flex items-center gap-2 text-[11px] font-extrabold text-[var(--ink-4)]">
              Port
              <input
                value={String(previewPort)}
                onChange={(e) => setPreviewPort(Number.parseInt(e.target.value || "3000", 10) || 3000)}
                inputMode="numeric"
                className="h-8 w-[90px] rounded-[7px] border border-[var(--line)] bg-white px-2 text-[12px] font-semibold text-[var(--ink-strong)] outline-none focus:border-[var(--line-strong)]"
              />
            </label>
            <div className="flex overflow-hidden rounded-[8px] border border-[var(--line)] bg-white">
              <button type="button" onClick={() => setPreviewKind("proxy")} className={`h-8 px-2 text-[12px] font-extrabold ${previewKind === "proxy" ? "bg-[var(--bg-sunken)] text-[var(--ink-strong)]" : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]"}`}>
                proxy
              </button>
              <button
                type="button"
                onClick={() => setPreviewKind("absproxy")}
                className={`h-8 px-2 text-[12px] font-extrabold ${previewKind === "absproxy" ? "bg-[var(--bg-sunken)] text-[var(--ink-strong)]" : "text-[var(--ink-4)] hover:bg-[var(--bg-sunken)]"}`}
                title="Use absproxy for CRA / when /proxy breaks due to path assumptions"
              >
                absproxy
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex h-full w-full min-h-0">
          <div className={`relative min-h-0 ${previewOpen ? "flex-[1.25]" : "flex-1"}`}>
            {!iframeLoaded ? (
              <div className="absolute inset-0 z-10 flex bg-[var(--surface-app)]">
                <Loader title="Loading VS Code" hint="Connecting to your task workspace." />
              </div>
            ) : null}
            {attempt.editor_url ? (
              <iframe
                title="Task editor"
                src={attempt.editor_url}
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write"
                onLoad={() => setIframeLoaded(true)}
              />
            ) : (
              <Loader title="Editor URL missing" hint="Restart the task from the task board." />
            )}
          </div>

          {previewOpen && previewUrl ? (
            <div className="relative min-h-0 flex-1 border-l border-[var(--line)] bg-white">
              {!previewLoaded ? (
                <div className="absolute inset-0 z-10 flex bg-[var(--surface-app)]">
                  <Loader title="Loading preview" hint={`Opening ${previewKind} on port ${previewPort}.`} />
                </div>
              ) : null}
              <iframe title="Preview" src={previewUrl} className="h-full w-full border-0" onLoad={() => setPreviewLoaded(true)} />
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
