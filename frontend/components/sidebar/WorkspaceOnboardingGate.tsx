"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProject } from "@/components/sidebar/project-context";

type WorkspaceOnboardingGateProps = {
  children: ReactNode;
};

const allowedOwnerNoProjectPaths = ["/projects/new", "/projects", "/teams", "/settings"];

function isAllowedOwnerNoProjectPath(pathname: string) {
  return allowedOwnerNoProjectPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function FirstProjectRedirectState() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-[var(--surface-app)] px-6 py-10 sm:px-10">
      <section className="mx-auto w-full max-w-[440px] rounded-[10px] border border-[var(--line-strong)] bg-[var(--bg-raised)] p-7 text-center shadow-[var(--sh-pop)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[8px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[var(--ink-4)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2.5h5.5A2.5 2.5 0 0 1 20 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
            <path d="M9 13h6" />
          </svg>
        </div>
        <p className="mt-5 text-[15px] font-extrabold tracking-tight text-[var(--ink-strong)]">Create your first project</p>
        <p className="mt-2 text-[13px] font-semibold leading-relaxed text-[var(--ink-4)]">
          Taking you to the project setup page.
        </p>
      </section>
    </main>
  );
}

function CollaboratorNoProjectState() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-[var(--surface-app)] px-6 py-10 sm:px-10">
      <section className="mx-auto w-full max-w-[440px] rounded-[10px] border border-[var(--ink-strong)] bg-[var(--bg-raised)] p-7 text-center shadow-[var(--sh-pop)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[8px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] text-[var(--ink-4)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2.5h5.5A2.5 2.5 0 0 1 20 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
            <path d="M9 13h6" />
          </svg>
        </div>
        <p className="mt-5 text-[15px] font-extrabold tracking-tight text-[var(--ink-strong)]">Waiting for project access</p>
        <p className="mt-2 text-[13px] font-semibold leading-relaxed text-[var(--ink-4)]">
          Ask a workspace owner to add you to a project. Once you are assigned, the workspace will unlock automatically.
        </p>
      </section>
    </main>
  );
}

export function WorkspaceOnboardingGate({ children }: WorkspaceOnboardingGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, hasProjects, isOwner } = useProject();

  const ownerNeedsFirstProject = !loading && !hasProjects && isOwner;
  const shouldRedirectOwner = ownerNeedsFirstProject && !isAllowedOwnerNoProjectPath(pathname);
  const showCollaboratorNoProject = !loading && !hasProjects && !isOwner;

  useEffect(() => {
    if (shouldRedirectOwner) {
      router.replace("/projects/new");
    }
  }, [router, shouldRedirectOwner]);

  if (showCollaboratorNoProject) {
    return <CollaboratorNoProjectState />;
  }

  if (shouldRedirectOwner) {
    return <FirstProjectRedirectState />;
  }

  return <>{children}</>;
}
