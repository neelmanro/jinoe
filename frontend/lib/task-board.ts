export type TaskStatus = "todo" | "doing" | "review" | "shipped";

export type TagTone = "engineering" | "design" | "data" | "ops" | "ai";

export type Tag = { label: string; tone: TagTone };

export type TaskCard = {
  id: string;
  ref: string;
  title: string;
  /** Task description from API; may be empty */
  body?: string | null;
  tags: Tag[];
  progress?: number;
  assignee_user_id?: number | null;
  assignee: string;
  reviewer?: string | null;
  /** ISO date `YYYY-MM-DD` */
  due_at?: string | null;
  shipped?: boolean;
  comments: number;
  ai_run?: AiTaskRun | null;
};

export type Column = {
  id: TaskStatus;
  title: string;
  tasks: TaskCard[];
};

export type AiTaskRun = {
  id: number;
  project_id: number;
  task_id: number;
  attempt_id?: number | null;
  session_id?: string | null;
  status: "queued" | "running" | "submitted" | "failed" | "cancelled" | string;
  current_step: string;
  progress: number;
  todos: Array<{ id?: string; content?: string; status?: "pending" | "in_progress" | "completed" | string }>;
  events: Array<{
    id?: string;
    kind?: string;
    title?: string;
    detail?: string | null;
    status?: string;
    created_at?: string;
    payload?: Record<string, unknown>;
  }>;
  logs?: string | null;
  error?: string | null;
  review_id?: number | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};
