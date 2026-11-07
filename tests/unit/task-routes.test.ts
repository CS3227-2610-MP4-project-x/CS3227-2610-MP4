import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-memory PostgreSQL stand-in is shared with the other unit tests (design.md T17).
import { FakeDatabase, pgError, PRIVATE_DETAIL, UUID_PATTERN, type LogEntry, type PersonRow, type TaskRow } from "./support/sql-fake";

// OpenSpec task 4.2 (tasks-crud-4-2). No formal requirement IDs exist; cited by name:
// task-management "Product manager manages tasks", "Task management routes" and "Projects and
// tasks have readable IDs"; identity-and-access "Protected route authorization stubs" ("Task
// creation is functional", "Task read is functional", "Task field edit is functional"),
// "Mutating project routes check the request origin" and "Protected API errors use stable safe
// responses"; data-persistence "Identifiers, timestamps, and revisions".
// Decisions: design.md "Task Management Decisions (4.2)" T1 to T16, Q2, Q4, R1, and the API
// Error Contract.
//
// The real route handlers, services and repositories run. Only Supabase Auth, server config
// and `pg` are replaced. The `pg` fake evaluates statements with PostgreSQL's semantics and
// throws on anything it cannot read. Tests assert recorded behaviour and stored state, not SQL
// text. All identities and rows are synthetic.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({
    appEnvironment: "development",
    appOrigin: "https://synthetic-app.example",
    databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
    databaseCaCert: "synthetic-test-ca",
    supabaseUrl: "https://synthetic.supabase.co",
    supabasePublishableKey: "synthetic-publishable-key",
    githubAppClientId: "synthetic-app-client",
    githubAppClientSecret: "synthetic-app-secret",
    ai: { provider: "fake" },
  }),
}));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: boundary.getUser } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = boundary.query;
    connect = boundary.connect;
  }
  return { Pool, default: { Pool } };
});

// ---------------------------------------------------------------------------
// Synthetic team: project WEB (pm, dev, dev2) and project OTH (otherPm, otherDev)
// ---------------------------------------------------------------------------

const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const otherProjectId = "33333333-3333-4333-8333-333333333334";
const missingTaskId = "99999999-9999-4999-8999-999999999999";
const unknownPersonId = "22222222-2222-4222-8222-222222222299";
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function person(id: string, authId: string, githubUserId: string, username: string): PersonRow {
  return { id, auth_user_id: authId, github_user_id: githubUserId, github_username: username };
}

const people = {
  pm: person("22222222-2222-4222-8222-222222222201", "11111111-1111-4111-8111-111111111101", "1001", "synthetic-pm"),
  dev: person("22222222-2222-4222-8222-222222222202", "11111111-1111-4111-8111-111111111102", "1002", "Synthetic-Dev"),
  dev2: person("22222222-2222-4222-8222-222222222203", "11111111-1111-4111-8111-111111111103", "1003", "Synthetic-Dev2"),
  outsider: person("22222222-2222-4222-8222-222222222205", "11111111-1111-4111-8111-111111111105", "1005", "synthetic-outsider"),
  otherPm: person("22222222-2222-4222-8222-222222222206", "11111111-1111-4111-8111-111111111106", "1006", "synthetic-other-pm"),
  otherDev: person("22222222-2222-4222-8222-222222222207", "11111111-1111-4111-8111-111111111107", "1007", "synthetic-other-dev"),
} as const;

let fake: FakeDatabase;

function seed(): void {
  fake.state.people.push(...Object.values(people).map((entry) => ({ ...entry })));
  fake.state.projects.push(
    { id: projectId, key: "WEB", name: "Synthetic web project", last_task_number: 0, version: 1 },
    { id: otherProjectId, key: "OTH", name: "Synthetic other project", last_task_number: 0, version: 1 },
  );
  fake.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: people.pm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev.id, role: "developer", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev2.id, role: "developer", version: 1 },
    { id: randomUUID(), project_id: otherProjectId, person_id: people.otherPm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: otherProjectId, person_id: people.otherDev.id, role: "developer", version: 1 },
  );
}

interface TaskSeed {
  project?: string;
  assigneeId?: string;
  status?: string;
  deleted?: boolean;
  criteria?: string[];
  version?: number;
}

const STORED_TIME = "2026-11-01T02:03:04.000Z";

/** Inserts a stored task and its criteria directly, as earlier writes would have left them. */
function addTask(options: TaskSeed = {}): TaskRow {
  const project = fake.state.projects.find((entry) => entry.id === (options.project ?? projectId))!;
  project.last_task_number += 1;
  const task: TaskRow = {
    id: randomUUID(),
    project_id: project.id,
    number: project.last_task_number,
    title: "Stored task",
    description: "Stored description",
    assignee_id: options.assigneeId ?? (project.id === projectId ? people.dev.id : people.otherDev.id),
    due_date: "2026-11-30",
    status: options.status ?? "to_do",
    branch_name: null,
    deleted_at: options.deleted ? STORED_TIME : null,
    version: options.version ?? 1,
    created_at: STORED_TIME,
    updated_at: STORED_TIME,
  };
  fake.state.tasks.push(task);
  (options.criteria ?? ["Stored criterion one", "Stored criterion two"]).forEach((description, index) => {
    fake.state.acceptance_criteria.push({
      id: randomUUID(), task_id: task.id, position: index + 1, description, version: 1, created_at: STORED_TIME, updated_at: STORED_TIME,
    });
  });
  return task;
}

function taskRow(id: string): TaskRow {
  return fake.state.tasks.find((task) => task.id === id)!;
}

function criteriaOf(taskId: string) {
  return fake.state.acceptance_criteria
    .filter((criterion) => criterion.task_id === taskId)
    .sort((left, right) => left.position - right.position);
}

