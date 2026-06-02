"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const SIDEBAR_COLLAPSED_KEY = "jinoe.workspace.sidebarCollapsed";

function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

type WorkspaceChromeValue = {
  /** `true` = narrow icon rail; `false` = full 232px nav. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Right-side workspace assistant (UI-only for now). */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
};

const WorkspaceChromeContext = createContext<WorkspaceChromeValue | null>(null);

export function WorkspaceChromeProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [assistantOpen, setAssistantOpenState] = useState(false);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSidebarCollapsedState(readStoredSidebarCollapsed());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    if (!collapsed) {
      setAssistantOpenState(false);
    }
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* quota / private mode */
    }
  }, []);

  const setAssistantOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setSidebarCollapsed(true);
      }
      setAssistantOpenState(open);
    },
    [setSidebarCollapsed],
  );

  const value = useMemo<WorkspaceChromeValue>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      assistantOpen,
      setAssistantOpen,
    }),
    [assistantOpen, setAssistantOpen, sidebarCollapsed, setSidebarCollapsed],
  );

  return (
    <WorkspaceChromeContext.Provider value={value}>{children}</WorkspaceChromeContext.Provider>
  );
}

export function useWorkspaceChrome() {
  const ctx = useContext(WorkspaceChromeContext);
  if (!ctx) {
    throw new Error("useWorkspaceChrome must be used within WorkspaceChromeProvider");
  }
  return ctx;
}
