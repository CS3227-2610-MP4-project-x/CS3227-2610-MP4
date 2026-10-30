/**
 * Task history is kept (D-E, D-F) — design.md "Task 2.4 review decisions":
 * - History is never hard-deleted: app_runtime has no DELETE on tasks.
 * - Task events are append-only: app_runtime has only SELECT and INSERT on task_events.
 * - Review feedback must contain non-blank text, and only review_feedback events carry it.
 * - A task event's check_result_id may only cite a check result of the same task
 *   (reviewer test-adequacy gap; requirement "Task data stays inside its project").
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  SCHEMA,
  TASK_EVENT_TYPES,
  createProjectWithTeam,
  createTask,
  insertCheckResult,
  insertTaskChild,
  syntheticHash,
  type ChildContext,
} from "./support/fixtures";
import {
  dbDescribe,
  expectIntegrityRejection,
  expectPrivilegeRejection,
  useMigratedDatabase,
} from "./support/harness";

const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const EVENTS = `${SCHEMA}.${ENTITY_TABLES.taskEvents}`;

dbDescribe("task history is never hard-deleted or rewritten by app_runtime", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  async function newTaskContext(): Promise<ChildContext> {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    return { taskId: task.id, projectId: team.projectId, actorId: team.productManagerId };
  }

  it("refuses DELETE on tasks with insufficient_privilege, even for a task with no records", async () => {
    const context = await newTaskContext();
    await expectPrivilegeRejection(runtime.query(`DELETE FROM ${TASKS} WHERE id = $1`, [context.taskId]));

    const { rows } = await db().admin.query(`SELECT id FROM ${TASKS} WHERE id = $1`, [context.taskId]);
    expect(rows).toEqual([{ id: context.taskId }]);
  });

  it("still lets app_runtime soft-delete a task through deleted_at (control)", async () => {
    const context = await newTaskContext();
    const result = await runtime.query(`UPDATE ${TASKS} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [
      context.taskId,
    ]);
    expect(result.rowCount).toBe(1);
  });

  it("lets app_runtime append and read task events (control)", async () => {
    const context = await newTaskContext();
    const event = await insertTaskChild(runtime, ENTITY_TABLES.taskEvents, context);
    const { rows } = await runtime.query(`SELECT id FROM ${EVENTS} WHERE id = $1`, [event.id]);
    expect(rows).toEqual([{ id: event.id }]);
  });

  it("refuses UPDATE on task_events with insufficient_privilege", async () => {
    const context = await newTaskContext();
    const event = await insertTaskChild(runtime, ENTITY_TABLES.taskEvents, context, {
      event_type: "review_feedback",
      feedback: "Synthetic original feedback",
    });

    await expectPrivilegeRejection(
      runtime.query(`UPDATE ${EVENTS} SET feedback = $2 WHERE id = $1`, [event.id, "Synthetic rewritten feedback"]),
    );
    await expectPrivilegeRejection(runtime.query(`UPDATE ${EVENTS} SET created_at = now() WHERE id = $1`, [event.id]));

    const { rows } = await db().admin.query(`SELECT feedback FROM ${EVENTS} WHERE id = $1`, [event.id]);
    expect(rows).toEqual([{ feedback: "Synthetic original feedback" }]);
  });

  it("refuses DELETE on task_events with insufficient_privilege", async () => {
    const context = await newTaskContext();
    const event = await insertTaskChild(runtime, ENTITY_TABLES.taskEvents, context);

    await expectPrivilegeRejection(runtime.query(`DELETE FROM ${EVENTS} WHERE id = $1`, [event.id]));

    const { rows } = await db().admin.query(`SELECT id FROM ${EVENTS} WHERE id = $1`, [event.id]);
    expect(rows).toEqual([{ id: event.id }]);
  });
});

dbDescribe("review feedback must contain non-blank text, on review_feedback events only", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let context: ChildContext;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    context = { taskId: task.id, projectId: team.projectId, actorId: team.productManagerId };
  });

  function insertEvent(overrides: Record<string, unknown>) {
    return insertTaskChild(runtime, ENTITY_TABLES.taskEvents, context, overrides);
  }

  it.each([["Synthetic: please add tests"], ["  Synthetic feedback with surrounding spaces  "]])(
    "accepts review_feedback with non-blank text %j (control)",
    async (feedback) => {
      const row = await insertEvent({ event_type: "review_feedback", feedback });
      expect(row.feedback).toBe(feedback);
    },
  );

  it("rejects review_feedback without feedback", async () => {
    await expectIntegrityRejection(insertEvent({ event_type: "review_feedback", feedback: null }));
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["tab and newlines", "\t\n\r\n"],
    ["mixed whitespace", " \t \n "],
  ])("rejects review_feedback whose feedback is blank (%s)", async (_label, feedback) => {
    await expectIntegrityRejection(insertEvent({ event_type: "review_feedback", feedback }));
  });

  const otherTypes = TASK_EVENT_TYPES.filter((type) => type !== "review_feedback");

  it.each(otherTypes.map((type) => [type]))("rejects feedback text on a %s event", async (eventType) => {
    await expectIntegrityRejection(insertEvent({ event_type: eventType, feedback: "Synthetic misplaced feedback" }));
  });

  it.each(otherTypes.map((type) => [type]))("accepts a %s event without feedback (control)", async (eventType) => {
    const row = await insertEvent({ event_type: eventType });
    expect(row.feedback).toBeNull();
  });
});

dbDescribe("a task event can only cite a check result of the same task", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("accepts a submission event citing its own task's check result (control)", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const context = { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
    const check = await insertCheckResult(runtime, context, { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() });

    const event = await insertTaskChild(runtime, ENTITY_TABLES.taskEvents, context, {
      event_type: "submission",
      check_result_id: check.id,
    });
    expect(event.check_result_id).toBe(check.id);
  });

  it("rejects an event citing a check result of another task in the same project", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const otherTask = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const otherCheck = await insertCheckResult(
      runtime,
      { taskId: otherTask.id, projectId: team.projectId, actorId: team.developerId },
      { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() },
    );

    await expectIntegrityRejection(
      insertTaskChild(
        runtime,
        ENTITY_TABLES.taskEvents,
        { taskId: task.id, projectId: team.projectId, actorId: team.developerId },
        { event_type: "submission", check_result_id: otherCheck.id },
      ),
    );
  });

  it("rejects an event citing a check result of a task in another project", async () => {
    const team = await createProjectWithTeam(runtime);
    const otherTeam = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const otherTask = await createTask(runtime, { projectId: otherTeam.projectId, assigneeId: otherTeam.developerId });
    const otherCheck = await insertCheckResult(
      runtime,
      { taskId: otherTask.id, projectId: otherTeam.projectId, actorId: otherTeam.developerId },
      { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() },
    );

    await expectIntegrityRejection(
      insertTaskChild(
        runtime,
        ENTITY_TABLES.taskEvents,
        { taskId: task.id, projectId: team.projectId, actorId: team.developerId },
        { event_type: "submission", check_result_id: otherCheck.id },
      ),
    );
  });

  it("rejects an event citing a check result that does not exist", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    await expectIntegrityRejection(
      insertTaskChild(
        runtime,
        ENTITY_TABLES.taskEvents,
        { taskId: task.id, projectId: team.projectId, actorId: team.developerId },
        { event_type: "submission", check_result_id: randomUUID() },
      ),
    );
  });
});
