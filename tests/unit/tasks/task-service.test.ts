import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.2 (tasks-crud-4-2). Validation, error-mapping and service unit tests for the
// `@/server/tasks` public entry. Requirements by name (no formal IDs): task-management "Product
// manager manages tasks" and "Projects and tasks have readable IDs"; data-persistence
// "Identifiers, timestamps, and revisions". Decisions: design.md "Task Management Decisions
// (4.2)" T2 to T13, R1, R4, Q2 and the API Error Contract.
//
// TaskRepository runs against the shared in-memory fake (tests/unit/support/sql-fake.ts),
// which evaluates statements with PostgreSQL's semantics and throws on any it cannot read.
// All values are synthetic.

vi.mock("server-only", () => ({}));

import {
  TaskError,
  TaskRepository,
  TaskService,
  parseCreateTaskBody,
  parseDeleteTaskBody,
  parseEditTaskBody,
  parseReassignTaskBody,
  taskErrorResponse,
} from "@/server/tasks";

import { FakeDatabase, PRIVATE_DETAIL, pgError, type TaskRow } from "../support/sql-fake";

const projectId = "33333333-3333-4333-8333-333333333333";
const people = {
  pm: { id: "22222222-2222-4222-8222-222222222201", auth_user_id: "11111111-1111-4111-8111-111111111101", github_user_id: "1001", github_username: "synthetic-pm" },
  dev: { id: "22222222-2222-4222-8222-222222222202", auth_user_id: "11111111-1111-4111-8111-111111111102", github_user_id: "1002", github_username: "Synthetic-Dev" },
  dev2: { id: "22222222-2222-4222-8222-222222222203", auth_user_id: "11111111-1111-4111-8111-111111111103", github_user_id: "1003", github_username: "Synthetic-Dev2" },
  outsider: { id: "22222222-2222-4222-8222-222222222205", auth_user_id: "11111111-1111-4111-8111-111111111105", github_user_id: "1005", github_username: "synthetic-outsider" },
} as const;
const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

// ---------------------------------------------------------------------------
// Validation (T2, T4, T5, T6, T7)
// ---------------------------------------------------------------------------

function validCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Synthetic task",
    description: "Synthetic description",
    assigneeId: people.dev.id,
    dueDate: "2026-12-01",
    acceptanceCriteria: ["Synthetic criterion"],
    ...overrides,
  };
}

