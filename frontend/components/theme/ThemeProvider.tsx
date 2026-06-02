"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const THEME_STORAGE_KEY = "jinoe-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_THEME_VARS: Record<string, string> = {
  "--surface-app": "#000000",
  "--surface-panel": "#111111",
  "--surface-muted": "#0a0a0a",
  "--surface-soft": "#171717",
  "--border-subtle": "#333333",
  "--border-strong": "#333333",
  "--ink-strong": "#ffffff",
  "--ink-slate": "#ededed",
  "--ink-muted": "#a1a1a1",
  "--ink-soft": "#888888",
  "--charcoal": "#ffffff",
  "--charcoal-hover": "#e5e5e5",
  "--bg-app": "#000000",
  "--bg-canvas": "transparent",
  "--bg-sunken": "#0a0a0a",
  "--bg-raised": "#111111",
  "--bg-overlay": "rgba(10, 10, 10, 0.96)",
  "--line": "#333333",
  "--line-strong": "#333333",
  "--line-faint": "rgba(255, 255, 255, 0.08)",
  "--ink-1": "#ffffff",
  "--ink": "#ededed",
  "--ink-2": "#ededed",
  "--ink-3": "#a1a1a1",
  "--ink-4": "#888888",
  "--ink-5": "#737373",
  "--ink-6": "#525252",
  "--accent": "#dfff00",
  "--accent-hover": "#e7ff39",
  "--accent-soft": "rgba(223, 255, 0, 0.14)",
  "--accent-line": "rgba(223, 255, 0, 0.38)",
  "--pos": "#0070f3",
  "--pos-soft": "rgba(0, 112, 243, 0.14)",
  "--warn": "#f5a623",
  "--warn-soft": "rgba(245, 166, 35, 0.14)",
  "--neg": "#ee0000",
  "--neg-soft": "rgba(238, 0, 0, 0.12)",
  "--sh-1": "0 1px 0 rgba(255, 255, 255, 0.04)",
  "--sh-2": "0 1px 2px rgba(0, 0, 0, 0.5)",
  "--sh-3": "0 8px 30px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)",
  "--sh-pop": "0 24px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06)",
  "--background": "var(--surface-app)",
  "--foreground": "var(--ink-strong)",
  "--brand-strong": "#0b0a08",
};

const DARK_THEME_VAR_NAMES = Object.keys(DARK_THEME_VARS);

function preferenceFromStorage(stored: string | null): ThemePreference {
  if (stored === "dark") return "dark";
  return "light";
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolvedTheme;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
  if (resolvedTheme === "dark") {
    Object.entries(DARK_THEME_VARS).forEach(([name, value]) => root.style.setProperty(name, value));
  } else {
    DARK_THEME_VAR_NAMES.forEach((name) => root.style.removeProperty(name));
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "light";
    return preferenceFromStorage(window.localStorage.getItem(THEME_STORAGE_KEY));
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") return "light";
    return preferenceFromStorage(window.localStorage.getItem(THEME_STORAGE_KEY));
  });

  useEffect(() => {
    applyTheme(preference, resolvedTheme);
  }, [preference, resolvedTheme]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored !== "light" && stored !== "dark") {
      window.localStorage.setItem(THEME_STORAGE_KEY, preferenceFromStorage(stored));
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference(nextPreference) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
        setPreferenceState(nextPreference);
        setResolvedTheme(nextPreference);
      },
    }),
    [preference, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
