import "server-only";
import type { DashboardMember, DashboardState, DashboardStateCounts, ProjectDashboardSnapshot } from "./types";

type QueryResult<T extends Record<string, unknown>> = Readonly<{ rows: T[]; rowCount: number | null }>;
type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}>;
type Connection = Query & Readonly<{ release(): void }>;
type Database = Query & Readonly<{ connect(): Promise<Connection> }>;

const EMPTY_COUNTS: DashboardStateCounts = { to_do: 0, in_progress: 0, in_review: 0, done: 0 };
const COUNT_COLUMNS = `count(*) FILTER (WHERE t.status = 'to_do')::int AS to_do,
                       count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                       count(*) FILTER (WHERE t.status = 'in_review')::int AS in_review,
                       count(*) FILTER (WHERE t.status = 'done')::int AS done`;
type CountRow = Record<string, unknown> & Record<DashboardState, unknown>;
type MemberRow = CountRow & { person_id: string; github_username: string; role: DashboardMember["role"] };

function stateCounts(row?: CountRow): DashboardStateCounts {
  return row ? {
    to_do: Number(row.to_do), in_progress: Number(row.in_progress),
    in_review: Number(row.in_review), done: Number(row.done),
  } : EMPTY_COUNTS;
}

/** Read-only dashboard aggregates. All component queries share one repeatable-read snapshot. */
export class ProjectDashboardRepository {
  constructor(private readonly database: Database) {}

  async readSnapshot(projectId: string): Promise<ProjectDashboardSnapshot> {
    const connection = await this.database.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const projectCounts = await connection.query<CountRow>(
          `SELECT ${COUNT_COLUMNS} FROM app.tasks t
            WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL`, [projectId]);
        const memberCountResult = await connection.query<{ member_count: unknown }>(
          `SELECT count(*)::int AS member_count FROM app.memberships WHERE project_id = $1::uuid`, [projectId]);
        const membersResult = await connection.query<MemberRow>(
          `SELECT m.person_id::text AS person_id, pe.github_username, m.role,
                  count(t.id) FILTER (WHERE t.status = 'to_do')::int AS to_do,
                  count(t.id) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                  count(t.id) FILTER (WHERE t.status = 'in_review')::int AS in_review,
                  count(t.id) FILTER (WHERE t.status = 'done')::int AS done
             FROM app.memberships m
             JOIN app.people pe ON pe.id = m.person_id
             LEFT JOIN app.tasks t ON t.project_id = m.project_id AND t.assignee_id = m.person_id AND t.deleted_at IS NULL
            WHERE m.project_id = $1::uuid
            GROUP BY m.person_id, pe.github_username, m.role
            ORDER BY lower(pe.github_username), m.person_id`, [projectId]);
        const completedResult = await connection.query<{ completed_today: unknown }>(
          `SELECT count(DISTINCT e.task_id)::int AS completed_today
             FROM app.task_events e
             JOIN app.tasks t ON t.id = e.task_id
            WHERE t.project_id = $1::uuid AND t.deleted_at IS NULL
              AND e.event_type = 'state_change' AND e.to_status = 'done'
              AND e.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore'
              AND e.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') + interval '1 day') AT TIME ZONE 'Asia/Singapore'`, [projectId]);
        const members: DashboardMember[] = membersResult.rows.map(row => ({
          personId: String(row.person_id), githubUsername: String(row.github_username), role: row.role,
          stateCounts: stateCounts(row),
        }));
        const result = {
          stateCounts: stateCounts(projectCounts.rows[0]),
          memberCount: Number(memberCountResult.rows[0]?.member_count ?? 0),
          completedToday: Number(completedResult.rows[0]?.completed_today ?? 0),
          members,
        };
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}
