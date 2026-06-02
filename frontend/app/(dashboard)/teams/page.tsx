"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { authMutedBodyClass, inputClass, pageBg } from "@/components/auth/JinoeAuthChrome";
import { showDashboardToast } from "@/components/DashboardToastHost";

type Member = {
  id: number;
  full_name: string;
  email: string;
  company_name: string | null;
  role: "owner" | "collaborator";
  status: string;
  joined_at: string;
};

type Invite = {
  id: number;
  email: string;
  invited_name: string | null;
  role: "collaborator";
  token: string;
  accepted_at: string | null;
  opened_at: string | null;
  created_at: string;
  invite_url: string;
};

const btnGhost =
  "inline-flex h-8 items-center rounded-[6px] border border-[var(--line-strong)] bg-white px-2.5 text-[12px] font-bold text-[var(--ink-3)] shadow-none transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]";
const btnPrimarySm =
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-black/10 bg-[var(--accent)] px-3 text-[12.5px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] disabled:pointer-events-none disabled:opacity-45";

const surfaceCard = "rounded-[8px] border border-[var(--line-strong)] bg-white shadow-none";
const surfaceInner = "border-b border-[var(--line)]";
const quietSectionTitle = "text-[12px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-4)]";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  const first = parts[0] ?? "?";
  return first.length >= 2 ? first.slice(0, 2).toUpperCase() : first[0]?.toUpperCase() ?? "?";
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ink-strong)] bg-[var(--ink-strong)] text-[11px] font-extrabold tracking-[0] text-white shadow-sm"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

const rolePillClass =
  "inline-flex items-center rounded-full border border-black/10 bg-[var(--accent)] px-2.5 py-0.5 text-[11px] font-extrabold tracking-[0] text-[var(--ink-strong)] shadow-[0_6px_12px_rgba(11,10,8,0.08)]";

