"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, useAuth } from "@/components/auth/auth-context";
import { projectFromApi, type Project } from "./project-data";

type ProjectFromApi = {
  id: number;
  team_id: number;
  name: string;
  color: string;
  description?: string | null;
  source_type?: string | null;
  github_url?: string | null;
  backend_notes?: string | null;
  frontend_notes?: string | null;
  database_notes?: string | null;
  additional_notes?: string | null;
  workspace_path?: string | null;
  setup_status?: string | null;
  setup_step?: string | null;
  setup_logs?: string | null;
  setup_error?: string | null;
  setup_completed_at?: string | null;
  setup_editor_url?: string | null;
  editor_url?: string | null;
  created_at: string;
};

type ProjectContextValue = {
  projects: Project[];
  hasProjects: boolean;
  current: Project | null;
  projectId: string;
  setProjectId: (id: string) => void;
  loading: boolean;
  isOwner: boolean;
  createProject: (
    name: string,
    options?: {
      description?: string;
      githubUrl?: string;
      backendNotes?: string;
      frontendNotes?: string;
      databaseNotes?: string;
      additionalNotes?: string;
      memberUserIds?: number[];
    }
  ) => Promise<Project>;
  provisionEditor: (projectId: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { token, role, loading: authLoading, lastSelectedProjectId, refresh: refreshAuth } = useAuth();
  const isOwner = role === "owner";
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectIdState] = useState("");

  const persistLastProjectId = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await apiRequest(
          "/team/workspace/preferences",
          {
            method: "PUT",
            body: JSON.stringify({ last_selected_project_id: Number(id) }),
          },
          token
        );
        await refreshAuth();
      } catch {
        /* ignore — UI still uses local selection */
      }
    },
    [token, refreshAuth]
  );

  const refreshProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await apiRequest<ProjectFromApi[]>("/team/projects", {}, token);
      setProjects(list.map(projectFromApi));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshProjects]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (loading || authLoading) return;
      if (projects.length === 0) {
        setProjectIdState("");
        return;
      }
      const serverPref =
        lastSelectedProjectId != null ? String(lastSelectedProjectId) : null;
      const inList = Boolean(serverPref && projects.some((p) => p.id === serverPref));
      const valid = inList ? serverPref! : projects[0]!.id;
      const validNum = Number(valid);
      setProjectIdState(valid);
      if (serverPref && !inList) {
        void persistLastProjectId(valid);
        return;
      }
      if (lastSelectedProjectId !== validNum) {
        void persistLastProjectId(valid);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, authLoading, projects, lastSelectedProjectId, persistLastProjectId]);

  const setProjectId = useCallback(
    (id: string) => {
      if (!projects.some((p) => p.id === id)) return;
      setProjectIdState(id);
      void persistLastProjectId(id);
    },
    [projects, persistLastProjectId]
  );

  const current = useMemo<Project | null>(() => {
    if (!projectId || projects.length === 0) return null;
    return projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  }, [projects, projectId]);

  const createProject = useCallback(
    async (
      name: string,
      options?: {
        description?: string;
        githubUrl?: string;
        backendNotes?: string;
        frontendNotes?: string;
        databaseNotes?: string;
        additionalNotes?: string;
        memberUserIds?: number[];
      }
    ): Promise<Project> => {
      if (!token) throw new Error("Not signed in");
      if (!isOwner) throw new Error("Only the workspace owner can create projects");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a project name");
      const building = options?.description?.trim() ?? "";
      const body: Record<string, unknown> = {
        name: trimmed,
        member_user_ids: options?.memberUserIds ?? [],
      };
      if (building) body["description"] = building;
      const githubUrl = options?.githubUrl?.trim();
      if (githubUrl) body["github_url"] = githubUrl;
      const backendNotes = options?.backendNotes?.trim();
      if (backendNotes) body["backend_notes"] = backendNotes;
      const frontendNotes = options?.frontendNotes?.trim();
      if (frontendNotes) body["frontend_notes"] = frontendNotes;
      const databaseNotes = options?.databaseNotes?.trim();
      if (databaseNotes) body["database_notes"] = databaseNotes;
      const additionalNotes = options?.additionalNotes?.trim();
      if (additionalNotes) body["additional_notes"] = additionalNotes;
      const p = await apiRequest<ProjectFromApi>(
        "/team/projects",
        { method: "POST", body: JSON.stringify(body) },
        token
      );
      const proj = projectFromApi(p);
      setProjects((prev) =>
        [...prev, proj].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      );
      setProjectIdState(proj.id);
      await persistLastProjectId(proj.id);
      return proj;
    },
    [token, isOwner, persistLastProjectId]
  );

  const provisionEditor = useCallback(
    async (projectId: string) => {
      if (!token) throw new Error("Not signed in");
      const p = await apiRequest<ProjectFromApi>(
        `/team/projects/${projectId}/editor/provision`,
        { method: "POST" },
        token
      );
      const proj = projectFromApi(p);
      setProjects((prev) => prev.map((existing) => (existing.id === proj.id ? proj : existing)));
    },
    [token]
  );

  const hasProjects = projects.length > 0;

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      hasProjects,
      current,
      projectId,
      setProjectId,
      loading,
      isOwner,
      createProject,
      provisionEditor,
      refreshProjects,
    }),
    [
      projects,
      hasProjects,
      current,
      projectId,
      setProjectId,
      loading,
      isOwner,
      createProject,
      provisionEditor,
      refreshProjects,
    ]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return ctx;
}
