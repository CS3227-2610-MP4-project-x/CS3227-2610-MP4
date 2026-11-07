import "server-only";

import { TaskError } from "./errors";
import type { CreateTaskInput, CriterionView, EditTaskInput, ProjectRole, StoredTaskState } from "./types";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;
type Connection = Query & Readonly<{ release(): void }>;
type Database = Query & Readonly<{ connect(): Promise<Connection> }>;

/** A stored task with its project key and assignee username (design.md T3). */
export type TaskRecord = Readonly<{
  id: string;
  projectKey: string;
  number: number;
  title: string;
  description: string;
  assigneeId: string;
  assigneeGitHubUsername: string;
  dueDate: string;
  branchName: string | null;
  status: StoredTaskState;
  version: number;
  createdAt: string;
  updatedAt: string;
  criteria: readonly CriterionView[];
}>;

/** The locked fields of a live task that a write checks (design.md T6, T9). */
export type LockedTask = Readonly<{ assigneeId: string; version: number }>;

/** The editable task columns, in a fixed order (design.md T4). Column names are never user input. */
const EDITABLE_COLUMNS = [
  ["title", "title", ""],
  ["description", "description", ""],
  ["dueDate", "due_date", "::date"],
  ["branchName", "branch_name", ""],
] as const satisfies readonly (readonly [keyof EditTaskInput, string, string])[];

// The database's task-assignee trigger (migration 20261030144500) fails with this SQLSTATE and
// constraint when the assignee is not a developer in the task's project (design.md T7).
const FOREIGN_KEY_VIOLATION = "23503";
const ASSIGNEE_TRIGGER = "tasks_assignee_is_project_developer";

function rethrowAssigneeViolation(error: unknown): never {
  if (typeof error === "object" && error !== null) {
    const databaseError = error as { code?: unknown; constraint?: unknown };
    if (databaseError.code === FOREIGN_KEY_VIOLATION && databaseError.constraint === ASSIGNEE_TRIGGER) {
      throw new TaskError("ASSIGNEE_NOT_DEVELOPER");
    }
  }
  throw error;
}

