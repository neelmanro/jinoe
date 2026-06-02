"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/components/auth/auth-context";

/** Matches `GET /team/projects/:project_id/members` (project roster only). */
export type ProjectMemberOption = {
  user_id: number;
  full_name: string;
  email: string;
  role: "owner" | "collaborator";
};

/** Loads people on the project roster — not the whole workspace team. */
export function useProjectMembers(projectId: string | null, enabled: boolean) {
  const [members, setMembers] = useState<ProjectMemberOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
    }, 0);
    void (async () => {
      try {
        const rows = await apiRequest<ProjectMemberOption[]>(
          `/team/projects/${projectId}/members`
        );
        if (!cancelled) setMembers(rows);
      } catch (e) {
        if (!cancelled) {
          setMembers([]);
          setError(e instanceof Error ? e.message : "Could not load project members");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, projectId]);

  const uniqueMembers = useMemo(() => {
    const byId = new Map<number, ProjectMemberOption>();
    for (const row of members) {
      if (!byId.has(row.user_id)) byId.set(row.user_id, row);
    }
    return [...byId.values()];
  }, [members]);

  return { members: uniqueMembers, error, loading };
}