function signInAs(authUserId: string): void {
  boundary.getUser.mockResolvedValue({
    data: { user: {
      id: authUserId,
      identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-session-user" } }],
    } },
    error: null,
  });
}

function signOut(): void {
  boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
}

// ---------------------------------------------------------------------------
// Requests and assertions
// ---------------------------------------------------------------------------

type Route = "create" | "read" | "edit" | "reassign" | "delete";
const MUTATIONS: readonly Route[] = ["create", "edit", "reassign", "delete"];
const PM_ONLY: readonly Route[] = ["create", "edit", "reassign", "delete"];
const TASK_ROUTES: readonly Route[] = ["read", "edit", "reassign", "delete"];

interface CallOptions {
  projectId?: string;
  taskId?: string;
  body?: unknown;
  raw?: string;
  origin?: string | null;
  contentType?: string | null;
}

function validCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Synthetic task",
    description: "Synthetic description",
    assigneeId: people.dev.id,
    dueDate: "2026-12-01",
    acceptanceCriteria: ["Synthetic criterion one", "Synthetic criterion two"],
    ...overrides,
  };
}

/** A valid body for each route, for the given stored task (when the route names one). */
function validBody(route: Route, task?: TaskRow): unknown {
  switch (route) {
    case "create": return validCreate();
    case "read": return undefined;
    case "edit": return { version: task?.version ?? 1, title: "Edited title" };
    case "reassign": return { assigneeId: people.dev2.id, version: task?.version ?? 1 };
    case "delete": return { version: task?.version ?? 1 };
  }
}

async function call(route: Route, options: CallOptions = {}): Promise<Response> {
  const project = options.projectId ?? projectId;
  const taskId = options.taskId ?? missingTaskId;
  const taskPath = `/api/v1/projects/${project}/tasks/${taskId}`;
  const path = route === "create" ? `/api/v1/projects/${project}/tasks`
    : route === "reassign" ? `${taskPath}/assignee` : taskPath;
  const method = { create: "POST", read: "GET", edit: "PATCH", reassign: "PUT", delete: "DELETE" }[route];
  const headers: Record<string, string> = {};
  const requestOrigin = options.origin === undefined ? (route === "read" ? null : origin) : options.origin;
  if (requestOrigin !== null) headers.origin = requestOrigin;
  const contentType = options.contentType === undefined ? (route === "read" ? null : "application/json") : options.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  const body = route === "read" ? undefined : options.raw ?? JSON.stringify(options.body ?? {});
  const request = new NextRequest(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
  const context = { params: Promise.resolve({ projectId: project, taskId }) };
  switch (route) {
    case "create": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/route")).POST(request, context);
    case "read": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route")).GET(request, context);
    case "edit": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route")).PATCH(request, context);
    case "reassign": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/assignee/route")).PUT(request, context);
    case "delete": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route")).DELETE(request, context);
  }
}

/** Calls a route with its valid body for `task` (or the creation body). */
async function callValid(route: Route, task?: TaskRow, options: CallOptions = {}): Promise<Response> {
  return call(route, { taskId: task?.id, body: validBody(route, task), ...options });
}

const stableMessages: Record<string, string> = {
  INVALID_REQUEST: "Invalid request",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Insufficient permissions",
  NOT_FOUND: "Resource not found",
  INTERNAL_ERROR: "Internal server error",
};

/**
 * Asserts the safe error envelope. Codes with a recorded message are checked exactly; the new
 * 4.2 codes only for a non-empty message containing none of the submitted values (Q2, T7).
 */
async function expectError(response: Response, status: number, code: string, submitted: string[] = []): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(text).not.toContain(PRIVATE_DETAIL);
  const body = JSON.parse(text) as { error: { code: string; message: string } };
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  if (stableMessages[code]) expect(body.error.message).toBe(stableMessages[code]);
  else expect(body.error.message.trim()).not.toBe("");
  for (const value of submitted) expect(body.error.message).not.toContain(value);
}

async function expectSuccess(response: Response, status: number): Promise<TaskViewBody> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response.json() as Promise<TaskViewBody>;
}

interface TaskViewBody {
  id: string;
  taskKey: string;
  title: string;
  description: string;
  assignee: { personId: string; githubUsername: string };
  dueDate: string;
  branchName: string | null;
  state: string;
  acceptanceCriteria: { id: string; position: number; description: string }[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

function writes(): LogEntry[] {
  return fake.log.filter((entry) => entry.kind === "insert" || entry.kind === "update" || entry.kind === "delete");
}

function eventsOf(taskId: string) {
  return fake.state.task_events.filter((event) => event.task_id === taskId);
}

function snapshot(): string {
  return JSON.stringify(fake.state);
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = new FakeDatabase();
  seed();
  boundary.query.mockImplementation(fake.query);
  boundary.connect.mockImplementation(async () => ({ query: boundary.query, release: boundary.release }));
  signInAs(people.pm.auth_user_id);
});

afterEach(() => {
  expect(fake.unexpected).toEqual([]);
  // Every client taken for a transaction is released.
  expect(boundary.release).toHaveBeenCalledTimes(boundary.connect.mock.calls.length);
});

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectId}/tasks
// ---------------------------------------------------------------------------

