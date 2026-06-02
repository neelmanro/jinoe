"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { authMutedBodyClass, pageBg } from "@/components/auth/JinoeAuthChrome";
import { useProject } from "@/components/sidebar/project-context";

type ProjectApi = {
  id: number;
  name: string;
  color: string;
  description?: string | null;
  created_at: string;
};

type ProjectMemberRow = {
  user_id: number;
  full_name: string;
  email: string;
  role: "owner" | "collaborator";
};

type TeamMemberRow = {
  id: number;
  full_name: string;
  email: string;
  company_name: string | null;
  role: "owner" | "collaborator";
  status: string;
  joined_at: string;
};

/** Match `/projects/new` field chrome */
const projectFieldInputClass =
  "block w-full rounded-[7px] border border-[var(--line)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--ink-strong)] shadow-none outline-none transition placeholder:font-medium placeholder:text-[var(--ink-5)] focus:border-[var(--ink-strong)] focus:bg-white focus:ring-2 focus:ring-[var(--accent-line)] disabled:opacity-50";

const btnGhost =
  "inline-flex h-9 items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-4 text-[12.5px] font-bold text-[var(--ink-3)] shadow-none transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)] disabled:pointer-events-none disabled:opacity-45";
const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-black/10 bg-[var(--accent)] px-4 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";
const btnPrimaryCompact =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] border border-black/10 bg-[var(--accent)] px-3 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";
const btnDangerSm =
  "inline-flex h-9 items-center justify-center rounded-[6px] border border-black/10 bg-[var(--neg)] px-4 text-[12.5px] font-extrabold text-white shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:opacity-[0.92] disabled:pointer-events-none disabled:opacity-45";
const btnDangerGhost =
  "inline-flex h-8 items-center justify-center rounded-[6px] border-2 border-[var(--neg)] bg-white px-2.5 text-[12px] font-extrabold text-[var(--neg)] shadow-none transition hover:bg-[var(--neg-soft)] hover:border-[var(--neg)] disabled:pointer-events-none disabled:opacity-45";

const surfaceCard = "rounded-[8px] border border-[var(--line-strong)] bg-white shadow-none";
const quietSectionTitle = "text-[12px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-4)]";
const activeProjectPillClass =
  "inline-flex shrink-0 items-center rounded-full border border-black/10 bg-[var(--accent)] px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--ink-strong)] shadow-[0_6px_12px_rgba(11,10,8,0.08)]";
const modalBackdrop = "absolute inset-0 cursor-default bg-[var(--ink-strong)]/25 backdrop-blur-[3px]";
const modalShell = `${surfaceCard} shadow-[var(--sh-pop)]`;

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