/** node-postgres returns timestamptz as Date; text drivers return strings. Always ISO 8601 UTC. */
function isoTimestamp(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

/** Reads one live task in the project and its ordered criteria, using the given connection. */
async function findTaskRecord(connection: Query, projectId: string, taskId: string): Promise<TaskRecord | null> {
  const result = await connection.query(
    `SELECT t.id::text AS id,
            p.key AS project_key,
            t.number,
            t.title,
            t.description,
            t.assignee_id::text AS assignee_id,
            a.github_username AS assignee_github_username,
            t.due_date::text AS due_date,
            t.branch_name,
            t.status,
            t.version,
            t.created_at,
            t.updated_at
       FROM app.tasks t
       JOIN app.projects p ON p.id = t.project_id
       JOIN app.people a ON a.id = t.assignee_id
      WHERE t.id = $1::uuid
        AND t.project_id = $2::uuid
        AND t.deleted_at IS NULL`,
    [taskId, projectId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const criteria = await connection.query(
    `SELECT id::text AS id, position, description
       FROM app.acceptance_criteria
      WHERE task_id = $1::uuid
      ORDER BY position, id`,
    [taskId],
  );
  return {
    id: String(row.id),
    projectKey: String(row.project_key),
    number: Number(row.number),
    title: String(row.title),
    description: String(row.description),
    assigneeId: String(row.assignee_id),
    assigneeGitHubUsername: String(row.assignee_github_username),
    dueDate: String(row.due_date),
    branchName: row.branch_name === null ? null : String(row.branch_name),
    status: row.status as StoredTaskState,
    version: Number(row.version),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    criteria: criteria.rows.map((criterion) => ({
      id: String(criterion.id),
      position: Number(criterion.position),
      description: String(criterion.description),
    })),
  };
}

/** Statements that run inside one TaskRepository transaction. */
export class TaskTransaction {
  constructor(private readonly connection: Query) {}

  /**
   * Share-locks the given people's memberships in the project, in person-ID order, and returns
   * their roles. The order matches the product manager transfer's `FOR UPDATE` lock, so a task
   * write and a transfer wait for each other instead of deadlocking (design.md D6).
   */
  async lockRoles(projectId: string, personIds: readonly string[]): Promise<ReadonlyMap<string, ProjectRole>> {
    const result = await this.connection.query<{ person_id: string; role: ProjectRole }>(
      `SELECT person_id::text AS person_id, role
         FROM app.memberships
        WHERE project_id = $1::uuid
          AND person_id = ANY($2::uuid[])
        ORDER BY person_id
          FOR SHARE`,
      [projectId, [...personIds]],
    );
    return new Map(result.rows.map((row) => [String(row.person_id).toLowerCase(), row.role]));
  }

  /** Increments the project's task counter and returns the new number (design.md T13, D-D). */
  async allocateTaskNumber(projectId: string): Promise<number> {
    const result = await this.connection.query<{ last_task_number: number }>(
      `UPDATE app.projects
          SET last_task_number = last_task_number + 1
        WHERE id = $1::uuid
      RETURNING last_task_number`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Project disappeared during task creation.");
    return Number(row.last_task_number);
  }

  async insertTask(projectId: string, number: number, input: CreateTaskInput): Promise<string> {
    try {
      const result = await this.connection.query<{ id: string }>(
        `INSERT INTO app.tasks (project_id, number, title, description, assignee_id, due_date, branch_name)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::date, $7)
         RETURNING id::text AS id`,
        [projectId, number, input.title, input.description, input.assigneeId, input.dueDate, input.branchName],
      );
      return String(result.rows[0].id);
    } catch (error) {
      rethrowAssigneeViolation(error);
    }
  }

  async insertCriterion(taskId: string, position: number, description: string): Promise<void> {
    await this.connection.query(
      `INSERT INTO app.acceptance_criteria (task_id, position, description)
       VALUES ($1::uuid, $2, $3)`,
      [taskId, position, description],
    );
  }

  /** Locks a live task of the project for update (design.md T6). */
  async lockTask(projectId: string, taskId: string): Promise<LockedTask | null> {
    const result = await this.connection.query<{ assignee_id: string; version: number }>(
      `SELECT assignee_id::text AS assignee_id, version
         FROM app.tasks
        WHERE id = $1::uuid
          AND project_id = $2::uuid
          AND deleted_at IS NULL
          FOR UPDATE`,
      [taskId, projectId],
    );
    const row = result.rows[0];
    return row ? { assigneeId: String(row.assignee_id), version: Number(row.version) } : null;
  }

  async listCriteria(taskId: string): Promise<readonly CriterionView[]> {
    const result = await this.connection.query(
      `SELECT id::text AS id, position, description
         FROM app.acceptance_criteria
        WHERE task_id = $1::uuid`,
      [taskId],
    );
    return result.rows.map((row) => ({ id: String(row.id), position: Number(row.position), description: String(row.description) }));
  }

  /**
   * Updates the sent fields under the version guard; with no field sent it still updates the
   * row, so the version trigger increases the version once (design.md T6). Returns false when
   * the version no longer matches.
   */
  async updateTaskFields(taskId: string, expectedVersion: number, input: EditTaskInput): Promise<boolean> {
    const values: unknown[] = [taskId, expectedVersion];
    const assignments = EDITABLE_COLUMNS.flatMap(([field, column, cast]) => {
      if (!(field in input)) return [];
      values.push(input[field]);
      return [`${column} = $${values.length}${cast}`];
    });
    const result = await this.connection.query(
      `UPDATE app.tasks
          SET ${assignments.length > 0 ? assignments.join(", ") : "title = title"}
        WHERE id = $1::uuid
          AND version = $2`,
      values,
    );
    return result.rowCount === 1;
  }

  async updateCriterion(taskId: string, criterion: CriterionView): Promise<void> {
    await this.connection.query(
      `UPDATE app.acceptance_criteria
          SET position = $3, description = $4
        WHERE id = $1::uuid
          AND task_id = $2::uuid`,
      [criterion.id, taskId, criterion.position, criterion.description],
    );
  }

  async deleteCriterion(taskId: string, criterionId: string): Promise<void> {
    await this.connection.query(
      `DELETE FROM app.acceptance_criteria
        WHERE id = $1::uuid
          AND task_id = $2::uuid`,
      [criterionId, taskId],
    );
  }

  /** Changes the assignee under the version guard; false when the version no longer matches. */
  async updateAssignee(taskId: string, expectedVersion: number, assigneeId: string): Promise<boolean> {
    try {
      const result = await this.connection.query(
        `UPDATE app.tasks
            SET assignee_id = $3::uuid
          WHERE id = $1::uuid
            AND version = $2`,
        [taskId, expectedVersion, assigneeId],
      );
      return result.rowCount === 1;
    } catch (error) {
      rethrowAssigneeViolation(error);
    }
  }

  /** Appends the reassignment to the task's history (design.md D-F, T9). */
  async insertAssignmentChange(taskId: string, actorPersonId: string, previousAssigneeId: string, newAssigneeId: string): Promise<void> {
    await this.connection.query(
      `INSERT INTO app.task_events (task_id, actor_id, event_type, previous_assignee_id, new_assignee_id)
       VALUES ($1::uuid, $2::uuid, 'assignment_change', $3::uuid, $4::uuid)`,
      [taskId, actorPersonId, previousAssigneeId, newAssigneeId],
    );
  }

  /** Soft delete (design.md D-E, T12): the row and its records stay. False on a version mismatch. */
  async markDeleted(taskId: string, expectedVersion: number): Promise<boolean> {
    const result = await this.connection.query(
      `UPDATE app.tasks
          SET deleted_at = now()
        WHERE id = $1::uuid
          AND version = $2
          AND deleted_at IS NULL`,
      [taskId, expectedVersion],
    );
    return result.rowCount === 1;
  }

  async findTask(projectId: string, taskId: string): Promise<TaskRecord | null> {
    return findTaskRecord(this.connection, projectId, taskId);
  }
}

export class TaskRepository {
  constructor(private readonly database: Database) {}

  /**
   * Reads a live task and its criteria from one snapshot: a read-only REPEATABLE READ
   * transaction, so a concurrent edit is seen either entirely or not at all.
   */
  async findTask(projectId: string, taskId: string): Promise<TaskRecord | null> {
    return this.run("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", (connection) => findTaskRecord(connection, projectId, taskId));
  }

  /** Runs `work` in one transaction on one connection; rolls back on any error. */
  async transaction<T>(work: (transaction: TaskTransaction) => Promise<T>): Promise<T> {
    return this.run("BEGIN", (connection) => work(new TaskTransaction(connection)));
  }

  private async run<T>(begin: string, work: (connection: Query) => Promise<T>): Promise<T> {
    const connection = await this.database.connect();
    try {
      await connection.query(begin);
      try {
        const result = await work(connection);
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
