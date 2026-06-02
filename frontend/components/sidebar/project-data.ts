export type Project = {
  id: string;
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
};

export function projectFromApi(p: {
  id: number;
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
}): Project {
  return {
    id: String(p.id),
    name: p.name,
    color: p.color,
    description: p.description ?? null,
    source_type: p.source_type ?? null,
    github_url: p.github_url ?? null,
    backend_notes: p.backend_notes ?? null,
    frontend_notes: p.frontend_notes ?? null,
    database_notes: p.database_notes ?? null,
    additional_notes: p.additional_notes ?? null,
    workspace_path: p.workspace_path ?? null,
    setup_status: p.setup_status ?? null,
    setup_step: p.setup_step ?? null,
    setup_logs: p.setup_logs ?? null,
    setup_error: p.setup_error ?? null,
    setup_completed_at: p.setup_completed_at ?? null,
    setup_editor_url: p.setup_editor_url ?? null,
    editor_url: p.editor_url ?? null,
  };
}
