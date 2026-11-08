import "server-only";

import { ProjectError, type ProjectErrorCode } from "./errors";
import type { ProjectRole } from "./types";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;
type Connection = Query & Readonly<{ release(): void }>;
type Database = Query & Readonly<{ connect(): Promise<Connection> }>;

type ProjectRecord = Readonly<{ id: string; key: string; name: string }>;

// design.md S6: unique violations are recognised by SQLSTATE and constraint name.
const UNIQUE_VIOLATION = "23505";

function rethrowUniqueViolation(error: unknown, constraint: string, code: ProjectErrorCode): never {
  if (typeof error === "object" && error !== null) {
    const databaseError = error as { code?: unknown; constraint?: unknown };
    if (databaseError.code === UNIQUE_VIOLATION && databaseError.constraint === constraint) {
      throw new ProjectError(code);
    }
  }
  throw error;
}

function projectRecord(row: Record<string, unknown>): ProjectRecord {
  return { id: String(row.id), key: String(row.key), name: String(row.name) };
}

/** Statements that run inside one ProjectRepository transaction. */
export class ProjectTransaction {
  constructor(private readonly connection: Query) {}

  async insertProject(key: string, name: string): Promise<ProjectRecord> {
    try {
      const result = await this.connection.query(
        `INSERT INTO app.projects (key, name)
         VALUES ($1, $2)
         RETURNING id::text AS id, key, name`,
        [key, name],
      );
      return projectRecord(result.rows[0]);
    } catch (error) {
      rethrowUniqueViolation(error, "projects_key_key", "PROJECT_KEY_TAKEN");
    }
  }

  async insertMembership(projectId: string, personId: string, role: ProjectRole): Promise<void> {
    try {
      await this.connection.query(
        `INSERT INTO app.memberships (project_id, person_id, role)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [projectId, personId, role],
      );
    } catch (error) {
      rethrowUniqueViolation(error, "memberships_project_person_key", "ALREADY_MEMBER");
    }
  }

  /** Share-locks one membership so a competing transfer waits for this transaction. */
  async findRoleForShare(projectId: string, personId: string): Promise<ProjectRole | null> {
    const result = await this.connection.query<{ role: ProjectRole }>(
      `SELECT role
         FROM app.memberships
        WHERE project_id = $1::uuid
          AND person_id = $2::uuid
          FOR SHARE`,
      [projectId, personId],
    );
    return result.rows[0]?.role ?? null;
  }

  /**
   * Locks only the named people's membership rows FOR UPDATE, in person order, and returns
   * their current roles (design.md D6). The lock conflicts with the assignee trigger's FOR SHARE.
   */
  async lockMemberships(projectId: string, personIds: readonly string[]): Promise<ReadonlyMap<string, ProjectRole>> {
    const result = await this.connection.query<{ person_id: string; role: ProjectRole }>(
      `SELECT id::text AS id, person_id::text AS person_id, role
         FROM app.memberships
        WHERE project_id = $1::uuid
          AND person_id = ANY($2::uuid[])
        ORDER BY person_id
          FOR UPDATE`,
      [projectId, [...personIds]],
    );
    return new Map(result.rows.map((row) => [String(row.person_id), row.role]));
  }

  /** Only non-deleted tasks that are not Done count as open (design.md D6, D-E). */
  async hasOpenAssignedTasks(projectId: string, personId: string): Promise<boolean> {
    const result = await this.connection.query<{ has_open_tasks: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM app.tasks
          WHERE project_id = $1::uuid
            AND assignee_id = $2::uuid
            AND status <> 'done'
            AND deleted_at IS NULL
       ) AS has_open_tasks`,
      [projectId, personId],
    );
    return result.rows[0]?.has_open_tasks === true;
  }

  async setRole(projectId: string, personId: string, role: ProjectRole): Promise<void> {
    const result = await this.connection.query(
      `UPDATE app.memberships
          SET role = $3
        WHERE project_id = $1::uuid
          AND person_id = $2::uuid`,
      [projectId, personId, role],
    );
    if (result.rowCount !== 1) throw new Error("Membership role change did not apply.");
  }

  async findProject(projectId: string): Promise<ProjectRecord | null> {
    const result = await this.connection.query(
      `SELECT id::text AS id, key, name
         FROM app.projects
        WHERE id = $1::uuid`,
      [projectId],
    );
    return result.rows[0] ? projectRecord(result.rows[0]) : null;
  }
}

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  async findProjectForMember(projectId: string, personId: string): Promise<(ProjectRecord & { role: ProjectRole }) | null> {
    const result = await this.database.query(
      `SELECT p.id::text AS id, p.key, p.name, m.role
         FROM app.projects p
         JOIN app.memberships m ON m.project_id = p.id
        WHERE p.id = $1::uuid
          AND m.person_id = $2::uuid`,
      [projectId, personId],
    );
    const row = result.rows[0];
    return row ? { ...projectRecord(row), role: row.role as ProjectRole } : null;
  }

  /** Every project the person is a member of, with their role, by name then id (design.md B3). */
  async listProjectsForMember(personId: string): Promise<readonly (ProjectRecord & { role: ProjectRole })[]> {
    const result = await this.database.query(
      `SELECT p.id::text AS id, p.key, p.name, m.role
         FROM app.projects p
         JOIN app.memberships m ON m.project_id = p.id
        WHERE m.person_id = $1::uuid
        ORDER BY p.name ASC, p.id ASC`,
      [personId],
    );
    return result.rows.map((row) => ({ ...projectRecord(row), role: row.role as ProjectRole }));
  }

  /** Runs `work` in one transaction on one connection; rolls back on any error (design.md S6). */
  async transaction<T>(work: (transaction: ProjectTransaction) => Promise<T>): Promise<T> {
    const connection = await this.database.connect();
    try {
      await connection.query("BEGIN");
      try {
        const result = await work(new ProjectTransaction(connection));
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
