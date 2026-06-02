"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

export type AuthUser = {
  id: number;
  full_name: string;
  company_name: string | null;
  email: string;
};

export type AuthTeam = {
  id: number;
  name: string;
  created_at: string;
};

export type AuthRole = "owner" | "collaborator";

export type AuthPayload = {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
  team: AuthTeam;
  role: AuthRole;
};

/** API shape for POST /auth/login and POST /auth/signup */
export type AuthResponse = {
  verification_required: boolean;
  challenge_id?: string | null;
  access_token?: string | null;
  token_type?: string;
  user?: AuthUser | null;
  team?: AuthTeam | null;
  role?: AuthRole | null;
};

export type LoginApiResult = AuthResponse;

export type MePayload = {
  user: AuthUser;
  team: AuthTeam;
  role: AuthRole;
  last_selected_project_id: number | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  team: AuthTeam | null;
  role: AuthRole | null;
  /** Server-stored workspace preference; replaces localStorage for project selection. */
  lastSelectedProjectId: number | null;
  loading: boolean;
  token: string | null;
  refresh: () => Promise<void>;
  setSession: (payload: AuthPayload) => void;
  signOut: () => Promise<void>;
};

const TOKEN_KEY = "Jinoe.accessToken";

/**
 * API origin for browser `fetch`. `NEXT_PUBLIC_*` is inlined at `next build` time — set it in the environment used for that build.
 * No implicit domain fallback: configure `NEXT_PUBLIC_API_URL` explicitly.
 * Use an empty value for same-origin requests (reverse proxy serves `/auth`, `/team`, etc. on the app host).
 * Otherwise set the full origin with no trailing slash, e.g. `https://api.example.com`.
 */
export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const resolvedToken = token === undefined ? getStoredToken() : token;
  if (resolvedToken) headers.set("Authorization", `Bearer ${resolvedToken}`);

  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let message = "Something went wrong";
    try {
      const data = (await res.json()) as { detail?: string };
      message = data.detail || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [team, setTeam] = useState<AuthTeam | null>(null);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [lastSelectedProjectId, setLastSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const stored = getStoredToken();
    setToken(stored);
    if (!stored) {
      setUser(null);
      setTeam(null);
      setRole(null);
      setLastSelectedProjectId(null);
      setLoading(false);
      return;
    }

    try {
      const me = await apiRequest<MePayload>("/auth/me", {}, stored);
      setUser(me.user);
      setTeam(me.team);
      setRole(me.role);
      setLastSelectedProjectId(me.last_selected_project_id ?? null);
    } catch {
      setStoredToken(null);
      setToken(null);
      setUser(null);
      setTeam(null);
      setRole(null);
      setLastSelectedProjectId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const setSession = useCallback((payload: AuthPayload) => {
    setStoredToken(payload.access_token);
    setToken(payload.access_token);
    setUser(payload.user);
    setTeam(payload.team);
    setRole(payload.role);
    setLastSelectedProjectId(null);
  }, []);

  const signOut = useCallback(async () => {
    const current = getStoredToken();
    try {
      if (current) await apiRequest("/auth/logout", { method: "POST" }, current);
    } catch {
      /* ignore */
    }
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setTeam(null);
    setRole(null);
    setLastSelectedProjectId(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      team,
      role,
      lastSelectedProjectId,
      loading,
      token,
      refresh,
      setSession,
      signOut,
    }),
    [user, team, role, lastSelectedProjectId, loading, token, refresh, setSession, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  /** Avoid repeated `router.replace` to the same login URL (can thrash the tab loader in dev). */
  const pendingLoginRedirect = useRef<string | null>(null);

  useEffect(() => {
    if (auth.loading || auth.user) {
      pendingLoginRedirect.current = null;
      return;
    }
    if (pathname === "/login" || pathname === "/signup") return;

    const dest = `/login?next=${encodeURIComponent(pathname)}`;
    if (pendingLoginRedirect.current === dest) return;
    pendingLoginRedirect.current = dest;
    router.replace(dest);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `useRouter` is stable; including it can retrigger this effect unnecessarily.
  }, [auth.loading, auth.user, pathname]);

  if (auth.loading || !auth.user) {
    return (
      <div className="grid h-dvh place-items-center bg-[var(--surface-app)] text-sm text-[var(--ink-soft)]">
        Loading workspace...
      </div>
    );
  }

  return children;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
