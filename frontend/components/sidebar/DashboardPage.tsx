import type { ReactNode } from "react";

type DashboardPageProps = {
  /** Omit or leave empty to hide the in-body page heading. */
  title?: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  /**
   * `centered` - body fills the area below the topbar and centers the main column
   * (title + children) for full-screen, focused flows (e.g. new project).
   */
  contentMode?: "default" | "centered";
  /** Use full viewport width below the topbar (e.g. wide roster tables). */
  wideContent?: boolean;
  /**
   * No body padding or outer scroll — children fill the area below the top bar
   * (e.g. wide collage layouts). Pair with omitted title/description for a single-screen layout.
   */
  fullBleed?: boolean;
  children?: ReactNode;
};

/**
 * Page chrome: optional top bar (meta + action only), then header + body.
 */
export function DashboardPage({
  title,
  description,
  meta,
  action,
  contentMode = "default",
  wideContent = false,
  fullBleed = false,
  children,
}: DashboardPageProps) {
  const pageHeader =
    title || description ? (
      <div className={contentMode === "centered" ? "mb-6 text-center" : "mb-7"}>
        {title ? (
          <h1
            className={[
              "text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-[var(--ink-strong)]",
              contentMode === "centered" ? "text-balance" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {title}
          </h1>
        ) : null}
        {description ? (
          <p
            className={[
              "mt-1.5 text-[13.5px] leading-[1.55] text-[var(--ink-4)]",
              contentMode === "centered" ? "mx-auto max-w-[62ch] text-balance" : "max-w-[68ch]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {description}
          </p>
        ) : null}
      </div>
    ) : null;

  const showTopBar = Boolean(meta) || Boolean(action);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showTopBar ? (
        <header className="flex min-h-[56px] shrink-0 items-center justify-end gap-3 border-b border-[var(--ink-strong)] bg-[var(--bg-raised)] px-6 py-3 sm:px-8">
          <div className="flex shrink-0 items-center gap-2">
            {meta ? <div className="text-[12px] text-[var(--ink-muted)]">{meta}</div> : null}
            {action}
          </div>
        </header>
      ) : null}

      {/* Body */}
      <div
        className={[
          "min-h-0 flex-1",
          fullBleed ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
        ].join(" ")}
      >
        {contentMode === "centered" ? (
          <div className="box-border flex min-h-full w-full items-center justify-center px-6 py-8 sm:px-10 sm:py-10">
            <div className="w-full max-w-[720px] py-4">
              {pageHeader}
              {children}
            </div>
          </div>
        ) : fullBleed ? (
          <div className="box-border flex h-full min-h-0 w-full max-w-none flex-col overflow-hidden p-0">
            {pageHeader}
            {children}
          </div>
        ) : (
          <div
            className={[
              "mx-auto w-full px-5 pb-14 sm:px-6",
              pageHeader ? "pt-7" : "pt-5",
              wideContent ? "max-w-none" : "max-w-[1400px]",
            ].join(" ")}
          >
            {pageHeader}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