describe("parseCreateTaskBody", () => {
  it("returns trimmed values and a null branch name by default", () => {
    expect(parseCreateTaskBody(validCreate({ title: " T ", description: " D ", acceptanceCriteria: [" c "] }))).toEqual({
      ok: true,
      value: {
        title: "T", description: "D", assigneeId: people.dev.id, dueDate: "2026-12-01", branchName: null, acceptanceCriteria: ["c"],
      },
    });
  });

  it("keeps a trimmed branch name", () => {
    const result = parseCreateTaskBody(validCreate({ branchName: " feature/x " }));
    expect(result).toMatchObject({ ok: true, value: { branchName: "feature/x" } });
  });

  it.each([
    ["absent", validCreate({ acceptanceCriteria: undefined })],
    ["empty", validCreate({ acceptanceCriteria: [] })],
  ])("reports %s criteria as ACCEPTANCE_CRITERIA_REQUIRED", (_case, body) => {
    expect(parseCreateTaskBody(body)).toEqual({ ok: false, code: "ACCEPTANCE_CRITERIA_REQUIRED" });
  });

  it("lets any other body error take precedence over missing criteria", () => {
    expect(parseCreateTaskBody(validCreate({ acceptanceCriteria: [], dueDate: "soon" }))).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it("counts lengths in code points after trimming (R1)", () => {
    expect(parseCreateTaskBody(validCreate({ title: `  ${"\u{1F600}".repeat(200)}  ` })).ok).toBe(true);
    expect(parseCreateTaskBody(validCreate({ title: "\u{1F600}".repeat(201) })).ok).toBe(false);
    expect(parseCreateTaskBody(validCreate({ acceptanceCriteria: ["\u{1F600}".repeat(500)] })).ok).toBe(true);
    expect(parseCreateTaskBody(validCreate({ acceptanceCriteria: ["\u{1F600}".repeat(501)] })).ok).toBe(false);
  });

  it.each([
    "2026-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-12-00", "0000-01-01", "2026-12-1", "26-12-01", " 2026-12-01", "2026/12/01",
  ])("rejects due date %s", (dueDate) => {
    expect(parseCreateTaskBody(validCreate({ dueDate }))).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it.each(["2028-02-29", "2000-02-29", "1999-12-31", "9999-12-31"])("accepts due date %s", (dueDate) => {
    expect(parseCreateTaskBody(validCreate({ dueDate })).ok).toBe(true);
  });

  it.each(["main", "feature/WEB-12", "release-1.2.3", "a_b", "x".repeat(255), "a.lockfile"])("accepts branch name %s", (branchName) => {
    expect(parseCreateTaskBody(validCreate({ branchName })).ok).toBe(true);
  });

  it.each(["", " ", "a..b", "a//b", "/a", "-a", "a/", "a.", "a.lock", "a b", "a~b", "a:b", "x".repeat(256)])("rejects branch name %j", (branchName) => {
    expect(parseCreateTaskBody(validCreate({ branchName }))).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it.each([undefined, null, "x", 1, [], [validCreate()]])("rejects a non-object body %j", (body) => {
    expect(parseCreateTaskBody(body)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});

describe("parseEditTaskBody", () => {
  it("returns only the fields sent", () => {
    expect(parseEditTaskBody({ version: 3, title: " New " })).toEqual({ ok: true, value: { version: 3, title: "New" } });
  });

  it("accepts a null branch name to clear it", () => {
    expect(parseEditTaskBody({ version: 1, branchName: null })).toEqual({ ok: true, value: { version: 1, branchName: null } });
  });

  it("parses the criteria list with optional IDs", () => {
    expect(parseEditTaskBody({ version: 1, acceptanceCriteria: [{ id: UUID_A, description: " a " }, { description: "b" }] })).toEqual({
      ok: true, value: { version: 1, acceptanceCriteria: [{ id: UUID_A, description: "a" }, { description: "b" }] },
    });
  });

  it("reports an empty criteria list as ACCEPTANCE_CRITERIA_REQUIRED", () => {
    expect(parseEditTaskBody({ version: 1, acceptanceCriteria: [] })).toEqual({ ok: false, code: "ACCEPTANCE_CRITERIA_REQUIRED" });
  });

  it.each([
    ["only a version", { version: 1 }],
    ["no version", { title: "x" }],
    ["a duplicated criterion ID", { version: 1, acceptanceCriteria: [{ id: UUID_A, description: "a" }, { id: UUID_A, description: "b" }] }],
    ["an assignee", { version: 1, assigneeId: people.dev.id }],
    ["a state", { version: 1, state: "Done" }],
    ["a null title", { version: 1, title: null }],
    ["an empty criteria list and a bad title", { version: 1, acceptanceCriteria: [], title: "" }],
  ])("rejects %s", (_case, body) => {
    expect(parseEditTaskBody(body)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});

describe("version, reassign and delete bodies (T6, T9)", () => {
  it.each([0, -1, 1.5, "1", null, true, 2_147_483_648])("rejects version %j", (version) => {
    expect(parseDeleteTaskBody({ version })).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(parseReassignTaskBody({ assigneeId: people.dev.id, version })).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it("accepts the largest stored version", () => {
    expect(parseDeleteTaskBody({ version: 2_147_483_647 })).toEqual({ ok: true, value: { version: 2_147_483_647 } });
  });

  it("parses a reassignment body", () => {
    expect(parseReassignTaskBody({ assigneeId: people.dev2.id, version: 2 })).toEqual({ ok: true, value: { assigneeId: people.dev2.id, version: 2 } });
  });

  it.each([{}, { version: 1, extra: 1 }, [], null])("rejects delete body %j", (body) => {
    expect(parseDeleteTaskBody(body)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// Error mapping (T7, Q2)
// ---------------------------------------------------------------------------

describe("taskErrorResponse", () => {
  it.each([
    ["INVALID_REQUEST", 400],
    ["ACCEPTANCE_CRITERIA_REQUIRED", 400],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["ASSIGNEE_NOT_DEVELOPER", 409],
    ["VERSION_CONFLICT", 409],
  ] as const)("maps %s to %i with a fixed, non-empty message", async (code, status) => {
    const response = taskErrorResponse(new TaskError(code));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(code);
    expect(body.error.message.trim()).not.toBe("");
  });

  it("maps any other error to a generic 500 without details", async () => {
    const response = taskErrorResponse(new Error(PRIVATE_DETAIL));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(PRIVATE_DETAIL);
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});

// ---------------------------------------------------------------------------
// TaskService against the fake (T6, T9, T10, T12, T13, R4)
// ---------------------------------------------------------------------------

let fake: FakeDatabase;
let service: TaskService;

beforeEach(() => {
  fake = new FakeDatabase();
  fake.state.people.push(...Object.values(people).map((entry) => ({ ...entry })));
  fake.state.projects.push({ id: projectId, key: "WEB", name: "Synthetic web project", last_task_number: 0, version: 1 });
  fake.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: people.pm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev.id, role: "developer", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev2.id, role: "developer", version: 1 },
  );
  service = new TaskService(new TaskRepository(
    { query: fake.query, connect: fake.connect } as unknown as ConstructorParameters<typeof TaskRepository>[0],
  ));
});

const createInput = {
  title: "Synthetic task", description: "Synthetic description", assigneeId: people.dev.id, dueDate: "2026-12-01",
  branchName: null, acceptanceCriteria: ["one", "two"],
};

async function codeOf(operation: Promise<unknown>): Promise<string | undefined> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(TaskError);
  return (error as TaskError).code;
}

function stored(id: string): TaskRow {
  return fake.state.tasks.find((task) => task.id === id)!;
}

describe("TaskService", () => {
  it("creates a task with the next number and returns its view", async () => {
    fake.state.projects[0].last_task_number = 7;
    const view = await service.createTask(projectId, people.pm.id, createInput);
    expect(view).toMatchObject({ taskKey: "WEB-8", state: "To Do", version: 1, assignee: { personId: people.dev.id } });
    expect(fake.state.projects[0].last_task_number).toBe(8);
    expect(fake.connected).toBe(fake.released);
  });

  it("rechecks the product manager role in the transaction (R4)", async () => {
    expect(await codeOf(service.createTask(projectId, people.dev.id, createInput))).toBe("FORBIDDEN");
    expect(await codeOf(service.createTask(projectId, people.outsider.id, createInput))).toBe("NOT_FOUND");
    expect(fake.state.tasks).toEqual([]);
    expect(fake.state.projects[0].last_task_number).toBe(0);
  });

  it("locks the actor's membership FOR SHARE inside the transaction (R5 pattern)", async () => {
    await service.createTask(projectId, people.pm.id, createInput);
    const begin = fake.log.findIndex((entry) => entry.kind === "begin");
    const lock = fake.log.findIndex((entry) => entry.tables.includes("memberships") && /for\s+share/i.test(entry.sql));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(begin);
  });

  it("refuses an assignee who is not a developer before allocating a number", async () => {
    expect(await codeOf(service.createTask(projectId, people.pm.id, { ...createInput, assigneeId: people.outsider.id }))).toBe("ASSIGNEE_NOT_DEVELOPER");
    expect(fake.log.some((entry) => entry.kind === "update" && entry.tables.includes("projects"))).toBe(false);
  });

  it("rolls back everything when a later statement fails", async () => {
    fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("acceptance_criteria") ? pgError("23514") : undefined;
    await expect(service.createTask(projectId, people.pm.id, createInput)).rejects.toBeDefined();
    expect(fake.state.tasks).toEqual([]);
    expect(fake.state.projects[0].last_task_number).toBe(0);
    expect(fake.connected).toBe(fake.released);
  });

  it("reads a task and conceals a missing one", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    expect(await service.getTask(projectId, created.id)).toEqual(created);
    expect(await codeOf(service.getTask(projectId, UUID_A))).toBe("NOT_FOUND");
  });

  it("refuses an edit with a stale version and one whose version changes before the update", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    expect(await codeOf(service.editTask(projectId, created.id, people.pm.id, { version: 2, title: "x" }))).toBe("VERSION_CONFLICT");
    fake.beforeStatement = ({ kind, tables }) => {
      if (kind === "update" && tables.includes("tasks")) {
        fake.beforeStatement = undefined;
        fake.applyCommitted((state) => { state.tasks[0].version = 2; });
      }
    };
    expect(await codeOf(service.editTask(projectId, created.id, people.pm.id, { version: 1, title: "x" }))).toBe("VERSION_CONFLICT");
    expect(stored(created.id).title).toBe("Synthetic task");
  });

  it("refuses an edit by a developer inside the transaction", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    expect(await codeOf(service.editTask(projectId, created.id, people.dev.id, { version: 1, title: "x" }))).toBe("FORBIDDEN");
  });

  it("refuses criterion IDs that are not the task's own", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    const other = await service.createTask(projectId, people.pm.id, createInput);
    expect(await codeOf(service.editTask(projectId, created.id, people.pm.id, {
      version: 1, acceptanceCriteria: [{ id: other.acceptanceCriteria[0].id, description: "x" }],
    }))).toBe("INVALID_REQUEST");
    expect(stored(created.id).version).toBe(1);
  });

  it("reassigns with one assignment_change event and skips a same-assignee reassignment", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    const same = await service.reassignTask(projectId, created.id, people.pm.id, { assigneeId: people.dev.id, version: 1 });
    expect(same.version).toBe(1);
    expect(fake.state.task_events).toEqual([]);
    const moved = await service.reassignTask(projectId, created.id, people.pm.id, { assigneeId: people.dev2.id, version: 1 });
    expect(moved).toMatchObject({ version: 2, assignee: { personId: people.dev2.id, githubUsername: "Synthetic-Dev2" } });
    expect(fake.state.task_events).toEqual([expect.objectContaining({
      task_id: created.id, actor_id: people.pm.id, event_type: "assignment_change", previous_assignee_id: people.dev.id, new_assignee_id: people.dev2.id,
    })]);
  });

  it("refuses a reassignment to a non-developer", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    expect(await codeOf(service.reassignTask(projectId, created.id, people.pm.id, { assigneeId: people.pm.id, version: 1 }))).toBe("ASSIGNEE_NOT_DEVELOPER");
    expect(fake.state.task_events).toEqual([]);
  });

  it("soft-deletes with an UPDATE, never a DELETE, and conceals the task afterwards (T12, D-E)", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    await service.deleteTask(projectId, created.id, people.pm.id, 1);
    expect(stored(created.id).deleted_at).toEqual(expect.any(String));
    expect(fake.log.some((entry) => entry.kind === "delete" && entry.tables.includes("tasks"))).toBe(false);
    expect(await codeOf(service.getTask(projectId, created.id))).toBe("NOT_FOUND");
    expect(await codeOf(service.deleteTask(projectId, created.id, people.pm.id, 2))).toBe("NOT_FOUND");
  });

  it("refuses a stale delete", async () => {
    const created = await service.createTask(projectId, people.pm.id, createInput);
    expect(await codeOf(service.deleteTask(projectId, created.id, people.pm.id, 9))).toBe("VERSION_CONFLICT");
    expect(stored(created.id).deleted_at).toBeNull();
  });
});
