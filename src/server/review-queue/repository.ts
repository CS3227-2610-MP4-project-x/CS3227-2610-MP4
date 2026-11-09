import "server-only";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

type Person = Readonly<{ id: string; githubUsername: string }>;

export type ReviewAttachedCommit = Readonly<{ id: string; sha: string; attachedBy: Person; attachedAt: string }>;

/** One non-deleted In Review task as the review read stores it (design.md B5, B6, B7). */
export type ReviewTaskRecord = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  version: number;
  assignee: Person;
  dueDate: string;
  attachedCommits: readonly ReviewAttachedCommit[];
  /** The `check_result_id` of the task's most recent `submission` event, if any (B5). */
  submissionCheckResultId: string | null;
}>;

type ReviewRow = Record<string, unknown> & {
  id: string;
  task_key: string;
  title: string;
  version: unknown;
  assignee_id: string;
  assignee_github_username: string;
  due_date: string;
  attached_commits: unknown;
  submission_check_result_id: string | null;
};

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

/**
 * Read-only review-queue query. It reads tasks, attached commits and submission events only; check
 * results are read through the public completion-assessment history seam (design.md B6, A1).
 */
export class ReviewQueueRepository {
  constructor(private readonly database: Query) {}

  async listInReviewTasks(projectId: string): Promise<readonly ReviewTaskRecord[]> {
    const result = await this.database.query<ReviewRow>(
      `SELECT t.id::text AS id,
              p.key || '-' || t.number::text AS task_key,
              t.title,
              t.version,
              t.assignee_id::text AS assignee_id,
              assignee.github_username AS assignee_github_username,
              t.due_date::text AS due_date,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', c.id::text, 'sha', c.commit_sha,
                  'attachedBy', jsonb_build_object('id', author.id::text, 'githubUsername', author.github_username),
                  'attachedAt', c.created_at
                ) ORDER BY c.created_at ASC, c.id ASC)
                FROM app.attached_commits c
                JOIN app.people author ON author.id = c.attached_by
                WHERE c.task_id = t.id
              ), '[]'::jsonb) AS attached_commits,
              (
                SELECT e.check_result_id::text
                  FROM app.task_events e
                 WHERE e.task_id = t.id AND e.event_type = 'submission'
                 ORDER BY e.created_at DESC, e.id DESC
                 LIMIT 1
              ) AS submission_check_result_id
         FROM app.tasks t
         JOIN app.projects p ON p.id = t.project_id
         JOIN app.people assignee ON assignee.id = t.assignee_id
        WHERE t.project_id = $1::uuid
          AND t.status = 'in_review'
          AND t.deleted_at IS NULL
        ORDER BY t.number ASC, t.id ASC`,
      [projectId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      taskKey: row.task_key,
      title: row.title,
      version: Number(row.version),
      assignee: { id: row.assignee_id, githubUsername: row.assignee_github_username },
      dueDate: row.due_date,
      attachedCommits: jsonValue<ReviewAttachedCommit[]>(row.attached_commits).map((item) => ({
        id: item.id,
        sha: item.sha,
        attachedBy: { id: item.attachedBy.id, githubUsername: item.attachedBy.githubUsername },
        attachedAt: timestamp(item.attachedAt),
      })),
      submissionCheckResultId: row.submission_check_result_id ?? null,
    }));
  }
}
