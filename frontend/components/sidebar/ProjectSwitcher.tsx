"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useProject } from "./project-context";

const PLACEHOLDER = { name: "No project", color: "#a1a1aa" };

function ChevronRightProject() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

type Props = { collapsed: boolean };

export function ProjectSwitcher({ collapsed }: Props) {
  const router = useRouter();
  const {
    projects,
    hasProjects,
    current,
    projectId,
    setProjectId,
    loading,
    isOwner,
  } = useProject();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const display = current ?? PLACEHOLDER;
  const canCreate = isOwner && !loading;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function goToNewProject() {
    setOpen(false);
    router.push("/projects/new");
  }

  if (loading) {
    return (
      <div
        className={collapsed ? "mx-auto h-8 w-8 rounded-[5px] bg-[var(--bg-sunken)]" : "h-9 w-full rounded-[5px] bg-[var(--bg-sunken)]"}
        aria-hidden
      />
    );
  }

  if (collapsed) {
    return (
      <div ref={ref} className="relative flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[5px] transition hover:bg-[var(--bg-sunken)]"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={hasProjects ? display.name : isOwner ? "No project" : "Waiting for project"}
          title={hasProjects ? display.name : isOwner ? "No project" : "Waiting for project"}
        >
          {hasProjects ? (
            <span
              className={["flex items-center justify-center text-[var(--ink-strong)] transition-transform duration-150 ease-out", open ? "rotate-90" : ""].join(
                " ",
              )}
            >
              <ChevronRightProject />
            </span>
          ) : !isOwner ? (
            <span className="block h-[18px] w-[18px] rounded-[5px] border border-dashed border-[var(--line-strong)]" />
          ) : (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-dashed border-[var(--line-strong)] text-[var(--ink-4)]">
              <PlusIcon />
            </span>
          )}
        </button>

        {open ? <Menu /> : null}
      </div>
    );
  }

  function Menu() {
    return (
      <div
        role="listbox"
        className={[
          "absolute z-50 overflow-hidden rounded-[8px] border border-[var(--ink-strong)] bg-white py-1 shadow-[var(--sh-pop)]",
          collapsed ? "left-full top-0 ml-2 w-[220px]" : "left-0 right-0 top-[calc(100%+4px)]",
        ].join(" ")}
      >
        {hasProjects ? (
          <>
            <p className="px-2 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink-4)]">
              Projects
            </p>
            <ul className="max-h-[260px] overflow-y-auto">
              {projects.map((p) => {
                const selected = p.id === projectId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setProjectId(p.id);
                        setOpen(false);
                      }}
                      className={[
                        "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[12.5px] transition",
                        selected
                          ? "bg-[var(--accent)] text-[var(--ink-strong)] font-extrabold"
                          : "text-[var(--ink-3)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {selected ? (
                        <span className="text-[var(--ink-strong)]" aria-hidden>
                          <CheckIcon />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {canCreate ? (
          <div className={hasProjects ? "border-t border-[var(--line)] p-1" : "p-1"}>
            <button
              type="button"
              onClick={goToNewProject}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] font-semibold text-[var(--ink-3)] transition hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
            >
              <span className="text-[var(--ink-strong)]">
                <PlusIcon />
              </span>
              {hasProjects ? "New project" : "Create your first project"}
            </button>
          </div>
        ) : null}

        {!isOwner && !hasProjects ? (
          <p className="px-2 py-3 text-center text-[11.5px] font-medium text-slate-500">
            Ask a workspace owner to add you to a project.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border border-transparent px-2 text-left transition",
          open ? "border-[var(--line-strong)] bg-[var(--bg-sunken)] shadow-sm" : "hover:border-[var(--line)] hover:bg-[var(--bg-sunken)]",
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {hasProjects ? null : !isOwner ? (
          <span className="block h-[18px] w-[18px] shrink-0 rounded-[5px] border border-dashed border-[var(--line-strong)]" />
        ) : (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-[var(--line-strong)] text-[var(--ink-4)]">
            <PlusIcon />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold tracking-[-0.005em] text-neutral-950">
          {hasProjects ? display.name : canCreate ? "New project" : "Waiting for project"}
        </span>
        <span className="text-[var(--ink-4)]">
          <ChevronDown />
        </span>
      </button>

      {open ? <Menu /> : null}
    </div>
  );
}
