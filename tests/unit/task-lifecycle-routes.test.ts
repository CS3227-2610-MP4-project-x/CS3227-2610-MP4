import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeDatabase, PRIVATE_DETAIL, UUID_PATTERN, type LogEntry, type PersonRow, type State, type TaskRow } from "./support/sql-fake";

// OpenSpec task 4.3 (tasks-lifecycle-4-3). No formal requirement IDs exist; cited by name:
// task-management "Task lifecycle", "Task state route", "Task completion requires
// product-manager approval", "Submission records attached commits and a matching check",
// "Submission rechecks its inputs before it is stored", "Lifecycle changes are recorded as task
// events" and "Developer submits task progress"; identity-and-access "Protected route
// authorization stubs" ("Task state transition is functional and enforces lifecycle
// permissions", "Invalid state transition uses the permission response", "Progress update route
// is a protected mutating route"), "Protected API errors use stable safe responses" and
// "Mutating project routes check the request origin"; completion-assessment "Submission can look
// up the committed tip" and "AI check does not decide task completion".
// Decisions: design.md "Task Lifecycle Decisions (4.3)" L1 to L8 and its check order; T3, T5,
// T6, T8 and U2 from "Task Management Decisions (4.2)"; the API Error Contract.
//
// The real route handlers, services and repositories run. Supabase Auth, server config, `pg`,
// the GitHub App adapter and the completion-assessment tip lookup are replaced. The tip lookup
// is the seam this file assumes (see the session report in the 4.3 handoff):
//   `SubmissionTipLookup` exported from `@/server/completion-assessment`, constructed by
//   `src/server/composition.ts`, with `findSubmissionTip(projectId, taskId)` resolving to a tip
//   or `null`. The stub here resolves `null` (no tip), so no check reference is stored; the
//   unit SQL fake does not model attached_commits or check_results, and the matching-check
//   paths are covered by tests/integration/db/task-lifecycle.test.ts.
// The `pg` fake evaluates statements with PostgreSQL's semantics and throws on anything it
// cannot read. Tests assert recorded behaviour and stored state, not SQL text. All identities
// and rows are synthetic.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  findSubmissionTip: vi.fn(),
  github: vi.fn(),
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
    githubAppId: "123",
    githubAppSlug: "synthetic-app",
    githubAppPrivateKey: "synthetic-private-key",
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
// Safety net: no test here may reach GitHub. Any adapter call is recorded and refused.
vi.mock("@/server/github", async (original) => ({
  ...await original<typeof import("@/server/github")>(),
  GitHubAppAdapter: class {
    getRepositoryDefaultBranch = boundary.github;
    listBranches = boundary.github;
    fetchFileAtCommit = boundary.github;
    isAncestor = boundary.github;
    fetchDiff = boundary.github;
  },
}));
vi.mock("@/server/completion-assessment", async (original) => ({
  ...await original<typeof import("@/server/completion-assessment")>(),
  SubmissionTipLookup: class {
    findSubmissionTip = boundary.findSubmissionTip;
  },
}));

// ---------------------------------------------------------------------------
// Synthetic team: project WEB (pm, dev, dev2) and project OTH (otherPm, otherDev)
// ---------------------------------------------------------------------------

