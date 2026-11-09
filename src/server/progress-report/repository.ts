import "server-only";
import type { ReportActivity, ReportRange, ReportReadSession, ReportRepository, ReportSnapshot } from "./types";

type QueryResult<T extends Record<string, unknown>> = Readonly<{ rows: T[]; rowCount: number | null }>;
type Query = Readonly<{ query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> }>;
type Connection = Query & Readonly<{ release(): void }>;
export type ReportQueryPool = Readonly<{ connect(): Promise<Connection> }>;
function dateText(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function instant(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function asObject(value: unknown): Record<string, unknown> { const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value; return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
function isCheckStatus(value: unknown): value is "addressed" | "not_addressed" | "unclear" { return value === "addressed" || value === "not_addressed" || value === "unclear"; }
function checkResultProjection(value: unknown): { anchorSha: string; criteria: { criterionId: string; status: "addressed" | "not_addressed" | "unclear" }[]; possibleGaps: string[]; omittedFiles: string[] } {
  const result = asObject(value);
  if (typeof result.anchorSha !== "string" || !Array.isArray(result.criteria) || !Array.isArray(result.possibleGaps) || !Array.isArray(result.omittedFiles)) throw new Error("Invalid persisted check result.");
  const criteria = result.criteria.map((entry) => {
    const criterion = asObject(entry);
    if (typeof criterion.criterionId !== "string" || !isCheckStatus(criterion.status)) throw new Error("Invalid persisted check criterion.");
    return { criterionId: criterion.criterionId, status: criterion.status };
  });
  const possibleGaps = result.possibleGaps.map((gap) => { if (typeof gap !== "string") throw new Error("Invalid persisted check gap."); return gap; });
  const omittedFiles = result.omittedFiles.map((file) => { if (typeof file !== "string") throw new Error("Invalid persisted omitted file."); return file; });
  return { anchorSha: result.anchorSha, criteria, possibleGaps, omittedFiles };
}

export function createProgressReportRepository(pool: ReportQueryPool): ReportRepository {
  return {
    async withReadSnapshot<T>(read: (session: ReportReadSession) => Promise<T>): Promise<T> {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          const session: ReportReadSession = {
            async readAccess({ projectId, personId }) {
              const result = await connection.query<{ role: string }>(
                `SELECT m.role FROM app.projects p JOIN app.memberships m ON m.project_id = p.id
                  WHERE p.id = $1::uuid AND m.person_id = $2::uuid`, [projectId, personId]);
              const role = result.rows[0]?.role;
              return role === "product_manager" || role === "developer" ? role : "not_found";
            },
            async readCurrentSgtDate() {
              const result = await connection.query<{ today: string }>(`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') AS today`);
              return result.rows[0].today;
            },
            async readInputs({ projectId, range }): Promise<ReportSnapshot> {
              const taskRows = await connection.query<Record<string, unknown>>(
                `SELECT t.id::text AS task_id, p.key || '-' || t.number::text AS task_key, t.title,
                        t.status, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, m.person_id::text AS person_id, pe.github_username,
                        (SELECT count(*)::int FROM app.task_events e WHERE e.task_id = t.id
                           AND e.event_type = 'review_feedback' AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz) AS request_changes_count
                   FROM app.tasks t JOIN app.projects p ON p.id = t.project_id
                   JOIN app.memberships m ON m.project_id = t.project_id AND m.person_id = t.assignee_id
                   JOIN app.people pe ON pe.id = m.person_id
                  WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL
                  ORDER BY lower(pe.github_username), m.person_id, t.number, t.id`, [projectId, range.startUtc, range.endUtcExclusive]);
              const taskValues = [projectId, range.startUtc, range.endUtcExclusive];
              const activityRows = await connection.query<Record<string, unknown>>(
                `SELECT t.id::text AS task_id, p.key || '-' || t.number::text AS task_key, e.event_type AS type, e.id::text AS source_id,
                        e.created_at AS occurred_at, e.actor_id::text AS actor_id, actor.github_username,
                        e.from_status, e.to_status, e.previous_assignee_id::text AS from_assignee_id,
                        e.new_assignee_id::text AS to_assignee_id, e.feedback, e.check_result_id::text AS check_result_id
                   FROM app.task_events e JOIN app.tasks t ON t.id = e.task_id JOIN app.projects p ON p.id = t.project_id
                   LEFT JOIN app.people actor ON actor.id = e.actor_id
                  WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz
                 UNION ALL
                 SELECT t.id::text, p.key || '-' || t.number::text, 'progress_update', u.id::text, u.created_at,
                        u.author_id::text, actor.github_username, NULL::text, NULL::text, NULL::text, NULL::text, u.body, NULL::text
                   FROM app.progress_updates u JOIN app.tasks t ON t.id = u.task_id JOIN app.projects p ON p.id = t.project_id
                   JOIN app.people actor ON actor.id = u.author_id
                  WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL AND u.created_at >= $2::timestamptz AND u.created_at < $3::timestamptz
                  ORDER BY occurred_at, type, source_id, task_id`, taskValues);
              const checkRows = await connection.query<Record<string, unknown>>(
                `SELECT t.id::text AS task_id, p.key || '-' || t.number::text AS task_key, c.id::text AS result_id, c.created_at,
                        c.model, c.redacted, c.result
                   FROM app.check_results c JOIN app.tasks t ON t.id = c.task_id JOIN app.projects p ON p.id = t.project_id
                  WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL AND c.created_at >= $2::timestamptz AND c.created_at < $3::timestamptz
                  ORDER BY c.created_at, c.id`, taskValues);
              const attachedRows = await connection.query<Record<string, unknown>>(
                `SELECT t.id::text AS task_id, p.key || '-' || t.number::text AS task_key, a.commit_sha, a.created_at
                   FROM app.attached_commits a JOIN app.tasks t ON t.id = a.task_id JOIN app.projects p ON p.id = t.project_id
                  WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL
                  ORDER BY t.id, a.commit_sha`, [projectId]);
              const repoRows = await connection.query<Record<string, unknown>>(
                `SELECT github_repository_id, github_installation_id, github_repository_owner, github_repository_name FROM app.projects WHERE id = $1::uuid`, [projectId]);
              const activity: ReportActivity[] = activityRows.rows.map((row) => {
                const base = { taskId: String(row.task_id), taskKey: String(row.task_key), sourceId: String(row.source_id), occurredAt: instant(row.occurred_at), actor: row.actor_id ? { personId: String(row.actor_id), githubUsername: String(row.github_username) } : null };
                const transition = { fromStatus: row.from_status === null ? null : String(row.from_status), toStatus: row.to_status === null ? null : String(row.to_status) };
                switch (row.type) {
                  case "state_change": return { ...base, type: row.type, payload: transition };
                  case "submission": return { ...base, type: row.type, payload: { ...transition, ...(row.check_result_id ? { checkResultId: String(row.check_result_id) } : {}) } };
                  case "assignment_change": return { ...base, type: row.type, payload: { fromAssigneeId: row.from_assignee_id === null ? null : String(row.from_assignee_id), toAssigneeId: row.to_assignee_id === null ? null : String(row.to_assignee_id) } };
                  case "review_feedback": return { ...base, type: row.type, payload: { ...transition, feedback: String(row.feedback) } };
                  case "progress_update": return { ...base, type: row.type, payload: { body: String(row.feedback) } };
                  default: throw new Error("Unexpected report activity type.");
                }
              });
              for (const row of checkRows.rows) {
                const result = checkResultProjection(row.result);
                const criteria = result.criteria.map((item) => ({ criterionId: item.criterionId, status: item.status }));
                const gaps = result.possibleGaps.length;
                const omissions = result.omittedFiles.length;
                activity.push({ taskId: String(row.task_id), taskKey: String(row.task_key), type: "criteria_check", sourceId: String(row.result_id), occurredAt: instant(row.created_at), actor: null,
                  payload: { resultId: String(row.result_id), createdAt: instant(row.created_at), model: String(row.model), anchorSha: result.anchorSha, redacted: Boolean(row.redacted), criteria, gapCount: gaps, omissionCount: omissions } });
              }
              const repo = repoRows.rows[0];
              const repository = repo && repo.github_repository_id !== null && repo.github_installation_id !== null && repo.github_repository_owner && repo.github_repository_name
                ? { repositoryId: Number(repo.github_repository_id), installationId: Number(repo.github_installation_id), owner: String(repo.github_repository_owner), name: String(repo.github_repository_name) } : null;
              return {
                projectId,
                repository,
                tasks: taskRows.rows.map((row) => ({ taskId: String(row.task_id), taskKey: String(row.task_key), title: String(row.title), currentAssignee: { personId: String(row.person_id), githubUsername: String(row.github_username) }, status: String(row.status) as ReportSnapshot["tasks"][number]["status"], dueDate: dateText(row.due_date), requestChangesCount: Number(row.request_changes_count) })),
                activity,
                attachedCommits: attachedRows.rows.map((row) => ({ taskId: String(row.task_id), taskKey: String(row.task_key), sha: String(row.commit_sha), attachedAt: instant(row.created_at) })),
              };
            },
          };
          const result = await read(session);
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      } finally { connection.release(); }
    },
  };
}
