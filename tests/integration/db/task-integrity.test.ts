/**
 * Requirement "Task data stays inside its project" (D-E).
 * AC8: Assignee outside the project. AC9: Orphan record / records stay in their task's
 * project. AC10: Deleted task keeps its history.
 *
 * Mechanisms (trigger, composite foreign key, ...) are the implementer's choice; only the
 * observable accept/reject behaviour is tested.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  SCHEMA,
  TASK_CHILD_TABLES,
  addMembership,
  createPerson,
  createProjectWithTeam,
  createTask,
  hasProjectColumn,
  insertCheckResult,
  insertTaskChild,
  syntheticHash,
  MEMBERSHIP_ROLE,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const MISSING_TASK_ID = "00000000-0000-4000-8000-0000000000aa";

dbDescribe("assignee must be a developer in the task's project (AC8)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("accepts a task assigned to a developer member of its project", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    expect(task.id).toBeTruthy();
  });

  it("rejects a task assigned to a person with no membership", async () => {
    const team = await createProjectWithTeam(runtime);
    const outsider = await createPerson(runtime);
    await expectIntegrityRejection(createTask(runtime, { projectId: team.projectId, assigneeId: outsider }));
  });

  it("rejects a task assigned to the project's product manager", async () => {
    const team = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(createTask(runtime, { projectId: team.projectId, assigneeId: team.productManagerId }));
  });

  it("rejects a task assigned to a developer of a different project", async () => {
    const team = await createProjectWithTeam(runtime);
    const otherTeam = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(createTask(runtime, { projectId: team.projectId, assigneeId: otherTeam.developerId }));
  });

  it("rejects reassigning an existing task to a person who is not a developer in its project", async () => {
    const team = await createProjectWithTeam(runtime);
    const otherTeam = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });

    for (const assignee of [otherTeam.developerId, team.productManagerId]) {
      await expectIntegrityRejection(
        runtime.query(`UPDATE ${TASKS} SET assignee_id = $2, version = version + 1 WHERE id = $1`, [task.id, assignee]),
      );
    }
    const { rows } = await runtime.query(`SELECT assignee_id FROM ${TASKS} WHERE id = $1`, [task.id]);
    expect(rows[0].assignee_id).toBe(team.developerId);
  });

  it("accepts reassigning a task to another developer in its project", async () => {
    const team = await createProjectWithTeam(runtime);
    const secondDeveloper = await createPerson(runtime);
    await addMembership(runtime, team.projectId, secondDeveloper, MEMBERSHIP_ROLE.developer);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });

    const result = await runtime.query(`UPDATE ${TASKS} SET assignee_id = $2, version = version + 1 WHERE id = $1`, [
      task.id,
      secondDeveloper,
    ]);
    expect(result.rowCount).toBe(1);
  });
});

dbDescribe("task records belong to exactly one existing task in the same project (AC9)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  for (const table of TASK_CHILD_TABLES) {
    it(`${table}: accepts a record for an existing task (control)`, async () => {
      const team = await createProjectWithTeam(runtime);
      const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
      const row = await insertTaskChild(runtime, table, {
        taskId: task.id,
        projectId: team.projectId,
        actorId: team.developerId,
      });
      expect(row.task_id).toBe(task.id);
    });

    it(`${table}: rejects a record whose task does not exist (orphan)`, async () => {
      const team = await createProjectWithTeam(runtime);
      await expectIntegrityRejection(
        insertTaskChild(runtime, table, { taskId: MISSING_TASK_ID, projectId: team.projectId, actorId: team.developerId }),
      );
    });

    it(`${table}: rejects a record without a task`, async () => {
      const team = await createProjectWithTeam(runtime);
      await expectIntegrityRejection(
        insertTaskChild(
          runtime,
          table,
          { taskId: MISSING_TASK_ID, projectId: team.projectId, actorId: team.developerId },
          { task_id: null },
        ),
      );
    });

    it(`${table}: cannot belong to a project different from its task's`, async () => {
      const team = await createProjectWithTeam(runtime);
      const otherTeam = await createProjectWithTeam(runtime);
      const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });

      if (await hasProjectColumn(runtime, table)) {
        // The table stores its own project_id: a mismatch with the task's project must be refused.
        await expectIntegrityRejection(
          insertTaskChild(runtime, table, { taskId: task.id, projectId: otherTeam.projectId, actorId: team.developerId }),
        );
      } else {
        // No project_id column: the project can only be derived through the task.
        const row = await insertTaskChild(runtime, table, {
          taskId: task.id,
          projectId: team.projectId,
          actorId: team.developerId,
        });
        const { rows } = await runtime.query<{ project_id: string }>(
          `SELECT t.project_id FROM ${SCHEMA}."${table}" c JOIN ${TASKS} t ON t.id = c.task_id WHERE c.id = $1`,
          [row.id],
        );
        expect(rows).toEqual([{ project_id: team.projectId }]);
      }
    });
  }
});

dbDescribe("deleted task keeps its history (AC10, D-E)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("has a nullable timestamptz deleted_at column on tasks, unset for a new task", async () => {
    const { rows } = await db().admin.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = 'deleted_at'`,
      [SCHEMA, ENTITY_TABLES.tasks],
    );
    expect(rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);

    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const stored = await runtime.query(`SELECT deleted_at FROM ${TASKS} WHERE id = $1`, [task.id]);
    expect(stored.rows[0].deleted_at).toBeNull();
  });

  it("keeps the task, its progress updates and its check results after a soft delete", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const context = { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
    const update = await insertTaskChild(runtime, ENTITY_TABLES.progressUpdates, context);
    const check = await insertCheckResult(runtime, context, {
      commitSetHash: syntheticHash(),
      criteriaHash: syntheticHash(),
    });

    const deletion = await runtime.query(
      `UPDATE ${TASKS} SET deleted_at = now(), version = version + 1 WHERE id = $1 AND deleted_at IS NULL`,
      [task.id],
    );
    expect(deletion.rowCount).toBe(1);

    const stored = await runtime.query(`SELECT deleted_at FROM ${TASKS} WHERE id = $1`, [task.id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].deleted_at).toBeInstanceOf(Date);

    const updates = await runtime.query(`SELECT id FROM ${SCHEMA}.${ENTITY_TABLES.progressUpdates} WHERE task_id = $1`, [
      task.id,
    ]);
    expect(updates.rows).toEqual([{ id: update.id }]);

    const checks = await runtime.query(`SELECT id FROM ${SCHEMA}.${ENTITY_TABLES.checkResults} WHERE task_id = $1`, [
      task.id,
    ]);
    expect(checks.rows).toEqual([{ id: check.id }]);
  });
});
