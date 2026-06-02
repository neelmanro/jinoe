"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { authMutedBodyClass, pageBg } from "@/components/auth/JinoeAuthChrome";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { useProject } from "@/components/sidebar/project-context";

type Member = {
  id: number;
  full_name: string;
  email: string;
  company_name: string | null;
  role: "owner" | "collaborator";
  status: string;
  joined_at: string;
};

const btnGhost =
  "inline-flex h-9 items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-4 text-[12.5px] font-bold text-[var(--ink-3)] shadow-none transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]";
const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";
const inputClass =
  "block w-full rounded-[7px] border border-[var(--line)] bg-[#fbfbf7] px-3 py-2.5 text-sm font-semibold text-[var(--ink-strong)] shadow-none outline-none transition placeholder:font-medium placeholder:text-[var(--ink-5)] focus:border-[var(--ink-strong)] focus:bg-white focus:ring-2 focus:ring-[var(--accent-line)] disabled:opacity-50";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  const first = parts[0] ?? "?";
  return first.length >= 2 ? first.slice(0, 2).toUpperCase() : first[0]?.toUpperCase() ?? "?";
}

function MemberAvatar({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--ink-strong)] bg-[var(--ink-strong)] text-[10px] font-extrabold text-white shadow-sm">
      {initials(name)}
    </span>
  );
}

