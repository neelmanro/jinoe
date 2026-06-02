"use client";

/** Spinner for buttons on the brand chartreuse accent — dark ring so it stays visible. */
export function AuthSubmitSpinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block size-4 shrink-0 rounded-full border-2 border-[var(--ink-strong)]/25 border-t-[var(--ink-strong)] ${className ?? ""}`}
      style={{ animation: "auth-spin 0.7s linear infinite" }}
      aria-hidden
    />
  );
}