describe("POST /api/v1/projects/{projectId}/tasks (Product manager manages tasks)", () => {
  it("creates a To Do task for a project developer and returns the task view (T1, T3)", async () => {
    const body = await expectSuccess(await callValid("create"), 201);
    expect(body).toEqual({
      id: expect.stringMatching(UUID_PATTERN),
      taskKey: "WEB-1",
      title: "Synthetic task",
      description: "Synthetic description",
      assignee: { personId: people.dev.id, githubUsername: "Synthetic-Dev" },
      dueDate: "2026-12-01",
      branchName: null,
      state: "To Do",
      acceptanceCriteria: [
        { id: expect.stringMatching(UUID_PATTERN), position: 1, description: "Synthetic criterion one" },
        { id: expect.stringMatching(UUID_PATTERN), position: 2, description: "Synthetic criterion two" },
      ],
      version: 1,
      createdAt: expect.stringMatching(ISO_UTC),
      updatedAt: expect.stringMatching(ISO_UTC),
    });
    const stored = taskRow(body.id);
    expect(stored).toMatchObject({ project_id: projectId, number: 1, assignee_id: people.dev.id, status: "to_do", deleted_at: null });
    expect(criteriaOf(body.id).map((criterion) => criterion.id)).toEqual(body.acceptanceCriteria.map((criterion) => criterion.id));
  });

  it("stores trimmed text and an optional branch name", async () => {
    const body = await expectSuccess(await call("create", { body: validCreate({
      title: "  Padded title  ", description: "  Padded description ", branchName: " feature/web-1 ",
      acceptanceCriteria: ["  first  ", "second "],
    }) }), 201);
    expect(body).toMatchObject({ title: "Padded title", description: "Padded description", branchName: "feature/web-1" });
    expect(body.acceptanceCriteria.map((criterion) => criterion.description)).toEqual(["first", "second"]);
    expect(taskRow(body.id)).toMatchObject({ title: "Padded title", branch_name: "feature/web-1" });
  });

  it("accepts an explicit null branch name", async () => {
    const body = await expectSuccess(await call("create", { body: validCreate({ branchName: null }) }), 201);
    expect(body.branchName).toBeNull();
  });

  it("gives the next task ID after WEB-11 (Task receives an ID, T13)", async () => {
    fake.state.projects[0].last_task_number = 11;
    const body = await expectSuccess(await callValid("create"), 201);
    expect(body.taskKey).toBe("WEB-12");
    expect(fake.state.projects[0].last_task_number).toBe(12);
  });

  it("never reuses a deleted task's number (Deleted task number is not reused, D-D)", async () => {
    fake.state.projects[0].last_task_number = 11;
    const first = await expectSuccess(await callValid("create"), 201);
    expect(first.taskKey).toBe("WEB-12");
    expect((await call("delete", { taskId: first.id, body: { version: first.version } })).status).toBe(204);
    const next = await expectSuccess(await callValid("create"), 201);
    expect(next.taskKey).toBe("WEB-13");
  });

  it("numbers tasks per project", async () => {
    addTask({ project: otherProjectId });
    const body = await expectSuccess(await callValid("create"), 201);
    expect(body.taskKey).toBe("WEB-1");
  });

  it.each([
    ["missing criteria", validCreate({ acceptanceCriteria: undefined }), 400, "ACCEPTANCE_CRITERIA_REQUIRED"],
    ["an assignee outside the project", validCreate({ assigneeId: people.outsider.id }), 409, "ASSIGNEE_NOT_DEVELOPER"],
    ["an invalid title", validCreate({ title: " " }), 400, "INVALID_REQUEST"],
  ] as const)("does not use a task number when creation is refused for %s (Refused creation does not use a task number)", async (_case, body, status, code) => {
    fake.state.projects[0].last_task_number = 11;
    await expectError(await call("create", { body }), status, code);
    expect(fake.state.projects[0].last_task_number).toBe(11);
    expect(fake.state.tasks).toEqual([]);
    const next = await expectSuccess(await callValid("create"), 201);
    expect(next.taskKey).toBe("WEB-12");
  });

  it("writes no task event on creation (T10)", async () => {
    await expectSuccess(await callValid("create"), 201);
    expect(fake.state.task_events).toEqual([]);
  });

  it("creates the task, its number and its criteria in one transaction", async () => {
    await expectSuccess(await callValid("create"), 201);
    const kinds = fake.log.map((entry) => entry.kind);
    const begin = kinds.indexOf("begin");
    const commit = kinds.lastIndexOf("commit");
    expect(begin).toBeGreaterThanOrEqual(0);
    fake.log.forEach((entry, index) => {
      if (entry.kind === "insert" || entry.kind === "update") {
        expect(index).toBeGreaterThan(begin);
        expect(index).toBeLessThan(commit);
      }
    });
  });

  it("rolls back the number and the task when a criterion insert fails (atomic create)", async () => {
    fake.state.projects[0].last_task_number = 4;
    fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("acceptance_criteria") ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await callValid("create"), 500, "INTERNAL_ERROR");
    expect(fake.log.some((entry) => entry.kind === "rollback")).toBe(true);
    expect(fake.state.projects[0].last_task_number).toBe(4);
    expect(fake.state.tasks).toEqual([]);
    expect(fake.state.acceptance_criteria).toEqual([]);
  });

  describe("missing acceptance criteria (Task without acceptance criteria is refused, T7)", () => {
    it.each([
      ["absent", validCreate({ acceptanceCriteria: undefined })],
      ["empty", validCreate({ acceptanceCriteria: [] })],
    ])("refuses %s criteria with ACCEPTANCE_CRITERIA_REQUIRED and creates nothing", async (_case, body) => {
      const before = snapshot();
      await expectError(await call("create", { body }), 400, "ACCEPTANCE_CRITERIA_REQUIRED");
      expect(snapshot()).toBe(before);
      expect(writes()).toEqual([]);
    });

    it("prefers INVALID_REQUEST when the body has another error as well", async () => {
      await expectError(await call("create", { body: validCreate({ acceptanceCriteria: [], title: "" }) }), 400, "INVALID_REQUEST");
      await expectError(await call("create", { body: validCreate({ acceptanceCriteria: undefined, extra: true }) }), 400, "INVALID_REQUEST");
    });
  });

  describe("assignee outside the project (Assignee must belong to the project, T7)", () => {
    it.each([
      ["a registered non-member", people.outsider.id],
      ["the product manager", people.pm.id],
      ["a developer of another project only", people.otherDev.id],
      ["a product manager of another project", people.otherPm.id],
      ["an unknown person", unknownPersonId],
    ])("refuses %s with ASSIGNEE_NOT_DEVELOPER and creates nothing", async (_case, assigneeId) => {
      const before = snapshot();
      await expectError(await call("create", { body: validCreate({ assigneeId }) }), 409, "ASSIGNEE_NOT_DEVELOPER", [assigneeId]);
      expect(snapshot()).toBe(before);
    });

    it("maps the database's assignee trigger to ASSIGNEE_NOT_DEVELOPER", async () => {
      fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("tasks")
        ? pgError("23503", "tasks_assignee_is_project_developer") : undefined;
      await expectError(await callValid("create"), 409, "ASSIGNEE_NOT_DEVELOPER");
      expect(fake.state.tasks).toEqual([]);
      expect(fake.state.projects[0].last_task_number).toBe(0);
    });

    it("returns a safe 500 for other database errors", async () => {
      fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("tasks") ? pgError("23503", "tasks_project_id_fkey") : undefined;
      await expectError(await callValid("create"), 500, "INTERNAL_ERROR");
    });
  });

  describe("invalid fields (Invalid task fields, T2, T5)", () => {
    const longTitle = "t".repeat(201);
    it.each([
      ["an unknown field", validCreate({ state: "To Do" })],
      ["a version field", validCreate({ version: 1 })],
      ["a missing title", validCreate({ title: undefined })],
      ["a non-string title", validCreate({ title: 5 })],
      ["a blank title", validCreate({ title: "   " })],
      ["a 201-character title", validCreate({ title: longTitle })],
      ["a title with a line feed", validCreate({ title: "two\nlines" })],
      ["a title with a carriage return", validCreate({ title: "two\rlines" })],
      ["a missing description", validCreate({ description: undefined })],
      ["a blank description", validCreate({ description: " " })],
      ["a 5,001-character description", validCreate({ description: "d".repeat(5001) })],
      ["criteria that are not an array", validCreate({ acceptanceCriteria: "one" })],
      ["21 criteria", validCreate({ acceptanceCriteria: Array.from({ length: 21 }, (_, index) => `criterion ${index}`) })],
      ["a blank criterion", validCreate({ acceptanceCriteria: ["ok", "  "] })],
      ["a 501-character criterion", validCreate({ acceptanceCriteria: ["c".repeat(501)] })],
      ["a non-string criterion", validCreate({ acceptanceCriteria: [{ description: "object" }] })],
      ["a missing due date", validCreate({ dueDate: undefined })],
      ["an impossible due date", validCreate({ dueDate: "2026-02-30" })],
      ["a short due date", validCreate({ dueDate: "2026-1-05" })],
      ["a timestamp due date", validCreate({ dueDate: "2026-12-01T00:00:00Z" })],
      ["a numeric due date", validCreate({ dueDate: 20261201 })],
      ["a missing assignee", validCreate({ assigneeId: undefined })],
      ["a malformed assignee", validCreate({ assigneeId: "not-a-uuid" })],
      ["an empty branch name", validCreate({ branchName: "  " })],
      ["a branch name with ..", validCreate({ branchName: "a..b" })],
      ["a branch name with //", validCreate({ branchName: "a//b" })],
      ["a branch name starting with /", validCreate({ branchName: "/a" })],
      ["a branch name starting with -", validCreate({ branchName: "-a" })],
      ["a branch name ending with /", validCreate({ branchName: "a/" })],
      ["a branch name ending with .", validCreate({ branchName: "a." })],
      ["a branch name ending with .lock", validCreate({ branchName: "a.lock" })],
      ["a branch name with a space", validCreate({ branchName: "a b" })],
      ["a 256-character branch name", validCreate({ branchName: "b".repeat(256) })],
      ["a non-string branch name", validCreate({ branchName: 7 })],
      ["a JSON array body", [validCreate()]],
      ["a null body", null],
    ])("refuses %s with INVALID_REQUEST and creates nothing", async (_case, body) => {
      const before = snapshot();
      await expectError(await call("create", { body }), 400, "INVALID_REQUEST");
      expect(snapshot()).toBe(before);
      expect(writes()).toEqual([]);
    });

    it("refuses malformed JSON", async () => {
      await expectError(await call("create", { raw: "{broken" }), 400, "INVALID_REQUEST");
    });

    it.each([
      ["a 200-character title", { title: "t".repeat(200) }],
      ["a 200-code-point title of astral characters", { title: "\u{1F600}".repeat(200) }],
      ["a 5,000-character description", { description: "d".repeat(5000) }],
      ["20 criteria of 500 characters", { acceptanceCriteria: Array.from({ length: 20 }, () => "c".repeat(500)) }],
      ["a leap-day due date", { dueDate: "2028-02-29" }],
      ["a past due date", { dueDate: "2020-01-01" }],
      ["a 255-character branch name", { branchName: "b".repeat(255) }],
      ["a nested branch name", { branchName: "feature/WEB-12_fix.v2" }],
    ])("accepts %s at the limit", async (_case, overrides) => {
      await expectSuccess(await call("create", { body: validCreate(overrides) }), 201);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{projectId}/tasks/{taskId}
// ---------------------------------------------------------------------------

describe("GET /api/v1/projects/{projectId}/tasks/{taskId} (Member reads a task)", () => {
  it.each([
    ["the product manager", people.pm],
    ["the assigned developer", people.dev],
    ["an unassigned developer", people.dev2],
  ])("returns the task view to %s (T15)", async (_case, reader) => {
    const task = addTask({ criteria: ["First", "Second"] });
    task.branch_name = "feature/stored";
    task.status = "in_progress";
    signInAs(reader.auth_user_id);
    const body = await expectSuccess(await call("read", { taskId: task.id }), 200);
    expect(body).toEqual({
      id: task.id,
      taskKey: "WEB-1",
      title: "Stored task",
      description: "Stored description",
      assignee: { personId: people.dev.id, githubUsername: "Synthetic-Dev" },
      dueDate: "2026-11-30",
      branchName: "feature/stored",
      state: "In Progress",
      acceptanceCriteria: criteriaOf(task.id).map(({ id, position, description }) => ({ id, position, description })),
      version: 1,
      createdAt: STORED_TIME,
      updatedAt: STORED_TIME,
    });
    expect(writes()).toEqual([]);
  });

  it.each([["to_do", "To Do"], ["in_progress", "In Progress"], ["in_review", "In Review"], ["done", "Done"]])(
    "shows stored state %s as %s", async (status, state) => {
      const task = addTask({ status });
      expect((await expectSuccess(await call("read", { taskId: task.id }), 200)).state).toBe(state);
    },
  );

  it("orders criteria by position, then ID", async () => {
    const task = addTask({ criteria: [] });
    const rows = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", position: 2, description: "third" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", position: 1, description: "second" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", position: 1, description: "first" },
    ];
    for (const row of rows) {
      fake.state.acceptance_criteria.push({ ...row, task_id: task.id, version: 1, created_at: STORED_TIME, updated_at: STORED_TIME });
    }
    const body = await expectSuccess(await call("read", { taskId: task.id }), 200);
    expect(body.acceptanceCriteria.map((criterion) => criterion.description)).toEqual(["first", "second", "third"]);
  });

  it("does not include checkHistory (C1: added by task 7.3)", async () => {
    const task = addTask();
    const body = await expectSuccess(await call("read", { taskId: task.id }), 200) as unknown as Record<string, unknown>;
    expect(body).not.toHaveProperty("checkHistory");
  });

  it.each([
    ["a deleted task", () => addTask({ deleted: true }).id],
    ["a task in another project", () => addTask({ project: otherProjectId }).id],
    ["a missing task", () => missingTaskId],
  ])("conceals %s with 404", async (_case, taskId) => {
    await expectError(await call("read", { taskId: taskId() }), 404, "NOT_FOUND");
  });

  it("conceals the task from a non-member", async () => {
    const task = addTask();
    signInAs(people.otherDev.auth_user_id);
    await expectError(await call("read", { taskId: task.id }), 404, "NOT_FOUND");
  });

  it("needs no Origin header and rejects a malformed task UUID with 400", async () => {
    await expectError(await call("read", { taskId: "not-a-uuid", origin: null }), 400, "INVALID_REQUEST");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/projects/{projectId}/tasks/{taskId}
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/projects/{projectId}/tasks/{taskId} (Product manager edits a task)", () => {
  it("changes only the fields sent and increases the version by one (T4, T6)", async () => {
    const task = addTask();
    const criteriaBefore = structuredClone(criteriaOf(task.id));
    const body = await expectSuccess(await call("edit", { taskId: task.id, body: { version: 1, title: "  New title " } }), 200);
    expect(body).toMatchObject({
      id: task.id, title: "New title", description: "Stored description", dueDate: "2026-11-30", branchName: null, version: 2,
    });
    expect(taskRow(task.id)).toMatchObject({ title: "New title", description: "Stored description", version: 2, assignee_id: people.dev.id, status: "to_do" });
    expect(criteriaOf(task.id)).toEqual(criteriaBefore);
  });

  it.each([
    ["description", { description: "New description" }, { description: "New description" }],
    ["due date", { dueDate: "2027-01-15" }, { due_date: "2027-01-15" }],
    ["branch name", { branchName: "feature/new" }, { branch_name: "feature/new" }],
  ])("edits the %s", async (_field, change, stored) => {
    const task = addTask();
    await expectSuccess(await call("edit", { taskId: task.id, body: { version: 1, ...change } }), 200);
    expect(taskRow(task.id)).toMatchObject({ ...stored, version: 2 });
  });

  it("clears the branch name with null", async () => {
    const task = addTask();
    task.branch_name = "feature/old";
    const body = await expectSuccess(await call("edit", { taskId: task.id, body: { version: 1, branchName: null } }), 200);
    expect(body.branchName).toBeNull();
    expect(taskRow(task.id).branch_name).toBeNull();
  });

  it("edits criteria as a list: keeps IDs, inserts new items and removes omitted ones (Acceptance criteria are edited as a list)", async () => {
    const task = addTask({ criteria: ["keep me", "drop me", "move me"] });
    const [keep, , move] = criteriaOf(task.id);
    const body = await expectSuccess(await call("edit", { taskId: task.id, body: {
      version: 1,
      acceptanceCriteria: [
        { id: move.id, description: "moved first" },
        { description: "  brand new " },
        { id: keep.id, description: "kept, reworded" },
      ],
    } }), 200);
    expect(body.acceptanceCriteria).toEqual([
      { id: move.id, position: 1, description: "moved first" },
      { id: expect.stringMatching(UUID_PATTERN), position: 2, description: "brand new" },
      { id: keep.id, position: 3, description: "kept, reworded" },
    ]);
    expect(criteriaOf(task.id).map(({ id, position, description }) => ({ id, position, description }))).toEqual(body.acceptanceCriteria);
    expect(new Set(fake.state.acceptance_criteria.map((criterion) => criterion.id)).has(body.acceptanceCriteria[1].id)).toBe(true);
  });

  it("increases the task version exactly once for a criteria-only edit (T6)", async () => {
    const task = addTask({ criteria: ["one"] });
    const [one] = criteriaOf(task.id);
    const body = await expectSuccess(await call("edit", { taskId: task.id, body: {
      version: 1, acceptanceCriteria: [{ id: one.id, description: "one, edited" }, { description: "two" }],
    } }), 200);
    expect(body.version).toBe(2);
    expect(taskRow(task.id).version).toBe(2);
    expect(fake.log.filter((entry) => entry.kind === "update" && entry.tables.includes("tasks"))).toHaveLength(1);
  });

  it.each([
    ["a criterion of another task", () => criteriaOf(addTask().id)[0].id],
    ["an unknown criterion", () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  ])("refuses %s ID with INVALID_REQUEST and changes nothing", async (_case, foreignId) => {
    const task = addTask({ criteria: ["one"] });
    const id = foreignId();
    const before = snapshot();
    await expectError(await call("edit", { taskId: task.id, body: {
      version: 1, acceptanceCriteria: [{ id, description: "hijack" }],
    } }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("refuses a criterion ID sent twice", async () => {
    const task = addTask({ criteria: ["one"] });
    const [one] = criteriaOf(task.id);
    const before = snapshot();
    await expectError(await call("edit", { taskId: task.id, body: {
      version: 1, acceptanceCriteria: [{ id: one.id, description: "a" }, { id: one.id, description: "b" }],
    } }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("refuses an empty criteria list with ACCEPTANCE_CRITERIA_REQUIRED (T7)", async () => {
    const task = addTask();
    const before = snapshot();
    await expectError(await call("edit", { taskId: task.id, body: { version: 1, acceptanceCriteria: [] } }), 400, "ACCEPTANCE_CRITERIA_REQUIRED");
    expect(snapshot()).toBe(before);
    await expectError(await call("edit", { taskId: task.id, body: { version: 1, acceptanceCriteria: [], title: "" } }), 400, "INVALID_REQUEST");
  });

  it.each([
    ["only a version", { version: 1 }],
    ["no version", { title: "x" }],
    ["a zero version", { version: 0, title: "x" }],
    ["a string version", { version: "1", title: "x" }],
    ["a fractional version", { version: 1.5, title: "x" }],
    ["an assignee", { version: 1, assigneeId: people.dev2.id }],
    ["a state", { version: 1, state: "Done" }],
    ["an unknown field", { version: 1, title: "x", priority: "high" }],
    ["a blank title", { version: 1, title: "" }],
    ["an impossible due date", { version: 1, dueDate: "2026-13-01" }],
    ["an invalid branch name", { version: 1, branchName: "a..b" }],
    ["a criterion with an unknown key", { version: 1, acceptanceCriteria: [{ description: "x", position: 1 }] }],
    ["a criterion that is a string", { version: 1, acceptanceCriteria: ["x"] }],
    ["a criterion with a malformed ID", { version: 1, acceptanceCriteria: [{ id: "nope", description: "x" }] }],
    ["21 criteria", { version: 1, acceptanceCriteria: Array.from({ length: 21 }, () => ({ description: "x" })) }],
  ])("refuses a body with %s (T4, T5)", async (_case, body) => {
    const task = addTask();
    const before = snapshot();
    await expectError(await call("edit", { taskId: task.id, body }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("refuses a stale version with VERSION_CONFLICT and leaves the task unchanged (Edit with a stale version)", async () => {
    const task = addTask({ version: 3 });
    const before = snapshot();
    await expectError(await call("edit", { taskId: task.id, body: { version: 2, title: "Too late" } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
  });

  it("refuses an edit whose version changed after the task was read (competing writes)", async () => {
    const task = addTask();
    fake.beforeStatement = ({ kind, tables }) => {
      if (kind === "update" && tables.includes("tasks")) {
        fake.beforeStatement = undefined;
        fake.applyCommitted((state) => { const row = state.tasks.find((entry) => entry.id === task.id)!; row.version = 2; row.title = "Other writer"; });
      }
    };
    await expectError(await call("edit", { taskId: task.id, body: { version: 1, title: "Mine" } }), 409, "VERSION_CONFLICT");
    expect(taskRow(task.id)).toMatchObject({ title: "Other writer", version: 2 });
    expect(criteriaOf(task.id)).toHaveLength(2);
  });

  it.each(["to_do", "in_progress", "in_review", "done"])("edits a task in state %s without changing its state (T11)", async (status) => {
    const task = addTask({ status });
    await expectSuccess(await call("edit", { taskId: task.id, body: { version: 1, title: "Any state" } }), 200);
    expect(taskRow(task.id).status).toBe(status);
  });

  it("writes no task event on edit (T10)", async () => {
    const task = addTask();
    await expectSuccess(await call("edit", { taskId: task.id, body: { version: 1, title: "x", acceptanceCriteria: [{ description: "y" }] } }), 200);
    expect(fake.state.task_events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/projects/{projectId}/tasks/{taskId}/assignee
// ---------------------------------------------------------------------------

describe("PUT /api/v1/projects/{projectId}/tasks/{taskId}/assignee (Product manager reassigns a task)", () => {
  it("reassigns to another developer, keeps the state and records one assignment change (T9)", async () => {
    const task = addTask({ status: "in_progress" });
    const body = await expectSuccess(await call("reassign", { taskId: task.id, body: { assigneeId: people.dev2.id, version: 1 } }), 200);
    expect(body).toMatchObject({ id: task.id, assignee: { personId: people.dev2.id, githubUsername: "Synthetic-Dev2" }, state: "In Progress", version: 2 });
    expect(taskRow(task.id)).toMatchObject({ assignee_id: people.dev2.id, status: "in_progress", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      actor_id: people.pm.id,
      event_type: "assignment_change",
      previous_assignee_id: people.dev.id,
      new_assignee_id: people.dev2.id,
      from_status: null,
      to_status: null,
      feedback: null,
      check_result_id: null,
    })]);
  });

  it.each(["to_do", "in_progress", "in_review", "done"])("reassigns a task in state %s without changing it (T11)", async (status) => {
    const task = addTask({ status });
    await expectSuccess(await call("reassign", { taskId: task.id, body: { assigneeId: people.dev2.id, version: 1 } }), 200);
    expect(taskRow(task.id).status).toBe(status);
  });

  it("returns the unchanged task for the current assignee, with no event and no version change (Reassigning to the current assignee)", async () => {
    const task = addTask();
    const before = snapshot();
    const body = await expectSuccess(await call("reassign", { taskId: task.id, body: { assigneeId: people.dev.id, version: 1 } }), 200);
    expect(body).toMatchObject({ assignee: { personId: people.dev.id }, version: 1 });
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["another assignee", people.dev2.id],
    ["the current assignee", people.dev.id],
  ])("refuses a stale version for %s with VERSION_CONFLICT", async (_case, assigneeId) => {
    const task = addTask({ version: 2 });
    const before = snapshot();
    await expectError(await call("reassign", { taskId: task.id, body: { assigneeId, version: 1 } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["a registered non-member", people.outsider.id],
    ["the product manager", people.pm.id],
    ["a developer of another project only", people.otherDev.id],
    ["an unknown person", unknownPersonId],
  ])("refuses %s with ASSIGNEE_NOT_DEVELOPER and changes nothing", async (_case, assigneeId) => {
    const task = addTask();
    const before = snapshot();
    await expectError(await call("reassign", { taskId: task.id, body: { assigneeId, version: 1 } }), 409, "ASSIGNEE_NOT_DEVELOPER", [assigneeId]);
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["an extra field", { assigneeId: people.dev2.id, version: 1, note: "x" }],
    ["no version", { assigneeId: people.dev2.id }],
    ["no assignee", { version: 1 }],
    ["a malformed assignee", { assigneeId: "dev2", version: 1 }],
    ["a null assignee", { assigneeId: null, version: 1 }],
  ])("refuses a body with %s", async (_case, body) => {
    const task = addTask();
    const before = snapshot();
    await expectError(await call("reassign", { taskId: task.id, body }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/projects/{projectId}/tasks/{taskId}
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/projects/{projectId}/tasks/{taskId} (Product manager deletes a task)", () => {
  it("marks the task deleted, keeps its history, and returns 204 with no body (Deleted task is no longer available)", async () => {
    const task = addTask({ status: "in_review" });
    fake.state.task_events.push({
      id: randomUUID(), task_id: task.id, actor_id: people.dev.id, event_type: "state_change", from_status: "to_do", to_status: "in_progress",
      previous_assignee_id: null, new_assignee_id: null, check_result_id: null, feedback: null, created_at: STORED_TIME,
    });
    const criteriaBefore = structuredClone(criteriaOf(task.id));
    const response = await call("delete", { taskId: task.id, body: { version: 1 } });
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("");
    expect(taskRow(task.id)).toMatchObject({ status: "in_review", version: 2, deleted_at: expect.stringMatching(ISO_UTC) });
    expect(criteriaOf(task.id)).toEqual(criteriaBefore);
    expect(eventsOf(task.id)).toHaveLength(1);
    expect(writes().every((entry) => entry.kind === "update" && entry.tables.join() === "tasks")).toBe(true);
  });

  it.each(["read", "edit", "reassign", "delete"] as const)("answers a later %s of the deleted task with 404", async (route) => {
    const task = addTask();
    expect((await call("delete", { taskId: task.id, body: { version: 1 } })).status).toBe(204);
    const deleted = taskRow(task.id);
    await expectError(await callValid(route, deleted), 404, "NOT_FOUND");
  });

  it("refuses a stale version with VERSION_CONFLICT", async () => {
    const task = addTask({ version: 4 });
    const before = snapshot();
    await expectError(await call("delete", { taskId: task.id, body: { version: 3 } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["an empty object", {}],
    ["an extra field", { version: 1, reason: "x" }],
    ["a string version", { version: "1" }],
  ])("refuses a body with %s", async (_case, body) => {
    const task = addTask();
    await expectError(await call("delete", { taskId: task.id, body }), 400, "INVALID_REQUEST");
    expect(taskRow(task.id).deleted_at).toBeNull();
  });

  it("refuses a request without a JSON body", async () => {
    const task = addTask();
    await expectError(await call("delete", { taskId: task.id, raw: "" }), 400, "INVALID_REQUEST");
    await expectError(await call("delete", { taskId: task.id, raw: "", contentType: null }), 400, "INVALID_REQUEST");
    expect(taskRow(task.id).deleted_at).toBeNull();
  });

  it.each(["to_do", "in_progress", "in_review", "done"])("deletes a task in state %s (T11)", async (status) => {
    const task = addTask({ status });
    expect((await call("delete", { taskId: task.id, body: { version: 1 } })).status).toBe(204);
  });

  it("writes no task event (T10) and touches no report (T12)", async () => {
    const task = addTask();
    expect((await call("delete", { taskId: task.id, body: { version: 1 } })).status).toBe(204);
    expect(fake.state.task_events).toEqual([]);
    expect(fake.log.some((entry) => /\breports\b/i.test(entry.sql))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Authorization, Origin and check order (T8)
// ---------------------------------------------------------------------------

describe("authorization (Developer cannot manage tasks)", () => {
  it.each(PM_ONLY)("refuses an assigned developer's %s with 403 and changes nothing", async (route) => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    const before = snapshot();
    await expectError(await callValid(route, task), 403, "FORBIDDEN");
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
  });

  it.each([...PM_ONLY, "read"] as Route[])("conceals %s from a non-member with 404", async (route) => {
    const task = addTask();
    signInAs(people.outsider.auth_user_id);
    const before = snapshot();
    await expectError(await callValid(route, task), 404, "NOT_FOUND");
    expect(snapshot()).toBe(before);
  });

  it.each([...PM_ONLY, "read"] as Route[])("conceals %s from a person with no application identity", async (route) => {
    const task = addTask();
    signInAs("10101010-1010-4010-8010-101010101010");
    await expectError(await callValid(route, task), 404, "NOT_FOUND");
  });

  it.each([...PM_ONLY, "read"] as Route[])("refuses an unauthenticated %s with 401", async (route) => {
    const task = addTask();
    signOut();
    await expectError(await callValid(route, task), 401, "UNAUTHENTICATED");
    expect(writes()).toEqual([]);
  });

  it.each(TASK_ROUTES)("conceals a task of another project on %s, even from that project's PM", async (route) => {
    const task = addTask({ project: otherProjectId });
    signInAs(people.otherPm.auth_user_id);
    await expectError(await callValid(route, task), 404, "NOT_FOUND");
  });

  it.each(TASK_ROUTES)("returns a safe 500 when the task lookup fails on %s", async (route) => {
    const task = addTask();
    fake.failWhen = ({ kind, tables }) => kind === "select" && tables.includes("tasks") ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await callValid(route, task), 500, "INTERNAL_ERROR");
  });

  it("returns a safe 500 when the membership lookup fails", async () => {
    fake.failWhen = ({ tables }) => tables.includes("memberships") ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await callValid("create"), 500, "INTERNAL_ERROR");
  });

  it.each(TASK_ROUTES)("rejects a malformed task UUID on %s with 400", async (route) => {
    await expectError(await call(route, { taskId: "not-a-uuid", body: validBody(route) }), 400, "INVALID_REQUEST");
  });

  it.each([...PM_ONLY, "read"] as Route[])("rejects a malformed project UUID on %s with 400", async (route) => {
    await expectError(await call(route, { projectId: "not-a-uuid", body: validBody(route) }), 400, "INVALID_REQUEST");
  });
});

describe("Origin and content type (Mutating project routes check the request origin)", () => {
  it.each(MUTATIONS)("refuses %s with a missing Origin (403) and changes nothing", async (route) => {
    const task = addTask();
    const before = snapshot();
    await expectError(await callValid(route, task, { origin: null }), 403, "FORBIDDEN");
    expect(snapshot()).toBe(before);
  });

  it.each(MUTATIONS)("refuses %s with a different Origin (403)", async (route) => {
    const task = addTask();
    await expectError(await callValid(route, task, { origin: "https://synthetic-attacker.example" }), 403, "FORBIDDEN");
  });

  it.each(MUTATIONS)("refuses %s with a wrong content type (400)", async (route) => {
    const task = addTask();
    await expectError(await callValid(route, task, { contentType: "text/plain" }), 400, "INVALID_REQUEST");
  });

  it.each(MUTATIONS)("gives 403 to %s with a bad Origin and a wrong content type", async (route) => {
    const task = addTask();
    await expectError(await callValid(route, task, { origin: null, contentType: "text/plain" }), 403, "FORBIDDEN");
  });

  it.each(MUTATIONS)("gives 403, not 401, to %s with a bad Origin and no session", async (route) => {
    const task = addTask();
    signOut();
    await expectError(await callValid(route, task, { origin: null }), 403, "FORBIDDEN");
  });

  it.each(MUTATIONS)("accepts %s with a JSON content type that has parameters", async (route) => {
    const task = addTask();
    const response = await callValid(route, task, { contentType: "Application/JSON; charset=utf-8" });
    expect([200, 201, 204]).toContain(response.status);
  });
});

describe("check order (T8, Q4)", () => {
  it.each(MUTATIONS)("gives 400, not 401, to %s with a bad body and no session", async (route) => {
    const task = addTask();
    signOut();
    await expectError(await call(route, { taskId: task.id, body: { unexpected: true } }), 400, "INVALID_REQUEST");
  });

  it("gives ACCEPTANCE_CRITERIA_REQUIRED before the session check", async () => {
    signOut();
    await expectError(await call("create", { body: validCreate({ acceptanceCriteria: [] }) }), 400, "ACCEPTANCE_CRITERIA_REQUIRED");
  });

  it.each(PM_ONLY)("gives 404, not 403, to a non-member on %s", async (route) => {
    const task = addTask();
    signInAs(people.otherDev.auth_user_id);
    await expectError(await callValid(route, task), 404, "NOT_FOUND");
  });

  it.each(["edit", "reassign", "delete"] as const)("gives 404, not 403, to a developer on %s of a missing task", async (route) => {
    signInAs(people.dev.auth_user_id);
    await expectError(await call(route, { taskId: missingTaskId, body: validBody(route) }), 404, "NOT_FOUND");
  });

  it.each(["edit", "reassign", "delete"] as const)("gives 404, not 403, to a developer on %s of a deleted task", async (route) => {
    const task = addTask({ deleted: true });
    signInAs(people.dev.auth_user_id);
    await expectError(await callValid(route, task), 404, "NOT_FOUND");
  });

  it.each(["edit", "reassign", "delete"] as const)("gives 403, not 409, to a developer sending a stale version on %s", async (route) => {
    const task = addTask({ version: 5 });
    signInAs(people.dev.auth_user_id);
    await expectError(await call(route, { taskId: task.id, body: { ...(validBody(route) as object), version: 1 } }), 403, "FORBIDDEN");
  });

  it("gives 403, not 409, to a developer creating a task for an outsider", async () => {
    signInAs(people.dev.auth_user_id);
    await expectError(await call("create", { body: validCreate({ assigneeId: people.outsider.id }) }), 403, "FORBIDDEN");
  });
});
