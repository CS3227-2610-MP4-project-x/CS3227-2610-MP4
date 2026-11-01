/**
 * Requirement "Identifiers, timestamps, and revisions" (D-D).
 * AC3: UUID keys, timestamptz, integer versions; "Concurrent edits to a task".
 * AC4: "Concurrent task creation"; project-key CHECK and uniqueness; task numbers unique
 *      per project and never reused after soft delete.
 *
 * Version mechanism (implemented, reviewer test-adequacy gap): a BEFORE UPDATE trigger
 * bumps `version` by exactly 1 on every update. Callers only guard with
 * `WHERE version = $n` and never set `version` themselves; the stale-writer test proves
 * the trigger alone increments it.
 *
 * Immutability (D-D, reviewer test-adequacy gaps): a project key cannot change after
 * creation, a task's number and project cannot change, and the per-project task counter
 * never decreases.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  MUTABLE_TABLES,
  SCHEMA,
  addMembership,
  allocateTaskNumber,
  createProject,
  createProjectWithTeam,
  createTask,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;

dbDescribe("identifiers, timestamps, and revisions (AC3)", () => {
  const db = useMigratedDatabase();
  let writerA: pg.Client;
  let writerB: pg.Client;

  beforeAll(async () => {
    writerA = await db().connectAsRuntime();
    writerB = await db().connectAsRuntime();
  });

  it("identifies every app table's records by a single-column uuid primary key named id", async () => {
    const { rows } = await db().admin.query<{ table_name: string; pk_columns: string[] | null; id_type: string | null }>(
      `SELECT c.relname AS table_name,
              (SELECT array_agg(a.attname::text ORDER BY a.attnum)
                 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
                WHERE k.conrelid = c.oid AND k.contype = 'p') AS pk_columns,
              (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped) AS id_type
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`,
      [SCHEMA],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ table: row.table_name, pk: row.pk_columns, type: row.id_type }).toEqual({
        table: row.table_name,
        pk: ["id"],
        type: "uuid",
      });
    }
  });

  it("stores every timestamp as timestamptz (no timestamp without time zone)", async () => {
    const { rows } = await db().admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND data_type IN ('timestamp without time zone', 'time without time zone')`,
      [SCHEMA],
    );
    expect(rows).toEqual([]);
  });

  it("gives every mutable record an integer version", async () => {
    const { rows } = await db().admin.query<{ table_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND column_name = 'version' AND table_name = ANY($2)`,
      [SCHEMA, [...MUTABLE_TABLES]],
    );
    const byTable = new Map(rows.map((row) => [row.table_name, row]));
    for (const table of MUTABLE_TABLES) {
      const column = byTable.get(table);
      expect(column, `${table}.version is missing`).toBeDefined();
      expect(["integer", "bigint", "smallint"]).toContain(column?.data_type);
      expect(column?.is_nullable).toBe("NO");
    }
  });

  it("Concurrent edits to a task: of two writers with the same version, one succeeds and the other affects 0 rows", async () => {
    const team = await createProjectWithTeam(writerA);
    const task = await createTask(writerA, { projectId: team.projectId, assigneeId: team.developerId });
    const before = await writerA.query<{ version: number }>(`SELECT version FROM ${TASKS} WHERE id = $1`, [task.id]);
    const version = Number(before.rows[0].version);

    // The SET list deliberately leaves version alone: the trigger must bump it.
    const guardedUpdate = `UPDATE ${TASKS} SET title = $3 WHERE id = $1 AND version = $2`;

    await writerA.query("BEGIN");
    const first = await writerA.query(guardedUpdate, [task.id, version, "Title from writer A"]);
    // Writer B uses the same, now stale, version. It blocks on A's row lock, then
    // re-evaluates its WHERE clause against A's committed row.
    const secondPending = writerB.query(guardedUpdate, [task.id, version, "Title from writer B"]);
    await writerA.query("COMMIT");
    const second = await secondPending;

    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);

    const after = await writerA.query<{ title: string; version: number }>(
      `SELECT title, version FROM ${TASKS} WHERE id = $1`,
      [task.id],
    );
    expect(after.rows[0].title).toBe("Title from writer A");
    expect(Number(after.rows[0].version)).toBe(version + 1);
  });

  it("bumps the version by exactly 1 on every update without the caller setting it", async () => {
    const team = await createProjectWithTeam(writerA);
    const task = await createTask(writerA, { projectId: team.projectId, assigneeId: team.developerId });
    const read = async () =>
      Number((await writerA.query<{ version: number }>(`SELECT version FROM ${TASKS} WHERE id = $1`, [task.id])).rows[0].version);

    const start = await read();
    await writerA.query(`UPDATE ${TASKS} SET title = 'Synthetic retitle' WHERE id = $1`, [task.id]);
    expect(await read()).toBe(start + 1);
    await writerA.query(`UPDATE ${TASKS} SET status = 'in_progress' WHERE id = $1`, [task.id]);
    expect(await read()).toBe(start + 2);
  });
});

dbDescribe("project keys and task numbers (AC4)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it.each(["AB", "WEB", "A1", "X9Y8", "ABCDEFGHIJ"])("accepts the valid project key %s", async (key) => {
    const project = await createProject(runtime, { key });
    expect(project.key).toBe(key);
  });

  it.each([
    ["one character", "A"],
    ["eleven characters", "ABCDEFGHIJK"],
    ["leading digit", "1AB"],
    ["lowercase", "web"],
    ["mixed case", "Web"],
    ["hyphen", "WE-B"],
    ["space", "WE B"],
    ["underscore", "WE_B"],
    ["empty", ""],
  ])("rejects a project key with %s (%j)", async (_label, key) => {
    await expectIntegrityRejection(createProject(runtime, { key }));
  });

  it("rejects a duplicate project key", async () => {
    await createProject(runtime, { key: "DUPKEY" });
    await expectIntegrityRejection(createProject(runtime, { key: "DUPKEY" }));
  });

  it("Concurrent task creation: two tasks created at the same time in one project get different numbers", async () => {
    const team = await createProjectWithTeam(runtime);
    const clientA = await db().connectAsRuntime();
    const clientB = await db().connectAsRuntime();

    const createInTransaction = async (client: pg.Client) => {
      await client.query("BEGIN");
      try {
        const number = await allocateTaskNumber(client, team.projectId);
        const task = await createTask(client, { projectId: team.projectId, assigneeId: team.developerId, number });
        await client.query("COMMIT");
        return task.number;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };

    const [a, b] = await Promise.all([createInTransaction(clientA), createInTransaction(clientB)]);
    expect(a).not.toBe(b);
    expect([a, b].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it("rejects a second task with the same number in the same project", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    await expectIntegrityRejection(
      createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, number: task.number }),
    );
  });

  it("allows the same task number in different projects", async () => {
    const first = await createProjectWithTeam(runtime);
    const second = await createProjectWithTeam(runtime);
    const a = await createTask(runtime, { projectId: first.projectId, assigneeId: first.developerId });
    const b = await createTask(runtime, { projectId: second.projectId, assigneeId: second.developerId });
    expect(a.number).toBe(b.number);
  });

  it("never reuses the number of a soft-deleted task", async () => {
    const team = await createProjectWithTeam(runtime);
    const deleted = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    await runtime.query(`UPDATE ${TASKS} SET deleted_at = now(), version = version + 1 WHERE id = $1`, [deleted.id]);

    await expectIntegrityRejection(
      createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, number: deleted.number }),
    );

    const next = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    expect(next.number).toBeGreaterThan(deleted.number);
  });
});

dbDescribe("project keys, task numbers and task counters are fixed (D-D)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("rejects changing a project key after creation", async () => {
    const project = await createProject(runtime, { key: "FIXEDKEY" });
    await expectIntegrityRejection(runtime.query(`UPDATE ${PROJECTS} SET key = $2 WHERE id = $1`, [project.id, "NEWKEY"]));
    const { rows } = await runtime.query(`SELECT key FROM ${PROJECTS} WHERE id = $1`, [project.id]);
    expect(rows).toEqual([{ key: "FIXEDKEY" }]);
  });

  it("allows other project updates, including setting the key to its current value (control)", async () => {
    const project = await createProject(runtime);
    const result = await runtime.query(`UPDATE ${PROJECTS} SET name = $2, key = key WHERE id = $1`, [
      project.id,
      "Synthetic renamed project",
    ]);
    expect(result.rowCount).toBe(1);
  });

  it("rejects changing a task's number", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    await expectIntegrityRejection(
      runtime.query(`UPDATE ${TASKS} SET number = $2 WHERE id = $1`, [task.id, task.number + 100]),
    );
    const { rows } = await runtime.query(`SELECT number FROM ${TASKS} WHERE id = $1`, [task.id]);
    expect(Number(rows[0].number)).toBe(task.number);
  });

  it("rejects moving a task to another project, even one where the assignee is a developer", async () => {
    const team = await createProjectWithTeam(runtime);
    const otherProject = await createProject(runtime);
    await addMembership(runtime, otherProject.id, team.developerId, MEMBERSHIP_ROLE.developer);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });

    await expectIntegrityRejection(
      runtime.query(`UPDATE ${TASKS} SET project_id = $2 WHERE id = $1`, [task.id, otherProject.id]),
    );
    const { rows } = await runtime.query(`SELECT project_id FROM ${TASKS} WHERE id = $1`, [task.id]);
    expect(rows).toEqual([{ project_id: team.projectId }]);
  });

  it("lets the task counter increase but rejects decreasing it", async () => {
    const team = await createProjectWithTeam(runtime);
    expect(await allocateTaskNumber(runtime, team.projectId)).toBe(1);
    expect(await allocateTaskNumber(runtime, team.projectId)).toBe(2);

    await expectIntegrityRejection(
      runtime.query(`UPDATE ${PROJECTS} SET last_task_number = last_task_number - 1 WHERE id = $1`, [team.projectId]),
    );
    await expectIntegrityRejection(
      runtime.query(`UPDATE ${PROJECTS} SET last_task_number = 0 WHERE id = $1`, [team.projectId]),
    );
    const { rows } = await runtime.query(`SELECT last_task_number FROM ${PROJECTS} WHERE id = $1`, [team.projectId]);
    expect(Number(rows[0].last_task_number)).toBe(2);
  });
});