const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const otherProjectId = "33333333-3333-4333-8333-333333333334";
const missingTaskId = "99999999-9999-4999-8999-999999999999";
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const STORED_TIME = "2026-11-01T02:03:04.000Z";

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
  version?: number;
}

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
  ["Stored criterion one", "Stored criterion two"].forEach((description, index) => {
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
    .sort((left, right) => left.position - right.position)
    .map(({ id, position, description }) => ({ id, position, description }));
}

function eventsOf(taskId: string) {
  return fake.state.task_events.filter((event) => event.task_id === taskId);
}

function updatesOf(taskId: string) {
  return fake.state.progress_updates.filter((update) => update.task_id === taskId);
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

type Route = "state" | "progress";

interface CallOptions {
  projectId?: string;
  taskId?: string;
  body?: unknown;
  raw?: string;
  origin?: string | null;
  contentType?: string | null;
}

async function call(route: Route, options: CallOptions = {}): Promise<Response> {
  const project = options.projectId ?? projectId;
  const taskId = options.taskId ?? missingTaskId;
  const taskPath = `/api/v1/projects/${project}/tasks/${taskId}`;
  const path = route === "state" ? `${taskPath}/state` : `${taskPath}/progress-updates`;
  const headers: Record<string, string> = {};
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (requestOrigin !== null) headers.origin = requestOrigin;
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  const body = options.raw ?? JSON.stringify(options.body ?? {});
  const request = new NextRequest(`${origin}${path}`, { method: route === "state" ? "PATCH" : "POST", headers, body });
  const context = { params: Promise.resolve({ projectId: project, taskId }) };
  if (route === "state") {
    return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route")).PATCH(request, context);
  }
  return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/progress-updates/route")).POST(request, context);
}

/** PATCH .../state for a stored task with the given state, its current version and optional feedback. */
async function transition(task: TaskRow, state: string, extra: Record<string, unknown> = {}, options: CallOptions = {}): Promise<Response> {
  return call("state", { taskId: task.id, body: { state, version: taskRow(task.id)?.version ?? task.version, ...extra }, ...options });
}

async function postUpdate(task: TaskRow, body: unknown = { body: "Synthetic progress update" }, options: CallOptions = {}): Promise<Response> {
  return call("progress", { taskId: task.id, body, ...options });
}

const stableMessages: Record<string, string> = {
  INVALID_REQUEST: "Invalid request",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Insufficient permissions",
  NOT_FOUND: "Resource not found",
  INTERNAL_ERROR: "Internal server error",
};

/** Asserts the safe error envelope; codes with a recorded generic message are checked exactly. */
async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(text).not.toContain(PRIVATE_DETAIL);
  const body = JSON.parse(text) as { error: { code: string; message: string } };
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  if (stableMessages[code]) expect(body.error.message).toBe(stableMessages[code]);
  else expect(body.error.message.trim()).not.toBe("");
}

async function expectSuccess<T = TaskViewBody>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response.json() as Promise<T>;
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

interface ProgressUpdateBody {
  id: string;
  author: { id: string; githubUsername: string };
  body: string;
  createdAt: string;
}

function writes(): LogEntry[] {
  return fake.log.filter((entry) => entry.kind === "insert" || entry.kind === "update" || entry.kind === "delete");
}

function snapshot(): string {
  return JSON.stringify(fake.state);
}

/** Transactions open at this point of the log (BEGIN minus COMMIT/ROLLBACK). */
function openTransactions(): number {
  return fake.log.reduce((open, entry) =>
    entry.kind === "begin" ? open + 1 : entry.kind === "commit" || entry.kind === "rollback" ? open - 1 : open, 0);
}

/**
 * Simulates a write committed by another request just before this request locks or writes the
 * task row: the first `SELECT ... FOR UPDATE` on tasks, the first task UPDATE, or the first
 * event or progress-update INSERT, whichever comes first. The handler's earlier unlocked task
 * lookup is not affected, so the change lands between that lookup and the guarded write.
 */
/** A row lock that a concurrent task UPDATE (a reassignment or transition) must wait for. */
const ROW_LOCK = /\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+share\b/i;

function commitConcurrently(change: (state: State) => void): void {
  fake.beforeStatement = ({ sql, kind, tables }) => {
    const lock = kind === "select" && tables.includes("tasks") && ROW_LOCK.test(sql);
    const write = (kind === "update" && tables.includes("tasks"))
      || (kind === "insert" && (tables.includes("task_events") || tables.includes("progress_updates")));
    if (lock || write) {
      fake.beforeStatement = undefined;
      fake.applyCommitted(change);
    }
  };
}

interface TipCall { args: unknown[]; openTransactions: number; logLength: number }
let tipCalls: TipCall[];

beforeEach(() => {
  vi.clearAllMocks();
  fake = new FakeDatabase();
  seed();
  tipCalls = [];
  boundary.query.mockImplementation(fake.query);
  boundary.connect.mockImplementation(async () => ({ query: boundary.query, release: boundary.release }));
  boundary.github.mockRejectedValue(new Error(PRIVATE_DETAIL));
  boundary.findSubmissionTip.mockImplementation(async (...args: unknown[]) => {
    tipCalls.push({ args, openTransactions: openTransactions(), logLength: fake.log.length });
    return null;
  });
  signInAs(people.pm.auth_user_id);
});

afterEach(() => {
  expect(fake.unexpected).toEqual([]);
  // Every client taken for a transaction is released, and no GitHub call was made.
  expect(boundary.release).toHaveBeenCalledTimes(boundary.connect.mock.calls.length);
  expect(boundary.github).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Allowed transitions (Task lifecycle, Task state route, L1, L6, L7)
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/projects/{projectId}/tasks/{taskId}/state: allowed transitions", () => {
  it("lets the assigned developer start a To Do task and returns the task view with version + 1 (Developer starts a task, L7)", async () => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await transition(task, "In Progress"), 200);
    expect(body).toEqual({
      id: task.id,
      taskKey: "WEB-1",
      title: "Stored task",
      description: "Stored description",
      assignee: { personId: people.dev.id, githubUsername: "Synthetic-Dev" },
      dueDate: "2026-11-30",
      branchName: null,
      state: "In Progress",
      acceptanceCriteria: criteriaOf(task.id),
      version: 2,
      createdAt: STORED_TIME,
      updatedAt: expect.stringMatching(ISO_UTC),
    });
    expect(taskRow(task.id)).toMatchObject({ status: "in_progress", version: 2, assignee_id: people.dev.id, deleted_at: null });
  });

  it("lets the assigned developer submit an In Progress task for review (Developer submits work for review)", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await transition(task, "In Review"), 200);
    expect(body).toMatchObject({ id: task.id, state: "In Review", version: 2 });
    expect(taskRow(task.id)).toMatchObject({ status: "in_review", version: 2 });
  });

  it("lets the product manager approve an In Review task (Product manager approves submitted work)", async () => {
    const task = addTask({ status: "in_review" });
    const body = await expectSuccess(await transition(task, "Done"), 200);
    expect(body).toMatchObject({ id: task.id, state: "Done", version: 2 });
    expect(taskRow(task.id)).toMatchObject({ status: "done", version: 2 });
  });

  it("lets the product manager request changes with trimmed feedback (Product manager requests changes, L3)", async () => {
    const task = addTask({ status: "in_review" });
    const body = await expectSuccess(await transition(task, "In Progress", { feedback: "  Please add tests.  " }), 200);
    expect(body).toMatchObject({ id: task.id, state: "In Progress", version: 2 });
    expect(taskRow(task.id)).toMatchObject({ status: "in_progress", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({ event_type: "review_feedback", feedback: "Please add tests." })]);
  });

  it("increases the stored version by exactly one per transition (L1)", async () => {
    const task = addTask({ version: 7 });
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await transition(task, "In Progress"), 200);
    expect(body.version).toBe(8);
    expect(taskRow(task.id).version).toBe(8);
    expect(fake.log.filter((entry) => entry.kind === "update" && entry.tables.includes("tasks"))).toHaveLength(1);
  });

  it("accepts the largest valid version when it is the task's current version (U2)", async () => {
    const task = addTask({ status: "in_review", version: 2_147_483_646 });
    const body = await expectSuccess(await transition(task, "Done"), 200);
    expect(body.version).toBe(2_147_483_647);
  });

  it("runs the whole journey To Do → In Progress → In Review → Done with one event per step", async () => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    expect((await expectSuccess(await transition(task, "In Progress"), 200)).version).toBe(2);
    expect((await expectSuccess(await transition(task, "In Review"), 200)).version).toBe(3);
    signInAs(people.pm.auth_user_id);
    expect((await expectSuccess(await transition(task, "Done"), 200)).state).toBe("Done");
    expect(taskRow(task.id)).toMatchObject({ status: "done", version: 4 });
    expect(eventsOf(task.id).map(({ event_type, from_status, to_status }) => [event_type, from_status, to_status])).toEqual([
      ["state_change", "to_do", "in_progress"],
      ["submission", "in_progress", "in_review"],
      ["state_change", "in_review", "done"],
    ]);
  });

  it("keeps earlier events and feedback when the developer resubmits after changes were requested (Developer resubmits)", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    await expectSuccess(await transition(task, "In Review"), 200);
    signInAs(people.pm.auth_user_id);
    await expectSuccess(await transition(task, "In Progress", { feedback: "First round of feedback" }), 200);
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await transition(task, "In Review"), 200);
    expect(body).toMatchObject({ state: "In Review", version: 4 });
    expect(eventsOf(task.id).map((event) => event.event_type)).toEqual(["submission", "review_feedback", "submission"]);
    expect(eventsOf(task.id)[1]).toMatchObject({ actor_id: people.pm.id, feedback: "First round of feedback" });
  });

  it("does not change the assignee, title, criteria or deletion state (only the state and version change)", async () => {
    const task = addTask({ status: "in_review" });
    const before = structuredClone(taskRow(task.id));
    const criteriaBefore = criteriaOf(task.id);
    await expectSuccess(await transition(task, "Done"), 200);
    const fixed = ["id", "project_id", "number", "title", "description", "assignee_id", "due_date", "branch_name", "deleted_at", "created_at"] as const;
    const pick = (row: TaskRow) => Object.fromEntries(fixed.map((column) => [column, row[column]]));
    expect(pick(taskRow(task.id))).toEqual(pick(before));
    expect(taskRow(task.id)).toMatchObject({ status: "done", version: 2 });
    expect(criteriaOf(task.id)).toEqual(criteriaBefore);
  });
});

