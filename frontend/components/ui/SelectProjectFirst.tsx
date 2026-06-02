import type { ReactNode } from "react";

function ProjectFolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={44}
      height={44}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 7.5C4 6.39543 4.89543 5.5 6 5.5H9.17157C9.70201 5.5 10.2107 5.71071 10.5858 6.08579L11.4142 6.91421C11.7893 7.28929 12.298 7.5 12.8284 7.5H18C19.1046 7.5 20 8.39543 20 9.5V16.5C20 17.6046 19.1046 18.5 18 18.5H6C4.89543 18.5 4 17.6046 4 16.5V7.5Z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path
        d="M4 9.5H20"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

export type SelectProjectFirstProps = {
  /** Short headline (e.g. "Select a project"). */
  title?: string;
  /** Supporting line shown under the title. */
  description?: string;
  /**
   * `full` — grows with the parent flex area and centers content (e.g. tasks).
   * `card` — padded card with border for dashboard-style pages.
   */
  layout?: "full" | "card";
  className?: string;
  /** Extra content below the description (rare). */
  footer?: ReactNode;
};

const DEFAULT_TITLE = "Select a project";
const DEFAULT_DESCRIPTION = "Choose one in the sidebar so this workspace can load the right data.";

/**
 * Shared empty state when no project is active.
 */
export function SelectProjectFirst({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  layout = "full",
  className,
  footer,
}: SelectProjectFirstProps) {
  const inner = (
    <div className="mx-auto flex max-w-[min(100%,26rem)] flex-col items-center gap-4 text-center">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-[var(--line-strong)] bg-[var(--bg-sunken)] text-slate-500">
        <ProjectFolderIcon className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <p className="text-[15px] font-extrabold tracking-tight text-neutral-950">{title}</p>
        <p className="text-[13px] font-semibold leading-relaxed text-slate-600">{description}</p>
      </div>
      {footer}
    </div>
  );

  if (layout === "card") {
    return (
      <div
        className={[
          "rounded-[8px] border border-[var(--line-strong)] bg-white p-8 shadow-none",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {inner}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex min-h-0 w-full flex-1 items-center justify-center px-6 py-10 sm:px-10",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {inner}
    </div>
  );
}
