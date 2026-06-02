import type { AiTaskRun, Column, Tag, TaskCard, TaskStatus } from "./task-board";

export type ChatReactionKind = "thumbs_up" | "heart" | "laugh" | "surprised";

export type ChatMessageOut = {
  id: number;
  author_user_id: number | null;
  author_name: string;
  body: string;
  is_agent: boolean;
  edited_at?: string | null;
  created_at: string;
  reply_to?: {
    id: number;
    author_name: string;
    body_preview: string;
  } | null;
  reactions?: { kind: ChatReactionKind; count: number; mine: boolean }[];
  receipt?: {
    state: "sent" | "read";
    read_by_user_id?: number | null;
    read_by_name?: string | null;
    read_by?: { user_id: number; full_name: string }[];
  } | null;
};

export function formatChatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatChatTimeGutter(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Matches FastAPI default JSON (snake_case) for /team/projects/.../tasks */
export type TaskOut = {
  id: number;
  project_id: number;
  ref: string;
  title: string;
  body: string | null;
  status: TaskStatus;
  tags: { label: string; tone: string }[];
  progress: number | null;
  assignee_user_id?: number | null;
  assignee: string;
  /** ISO date `YYYY-MM-DD` from API */
  due_at: string | null;
  shipped: boolean;
  comments_count: number;
  ai_run?: AiTaskRun | null;
  created_at: string;
  updated_at: string;
};

const COLUMN_TITLES: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  review: "In review",
  shipped: "Shipped",
};

const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "review", "shipped"];

function toTaskCard(t: TaskOut): TaskCard {
  return {
    id: String(t.id),
    ref: t.ref,
    title: t.title,
    body: t.body,
    tags: t.tags as Tag[],
    progress: t.progress ?? undefined,
    assignee_user_id: t.assignee_user_id ?? null,
    assignee: t.assignee,
    due_at: t.due_at,
    shipped: t.shipped,
    comments: t.comments_count,
    ai_run: t.ai_run ?? null,
  };
}

export function tasksToColumns(tasks: TaskOut[]): Column[] {
  const by: Record<TaskStatus, TaskOut[]> = { todo: [], doing: [], review: [], shipped: [] };
  for (const t of tasks) {
    if (by[t.status]) by[t.status].push(t);
  }
  return STATUS_ORDER.map((id) => ({
    id,
    title: COLUMN_TITLES[id],
    tasks: by[id].map(toTaskCard),
  }));
}