// ---------------------------------------------------------------------------
// The 403 matrix (L2): state x role x assignment
// ---------------------------------------------------------------------------

describe("the 403 matrix on the task's current state (Task lifecycle, L2)", () => {
  type Actor = "assigned developer" | "unassigned developer" | "product manager";
  const ACTORS: readonly Actor[] = ["assigned developer", "unassigned developer", "product manager"];
  const STATUSES = ["to_do", "in_progress", "in_review", "done"] as const;
  const TARGETS = ["To Do", "In Progress", "In Review", "Done"] as const;
  const ALLOWED = new Set([
    "assigned developer|to_do|In Progress",
    "assigned developer|in_progress|In Review",
    "product manager|in_review|Done",
    "product manager|in_review|In Progress",
  ]);
  const combinations = ACTORS.flatMap((actor) => STATUSES.flatMap((status) => TARGETS.map((target) => [actor, status, target] as const)));
  const authUserOf: Record<Actor, string> = {
    "assigned developer": people.dev.auth_user_id,
    "unassigned developer": people.dev2.auth_user_id,
    "product manager": people.pm.auth_user_id,
  };

  it.each(combinations.filter(([actor, status, target]) => !ALLOWED.has(`${actor}|${status}|${target}`)))(
    "refuses the %s's request on a %s task for %s with 403 FORBIDDEN and writes nothing",
    async (actor, status, target) => {
      const task = addTask({ status });
      signInAs(authUserOf[actor]);
      const before = snapshot();
      await expectError(await transition(task, target), 403, "FORBIDDEN");
      expect(snapshot()).toBe(before);
      expect(writes()).toEqual([]);
    },
  );

  it.each(combinations.filter(([actor, status, target]) => ALLOWED.has(`${actor}|${status}|${target}`)))(
    "allows the %s's request on a %s task for %s",
    async (actor, status, target) => {
      const task = addTask({ status });
      signInAs(authUserOf[actor]);
      const extra = actor === "product manager" && target === "In Progress" ? { feedback: "Synthetic feedback" } : {};
      const body = await expectSuccess(await transition(task, target, extra), 200);
      expect(body.state).toBe(target);
    },
  );

  it("refuses the assigned developer's request for changes even with feedback (Developer cannot request changes)", async () => {
    const task = addTask({ status: "in_review" });
    signInAs(people.dev.auth_user_id);
    const before = snapshot();
    await expectError(await transition(task, "In Progress", { feedback: "Self-review" }), 403, "FORBIDDEN");
    expect(snapshot()).toBe(before);
    expect(taskRow(task.id).status).toBe("in_review");
  });

  it("refuses a developer moving a task to Done (Developer cannot approve a submission)", async () => {
    const task = addTask({ status: "in_review" });
    signInAs(people.dev.auth_user_id);
    await expectError(await transition(task, "Done"), 403, "FORBIDDEN");
    expect(taskRow(task.id).status).toBe("in_review");
  });

  it("refuses a developer moving a task assigned to another developer (Developer cannot move another developer's task)", async () => {
    const task = addTask({ assigneeId: people.dev2.id });
    signInAs(people.dev.auth_user_id);
    await expectError(await transition(task, "In Progress"), 403, "FORBIDDEN");
    expect(taskRow(task.id)).toMatchObject({ status: "to_do", version: 1 });
  });
});

// ---------------------------------------------------------------------------
// Request changes and feedback (L3)
// ---------------------------------------------------------------------------

