import Link from "next/link";

type AuthShellProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
};

/** Shared with login/signup field styling; keep in sync. */
export const authFieldClass =
  "block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2.5 text-sm text-[var(--ink-strong)] shadow-sm outline-none transition placeholder:text-[var(--ink-soft)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-line)] disabled:opacity-50";

export const authLabelClass = "block text-left text-sm font-medium text-[var(--ink)]";

export const authPrimaryButtonClass =
  "flex w-full items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-zinc-400/25 disabled:opacity-50";

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="relative flex min-h-dvh min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden bg-[var(--surface-app)] px-4 py-10 sm:px-6">
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[var(--dashboard-backdrop)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 text-center">
          <p className="text-xs font-bold tracking-[-0.02em] text-[var(--ink-strong)]">Jinoe</p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center justify-center text-[13px] font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
          >
            ← Home
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-8 shadow-[var(--sh-3)]">
          <div className="mb-8 space-y-1.5 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">{title}</h1>
            <p className="text-sm text-[var(--ink-soft)]">{description}</p>
          </div>
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-[var(--ink-soft)]">{footer}</p>
      </div>
    </div>
  );
}