function RolePill({ role }: { role: Member["role"] }) {
  return (
    <span className={rolePillClass}>
      {role === "owner" ? "Owner" : "Collaborator"}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden className="shrink-0 text-[var(--ink-5)]">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function TeamsPage() {
  const { team, role, user: currentUser } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [modalEmail, setModalEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyInvite, setBusyInvite] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<number | null>(null);
  const [busyCancelInviteId, setBusyCancelInviteId] = useState<number | null>(null);
  const [revokeInviteTarget, setRevokeInviteTarget] = useState<Invite | null>(null);
  const [pendingInvitesOpen, setPendingInvitesOpen] = useState(false);
  const [busyRemoveMemberId, setBusyRemoveMemberId] = useState<number | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<Member | null>(null);

  const isOwner = role === "owner";

  async function loadTeam() {
    setLoadError(null);
    setLoading(true);
    try {
      const [memberRows, inviteRows] = await Promise.all([
        apiRequest<Member[]>("/team/members"),
        isOwner ? apiRequest<Invite[]>("/team/invites") : Promise.resolve([]),
      ]);
      setMembers(memberRows);
      setInvites(inviteRows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadTeam();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadTeam closes over isOwner via API
  }, [isOwner]);

  const closeInviteModal = useCallback(() => {
    setInviteOpen(false);
    setModalEmail("");
    setInviteError(null);
  }, []);

  async function inviteMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modalEmail.trim()) return;
    setBusyInvite(true);
    setInviteError(null);
    try {
      const email = modalEmail.trim();
      const invite = await apiRequest<Invite>("/team/invites", {
        method: "POST",
        body: JSON.stringify({
          email,
          role: "collaborator",
        }),
      });
      setInvites((prev) => [invite, ...prev]);
      closeInviteModal();
      showDashboardToast("Invite sent.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setBusyInvite(false);
    }
  }

  useEffect(() => {
    if (!inviteOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeInviteModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inviteOpen, closeInviteModal]);

  useEffect(() => {
    if (!revokeInviteTarget) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRevokeInviteTarget(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [revokeInviteTarget]);

  useEffect(() => {
    if (!pendingInvitesOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPendingInvitesOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingInvitesOpen]);

  useEffect(() => {
    if (!removeMemberTarget) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && busyRemoveMemberId === null) setRemoveMemberTarget(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [removeMemberTarget, busyRemoveMemberId]);

  async function copyInvite(invite: Invite) {
    await navigator.clipboard.writeText(invite.invite_url);
    setCopiedInviteId(invite.id);
    window.setTimeout(() => setCopiedInviteId(null), 1600);
  }

  async function confirmRemoveMember() {
    const member = removeMemberTarget;
    if (!member || !currentUser || member.id === currentUser.id || member.role === "owner") return;
    setBusyRemoveMemberId(member.id);
    setLoadError(null);
    try {
      await apiRequest<void>(`/team/members/${member.id}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      setRemoveMemberTarget(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not remove member");
    } finally {
      setBusyRemoveMemberId(null);
    }
  }

  async function confirmRevokeInvite() {
    if (!revokeInviteTarget) return;
    const invite = revokeInviteTarget;
    setRevokeInviteTarget(null);
    setBusyCancelInviteId(invite.id);
    setLoadError(null);
    try {
      await apiRequest<void>(`/team/invites/${invite.id}`, { method: "DELETE" });
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not withdraw invite");
    } finally {
      setBusyCancelInviteId(null);
    }
  }

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, search]);

  /** Outstanding = not accepted (matches server duplicate check). Must include opened links or users cannot see or cancel them. */
  const pendingInvites = invites.filter((invite) => !invite.accepted_at);

  const modalBackdrop = "absolute inset-0 cursor-default bg-[var(--ink-strong)]/30 backdrop-blur-[2px]";
  const modalShell = `${surfaceCard} shadow-[var(--sh-pop)]`;

  return (
    <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>
      <header className="shrink-0 border-b border-[var(--ink-strong)] bg-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[1.35rem] font-extrabold leading-none tracking-tight text-[var(--ink-strong)] sm:text-[1.7rem]">Members</h1>
            <p className="mt-2 max-w-[68ch] text-[13.5px] font-semibold leading-snug text-[var(--ink-4)]">
              Invite collaborators, review pending invites, and manage who can access this workspace.
            </p>
          </div>
          {isOwner ? (
            <button
              type="button"
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
              className={btnPrimarySm + " h-9 shrink-0 px-4"}
            >
              <PlusIcon />
              Invite
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pb-10 pt-4 sm:px-6 sm:pb-12 sm:pt-5">
          {isOwner && inviteOpen ? (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title">
              <button type="button" className={modalBackdrop} onClick={closeInviteModal} aria-label="Close dialog" />
              <div className={`relative z-10 w-full max-w-[420px] p-6 sm:p-7 ${modalShell}`}>
                <h2 id="invite-dialog-title" className="text-center text-[17px] font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
                  Invite a teammate
                </h2>
                <p className={`mt-2 text-center text-[13px] leading-relaxed ${authMutedBodyClass}`}>
                  {"We'll email them a link to join "}
                  <span className="font-extrabold text-[var(--ink-strong)]">{team?.name || "this workspace"}</span>.
                </p>
                <form onSubmit={inviteMember} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="invite-email" className="mb-1.5 block text-left text-[12px] font-extrabold text-[var(--ink-3)]">
                      Email
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      name="email"
                      required
                      autoComplete="email"
                      value={modalEmail}
                      onChange={(e) => setModalEmail(e.target.value)}
                      placeholder="teammate@company.com"
                      className={inputClass}
                    />
                  </div>
                  {inviteError ? (
                    <p className="text-center text-[13px] font-semibold text-[var(--neg)]" role="alert">
                      {inviteError}
                    </p>
                  ) : null}
                  <div className="flex justify-center gap-2 pt-1">
                    <button type="button" onClick={closeInviteModal} className={btnGhost + " h-9 min-w-[96px] justify-center"}>
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busyInvite}
                      className={btnPrimarySm + " h-9 min-w-[112px] justify-center gap-2"}
                    >
                      {busyInvite ? (
                        <>
                          <AuthSubmitSpinner className="size-3.5 shrink-0" />
                          <span>Sending…</span>
                        </>
                      ) : (
                        "Send invite"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {loadError ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-[8px] border border-[var(--line-strong)] bg-[var(--warn-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--warn)]"
              role="alert"
            >
              {loadError}
            </div>
          ) : null}

          <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-9">
            <aside className="space-y-6 lg:sticky lg:top-5 lg:self-start">
              <section className="space-y-5">
                <div>
                  <p className={quietSectionTitle}>Workspace access</p>
                  <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--ink-strong)]">
                    {team?.name || "Workspace"} roster
                  </h2>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y border-[var(--line)] py-4 lg:grid-cols-1 lg:gap-5">
                  <div>
                    <p className="ari-num text-[28px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{members.length || 0}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">active members</p>
                  </div>
                  <div>
                    <p className="ari-num text-[28px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{pendingInvites.length}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">pending invites</p>
                  </div>
                  <div>
                    <p className="text-[26px] font-extrabold leading-none tracking-tight text-[var(--ink-strong)]">{role === "owner" ? "Owner" : "Member"}</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--ink-4)]">{isOwner ? "full access" : "view and collaborate"}</p>
                  </div>
                </div>

                {isOwner ? (
                  <button
                    type="button"
                    onClick={() => setPendingInvitesOpen(true)}
                    className={btnPrimarySm + " h-9 gap-2 px-4"}
                  >
                    <EyeIcon />
                    Review pending invites
                  </button>
                ) : null}
              </section>
            </aside>

            <section className="min-w-0">
              <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className={quietSectionTitle}>Members</p>
                  <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--ink-strong)]">People with access</h2>
                  <p className="mt-1 text-[13px] font-semibold leading-snug text-[var(--ink-4)]">
                    Owners and collaborators that can access this workspace.
                  </p>
                </div>
                <div className="flex h-10 shrink-0 items-center gap-2 rounded-[7px] border border-[var(--line)] bg-[var(--bg-sunken)] px-3 shadow-none transition focus-within:border-[var(--ink-strong)] focus-within:bg-[var(--bg-raised)] focus-within:ring-2 focus-within:ring-[var(--accent-line)] sm:w-[260px]">
                  <SearchIcon />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search members"
                    className="h-8 min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[var(--ink-strong)] placeholder:font-medium placeholder:text-[var(--ink-5)] focus:outline-none"
                  />
                </div>
              </header>

              <div
                className={`mt-5 hidden items-center gap-3 border-y border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--ink-5)] md:grid ${
                  isOwner ? "grid-cols-[1.45fr_1.25fr_120px_100px_82px]" : "grid-cols-[1.45fr_1.25fr_130px_110px]"
                }`}
              >
                <span>Member</span>
                <span>Email</span>
                <span>Role</span>
                <span className="text-right">Joined</span>
                {isOwner ? <span className="text-right" /> : null}
              </div>

              {loading ? (
                <div className="border-b border-[var(--line)] px-3 py-12 text-center text-[13px] font-semibold text-[var(--ink-5)]">Loading members...</div>
              ) : filteredMembers.length === 0 ? (
                <div className="border-b border-[var(--line)] px-3 py-12 text-center text-[13px] font-semibold text-[var(--ink-5)]">
                  {search ? "No members match your search." : "No team members yet."}
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)] md:mt-0 md:border-t-0">
                  {filteredMembers.map((member) => {
                    const canRemove =
                      isOwner && member.role !== "owner" && currentUser != null && member.id !== currentUser.id;
                    return (
                      <li key={member.id}>
                        <div
                          className={`grid gap-3 bg-white px-3 py-3 transition hover:bg-[var(--bg-sunken)] md:items-center ${
                            isOwner ? "md:grid-cols-[1.45fr_1.25fr_120px_100px_82px]" : "md:grid-cols-[1.45fr_1.25fr_130px_110px]"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={member.full_name} />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-extrabold tracking-[-0.01em] text-[var(--ink-strong)]">{member.full_name}</p>
                              <p className="truncate text-[11.5px] font-semibold text-[var(--ink-5)]">
                                {member.status === "active" ? "Active" : "Pending"}
                              </p>
                            </div>
                          </div>
                          <p className="min-w-0 truncate text-[12.5px] font-semibold text-[var(--ink-3)]">{member.email}</p>
                          <RolePill role={member.role} />
                          <p className="ari-num text-[11.5px] font-bold text-[var(--ink-5)] md:text-right">{formatDate(member.joined_at)}</p>
                          {isOwner ? (
                            <div className="flex md:justify-end">
                              {canRemove ? (
                                <button
                                  type="button"
                                  onClick={() => setRemoveMemberTarget(member)}
                                  disabled={busyRemoveMemberId === member.id}
                                  className={btnPrimarySm + " h-8 px-2.5 disabled:opacity-50"}
                                >
                                  {busyRemoveMemberId === member.id ? "..." : "Remove"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      {isOwner && pendingInvitesOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="pending-invites-dialog-title">
          <button type="button" className={modalBackdrop} onClick={() => setPendingInvitesOpen(false)} aria-label="Close dialog" />
          <div className={`relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden ${modalShell}`}>
            <div className={`flex shrink-0 items-start justify-between gap-3 px-5 py-4 sm:px-6 ${surfaceInner}`}>
              <div>
                <h2 id="pending-invites-dialog-title" className="text-[16px] font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
                  Pending invites
                </h2>
                <p className={`mt-1 max-w-[56ch] text-[13px] leading-relaxed ${authMutedBodyClass}`}>
                  Everyone listed here was emailed a signup link and hasn’t finished joining yet, including if they only opened the link. Withdraw an invite to free that email for a new one.
                </p>
              </div>
              <button type="button" onClick={() => setPendingInvitesOpen(false)} className={btnGhost + " h-9 shrink-0 px-3"}>
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4 sm:px-6">
              {pendingInvites.length === 0 ? (
                <p className="py-10 text-center text-[13px] font-semibold text-[var(--ink-5)]">No pending invites right now.</p>
              ) : (
                <div className={`overflow-hidden ${surfaceCard}`}>
                  <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--bg-sunken)] text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--ink-5)]">
                        <th className="px-4 py-3 font-extrabold">Email</th>
                        <th className="px-4 py-3 font-extrabold">Role</th>
                        <th className="px-4 py-3 font-extrabold">Status</th>
                        <th className="px-4 py-3 font-extrabold">Sent</th>
                        <th className="px-4 py-3 text-right font-extrabold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {pendingInvites.map((invite) => (
                        <tr key={invite.id} className="bg-white transition hover:bg-[var(--bg-sunken)]">
                          <td className="px-4 py-3 font-extrabold text-[var(--ink-strong)]">{invite.email}</td>
                          <td className="px-4 py-3 align-middle">
                            <RolePill role="collaborator" />
                          </td>
                          <td className="px-4 py-3 align-middle">
                            {invite.opened_at ? (
                              <span className="inline-flex items-center rounded-full border border-[var(--line-strong)] bg-[var(--bg-sunken)] px-2.5 py-0.5 text-[11px] font-extrabold text-[var(--ink-3)]">
                                Link opened
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-[var(--ink-4)]">
                                Awaiting open
                              </span>
                            )}
                          </td>
                          <td className="ari-num px-4 py-3 text-[12.5px] font-bold text-[var(--ink-4)]">{formatDate(invite.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button type="button" onClick={() => void copyInvite(invite)} className={btnGhost + " h-8 px-3"}>
                                {copiedInviteId === invite.id ? "Copied" : "Copy link"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevokeInviteTarget(invite)}
                                disabled={busyCancelInviteId === invite.id}
                                className={btnGhost + " h-8 px-3 disabled:opacity-50"}
                              >
                                {busyCancelInviteId === invite.id ? "…" : "Cancel invite"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isOwner && removeMemberTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
          <button
            type="button"
            className={modalBackdrop}
            onClick={() => {
              if (busyRemoveMemberId !== null) return;
              setRemoveMemberTarget(null);
            }}
            aria-label="Close dialog"
          />
          <div className={`relative z-10 w-full max-w-[440px] p-6 sm:p-7 ${modalShell}`}>
            <h2 id="remove-member-title" className="text-[17px] font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
              Remove member?
            </h2>
            <p className={`mt-3 text-[13px] leading-relaxed ${authMutedBodyClass}`}>
              Remove <span className="font-extrabold text-[var(--ink-strong)]">{removeMemberTarget.full_name}</span> from this workspace? They will lose
              access immediately. You can invite them again later if needed.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={busyRemoveMemberId !== null}
                onClick={() => setRemoveMemberTarget(null)}
                className={btnGhost + " h-9 min-w-[108px] justify-center disabled:opacity-50"}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyRemoveMemberId !== null}
                onClick={() => void confirmRemoveMember()}
                className={btnPrimarySm + " h-9 min-w-[148px] justify-center disabled:opacity-50"}
              >
                {busyRemoveMemberId !== null ? "Removing…" : "Remove from workspace"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isOwner && revokeInviteTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="revoke-invite-title">
          <button type="button" className={modalBackdrop} onClick={() => setRevokeInviteTarget(null)} aria-label="Close dialog" />
          <div className={`relative z-10 w-full max-w-[440px] p-6 sm:p-7 ${modalShell}`}>
            <h2 id="revoke-invite-title" className="text-[17px] font-extrabold tracking-[-0.02em] text-[var(--ink-strong)]">
              Withdraw this invite?
            </h2>
            <p className={`mt-3 text-[13px] leading-relaxed ${authMutedBodyClass}`}>
              If you continue, <span className="font-extrabold text-[var(--ink-strong)]">{revokeInviteTarget.email}</span> won’t be able to use this link to join your workspace or create an account with it. You can send them a new invite anytime.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRevokeInviteTarget(null)} className={btnGhost + " h-9 min-w-[108px] justify-center"}>
                Keep invite
              </button>
              <button type="button" onClick={() => void confirmRevokeInvite()} className={btnPrimarySm + " h-9 min-w-[128px] justify-center"}>
                Withdraw invite
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
