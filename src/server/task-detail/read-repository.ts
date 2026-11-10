import "server-only";

import type { StoredTaskState } from "@/server/repositories/task-access-repository";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

export type TaskDetailSnapshot = Readonly<{
  task: Readonly<{
    id: string;
    projectKey: string;
    taskKey: string;
    title: string;
    description: string;
    status: StoredTaskState;
    /** The task's current integer version, which the task write routes require (design.md L1). */
    version: number;
    assigneeId: string;
    assignee: Readonly<{ id: string; githubUsername: string }>;
    dueDate: string;
    branchName: string | null;
    acceptanceCriteria: readonly Readonly<{ id: string; position: number; description: string }>[];
  }>;
  attachedCommits: readonly Readonly<{
    id: string;
    sha: string;
    sourceBranch: string | null;
    attachedBy: Readonly<{ id: string; githubUsername: string }>;
    attachedAt: string;
  }>[];
  progressUpdates: readonly Readonly<{
    id: string;
    author: Readonly<{ id: string; githubUsername: string }>;
    body: string;
    createdAt: string;
  }>[];
  reviewFeedback: readonly Readonly<{
    id: string;
    author: Readonly<{ id: string; githubUsername: string }>;
    feedback: string;
    createdAt: string;
  }>[];
}>;

type DetailRow = Record<string, unknown> & {
  id: string;
  project_key: string;
  task_key: string;
  title: string;
  description: string;
  status: StoredTaskState;
  version: unknown;
  assignee_id: string;
  assignee_github_username: string;
  due_date: string;
  branch_name: string | null;
  acceptance_criteria: unknown;
  attached_commits: unknown;
  progress_updates: unknown;
  review_feedback: unknown;
};

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export class TaskDetailReadRepository {
  constructor(private readonly database: Query) {}

  async findTaskAssignee(projectId: string, taskId: string): Promise<string | null> {
    const result = await this.database.query<{ assignee_id: string }>(
      `SELECT assignee_id::text AS assignee_id
         FROM app.tasks
        WHERE id = $1::uuid AND project_id = $2::uuid AND deleted_at IS NULL`,
      [taskId, projectId],
    );
    return result.rows[0]?.assignee_id ?? null;
  }

  async findTaskDetail(projectId: string, taskId: string): Promise<TaskDetailSnapshot | null> {
    const result = await this.database.query<DetailRow>(
      `SELECT t.id::text AS id,
              p.key AS project_key,
              p.key || '-' || t.number::text AS task_key,
              t.title,
              t.description,
              t.status,
              t.version,
              t.assignee_id::text AS assignee_id,
              assignee.github_username AS assignee_github_username,
              t.due_date::text AS due_date,
              t.branch_name,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', c.id::text, 'position', c.position, 'description', c.description
                ) ORDER BY c.position ASC, c.id ASC)
                FROM app.acceptance_criteria c WHERE c.task_id = t.id
              ), '[]'::jsonb) AS acceptance_criteria,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', c.id::text, 'sha', c.commit_sha,
                  'sourceBranch', c.source_branch,
                  'attachedBy', jsonb_build_object('id', author.id::text, 'githubUsername', author.github_username),
                  'attachedAt', c.created_at
                ) ORDER BY c.created_at ASC, c.id ASC)
                FROM app.attached_commits c
                JOIN app.people author ON author.id = c.attached_by
                WHERE c.task_id = t.id
              ), '[]'::jsonb) AS attached_commits,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', u.id::text,
                  'author', jsonb_build_object('id', author.id::text, 'githubUsername', author.github_username),
                  'body', u.body, 'createdAt', u.created_at
                ) ORDER BY u.created_at ASC, u.id ASC)
                FROM app.progress_updates u
                JOIN app.people author ON author.id = u.author_id
                WHERE u.task_id = t.id
              ), '[]'::jsonb) AS progress_updates,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', e.id::text,
                  'author', jsonb_build_object('id', author.id::text, 'githubUsername', author.github_username),
                  'feedback', e.feedback, 'createdAt', e.created_at
                ) ORDER BY e.created_at ASC, e.id ASC)
                FROM app.task_events e
                JOIN app.people author ON author.id = e.actor_id
                WHERE e.task_id = t.id AND e.event_type = 'review_feedback'
              ), '[]'::jsonb) AS review_feedback
         FROM app.tasks t
         JOIN app.projects p ON p.id = t.project_id
         JOIN app.people assignee ON assignee.id = t.assignee_id
        WHERE t.id = $1::uuid AND t.project_id = $2::uuid AND t.deleted_at IS NULL`,
      [taskId, projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const attachedCommits = jsonValue<TaskDetailSnapshot["attachedCommits"]>(row.attached_commits).map((item) => ({
      ...item,
      attachedAt: timestamp(item.attachedAt),
    }));
    const progressUpdates = jsonValue<TaskDetailSnapshot["progressUpdates"]>(row.progress_updates).map((item) => ({
      ...item,
      createdAt: timestamp(item.createdAt),
    }));
    const reviewFeedback = jsonValue<TaskDetailSnapshot["reviewFeedback"]>(row.review_feedback).map((item) => ({
      ...item,
      createdAt: timestamp(item.createdAt),
    }));
    return {
      task: {
        id: row.id,
        projectKey: row.project_key,
        taskKey: row.task_key,
        title: row.title,
        description: row.description,
        status: row.status,
        version: Number(row.version),
        assigneeId: row.assignee_id,
        assignee: { id: row.assignee_id, githubUsername: row.assignee_github_username },
        dueDate: row.due_date,
        branchName: row.branch_name,
        acceptanceCriteria: jsonValue<TaskDetailSnapshot["task"]["acceptanceCriteria"]>(row.acceptance_criteria),
      },
      attachedCommits,
      progressUpdates,
      reviewFeedback,
    };
  }
}
