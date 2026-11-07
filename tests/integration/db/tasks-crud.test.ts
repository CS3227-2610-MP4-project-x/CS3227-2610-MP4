/**
 * OpenSpec task 4.2 (tasks-crud-4-2): PostgreSQL integration tests for the task service, run
 * through the real TaskService and TaskRepository as `app_runtime` (design.md D-K). No formal
 * requirement IDs exist; cited by name: task-management "Product manager manages tasks" and
 * "Projects and tasks have readable IDs" (task numbers, never-reused IDs, concurrent creation,
 * refused creation); data-persistence "Identifiers, timestamps, and revisions" ("Concurrent
 * edits to a task", "Concurrent task creation") and "Task data stays inside its project".
 * Decisions: D-D, D-E, D-F, D6, T4, T6, T7, T9, T10, T12 and T13.
 *
 * Every person, project and task is synthetic, and each test uses its own rows.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProjectRepository, ProjectService } from "@/server/projects";
import { PeopleRepository } from "@/server/repositories/people-repository";
import { TaskError, TaskRepository, TaskService } from "@/server/tasks";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  SCHEMA,
  addMembership,
  createPerson,
  createProject,
  createProjectWithTeam,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

const PEOPLE = `${SCHEMA}.${ENTITY_TABLES.people}`;
const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;
const MEMBERSHIPS = `${SCHEMA}.${ENTITY_TABLES.memberships}`;
const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const CRITERIA = `${SCHEMA}.${ENTITY_TABLES.acceptanceCriteria}`;
const EVENTS = `${SCHEMA}.${ENTITY_TABLES.taskEvents}`;

async function codeOf(operation: Promise<unknown>): Promise<string | undefined> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  if (error === undefined) return undefined;
  if (!(error instanceof TaskError)) throw error;
  return error.code;
}

function createInput(assigneeId: string, criteria: string[] = ["Synthetic criterion"]) {
  return {
    title: "Synthetic task",
    description: "Synthetic description",
    assigneeId,
    dueDate: "2026-12-01",
    branchName: null,
    acceptanceCriteria: criteria,
  };
}

dbDescribe("task create, read, edit, reassign and soft delete (task 4.2)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let service: TaskService;
  let projects: ProjectService;

  async function counterOf(projectId: string): Promise<number> {
    const { rows } = await runtime.query<{ n: number }>(`SELECT last_task_number AS n FROM ${PROJECTS} WHERE id = $1`, [projectId]);
    return rows[0].n;
  }

  async function taskCount(projectId: string): Promise<number> {
    const { rows } = await runtime.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TASKS} WHERE project_id = $1`, [projectId]);
    return rows[0].n;
  }

  async function usernameOf(personId: string): Promise<string> {
    const { rows } = await runtime.query<{ github_username: string }>(`SELECT github_username FROM ${PEOPLE} WHERE id = $1`, [personId]);
    return rows[0].github_username;
  }

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    const pool = runtimePool(() => db().connectAsRuntime());
    service = new TaskService(new TaskRepository(pool as unknown as ConstructorParameters<typeof TaskRepository>[0]));
    projects = new ProjectService(
      new ProjectRepository(pool as unknown as ConstructorParameters<typeof ProjectRepository>[0]),
      new PeopleRepository(pool as unknown as ConstructorParameters<typeof PeopleRepository>[0]),
    );
  });

  // -------------------------------------------------------------------------
  // Task numbers (D-D, T13)
  // -------------------------------------------------------------------------

  it("allocates the next number from the project counter and stores the task and its criteria", async () => {
    const team = await createProjectWithTeam(runtime);
    const first = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId, ["one", "two"]));
    const second = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    expect(first.taskKey).toBe(`${team.projectKey}-1`);
    expect(second.taskKey).toBe(`${team.projectKey}-2`);
    expect(await counterOf(team.projectId)).toBe(2);
    expect(first).toMatchObject({ state: "To Do", version: 1, dueDate: "2026-12-01", branchName: null });
    expect(first.acceptanceCriteria.map(({ position, description }) => ({ position, description }))).toEqual([
      { position: 1, description: "one" }, { position: 2, description: "two" },
    ]);
    expect(first.createdAt).toMatch(/Z$/);
    expect(await service.getTask(team.projectId, first.id)).toEqual(first);
  });

  it("continues after WEB-11 with WEB-12 and never reuses a deleted task's number", async () => {
    const team = await createProjectWithTeam(runtime);
    await runtime.query(`UPDATE ${PROJECTS} SET last_task_number = 11 WHERE id = $1`, [team.projectId]);
    const twelve = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    expect(twelve.taskKey).toBe(`${team.projectKey}-12`);
    await service.deleteTask(team.projectId, twelve.id, team.productManagerId, twelve.version);
    const thirteen = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    expect(thirteen.taskKey).toBe(`${team.projectKey}-13`);
    const { rows } = await runtime.query<{ number: number; deleted: boolean }>(
      `SELECT number, deleted_at IS NOT NULL AS deleted FROM ${TASKS} WHERE project_id = $1 ORDER BY number`,
      [team.projectId],
    );
    expect(rows).toEqual([{ number: 12, deleted: true }, { number: 13, deleted: false }]);
  });

  it("gives concurrent creations distinct numbers (Concurrent task creation)", async () => {
    const team = await createProjectWithTeam(runtime);
    const views = await Promise.all(Array.from({ length: 6 }, () =>
      service.createTask(team.projectId, team.productManagerId, createInput(team.developerId))));
    expect(new Set(views.map((view) => view.taskKey)).size).toBe(6);
    expect(views.map((view) => view.taskKey).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `${team.projectKey}-${n}`).sort(),
    );
    expect(await counterOf(team.projectId)).toBe(6);
  });

  it("rolls back the task and its number when a criterion insert fails (atomic create)", async () => {
    const team = await createProjectWithTeam(runtime);
    const trigger = `synthetic_fail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await db().admin.query(`
      CREATE FUNCTION ${SCHEMA}.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.description = 'synthetic-forced-failure' THEN
          RAISE EXCEPTION 'synthetic forced failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON ${CRITERIA} FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.${trigger}();
    `);
    try {
      await expect(service.createTask(
        team.projectId, team.productManagerId, createInput(team.developerId, ["fine", "synthetic-forced-failure"]),
      )).rejects.toBeDefined();
      expect(await taskCount(team.projectId)).toBe(0);
      expect(await counterOf(team.projectId)).toBe(0);
      const next = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
      expect(next.taskKey).toBe(`${team.projectKey}-1`);
    } finally {
      await db().admin.query(`DROP TRIGGER ${trigger} ON ${CRITERIA}; DROP FUNCTION ${SCHEMA}.${trigger}();`);
    }
  });

  // -------------------------------------------------------------------------
  // Missing criteria and assignees outside the project (T7)
  // -------------------------------------------------------------------------

  it("refuses a task without criteria and uses no number", async () => {
    const team = await createProjectWithTeam(runtime);
    expect(await codeOf(service.createTask(team.projectId, team.productManagerId, createInput(team.developerId, []))))
      .toBe("ACCEPTANCE_CRITERIA_REQUIRED");
    expect(await taskCount(team.projectId)).toBe(0);
    expect(await counterOf(team.projectId)).toBe(0);
  });

  it("refuses an edit that removes every criterion", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    expect(await codeOf(service.editTask(team.projectId, task.id, team.productManagerId, { version: 1, acceptanceCriteria: [] })))
      .toBe("ACCEPTANCE_CRITERIA_REQUIRED");
    expect(await service.getTask(team.projectId, task.id)).toEqual(task);
  });

  it("refuses assignees who are not developers in the project, on create and reassign", async () => {
    const team = await createProjectWithTeam(runtime);
    const other = await createProjectWithTeam(runtime);
    const outsider = await createPerson(runtime);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    for (const assigneeId of [outsider, team.productManagerId, other.developerId, randomUUID()]) {
      expect(await codeOf(service.createTask(team.projectId, team.productManagerId, createInput(assigneeId)))).toBe("ASSIGNEE_NOT_DEVELOPER");
      expect(await codeOf(service.reassignTask(team.projectId, task.id, team.productManagerId, { assigneeId, version: 1 })))
        .toBe("ASSIGNEE_NOT_DEVELOPER");
    }
    expect(await taskCount(team.projectId)).toBe(1);
    expect(await counterOf(team.projectId)).toBe(1);
    expect(await service.getTask(team.projectId, task.id)).toEqual(task);
  });

  // -------------------------------------------------------------------------
  // Edit, reassign, delete (T4, T6, T9, T10, T12)
  // -------------------------------------------------------------------------

  it("edits fields and criteria, keeping criterion IDs, with one version increase", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId, ["keep", "drop"]));
    const [keep] = task.acceptanceCriteria;
    const edited = await service.editTask(team.projectId, task.id, team.productManagerId, {
      version: 1,
      title: "Edited",
      branchName: "feature/edited",
      acceptanceCriteria: [{ description: "new first" }, { id: keep.id, description: "kept" }],
    });
    expect(edited).toMatchObject({ title: "Edited", branchName: "feature/edited", version: 2 });
    expect(edited.acceptanceCriteria).toEqual([
      { id: expect.any(String), position: 1, description: "new first" },
      { id: keep.id, position: 2, description: "kept" },
    ]);
    const { rows } = await runtime.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${CRITERIA} WHERE task_id = $1`, [task.id]);
    expect(rows[0].n).toBe(2);
  });

  it("lets only one of two edits with the same version succeed (Concurrent edits to a task)", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    const codes = await Promise.all([
      codeOf(service.editTask(team.projectId, task.id, team.productManagerId, { version: 1, title: "First writer" })),
      codeOf(service.editTask(team.projectId, task.id, team.productManagerId, { version: 1, title: "Second writer" })),
    ]);
    expect(codes.sort()).toEqual([undefined, "VERSION_CONFLICT"].sort());
    const final = await service.getTask(team.projectId, task.id);
    expect(final.version).toBe(2);
    expect(["First writer", "Second writer"]).toContain(final.title);
  });

  it("reassigns with one assignment_change event and leaves the state unchanged", async () => {
    const team = await createProjectWithTeam(runtime);
    const second = await createPerson(runtime);
    await addMembership(runtime, team.projectId, second, MEMBERSHIP_ROLE.developer);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    await runtime.query(`UPDATE ${TASKS} SET status = 'in_review' WHERE id = $1`, [task.id]);
    const moved = await service.reassignTask(team.projectId, task.id, team.productManagerId, { assigneeId: second, version: 2 });
    expect(moved).toMatchObject({ state: "In Review", version: 3, assignee: { personId: second, githubUsername: await usernameOf(second) } });
    const { rows } = await runtime.query(`SELECT actor_id, event_type, previous_assignee_id, new_assignee_id FROM ${EVENTS} WHERE task_id = $1`, [task.id]);
    expect(rows).toEqual([{ actor_id: team.productManagerId, event_type: "assignment_change", previous_assignee_id: team.developerId, new_assignee_id: second }]);
  });

  it("soft-deletes: the row, criteria and events remain, and the task is concealed", async () => {
    const team = await createProjectWithTeam(runtime);
    const second = await createPerson(runtime);
    await addMembership(runtime, team.projectId, second, MEMBERSHIP_ROLE.developer);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId, ["a", "b"]));
    const moved = await service.reassignTask(team.projectId, task.id, team.productManagerId, { assigneeId: second, version: 1 });
    await service.deleteTask(team.projectId, task.id, team.productManagerId, moved.version);
    const { rows } = await runtime.query<{ deleted: boolean; criteria: number; events: number }>(
      `SELECT t.deleted_at IS NOT NULL AS deleted,
              (SELECT count(*)::int FROM ${CRITERIA} c WHERE c.task_id = t.id) AS criteria,
              (SELECT count(*)::int FROM ${EVENTS} e WHERE e.task_id = t.id) AS events
         FROM ${TASKS} t WHERE t.id = $1`,
      [task.id],
    );
    expect(rows).toEqual([{ deleted: true, criteria: 2, events: 1 }]);
    expect(await codeOf(service.getTask(team.projectId, task.id))).toBe("NOT_FOUND");
    expect(await codeOf(service.editTask(team.projectId, task.id, team.productManagerId, { version: 3, title: "x" }))).toBe("NOT_FOUND");
  });

  it("conceals a task from another project's service calls", async () => {
    const team = await createProjectWithTeam(runtime);
    const other = await createProject(runtime);
    await addMembership(runtime, other.id, team.productManagerId, MEMBERSHIP_ROLE.productManager);
    const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
    expect(await codeOf(service.getTask(other.id, task.id))).toBe("NOT_FOUND");
    expect(await codeOf(service.deleteTask(other.id, task.id, team.productManagerId, 1))).toBe("NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // Reassignment racing a product manager transfer (D6)
  // -------------------------------------------------------------------------

  it("never leaves the new product manager with an open task when a reassignment races a transfer", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const team = await createProjectWithTeam(runtime);
      const incoming = await createPerson(runtime);
      await addMembership(runtime, team.projectId, incoming, MEMBERSHIP_ROLE.developer);
      const task = await service.createTask(team.projectId, team.productManagerId, createInput(team.developerId));
      const [transfer, reassign] = await Promise.all([
        projects.transferProductManager(team.projectId, team.productManagerId, await usernameOf(incoming)).then(
          () => undefined, (error: { code?: string }) => error.code ?? "UNEXPECTED",
        ),
        codeOf(service.reassignTask(team.projectId, task.id, team.productManagerId, { assigneeId: incoming, version: 1 })),
      ]);
      expect([undefined, "TRANSFER_BLOCKED_OPEN_TASKS"]).toContain(transfer);
      expect([undefined, "ASSIGNEE_NOT_DEVELOPER", "FORBIDDEN"]).toContain(reassign);
      const { rows } = await runtime.query<{ role: string; open: number }>(
        `SELECT m.role,
                (SELECT count(*)::int FROM ${TASKS} t
                  WHERE t.project_id = m.project_id AND t.assignee_id = m.person_id
                    AND t.status <> 'done' AND t.deleted_at IS NULL) AS open
           FROM ${MEMBERSHIPS} m WHERE m.project_id = $1 AND m.person_id = $2`,
        [team.projectId, incoming],
      );
      expect(rows[0].role === MEMBERSHIP_ROLE.productManager && rows[0].open > 0).toBe(false);
    }
  });
});
