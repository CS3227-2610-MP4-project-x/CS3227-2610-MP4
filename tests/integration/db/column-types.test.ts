/**
 * Design D-M / D-F (AC15): statuses and outcomes are text + CHECK, never PostgreSQL enums;
 * task states are To Do / In Progress / In Review / Done; task_events is one table that
 * covers state changes, submissions, assignment changes, and review feedback.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  SCHEMA,
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  createProjectWithTeam,
  createTask,
  insertTaskChild,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

async function dataType(client: pg.Client, table: string, column: string): Promise<string | undefined> {
  const { rows } = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [SCHEMA, table, column],
  );
  return rows[0]?.data_type;
}

dbDescribe("text + CHECK statuses and a single task_events table (AC15)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("defines no enum types in schema app and no app column uses an enum", async () => {
    const enums = await db().admin.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typtype = 'e'`,
      [SCHEMA],
    );
    expect(enums.rows).toEqual([]);

    const enumColumns = await db().admin.query(
      `SELECT c.relname AS table_name, a.attname AS column_name
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND t.typtype = 'e'`,
      [SCHEMA],
    );
    expect(enumColumns.rows).toEqual([]);
  });

  it.each([
    [ENTITY_TABLES.tasks, "status"],
    [ENTITY_TABLES.memberships, "role"],
    [ENTITY_TABLES.taskEvents, "event_type"],
    [ENTITY_TABLES.usageRecords, "outcome"],
  ])("stores %s.%s as text", async (table, column) => {
    expect(await dataType(db().admin, table, column)).toBe("text");
  });

  it.each(TASK_STATUSES.map((status) => [status]))("accepts task status %s", async (status) => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, status });
    const { rows } = await runtime.query(`SELECT status FROM ${SCHEMA}.${ENTITY_TABLES.tasks} WHERE id = $1`, [task.id]);
    expect(rows[0].status).toBe(status);
  });

  it("rejects a task status outside To Do / In Progress / In Review / Done", async () => {
    const team = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(
      createTask(runtime, {
        projectId: team.projectId,
        assigneeId: team.developerId,
        status: "blocked" as (typeof TASK_STATUSES)[number],
      }),
    );
  });

  it.each(TASK_EVENT_TYPES.map((type) => [type]))("records a %s event in task_events", async (eventType) => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const overrides: Record<string, unknown> = { event_type: eventType };
    if (eventType === "review_feedback") {
      // D-F: feedback text is part of the request-changes event.
      overrides.feedback = "Synthetic review feedback";
    }
    const row = await insertTaskChild(
      runtime,
      ENTITY_TABLES.taskEvents,
      { taskId: task.id, projectId: team.projectId, actorId: team.productManagerId },
      overrides,
    );
    expect(row.event_type).toBe(eventType);
  });

  it("rejects an unknown task event type", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    await expectIntegrityRejection(
      insertTaskChild(
        runtime,
        ENTITY_TABLES.taskEvents,
        { taskId: task.id, projectId: team.projectId, actorId: team.developerId },
        { event_type: "comment" },
      ),
    );
  });

  it("has no separate table per event kind (feedback, submissions, assignments)", async () => {
    const { rows } = await db().admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name ~ '(feedback|submission|assignment|state_change)'`,
      [SCHEMA],
    );
    expect(rows).toEqual([]);
  });
});
