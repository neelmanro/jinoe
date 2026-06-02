"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const DASHBOARD_TOAST_EVENT = "Jinoe-dashboard-toast";

export function showDashboardToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DASHBOARD_TOAST_EVENT, {
      detail: { message },
    }),
  );
}

type ToastState = { message: string };

/** Fixed chip portaled to `document.body`; always top center below the safe area. */
export function DashboardToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const mounted = typeof document !== "undefined";

  const hide = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function onToast(e: Event) {
      const ce = e as CustomEvent<{ message?: string }>;
      const msg = ce.detail?.message?.trim();
      if (!msg) return;
      if (timer) clearTimeout(timer);
      setToast({ message: msg });
      timer = setTimeout(() => {
        setToast(null);
        timer = null;
      }, 4500);
    }

    window.addEventListener(DASHBOARD_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(DASHBOARD_TOAST_EVENT, onToast);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!mounted || !toast) return null;

  const positionClass =
    "pointer-events-none fixed inset-x-0 top-5 z-[200] flex justify-center px-4 pt-[env(safe-area-inset-top,0px)]";

  return createPortal(
    <div className={positionClass} aria-live="polite">
      <div
        role="status"
        className="pointer-events-auto flex max-w-[min(100vw-2rem,28rem)] items-center gap-2 rounded-lg border border-[var(--pos)]/35 bg-[var(--pos-soft)] px-2.5 py-1.5 shadow-md"
      >
        <span className="text-left text-[11.5px] font-semibold leading-snug tracking-tight text-[var(--pos)]">{toast.message}</span>
        <button
          type="button"
          onClick={hide}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px] font-medium leading-none text-[var(--pos)] opacity-70 transition hover:bg-[var(--bg-raised)] hover:opacity-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