export default function NewProjectPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { createProject, hasProjects, isOwner } = useProject();
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMembersLoading(true);
        setMembersError(null);
        try {
          const rows = await apiRequest<Member[]>("/team/members");
          if (!cancelled) setMembers(rows);
        } catch (e) {
          if (!cancelled) {
            setMembers([]);
            setMembersError(e instanceof Error ? e.message : "Could not load teammates");
          }
        } finally {
          if (!cancelled) setMembersLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const toggleMember = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => `${m.full_name} ${m.email} ${m.role}`.toLowerCase().includes(q));
  }, [members, memberSearch]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setSubmitError("Enter a project name");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createProject(trimmed, { memberUserIds: Array.from(selectedIds) });
      showDashboardToast("Project created. Set up the starting files next.");
      router.push("/editor");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOwner) {
    return (
      <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
        <header className="shrink-0 border-b border-[var(--ink-strong)] bg-white px-4 py-5 sm:px-6">
          <div className="mx-auto flex w-full max-w-[760px] items-start justify-between gap-3">
            <div>
              <h1 className="text-[1.35rem] font-extrabold tracking-tight text-neutral-950">New project</h1>
              <p className={`mt-1 max-w-[62ch] ${authMutedBodyClass}`}>Only the workspace owner can create projects.</p>
            </div>
            <Link href="/tasks" className={btnGhost}>
              Back
            </Link>
          </div>
        </header>
      </main>
    );
  }

  const firstProject = !hasProjects;

  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <header className="shrink-0 bg-white px-4 pb-3 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
        <div className="mx-auto w-full max-w-[920px]">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[1.7rem] font-extrabold leading-none tracking-tight text-neutral-950 sm:text-[2rem]">
                {firstProject ? "Create your first project" : "New project"}
              </h1>
              <p className="mt-2 max-w-[66ch] text-[13.5px] font-semibold leading-snug text-[var(--ink-4)]">
                Create a project space, choose who can access it, then set up the starting files. After that, work happens through tasks and reviews.
              </p>
            </div>
            {hasProjects ? (
              <Link href="/tasks" className="hidden text-[12.5px] font-extrabold text-[var(--ink-3)] underline decoration-2 underline-offset-[3px] hover:text-[var(--ink-strong)] sm:inline-block">
                Cancel
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6">
        <div className="mx-auto w-full max-w-[920px] pb-8 pt-5 sm:pb-10">
          <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-8">
            <section className="space-y-5">
              <div>
                <label htmlFor="project-name" className="mb-1.5 block text-[12px] font-black tracking-[-0.01em] text-[var(--ink-strong)]">
                  Project name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (submitError) setSubmitError(null);
                  }}
                  placeholder="e.g. Ziqara"
                  className={`${inputClass} bg-white py-2 text-[15px]`}
                  maxLength={200}
                  autoComplete="off"
                  disabled={submitting}
                  autoFocus
                />
                <p className="mt-2 text-[12.5px] font-semibold leading-snug text-[var(--ink-4)]">
                  This is where tasks, reviews, chat, and AI work will live.
                </p>
              </div>
              <div className="rounded-[8px] border border-[var(--line)] bg-white p-4">
                <p className="text-[12px] font-black uppercase tracking-[0.08em] text-[var(--ink-strong)]">What happens next</p>
                <div className="mt-3 space-y-3">
                  {[
                    ["1", "Create the project space"],
                    ["2", "Set up the starting files"],
                    ["3", "Create tasks and approve completed work"],
                  ].map(([n, label]) => (
                    <div key={n} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[11px] font-extrabold text-[var(--ink-strong)]">
                        {n}
                      </span>
                      <span className="text-[12.5px] font-bold text-[var(--ink-3)]">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="min-w-0 space-y-5 border-t border-[var(--line)] pt-6 lg:border-t-0 lg:pt-0">
              <div>
                <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[8px] border border-[var(--line)] bg-white">
                  <div className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-sunken)]/35 px-3 py-3 sm:px-3.5">
                    <label htmlFor="teammate-search" className="block text-[12px] font-black tracking-[-0.01em] text-[var(--ink-strong)]">
                      Add people already in this workspace
                    </label>
                    <input
                      id="teammate-search"
                      type="search"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className={`${inputClass} mt-2 bg-white`}
                      disabled={submitting}
                      autoComplete="off"
                    />
                  </div>
                  <div className="min-h-[180px] flex-1 p-2">
                    {membersLoading ? (
                      <p className="p-2.5 text-[12.5px] font-semibold text-[var(--ink-4)]">Loading teammates…</p>
                    ) : membersError ? (
                      <p className="p-2.5 text-[12.5px] font-semibold text-red-600">{membersError}</p>
                    ) : members.length === 0 ? (
                      <p className="p-2.5 text-[12.5px] font-semibold text-[var(--ink-4)]">No joined teammates found yet.</p>
                    ) : filteredMembers.length === 0 ? (
                      <p className="p-2.5 text-[12.5px] font-semibold text-[var(--ink-4)]">No matches for that search.</p>
                    ) : (
                      <ul className="grid max-h-[min(360px,calc(100vh-22rem))] gap-2 overflow-y-auto overscroll-contain pr-1">
                        {filteredMembers.map((m) => {
                          const isCurrentUser = user != null && m.id === user.id;
                          const checked = isCurrentUser || selectedIds.has(m.id);
                          return (
                            <li key={m.id}>
                              <label
                                className={[
                                  "flex items-center gap-3 rounded-[7px] border px-3 py-2.5 text-left transition",
                                  isCurrentUser ? "cursor-default" : "cursor-pointer",
                                  checked
                                    ? "border-[var(--ink-strong)] bg-[var(--accent)]"
                                    : "border-[var(--line)] bg-white hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)]",
                                ].join(" ")}
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 shrink-0 rounded border border-[var(--line-strong)] text-[var(--ink-strong)] focus:ring-[var(--accent-line)]"
                                  checked={checked}
                                  onChange={() => {
                                    if (!isCurrentUser) toggleMember(m.id);
                                  }}
                                  disabled={submitting || isCurrentUser}
                                />
                                <MemberAvatar name={m.full_name} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12.5px] font-extrabold text-neutral-950">{m.full_name}</span>
                                  <span className="block truncate text-[11.5px] font-semibold text-[var(--ink-4)]">{m.email}</span>
                                </span>
                                <span className="shrink-0 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--ink-4)]">{m.role}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {submitError ? (
                <p className="rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700">{submitError}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5">
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className={`${btnPrimary} min-w-[170px] gap-2`}
                >
                  {submitting ? <AuthSubmitSpinner /> : null}
                  {submitting ? "Getting your project ready, one moment…" : "Create project"}
                </button>
                {hasProjects ? (
                  <Link href="/tasks" className={`${btnGhost} sm:hidden`}>
                    Cancel
                  </Link>
                ) : null}
              </div>
            </section>
          </form>
        </div>
      </div>
    </main>
  );
}