export default function ProjectsPage() {
  const { token } = useAuth();
  const { projects, loading, projectId, refreshProjects, isOwner } = useProject();

  const [editModalId, setEditModalId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [busySave, setBusySave] = useState(false);

  const [projectMembers, setProjectMembers] = useState<ProjectMemberRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoadError, setMembersLoadError] = useState<string | null>(null);
  const [membersActionError, setMembersActionError] = useState<string | null>(null);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [busyAddMember, setBusyAddMember] = useState(false);
  const [busyRemoveUserId, setBusyRemoveUserId] = useState<number | null>(null);

  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const editProject = useMemo(
    () => (editModalId ? projects.find((p) => p.id === editModalId) ?? null : null),
    [editModalId, projects]
  );

  const availableToAdd = useMemo(() => {
    const onProject = new Set(projectMembers.map((m) => m.user_id));
    return teamMembers.filter((m) => !onProject.has(m.id));
  }, [teamMembers, projectMembers]);

  const filteredAvailableToAdd = useMemo(() => {
    const q = addMemberSearch.trim().toLowerCase();
    if (!q) return availableToAdd;
    return availableToAdd.filter((m) => `${m.full_name} ${m.email}`.toLowerCase().includes(q));
  }, [availableToAdd, addMemberSearch]);

  const closeEditModal = useCallback(() => {
    setEditModalId(null);
    setEditFormError(null);
    setMembersLoadError(null);
    setMembersActionError(null);
    setProjectMembers([]);
    setTeamMembers([]);
    setAddMemberSearch("");
    setBusySave(false);
    setBusyAddMember(false);
    setBusyRemoveUserId(null);
    setMembersLoading(false);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteModal(null);
    setDeleteError(null);
    setBusyDelete(false);
  }, []);

  const openEditModal = useCallback(
    (id: string) => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      setDeleteModal(null);
      setDeleteError(null);
      setEditModalId(id);
      setEditName(p.name);
      setEditFormError(null);
      setMembersLoadError(null);
      setMembersActionError(null);
      setAddMemberSearch("");
    },
    [projects]
  );

  useEffect(() => {
    if (!editModalId || !token) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMembersLoading(true);
        setMembersLoadError(null);
        try {
          const [pm, tm] = await Promise.all([
            apiRequest<ProjectMemberRow[]>(`/team/projects/${editModalId}/members`, {}, token),
            apiRequest<TeamMemberRow[]>("/team/members", {}, token),
          ]);
          if (!cancelled) {
            setProjectMembers(pm);
            setTeamMembers(tm);
          }
        } catch (e) {
          if (!cancelled) {
            setProjectMembers([]);
            setTeamMembers([]);
            setMembersLoadError(e instanceof Error ? e.message : "Could not load members");
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
  }, [editModalId, token]);

  useEffect(() => {
    if (!editModalId && !deleteModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (busyDelete || busySave || busyAddMember || busyRemoveUserId) return;
      if (deleteModal) closeDeleteModal();
      else closeEditModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editModalId, deleteModal, busyDelete, busySave, busyAddMember, busyRemoveUserId, closeEditModal, closeDeleteModal]);

  async function saveEdit() {
    if (!editModalId || !token) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditFormError("Name is required");
      return;
    }
    setBusySave(true);
    setEditFormError(null);
    try {
      await apiRequest<ProjectApi>(
        `/team/projects/${editModalId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: trimmed,
            description: editProject?.description?.trim() ? editProject.description.trim() : null,
          }),
        },
        token
      );
      await refreshProjects();
      closeEditModal();
    } catch (e) {
      setEditFormError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusySave(false);
    }
  }

  async function reloadProjectMembers() {
    if (!editModalId || !token) return;
    const pm = await apiRequest<ProjectMemberRow[]>(`/team/projects/${editModalId}/members`, {}, token);
    setProjectMembers(pm);
  }

  async function addMemberToProject(userId: number) {
    if (!editModalId || !token) return;
    setBusyAddMember(true);
    setMembersActionError(null);
    try {
      await apiRequest<ProjectMemberRow>(
        `/team/projects/${editModalId}/members`,
        { method: "POST", body: JSON.stringify({ user_id: userId }) },
        token
      );
      setAddMemberSearch("");
      await reloadProjectMembers();
    } catch (e) {
      setMembersActionError(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setBusyAddMember(false);
    }
  }

  async function removeMemberFromProject(userId: number) {
    if (!editModalId || !token) return;
    setBusyRemoveUserId(userId);
    setMembersActionError(null);
    try {
      await apiRequest<undefined>(`/team/projects/${editModalId}/members/${userId}`, { method: "DELETE" }, token);
      await reloadProjectMembers();
    } catch (e) {
      setMembersActionError(e instanceof Error ? e.message : "Could not remove member");
    } finally {
      setBusyRemoveUserId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteModal || !token) return;
    setBusyDelete(true);
    setDeleteError(null);
    try {
      await apiRequest<undefined>(`/team/projects/${deleteModal.id}`, { method: "DELETE" }, token);
      closeDeleteModal();
      await refreshProjects();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete project");
    } finally {
      setBusyDelete(false);
    }
  }

  const canManage = isOwner;
  const activeProjectName = projects.find((p) => p.id === projectId)?.name ?? "None selected";

  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <header className="shrink-0 border-b border-[var(--ink-strong)] bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[1.35rem] font-extrabold leading-none tracking-tight text-[var(--ink-strong)] sm:text-[1.7rem]">Projects</h1>
            <p className="mt-2 max-w-[68ch] text-[13.5px] font-semibold leading-snug text-[var(--ink-4)]">
              Every project is a separate context for tasks, chat, and reviews.
            </p>
          </div>
          {canManage ? (
            <Link href="/projects/new" className={`${btnPrimary} h-9 shrink-0`}>
              New project
            </Link>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pb-10 pt-4 sm:px-6 sm:pb-12 sm:pt-5">
          {!canManage ? (
            <p className="mb-4 rounded-[8px] border border-[var(--line)] bg-white px-3 py-2.5 text-[13px] font-semibold text-[var(--ink-4)] shadow-none">
              Only the workspace owner can create, edit, or delete projects. You can still switch the active project from the sidebar.
            </p>
          ) : null}

          {deleteModal && canManage ? (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
              <button type="button" className={modalBackdrop} onClick={() => !busyDelete && closeDeleteModal()} aria-label="Close dialog" />
              <div className={`relative z-10 w-full max-w-[440px] p-6 sm:p-8 ${modalShell}`}>
                <h2 id="delete-project-title" className="text-[1.35rem] font-extrabold tracking-tight text-[var(--ink-strong)]">
                  Delete project?
                </h2>
                <p className={`mt-3 text-[13px] leading-relaxed ${authMutedBodyClass}`}>
                  Delete <span className="font-extrabold text-[var(--ink-strong)]">{deleteModal.name}</span>? This permanently removes its tasks, chat, and member
                  links.
                </p>
                {deleteError ? (
                  <p className="mt-3 rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5">
                  <button type="button" onClick={closeDeleteModal} disabled={busyDelete} className={`${btnGhost} min-w-[96px]`}>
                    Cancel
                  </button>
                  <button type="button" disabled={busyDelete} onClick={() => void confirmDelete()} className={`${btnDangerSm} min-w-[128px]`}>
                    {busyDelete ? "Deleting…" : "Delete project"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {editModalId && editProject && canManage ? (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="edit-project-title">
              <button
                type="button"
                className={modalBackdrop}
                onClick={() => !busySave && !busyAddMember && !busyRemoveUserId && closeEditModal()}
                aria-label="Close dialog"
              />
              <div className={`relative z-10 max-h-[min(92vh,820px)] w-full max-w-[920px] overflow-y-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface-app)] p-6 shadow-[var(--sh-pop)] sm:p-8`}>
                <h2 id="edit-project-title" className="text-[1.7rem] font-extrabold leading-none tracking-tight text-[var(--ink-strong)] sm:text-[2rem]">
                  Edit project
                </h2>
                <p className={`mt-2 max-w-[62ch] text-[13.5px] font-semibold leading-snug ${authMutedBodyClass}`}>
                  Update <span className="font-extrabold text-[var(--ink-strong)]">{editProject.name}</span> and who can access it. Everyone here is already a
                  workspace member.
                </p>

                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-8">
                  <section>
                    <label htmlFor="edit-project-name" className="mb-1.5 block text-[12px] font-black tracking-[-0.01em] text-[var(--ink-strong)]">
                      Project name
                    </label>
                    <input
                      id="edit-project-name"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={`${projectFieldInputClass} py-2 text-[15px]`}
                      maxLength={200}
                      autoComplete="off"
                      disabled={busySave}
                    />
                  </section>

                  <section className="min-w-0 space-y-5 border-t border-[var(--line)] pt-6 lg:border-t-0 lg:pt-0">
                    <div>
                      <p className={quietSectionTitle}>Access</p>
                      <h3 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--ink-strong)]">People on this project</h3>
                    </div>

                    {membersLoadError ? (
                      <p className="rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700" role="alert">
                        {membersLoadError}
                      </p>
                    ) : null}
                    {membersActionError ? (
                      <p className="rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700" role="alert">
                        {membersActionError}
                      </p>
                    ) : null}

                    {membersLoading ? (
                      <p className="text-[12.5px] font-semibold text-[var(--ink-4)]">Loading teammates…</p>
                    ) : (
                      <>
                        <div className="min-h-[120px] rounded-[8px] border border-[var(--line)] bg-white p-2">
                          <ul className="grid max-h-[220px] gap-2 overflow-y-auto pr-1">
                            {projectMembers.length === 0 ? (
                              <li className="p-3 text-[12.5px] font-semibold text-[var(--ink-4)]">No one linked yet.</li>
                            ) : (
                              projectMembers.map((m) => (
                                <li key={m.user_id}>
                                  <div
                                    className={[
                                      "flex items-center gap-3 rounded-[7px] border px-3 py-2.5",
                                      "border-[var(--line)] bg-white",
                                    ].join(" ")}
                                  >
                                    <MemberAvatar name={m.full_name} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[12.5px] font-extrabold text-[var(--ink-strong)]">{m.full_name}</p>
                                      <p className="truncate text-[11.5px] font-semibold text-[var(--ink-4)]">{m.email}</p>
                                    </div>
                                    <span className="shrink-0 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--ink-4)]">
                                      {m.role === "owner" ? "Owner" : "Member"}
                                    </span>
                                    <button
                                      type="button"
                                      className={`${btnDangerGhost} shrink-0 px-2`}
                                      disabled={busyRemoveUserId !== null || projectMembers.length <= 1 || busyAddMember}
                                      title={projectMembers.length <= 1 ? "Keep at least one person on the project" : "Remove from project"}
                                      onClick={() => void removeMemberFromProject(m.user_id)}
                                    >
                                      {busyRemoveUserId === m.user_id ? "…" : "Remove"}
                                    </button>
                                  </div>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>

                        <div>
                          <label htmlFor="edit-add-member-search" className="mb-1.5 block text-[12px] font-black tracking-[-0.01em] text-[var(--ink-strong)]">
                            Add people already in this workspace
                          </label>
                          {availableToAdd.length === 0 ? (
                            <p className="text-[12.5px] font-semibold text-[var(--ink-4)]">Everyone on the team is already on this project.</p>
                          ) : (
                            <>
                              <input
                                id="edit-add-member-search"
                                type="search"
                                value={addMemberSearch}
                                onChange={(e) => setAddMemberSearch(e.target.value)}
                                placeholder="Name or email"
                                className={projectFieldInputClass}
                                disabled={busyAddMember || busyRemoveUserId !== null}
                              />
                              <div className="mt-3 min-h-[120px] rounded-[8px] border border-[var(--line)] bg-white p-2">
                                <ul className="grid max-h-[200px] gap-2 overflow-y-auto pr-1">
                                  {filteredAvailableToAdd.length === 0 ? (
                                    <li className="p-3 text-[12.5px] font-semibold text-[var(--ink-4)]">No matches.</li>
                                  ) : (
                                    filteredAvailableToAdd.map((m) => (
                                      <li key={m.id}>
                                        <div className="flex items-center gap-3 rounded-[7px] border border-[var(--line)] bg-white px-3 py-2.5 transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-sunken)]">
                                          <MemberAvatar name={m.full_name} />
                                          <div className="min-w-0 flex-1">
                                            <p className="truncate text-[12.5px] font-extrabold text-[var(--ink-strong)]">{m.full_name}</p>
                                            <p className="truncate text-[11.5px] font-semibold text-[var(--ink-4)]">{m.email}</p>
                                          </div>
                                          <span className="shrink-0 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-[var(--ink-4)]">{m.role}</span>
                                          <button
                                            type="button"
                                            className={`${btnPrimaryCompact} shrink-0`}
                                            disabled={busyAddMember || busyRemoveUserId !== null}
                                            onClick={() => void addMemberToProject(m.id)}
                                          >
                                            {busyAddMember ? "…" : "Add"}
                                          </button>
                                        </div>
                                      </li>
                                    ))
                                  )}
                                </ul>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                </div>

                {editFormError ? (
                  <p className="mt-4 rounded-[7px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700" role="alert">
                    {editFormError}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    disabled={busySave || busyAddMember || busyRemoveUserId !== null}
                    className={`${btnGhost} min-w-[96px]`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busySave || busyAddMember || busyRemoveUserId !== null}
                    onClick={() => void saveEdit()}
                    className={`${btnPrimary} min-w-[160px] gap-2`}
                  >
                    {busySave ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-9">
            <aside className="space-y-6 lg:sticky lg:top-5 lg:self-start">
              <section className="space-y-5">
                <div>
                  <p className={quietSectionTitle}>Workspace projects</p>
                  <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--ink-strong)]">Project directory</h2>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y border-[var(--line)] py-4 lg:grid-cols-1 lg:gap-5">
                  <div>
                    <p className="ari-num text-[28px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{projects.length}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">in this workspace</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[26px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{activeProjectName}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">active selection</p>
                  </div>
                  <div>
                    <p className="text-[26px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{canManage ? "Owner" : "Collaborator"}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">{canManage ? "full project controls" : "read-only directory"}</p>
                  </div>
                </div>
              </section>
            </aside>

            <section className="min-w-0">
              <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className={quietSectionTitle}>All projects</p>
                  <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--ink-strong)]">Contexts in this workspace</h2>
                  <p className="mt-1 text-[13px] font-semibold leading-snug text-[var(--ink-4)]">
                    Edit the name, manage who is on a project, or delete projects that are no longer needed.
                  </p>
                </div>
              </header>

              {loading ? (
                <div className="mt-5 border-y border-[var(--line)] px-3 py-12 text-center text-[13px] font-semibold text-[var(--ink-5)]">Loading projects...</div>
              ) : projects.length === 0 ? (
                <div className="mt-5 border-y border-[var(--line)] px-3 py-12 text-center">
                  <p className="text-[13px] font-semibold text-[var(--ink-4)]">No projects yet.</p>
                  {canManage ? (
                    <Link href="/projects/new" className={`${btnPrimary} mt-4 inline-flex`}>
                      Create first project
                    </Link>
                  ) : null}
                </div>
              ) : (
                <>
                  <div
                    className={`mt-5 hidden items-center gap-3 border-y border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--ink-5)] md:grid ${
                      canManage ? "md:grid-cols-[minmax(0,1fr)_100px_148px]" : "md:grid-cols-[minmax(0,1fr)_90px]"
                    }`}
                  >
                    <span>Project</span>
                    <span className="md:text-center">Status</span>
                    {canManage ? <span className="text-right">Actions</span> : null}
                  </div>

                  <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)] md:mt-0 md:border-t-0">
                    {projects.map((p) => {
                      const active = p.id === projectId;
                      return (
                        <li key={p.id}>
                          <div
                            className={`grid gap-3 bg-white px-3 py-3 transition hover:bg-[var(--bg-sunken)] md:items-center ${
                              canManage ? "md:grid-cols-[minmax(0,1fr)_100px_148px]" : "md:grid-cols-[minmax(0,1fr)_90px]"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-[13px] font-extrabold tracking-[-0.01em] text-[var(--ink-strong)]">{p.name}</p>
                              {active ? (
                                <span className={`${activeProjectPillClass} md:hidden`}>Active</span>
                              ) : null}
                            </div>
                            <div className="flex md:justify-center">
                              {active ? (
                                <span className={`${activeProjectPillClass} hidden md:inline-flex`}>Active</span>
                              ) : (
                                <span className="text-[11.5px] font-semibold text-[var(--ink-5)]">—</span>
                              )}
                            </div>
                            {canManage ? (
                              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                                <button type="button" className={btnPrimaryCompact} onClick={() => openEditModal(p.id)}>
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className={btnDangerGhost + " h-8 px-2.5"}
                                  onClick={() => {
                                    setEditModalId(null);
                                    setDeleteModal({ id: p.id, name: p.name });
                                    setDeleteError(null);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
