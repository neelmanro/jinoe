"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { useProject } from "@/components/sidebar/project-context";
import { useWorkspaceChrome } from "@/components/sidebar/workspace-chrome-context";
import { ProjectSwitcher } from "./ProjectSwitcher";

/* ─────────────────────────────────────────────────────────────
   Icons: 16px, heavier stroke for bold nav labels (Jinoe).
   Lucide-style geometry. No fill, no gradients.
   ───────────────────────────────────────────────────────────── */

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.35,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function TasksIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 11l2 2 4-4" />
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 14h4.5" />
    </svg>
  );
}
function CodebaseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18.5v-13z" />
      <path d="M8 3v18" />
      <path d="M11.5 8h4" />
      <path d="M11.5 12h5" />
    </svg>
  );
}
function EditorIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M9 8l-2 2 2 2" />
      <path d="M15 8l2 2-2 2" />
    </svg>
  );
}
function TeamsIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16.2 14.5A4.5 4.5 0 0 1 20.5 19" />
    </svg>
  );
}
function ReviewsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5z" />
      <path d="M14 3v5h5" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20.5a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
function ProjectsIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
function CollapseIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevronUpDownIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M8 10l4-4 4 4" />
      <path d="M16 14l-4 4-4-4" />
    </svg>
  );
}

/* ── Nav model ─────────────────────────────────────────────── */

type NavDef = { href: string; label: string; Icon: ComponentType };

const NAV_MAIN: NavDef[] = [
  { href: "/repo", label: "Codebase", Icon: CodebaseIcon },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon },
  { href: "/chat", label: "Chat", Icon: ChatIcon },
  { href: "/editor", label: "Editor", Icon: EditorIcon },
  { href: "/reviews", label: "Reviews", Icon: ReviewsIcon },
];