describe("request changes feedback (Task completion requires product-manager approval, L3)", () => {
  it.each([
    ["no feedback", {}],
    ["blank feedback", { feedback: "   " }],
    ["empty feedback", { feedback: "" }],
    ["numeric feedback", { feedback: 5 }],
    ["null feedback", { feedback: null }],
    ["object feedback", { feedback: { text: "x" } }],
    ["array feedback", { feedback: ["x"] }],
    ["5,001-character feedback", { feedback: "f".repeat(5001) }],
    ["5,001-code-point feedback of astral characters", { feedback: "\u{1F600}".repeat(5001) }],
  ])("refuses the product manager's request for changes with %s with 400 and changes nothing (Missing or invalid feedback)", async (_case, extra) => {
    const task = addTask({ status: "in_review" });
    const before = snapshot();
    await expectError(await transition(task, "In Progress", extra), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
  });

  it("accepts 5,000 code points of feedback after trimming (code points, as T5)", async () => {
    const task = addTask({ status: "in_review" });
    const feedback = "\u{1F600}".repeat(5000);
    await expectSuccess(await transition(task, "In Progress", { feedback: `  ${feedback}  ` }), 200);
    expect(eventsOf(task.id)[0].feedback).toBe(feedback);
  });

  it("stores feedback as plain text without interpreting markup (Feedback is plain trimmed text)", async () => {
    const task = addTask({ status: "in_review" });
    const feedback = "<script>alert('x')</script> **not markdown** &amp;";
    await expectSuccess(await transition(task, "In Progress", { feedback }), 200);
    expect(eventsOf(task.id)[0].feedback).toBe(feedback);
  });

  it.each([
    ["the assigned developer starting a task", "to_do", "In Progress", "dev"],
  ] as const)("refuses feedback on another transition (%s) with 400 and changes nothing (Feedback on another transition)", async (_case, status, target, actor) => {
    const task = addTask({ status });
    signInAs(people[actor].auth_user_id);
    const before = snapshot();
    await expectError(await transition(task, target, { feedback: "Not a review" }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["Done", "pm", "in_review"],
    ["In Review", "dev", "in_progress"],
    ["To Do", "pm", "in_review"],
  ] as const)("refuses feedback with state %s with 400 (Invalid state request)", async (target, actor, status) => {
    const task = addTask({ status });
    signInAs(people[actor].auth_user_id);
    const before = snapshot();
    await expectError(await transition(task, target, { feedback: "Synthetic feedback" }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("checks the feedback rule before the version guard: no feedback with a stale version is 400, not 409", async () => {
    const task = addTask({ status: "in_review", version: 3 });
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body: { state: "In Progress", version: 2 } }), 400, "INVALID_REQUEST");
    await expectError(await call("state", { taskId: task.id, body: { state: "In Progress", version: 2, feedback: " " } }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("returns 409 for a valid request for changes with a stale version", async () => {
    const task = addTask({ status: "in_review", version: 3 });
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body: { state: "In Progress", version: 2, feedback: "Synthetic" } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Version guard and competing writes (L1, T6)
// ---------------------------------------------------------------------------

describe("version guard (Task state route, L1)", () => {
  it.each([
    ["an older version", 2],
    ["a newer version", 9],
    ["the largest valid version", 2_147_483_647],
  ])("refuses an otherwise permitted transition with %s with 409 VERSION_CONFLICT and writes nothing (Stale version is refused)", async (_case, version) => {
    const task = addTask({ status: "in_review", version: 3 });
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body: { state: "Done", version } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
  });

  it("refuses a start whose version was raised by a product manager edit (still To Do) with 409", async () => {
    const task = addTask({ version: 2 });
    signInAs(people.dev.auth_user_id);
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body: { state: "In Progress", version: 1 } }), 409, "VERSION_CONFLICT");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["the developer starting a task someone already started", "in_progress", "In Progress", "dev"],
    ["the product manager approving a task already approved", "done", "Done", "pm"],
    ["the developer submitting a task already in review", "in_review", "In Review", "dev"],
  ] as const)("returns 403, not 409, for a stale version when the actor is no longer allowed (%s)", async (_case, status, target, actor) => {
    const task = addTask({ status, version: 2 });
    signInAs(people[actor].auth_user_id);
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body: { state: target, version: 1 } }), 403, "FORBIDDEN");
    expect(snapshot()).toBe(before);
  });

  it("refuses a transition that loses a race with another transition: 409, the other writer's state and one event (Competing transitions)", async () => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    commitConcurrently((state) => {
      const row = state.tasks.find((entry) => entry.id === task.id)!;
      row.status = "in_progress";
      row.version = 2;
      state.task_events.push({
        id: randomUUID(), task_id: task.id, actor_id: people.dev.id, event_type: "state_change", from_status: "to_do", to_status: "in_progress",
        previous_assignee_id: null, new_assignee_id: null, check_result_id: null, feedback: null, created_at: STORED_TIME,
      });
    });
    await expectError(await transition(task, "In Progress"), 409, "VERSION_CONFLICT");
    expect(taskRow(task.id)).toMatchObject({ status: "in_progress", version: 2 });
    expect(eventsOf(task.id)).toHaveLength(1);
  });

  it("refuses a request for changes that loses a race with an approval: 409 and no feedback event", async () => {
    const task = addTask({ status: "in_review" });
    commitConcurrently((state) => {
      const row = state.tasks.find((entry) => entry.id === task.id)!;
      row.status = "done";
      row.version = 2;
    });
    await expectError(await transition(task, "In Progress", { feedback: "Too late" }), 409, "VERSION_CONFLICT");
    expect(taskRow(task.id)).toMatchObject({ status: "done", version: 2 });
    expect(eventsOf(task.id)).toEqual([]);
  });

  it("refuses a start that races a reassignment to another developer with 409 and writes nothing", async () => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    commitConcurrently((state) => {
      const row = state.tasks.find((entry) => entry.id === task.id)!;
      row.assignee_id = people.dev2.id;
      row.version = 2;
    });
    await expectError(await transition(task, "In Progress"), 409, "VERSION_CONFLICT");
    expect(taskRow(task.id)).toMatchObject({ status: "to_do", assignee_id: people.dev2.id, version: 2 });
    expect(eventsOf(task.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task events (L6)
// ---------------------------------------------------------------------------

describe("lifecycle events (Lifecycle changes are recorded as task events, L6)", () => {
  const blank = { previous_assignee_id: null, new_assignee_id: null, check_result_id: null, feedback: null };

  it("records one state_change event with the actor and the from and to status when a task is started", async () => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    await expectSuccess(await transition(task, "In Progress"), 200);
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      ...blank, task_id: task.id, actor_id: people.dev.id, event_type: "state_change", from_status: "to_do", to_status: "in_progress",
      created_at: expect.stringMatching(ISO_UTC),
    })]);
  });

  it("records one state_change event when a task is approved", async () => {
    const task = addTask({ status: "in_review" });
    await expectSuccess(await transition(task, "Done"), 200);
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      ...blank, actor_id: people.pm.id, event_type: "state_change", from_status: "in_review", to_status: "done",
    })]);
  });

  it("records one submission event with no check reference when no tip is found", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    await expectSuccess(await transition(task, "In Review"), 200);
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      ...blank, actor_id: people.dev.id, event_type: "submission", from_status: "in_progress", to_status: "in_review",
    })]);
  });

  it("records one review_feedback event with the product manager, the from and to status and the trimmed feedback", async () => {
    const task = addTask({ status: "in_review" });
    await expectSuccess(await transition(task, "In Progress", { feedback: "\n Needs edge cases \t" }), 200);
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      previous_assignee_id: null, new_assignee_id: null, check_result_id: null,
      actor_id: people.pm.id, event_type: "review_feedback", from_status: "in_review", to_status: "in_progress", feedback: "Needs edge cases",
    })]);
  });

  it.each([
    ["start", "to_do", "In Progress", "dev"],
    ["submit", "in_progress", "In Review", "dev"],
    ["approve", "in_review", "Done", "pm"],
    ["request changes", "in_review", "In Progress", "pm"],
  ] as const)("writes the %s task update and its event in one transaction", async (_case, status, target, actor) => {
    const task = addTask({ status });
    signInAs(people[actor].auth_user_id);
    const extra = actor === "pm" && target === "In Progress" ? { feedback: "Synthetic" } : {};
    await expectSuccess(await transition(task, target, extra), 200);
    const kinds = fake.log.map((entry) => entry.kind);
    const update = fake.log.findIndex((entry) => entry.kind === "update" && entry.tables.includes("tasks"));
    const event = fake.log.findIndex((entry) => entry.kind === "insert" && entry.tables.includes("task_events"));
    const begin = kinds.lastIndexOf("begin", Math.min(update, event));
    const commit = kinds.indexOf("commit", Math.max(update, event));
    expect(update).toBeGreaterThan(-1);
    expect(event).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(Math.max(update, event));
    // No COMMIT or ROLLBACK between the BEGIN and the two writes.
    expect(kinds.slice(begin + 1, Math.max(update, event)).some((kind) => kind === "commit" || kind === "rollback" || kind === "begin")).toBe(false);
    // Only the task row and one event are written; no check result, criterion or progress update.
    expect(writes().map((entry) => entry.tables.join())).toEqual(expect.arrayContaining(["tasks", "task_events"]));
    expect(writes()).toHaveLength(2);
  });

  it.each([
    ["the event insert", "insert", "task_events"],
    ["the task update", "update", "tasks"],
  ] as const)("keeps the previous state and version and stores no event when %s fails (Failed change records no event)", async (_case, kind, table) => {
    const task = addTask();
    signInAs(people.dev.auth_user_id);
    fake.failWhen = (entry) => entry.kind === kind && entry.tables.includes(table) ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await transition(task, "In Progress"), 500, "INTERNAL_ERROR");
    expect(taskRow(task.id)).toMatchObject({ status: "to_do", version: 1 });
    expect(eventsOf(task.id)).toEqual([]);
    expect(fake.log.some((entry) => entry.kind === "rollback")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Submission and the tip lookup (L5)
// ---------------------------------------------------------------------------

describe("submission tip lookup (Submission records attached commits and a matching check, L5)", () => {
  it("looks up the tip once, with the path's project and task, before the state change begins and with no transaction open", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    await expectSuccess(await transition(task, "In Review"), 200);
    expect(tipCalls).toHaveLength(1);
    expect(tipCalls[0].args.slice(0, 2)).toEqual([projectId, task.id]);
    expect(tipCalls[0].openTransactions).toBe(0);
    const firstBeginAfter = fake.log.findIndex((entry, index) => index >= tipCalls[0].logLength && entry.kind === "begin");
    const taskUpdate = fake.log.findIndex((entry) => entry.kind === "update" && entry.tables.includes("tasks"));
    expect(firstBeginAfter).toBeGreaterThanOrEqual(tipCalls[0].logLength);
    expect(taskUpdate).toBeGreaterThan(firstBeginAfter);
  });

  it("submits with no check reference when the lookup finds no tip (Submission has no matching check result; zero attached commits)", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await transition(task, "In Review"), 200);
    expect(body.state).toBe("In Review");
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({ event_type: "submission", check_result_id: null })]);
  });

  it("still submits, with no check reference and no leaked detail, when the lookup fails (Evidence is unavailable at submission)", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    boundary.findSubmissionTip.mockRejectedValue(new Error(PRIVATE_DETAIL));
    const response = await transition(task, "In Review");
    const text = await response.clone().text();
    expect(text).not.toContain(PRIVATE_DETAIL);
    const body = await expectSuccess(response, 200);
    expect(body).toMatchObject({ state: "In Review", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({ event_type: "submission", check_result_id: null })]);
  });

  it.each([
    ["start", "to_do", "In Progress", "dev"],
    ["approve", "in_review", "Done", "pm"],
    ["request changes", "in_review", "In Progress", "pm"],
  ] as const)("does not look up a tip on %s", async (_case, status, target, actor) => {
    const task = addTask({ status });
    signInAs(people[actor].auth_user_id);
    const extra = actor === "pm" && target === "In Progress" ? { feedback: "Synthetic" } : {};
    await expectSuccess(await transition(task, target, extra), 200);
    expect(boundary.findSubmissionTip).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid body", () => ({ signIn: people.dev.auth_user_id, status: "in_progress", body: { state: "In Review" } })],
    ["no session", () => ({ signIn: null, status: "in_progress", body: undefined })],
    ["a non-member", () => ({ signIn: people.outsider.auth_user_id, status: "in_progress", body: undefined })],
    ["an unassigned developer", () => ({ signIn: people.dev2.auth_user_id, status: "in_progress", body: undefined })],
    ["the product manager", () => ({ signIn: people.pm.auth_user_id, status: "in_progress", body: undefined })],
    ["a task not in progress", () => ({ signIn: people.dev.auth_user_id, status: "to_do", body: undefined })],
  ])("does not look up a tip when the submission is refused for %s", async (_case, setup) => {
    const { signIn, status, body } = setup();
    const task = addTask({ status });
    if (signIn) signInAs(signIn); else signOut();
    const response = body ? await call("state", { taskId: task.id, body }) : await transition(task, "In Review");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(boundary.findSubmissionTip).not.toHaveBeenCalled();
    expect(taskRow(task.id).status).toBe(status);
  });

  it("writes only the task and one event on submission; it starts no check and stores no check result (Check never changes state)", async () => {
    const task = addTask({ status: "in_progress" });
    signInAs(people.dev.auth_user_id);
    await expectSuccess(await transition(task, "In Review"), 200);
    expect(writes().map((entry) => entry.tables.join()).sort()).toEqual(["task_events", "tasks"]);
    expect(fake.log.some((entry) => /check_results/i.test(entry.sql) && entry.kind !== "select")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concealment, authentication, Origin and check order on the state route
// ---------------------------------------------------------------------------

describe("state route access and check order (L2 check order, T8)", () => {
  it.each([
    ["a deleted task", () => addTask({ deleted: true, status: "in_review" })],
    ["a task in another project", () => addTask({ project: otherProjectId, status: "in_review" })],
  ])("conceals %s with 404 and changes nothing (Task is concealed or missing)", async (_case, make) => {
    const task = make();
    const before = snapshot();
    await expectError(await transition(task, "Done"), 404, "NOT_FOUND");
    expect(snapshot()).toBe(before);
  });

  it("conceals a missing task with 404", async () => {
    await expectError(await call("state", { taskId: missingTaskId, body: { state: "Done", version: 1 } }), 404, "NOT_FOUND");
  });

  it("conceals a task of another project even from that project's product manager", async () => {
    const task = addTask({ project: otherProjectId, status: "in_review" });
    signInAs(people.otherPm.auth_user_id);
    await expectError(await transition(task, "Done"), 404, "NOT_FOUND");
    expect(taskRow(task.id).status).toBe("in_review");
  });

  it.each([
    ["a registered non-member", people.outsider.auth_user_id],
    ["a person with no application identity", "10101010-1010-4010-8010-101010101010"],
  ])("conceals the task from %s with 404", async (_case, authId) => {
    const task = addTask({ status: "in_review" });
    signInAs(authId);
    await expectError(await transition(task, "Done"), 404, "NOT_FOUND");
    expect(taskRow(task.id).status).toBe("in_review");
  });

  it("refuses an unauthenticated request with 401", async () => {
    const task = addTask({ status: "in_review" });
    signOut();
    await expectError(await transition(task, "Done"), 401, "UNAUTHENTICATED");
    expect(writes()).toEqual([]);
  });

  it.each([
    ["task", { taskId: "not-a-uuid" }],
    ["project", { projectId: "not-a-uuid" }],
  ])("rejects a malformed %s UUID with 400", async (_case, ids) => {
    await expectError(await call("state", { ...ids, body: { state: "Done", version: 1 } }), 400, "INVALID_REQUEST");
  });

  it("rejects malformed JSON with 400", async () => {
    const task = addTask({ status: "in_review" });
    await expectError(await call("state", { taskId: task.id, raw: "{broken" }), 400, "INVALID_REQUEST");
  });

  it.each([
    ["no state", { version: 1 }],
    ["an unknown state", { state: "Blocked", version: 1 }],
    ["a stored status name", { state: "in_review", version: 1 }],
    ["no version", { state: "Done" }],
    ["a zero version", { state: "Done", version: 0 }],
    ["a string version", { state: "Done", version: "1" }],
    ["a fractional version", { state: "Done", version: 1.5 }],
    ["a version above the integer maximum", { state: "Done", version: 2_147_483_648 }],
    ["an unknown field", { state: "Done", version: 1, assigneeId: people.dev2.id }],
    ["a null body", null],
    ["an array body", [{ state: "Done", version: 1 }]],
  ])("rejects a body with %s with 400 and changes nothing (Invalid state request)", async (_case, body) => {
    const task = addTask({ status: "in_review" });
    const before = snapshot();
    await expectError(await call("state", { taskId: task.id, body }), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
  });

  it("gives 400, not 401, to an invalid body without a session", async () => {
    const task = addTask({ status: "in_review" });
    signOut();
    await expectError(await call("state", { taskId: task.id, body: { state: "Done" } }), 400, "INVALID_REQUEST");
  });

  it("gives 404, not 403, to a developer requesting a state on a deleted task", async () => {
    const task = addTask({ deleted: true, assigneeId: people.dev2.id });
    signInAs(people.dev.auth_user_id);
    await expectError(await transition(task, "In Progress"), 404, "NOT_FOUND");
  });

  it("gives 404, not 400, to a request for changes without feedback on a deleted task", async () => {
    const task = addTask({ deleted: true, status: "in_review" });
    await expectError(await transition(task, "In Progress"), 404, "NOT_FOUND");
  });

  it("gives 403, not 409, to an unassigned developer with a stale version", async () => {
    const task = addTask({ assigneeId: people.dev2.id, version: 5 });
    signInAs(people.dev.auth_user_id);
    await expectError(await call("state", { taskId: task.id, body: { state: "In Progress", version: 1 } }), 403, "FORBIDDEN");
  });

  it("returns a safe 500 when the task lookup fails", async () => {
    const task = addTask({ status: "in_review" });
    fake.failWhen = ({ kind, tables }) => kind === "select" && tables.includes("tasks") ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await transition(task, "Done"), 500, "INTERNAL_ERROR");
  });

  describe("Origin and content type (Mutating project routes check the request origin)", () => {
    it.each([
      ["a missing Origin", null],
      ["a different Origin", "https://synthetic-attacker.example"],
    ])("refuses %s with 403 before the session and changes nothing", async (_case, requestOrigin) => {
      const task = addTask({ status: "in_review" });
      const before = snapshot();
      await expectError(await transition(task, "Done", {}, { origin: requestOrigin }), 403, "FORBIDDEN");
      expect(snapshot()).toBe(before);
      expect(boundary.getUser).not.toHaveBeenCalled();
    });

    it("refuses a wrong content type with 400", async () => {
      const task = addTask({ status: "in_review" });
      await expectError(await transition(task, "Done", {}, { contentType: "text/plain" }), 400, "INVALID_REQUEST");
      expect(taskRow(task.id).status).toBe("in_review");
    });

    it("gives 403 to a bad Origin with a wrong content type, and 403, not 401, to a bad Origin with no session", async () => {
      const task = addTask({ status: "in_review" });
      await expectError(await transition(task, "Done", {}, { origin: null, contentType: "text/plain" }), 403, "FORBIDDEN");
      signOut();
      await expectError(await transition(task, "Done", {}, { origin: null }), 403, "FORBIDDEN");
    });

    it("accepts a JSON content type with parameters", async () => {
      const task = addTask({ status: "in_review" });
      await expectSuccess(await transition(task, "Done", {}, { contentType: "Application/JSON; charset=utf-8" }), 200);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectId}/tasks/{taskId}/progress-updates (L4)
// ---------------------------------------------------------------------------

describe("POST /api/v1/projects/{projectId}/tasks/{taskId}/progress-updates (Developer submits task progress, L4)", () => {
  beforeEach(() => {
    signInAs(people.dev.auth_user_id);
  });

  it("stores the assigned developer's trimmed update and returns 201 with the task-detail progressUpdates shape (Developer submits an update)", async () => {
    const task = addTask({ status: "in_progress" });
    const body = await expectSuccess<ProgressUpdateBody>(await postUpdate(task, { body: "  Finished the parser.  " }), 201);
    expect(body).toEqual({
      id: expect.stringMatching(UUID_PATTERN),
      author: { id: people.dev.id, githubUsername: "Synthetic-Dev" },
      body: "Finished the parser.",
      createdAt: expect.stringMatching(ISO_UTC),
    });
    expect(updatesOf(task.id)).toEqual([expect.objectContaining({ id: body.id, task_id: task.id, author_id: people.dev.id, body: "Finished the parser." })]);
  });

  it.each(["to_do", "in_progress", "in_review", "done"])("accepts an update on a task in state %s and leaves the task unchanged (Update in any state)", async (status) => {
    const task = addTask({ status, version: 4 });
    const tasksBefore = JSON.stringify(fake.state.tasks);
    await expectSuccess<ProgressUpdateBody>(await postUpdate(task), 201);
    expect(JSON.stringify(fake.state.tasks)).toBe(tasksBefore);
    expect(taskRow(task.id)).toMatchObject({ status, version: 4 });
    expect(eventsOf(task.id)).toEqual([]);
    expect(fake.log.some((entry) => entry.kind === "update" && entry.tables.includes("tasks"))).toBe(false);
  });

  it("stores and returns text unchanged, never interpreting markup (Update is trimmed plain text)", async () => {
    const task = addTask();
    const text = "<img src=x onerror=alert(1)> **bold** &lt;tag&gt;\nsecond line";
    const body = await expectSuccess<ProgressUpdateBody>(await postUpdate(task, { body: text }), 201);
    expect(body.body).toBe(text);
    expect(updatesOf(task.id)[0].body).toBe(text);
  });

  it("accepts 2,000 code points after trimming", async () => {
    const task = addTask();
    const text = "\u{1F600}".repeat(2000);
    const body = await expectSuccess<ProgressUpdateBody>(await postUpdate(task, { body: ` ${text} ` }), 201);
    expect(body.body).toBe(text);
  });

  it.each([
    ["a blank body", { body: "   " }],
    ["an empty body", { body: "" }],
    ["a 2,001-character body", { body: "b".repeat(2001) }],
    ["a 2,001-code-point body of astral characters", { body: "\u{1F600}".repeat(2001) }],
    ["a numeric body", { body: 7 }],
    ["a null body field", { body: null }],
    ["an array body field", { body: ["x"] }],
    ["no body field", {}],
    ["an extra field", { body: "Synthetic", version: 1 }],
    ["a state field", { body: "Synthetic", state: "Done" }],
    ["a JSON null", null],
    ["a JSON array", [{ body: "Synthetic" }]],
  ])("refuses %s with 400 and stores nothing (Invalid progress update)", async (_case, body) => {
    const task = addTask();
    const before = snapshot();
    await expectError(await postUpdate(task, body), 400, "INVALID_REQUEST");
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
  });

  it("refuses malformed JSON with 400", async () => {
    const task = addTask();
    await expectError(await call("progress", { taskId: task.id, raw: "{broken" }), 400, "INVALID_REQUEST");
    expect(updatesOf(task.id)).toEqual([]);
  });

  it.each([
    ["the product manager", () => people.pm.auth_user_id],
    ["a developer who is not assigned", () => people.dev2.auth_user_id],
  ])("refuses %s with 403 and stores nothing (Only the assigned developer posts)", async (_case, authId) => {
    const task = addTask();
    signInAs(authId());
    const before = snapshot();
    await expectError(await postUpdate(task), 403, "FORBIDDEN");
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["a non-member", () => { signInAs(people.outsider.auth_user_id); return addTask(); }],
    ["a deleted task", () => addTask({ deleted: true })],
    ["a task in another project", () => { signInAs(people.otherDev.auth_user_id); return addTask({ project: otherProjectId }); }],
  ])("conceals the task with 404 for %s and stores nothing", async (_case, make) => {
    const task = make();
    await expectError(await postUpdate(task), 404, "NOT_FOUND");
    expect(updatesOf(task.id)).toEqual([]);
  });

  it("conceals a missing task with 404", async () => {
    await expectError(await call("progress", { taskId: missingTaskId, body: { body: "Synthetic" } }), 404, "NOT_FOUND");
  });

  it("refuses an unauthenticated request with 401", async () => {
    const task = addTask();
    signOut();
    await expectError(await postUpdate(task), 401, "UNAUTHENTICATED");
    expect(updatesOf(task.id)).toEqual([]);
  });

  it("gives 400, not 401, to an invalid body without a session", async () => {
    const task = addTask();
    signOut();
    await expectError(await postUpdate(task, { body: "" }), 400, "INVALID_REQUEST");
  });

  it("gives 404, not 403, to a non-member", async () => {
    const task = addTask({ project: otherProjectId });
    await expectError(await postUpdate(task), 404, "NOT_FOUND");
  });

  it.each([
    ["task", { taskId: "not-a-uuid" }],
    ["project", { projectId: "not-a-uuid" }],
  ])("rejects a malformed %s UUID with 400", async (_case, ids) => {
    await expectError(await call("progress", { ...ids, body: { body: "Synthetic" } }), 400, "INVALID_REQUEST");
  });

  it("refuses an update that loses a race with a reassignment with 403 and stores nothing (Update racing with reassignment)", async () => {
    const task = addTask();
    commitConcurrently((state) => {
      const row = state.tasks.find((entry) => entry.id === task.id)!;
      row.assignee_id = people.dev2.id;
      row.version = 2;
    });
    await expectError(await postUpdate(task), 403, "FORBIDDEN");
    expect(updatesOf(task.id)).toEqual([]);
    expect(taskRow(task.id)).toMatchObject({ assignee_id: people.dev2.id, version: 2 });
  });

  it("locks the task row in the transaction before inserting the update, and does not update the task (L4)", async () => {
    const task = addTask();
    await expectSuccess<ProgressUpdateBody>(await postUpdate(task), 201);
    const insert = fake.log.findIndex((entry) => entry.kind === "insert" && entry.tables.includes("progress_updates"));
    const lock = fake.log.findIndex((entry) => entry.kind === "select" && entry.tables.includes("tasks") && ROW_LOCK.test(entry.sql));
    const begin = fake.log.map((entry) => entry.kind).lastIndexOf("begin", insert);
    expect(insert).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(begin);
    expect(lock).toBeLessThan(insert);
    expect(begin).toBeGreaterThan(-1);
    expect(writes().map((entry) => entry.tables.join())).toEqual(["progress_updates"]);
  });

  it("returns a safe 500 and stores nothing when the insert fails", async () => {
    const task = addTask();
    fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("progress_updates") ? new Error(PRIVATE_DETAIL) : undefined;
    await expectError(await postUpdate(task), 500, "INTERNAL_ERROR");
    expect(updatesOf(task.id)).toEqual([]);
  });

  it("does not look up a commit tip", async () => {
    const task = addTask();
    await expectSuccess<ProgressUpdateBody>(await postUpdate(task), 201);
    expect(boundary.findSubmissionTip).not.toHaveBeenCalled();
  });

  describe("Origin and content type (Mutating project routes check the request origin)", () => {
    it.each([
      ["a missing Origin", null],
      ["a different Origin", "https://synthetic-attacker.example"],
    ])("refuses %s with 403 before the session and stores nothing", async (_case, requestOrigin) => {
      const task = addTask();
      await expectError(await postUpdate(task, undefined, { origin: requestOrigin }), 403, "FORBIDDEN");
      expect(boundary.getUser).not.toHaveBeenCalled();
      expect(updatesOf(task.id)).toEqual([]);
    });

    it("refuses a wrong content type with 400, and a bad Origin with a wrong content type with 403", async () => {
      const task = addTask();
      await expectError(await postUpdate(task, undefined, { contentType: "text/plain" }), 400, "INVALID_REQUEST");
      await expectError(await postUpdate(task, undefined, { origin: null, contentType: "text/plain" }), 403, "FORBIDDEN");
      expect(updatesOf(task.id)).toEqual([]);
    });

    it("gives 403, not 401, to a bad Origin with no session", async () => {
      const task = addTask();
      signOut();
      await expectError(await postUpdate(task, undefined, { origin: null }), 403, "FORBIDDEN");
    });
  });
});
