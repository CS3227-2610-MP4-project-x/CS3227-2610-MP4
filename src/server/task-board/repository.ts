import "server-only";

import type { TASK_STATE_NAMES } from "@/server/tasks";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

export type StoredTaskStatus = keyof typeof TASK_STATE_NAMES;

/** One non-deleted task as the board read stores it (design.md B6, B7). */
export type BoardTaskRecord = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  status: StoredTaskStatus;
  version: number;
  assignee: Readonly<{ id: string; githubUsername: string }>;
  dueDate: string;
}>;

export type DashboardTaskRecord = BoardTaskRecord & Readonly<{
  description: string;
  branchName: string | null;
  progressUpdateCount: number;
  attachedCommitCount: number;
}>;

type BoardRow = Record<string, unknown> & {
  id: string;
  task_key: string;
  title: string;
  status: StoredTaskStatus;
  version: unknown;
  assignee_id: string;
  assignee_github_username: string;
  due_date: string;
};

type DashboardTaskRow = BoardRow & {
  description: string;
  branch_name: string | null;
  progress_update_count: unknown;
  attached_commit_count: unknown;
};

// Shared projection for both board reads. Each read adds its own fixed filter; no caller text
// reaches the SQL (parameterised values only).
const BOARD_SELECT = `SELECT t.id::text AS id,
              p.key || '-' || t.number::text AS task_key,
              t.title,
              t.status,
              t.version,
              t.assignee_id::text AS assignee_id,
              assignee.github_username AS assignee_github_username,
              t.due_date::text AS due_date
         FROM app.tasks t
         JOIN app.projects p ON p.id = t.project_id
         JOIN app.people assignee ON assignee.id = t.assignee_id
        WHERE t.project_id = $1::uuid
          AND t.deleted_at IS NULL`;

// design.md B7: task number ascending, then task id.
const BOARD_ORDER = "ORDER BY t.number ASC, t.id ASC";

function boardRecord(row: BoardRow): BoardTaskRecord {
  return {
    id: row.id,
    taskKey: row.task_key,
    title: row.title,
    status: row.status,
    version: Number(row.version),
    assignee: { id: row.assignee_id, githubUsername: row.assignee_github_username },
    dueDate: row.due_date,
  };
}

function dashboardTaskRecord(row: DashboardTaskRow): DashboardTaskRecord {
  return {
    ...boardRecord(row),
    description: row.description,
    branchName: row.branch_name,
    progressUpdateCount: Number(row.progress_update_count),
    attachedCommitCount: Number(row.attached_commit_count),
  };
}

/** Read-only board queries over non-deleted tasks (task-management "Project members read the task board"). */
export class TaskBoardRepository {
  constructor(private readonly database: Query) {}

  /** Every non-deleted task in the project (the product manager's board). */
  async listProjectTasks(projectId: string): Promise<readonly BoardTaskRecord[]> {
    const result = await this.database.query<BoardRow>(`${BOARD_SELECT}\n        ${BOARD_ORDER}`, [projectId]);
    return result.rows.map(boardRecord);
  }

  /** The non-deleted tasks in the project assigned to one person (a developer's board). */
  async listAssignedTasks(projectId: string, assigneeId: string): Promise<readonly BoardTaskRecord[]> {
    const result = await this.database.query<BoardRow>(
      `${BOARD_SELECT}\n          AND t.assignee_id = $2::uuid\n        ${BOARD_ORDER}`,
      [projectId, assigneeId],
    );
    return result.rows.map(boardRecord);
  }

  /** Own live-task dashboard rows and independent activity counts, ordered like the board. */
  async listAssignedDashboardTasks(projectId: string, assigneeId: string): Promise<readonly DashboardTaskRecord[]> {
    const result = await this.database.query<DashboardTaskRow>(
      `SELECT t.id::text AS id,
              p.key || '-' || t.number::text AS task_key,
              t.title,
              t.description,
              t.status,
              t.version,
              t.assignee_id::text AS assignee_id,
              assignee.github_username AS assignee_github_username,
              t.due_date::text AS due_date,
              t.branch_name,
              (SELECT count(*)::int FROM app.progress_updates pu WHERE pu.task_id = t.id) AS progress_update_count,
              (SELECT count(*)::int FROM app.attached_commits ac WHERE ac.task_id = t.id) AS attached_commit_count
         FROM app.tasks t
         JOIN app.projects p ON p.id = t.project_id
         JOIN app.people assignee ON assignee.id = t.assignee_id
        WHERE t.project_id = $1::uuid
          AND t.assignee_id = $2::uuid
          AND t.deleted_at IS NULL
        ${BOARD_ORDER}`,
      [projectId, assigneeId],
    );
    return result.rows.map(dashboardTaskRecord);
  }
}