const NAV_FOOTER: NavDef[] = [
  { href: "/teams", label: "Members", Icon: TeamsIcon },
  { href: "/projects", label: "Projects", Icon: ProjectsIcon },
  { href: "/settings", label: "Profile", Icon: ProfileIcon },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navItemClass(active: boolean, collapsed: boolean) {
  return [
    "group relative flex h-9 cursor-pointer select-none items-center text-[13px] font-extrabold tracking-[0] transition-colors duration-100",
    collapsed ? "mx-auto w-9 justify-center rounded-[6px]" : "gap-3 rounded-[7px] px-3",
    active
      ? "bg-[var(--accent)] text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)]"
      : "text-[var(--ink-3)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]",
  ].join(" ");
}

function isAllowedBeforeFirstProject(href: string) {
  return (
    href === "/teams" ||
    href === "/projects" ||
    href.startsWith("/projects/new")
  );
}

function isAllowedDuringProjectSetup(href: string) {
  return (
    href === "/editor" ||
    href === "/teams" ||
    href === "/projects" ||
    href.startsWith("/projects/new") ||
    href === "/settings"
  );
}

function isHiddenForCollaborator(href: string) {
  return href === "/projects" || href.startsWith("/projects/") || href === "/reviews";
}

function NavLink({
  href,
  label,
  Icon,
  active,
  collapsed,
  locked,
  lockedMessage = "Create your first project to unlock the workspace",
}: NavDef & { active: boolean; collapsed: boolean; locked?: boolean; lockedMessage?: string }) {
  if (locked && !isAllowedBeforeFirstProject(href)) {
    return (
      <button
        type="button"
        title={label}
        className={navItemClass(false, collapsed) + " w-full"}
        onClick={() => showDashboardToast(lockedMessage)}
      >
        <span className="text-[var(--ink-5)]">
          <Icon />
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    );
  }

  return (
    <Link href={href} title={label} className={navItemClass(active, collapsed)}>
      <span className={active ? "text-[var(--ink-strong)]" : "text-[var(--ink-3)] group-hover:text-[var(--ink-strong)]"}>
        <Icon />
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/* ── Component ─────────────────────────────────────────────── */

export function AppSidebar() {
  const pathname = usePathname();
  const { user, role, signOut } = useAuth();
  const { hasProjects, loading: projectsLoading, current } = useProject();
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } = useWorkspaceChrome();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const isCollaborator = role === "collaborator";
  const workspaceLocked = !projectsLoading && !hasProjects;
  const setupLocked = !projectsLoading && Boolean(current && current.setup_status && current.setup_status !== "ready");
  const workspaceLockedMessage = isCollaborator
    ? "Ask a workspace owner to add you to a project to unlock the workspace"
    : "Create your first project to unlock the workspace";
  const mainNav = isCollaborator ? NAV_MAIN.filter((item) => !isHiddenForCollaborator(item.href)) : NAV_MAIN;
  const footerNav = isCollaborator ? NAV_FOOTER.filter((item) => !isHiddenForCollaborator(item.href)) : NAV_FOOTER;

  useEffect(() => {
    if (!accountOpen) return;
    function onDoc(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const userInitials = (user?.full_name || "User")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside
      className={[
        "hidden h-full min-h-0 shrink-0 flex-col border-r border-[var(--ink-strong)] bg-[var(--bg-raised)] transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-[64px]" : "w-[248px]",
      ].join(" ")}
      aria-label="Workspace navigation"
    >
      {/* Brand row */}
      <div
        className={[
          "flex items-center gap-2 border-b border-[var(--line-strong)] bg-[var(--bg-raised)]",
          collapsed ? "h-16 justify-center px-0" : "h-16 px-5",
        ].join(" ")}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => {
              if (workspaceLocked) {
                showDashboardToast(workspaceLockedMessage);
                return;
              }
              setCollapsed(false);
            }}
            className="flex h-10 w-full cursor-pointer items-center justify-center px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <span className="relative block h-8 w-8 shrink-0">
              <Image
                src="/logo_v2.png"
                alt=""
                fill
                className="object-contain object-center"
                sizes="32px"
                priority
              />
            </span>
          </button>
        ) : (
          <>
            <Link
              href={setupLocked ? "/editor" : "/tasks"}
              onClick={(event) => {
                if (workspaceLocked) {
                  event.preventDefault();
                  showDashboardToast(workspaceLockedMessage);
                }
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-center py-0.5"
              title="Tasks"
              aria-label="Go to tasks"
            >
              <span className="relative block h-8 w-[min(100%,9.5rem)] max-w-[152px] shrink-0">
                <Image
                  src="/logo_and_name_v2.png"
                alt=""
                fill
                className="jinoe-wordmark object-contain object-left"
                  sizes="152px"
                  priority
                />
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
            className="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-4)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
              aria-label="Collapse sidebar"
              title="Collapse"
            >
              <CollapseIcon />
            </button>
          </>
        )}
      </div>

      {/* Project switcher */}
      <div className={collapsed ? "border-b border-[var(--line-strong)] px-2 py-3" : "border-b border-[var(--line-strong)] px-4 py-3"}>
        <ProjectSwitcher collapsed={collapsed} />
      </div>

      {/* Primary nav */}
      <nav className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3" aria-label="Main">
        <ul className="flex flex-col gap-1.5">
          {mainNav.map((item) => (
            <li key={item.href}>
              <NavLink
                {...item}
                active={isActivePath(pathname, item.href)}
                collapsed={collapsed}
                locked={workspaceLocked || (setupLocked && !isAllowedDuringProjectSetup(item.href))}
                lockedMessage={setupLocked ? "Finish project setup to unlock this page" : workspaceLockedMessage}
              />
            </li>
          ))}
        </ul>

        <div className="mt-auto" />

        <ul className="flex flex-col gap-1.5 pb-1">
          {footerNav.map((item) => (
            <li key={item.href}>
              <NavLink
                {...item}
                active={isActivePath(pathname, item.href)}
                collapsed={collapsed}
                locked={workspaceLocked || (setupLocked && !isAllowedDuringProjectSetup(item.href))}
                lockedMessage={setupLocked ? "Finish project setup to unlock this page" : workspaceLockedMessage}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Account */}
      <div ref={accountRef} className="relative border-t border-[var(--line-strong)] bg-[var(--bg-raised)] px-3 py-3">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[var(--ink-strong)] text-[10px] font-bold text-white shadow-sm transition hover:bg-[var(--charcoal-hover)]"
            aria-label="Expand sidebar"
            title={user?.full_name || "Account"}
          >
            {userInitials}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left transition hover:bg-[var(--bg-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink-strong)] text-[10px] font-bold text-white shadow-sm">
              {userInitials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold tracking-[-0.005em] text-[var(--ink-strong)]">
                {user?.full_name || "Account"}
              </span>
              <span className="block truncate text-[11px] font-medium text-[var(--ink-muted)]">
                {role === "owner" ? "Owner" : "Collaborator"}
              </span>
            </span>
            <span className="text-[var(--ink-4)]">
              <ChevronUpDownIcon />
            </span>
          </button>
        )}

        {accountOpen ? (
          <div
            role="menu"
            className={[
              "absolute z-50 overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[var(--bg-raised)] py-1 shadow-[var(--sh-pop)]",
              collapsed
                ? "bottom-1 left-full ml-2 w-[200px]"
                : "bottom-[calc(100%+4px)] left-1.5 right-1.5",
            ].join(" ")}
          >
            <div className="border-b border-[var(--line)] px-2.5 py-2">
              <p className="truncate text-[12.5px] font-bold text-[var(--ink-strong)]">
                {user?.full_name || "Account"}
              </p>
              <p className="truncate text-[11px] font-medium text-[var(--ink-muted)]">{user?.email}</p>
            </div>
            <Link
              href="/settings"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
              onClick={(event) => {
                if (workspaceLocked) {
                  event.preventDefault();
                  showDashboardToast(workspaceLockedMessage);
                }
                setAccountOpen(false);
              }}
            >
              <ProfileIcon />
              Profile
            </Link>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-[12.5px] font-semibold text-[var(--ink-2)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
              onClick={() => {
                setAccountOpen(false);
                void signOut();
              }}
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
