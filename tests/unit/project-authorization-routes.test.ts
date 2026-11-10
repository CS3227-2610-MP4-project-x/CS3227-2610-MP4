import { NextRequest } from "next/server";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 3.2; identity-and-access requirements “Protected route
// authorization stubs”, “Protected API errors use stable safe responses”, and
// “Access is enforced by project role on the server”. No formal IDs exist.
// Exercise real handlers/services/repositories with only external boundaries
// replaced. Fixtures are synthetic; no network, credentials, or database is used.
//
// Task 4.1 replaced the project read and creation stubs: task-management "Signed-in
// people create projects" and identity-and-access "Project details require membership"
// and "Project creation is functional"; design.md Q4, Q6 and S1 to S6. Detailed project-route
// coverage lives in tests/unit/project-routes.test.ts.
//
// Task 4.2 replaced the task create, read and edit stubs: identity-and-access "Task creation is
// functional", "Task read is functional" and "Task field edit is functional"; design.md T1, T8
// and T16. Their default bodies below are now valid (T2, T4), because the body is validated
// before the session (T8). The authorized-success cases for those routes, which write, live in
// tests/unit/task-routes.test.ts; this file keeps the denial, concealment and safe-error
// cases.
//
// Task 4.3 replaced the task-state stub: identity-and-access "Task state transition is functional
// and enforces lifecycle permissions" and "Invalid state transition uses the permission
// response"; task-management "Task lifecycle" and "Task state route"; design.md L1, L2 and the
// 4.3 check order. The state body is now {state, version} (L1) and is validated before the
// session, so the default state body below is valid. The 501 stub assertions are superseded
// ("Superseded tests" conflict resolution). This file's database fake refuses every write, so
// it keeps the 403 matrix denials and body validation; the authorized transitions, which write,
// are covered in tests/unit/task-lifecycle-routes.test.ts.
const fixtures = vi.hoisted(() => ({
  authId: "11111111-1111-4111-8111-111111111111",
  personId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  otherProjectId: "55555555-5555-4555-8555-555555555555",
  otherPersonId: "66666666-6666-4666-8666-666666666666",
  getUser: vi.fn(),
  query: vi.fn(),
  writes: [] as string[],
  personExists: true,
  projectExists: true,
  member: true,
  role: "developer",
  taskExists: true,
  taskProjectId: "33333333-3333-4333-8333-333333333333",
  assigneeId: "22222222-2222-4222-8222-222222222222",
  status: "to_do",
  failure: "" as "" | "people" | "projects" | "memberships" | "tasks",
  // Task 4.1: only project creation may write, and only to projects and memberships.
  allowProjectCreation: false,
  created: [] as { table: string; values: readonly unknown[] }[],
  transaction: [] as string[],
  projectKey: "WEB",
  projectName: "Synthetic project",
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
  createRequestSupabaseClient: async () => ({ auth: { getUser: fixtures.getUser } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = fixtures.query;
    // Task 4.1 (design.md S6): transactions use pool.connect(), then BEGIN/COMMIT/ROLLBACK.
    async connect() { return { query: fixtures.query, release: () => undefined }; }
  }
  return { Pool, default: { Pool } };
});

const errors = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
  501: { code: "NOT_IMPLEMENTED", message: "Endpoint not implemented" },
} as const;

type Endpoint = "projectRead" | "projectCreate" | "taskCreate" | "taskRead" | "taskEdit" | "taskState";
const endpoints: Endpoint[] = ["projectRead", "projectCreate", "taskCreate", "taskRead", "taskEdit", "taskState"];

async function requestEndpoint(endpoint: Endpoint, options: {
  projectId?: string;
  taskId?: string;
  body?: string;
} = {}): Promise<Response> {
  const projectId = options.projectId ?? fixtures.projectId;
  const taskId = options.taskId ?? fixtures.taskId;
  const projectPath = `/api/v1/projects/${projectId}`;
  const taskPath = `${projectPath}/tasks/${taskId}`;
  const method = endpoint.endsWith("Create") ? "POST" : endpoint === "taskEdit" || endpoint === "taskState" ? "PATCH" : "GET";
  const path = endpoint === "projectCreate" ? "/api/v1/projects"
    : endpoint === "projectRead" ? projectPath
      : endpoint === "taskCreate" ? `${projectPath}/tasks`
        : endpoint === "taskState" ? `${taskPath}/state` : taskPath;
  // Task 4.1 (D3, Q4): project creation validates its body before the session, so the
  // default creation body is a valid {key, name}.
  const defaultBody = endpoint === "taskState" ? { state: "In Progress", version: 1 }
    : endpoint === "projectCreate" ? { key: "WEB", name: "Synthetic project" }
      : endpoint === "taskCreate" ? {
        title: "Synthetic task", description: "Synthetic description", assigneeId: fixtures.otherPersonId,
        dueDate: "2026-11-30", acceptanceCriteria: ["Synthetic criterion"],
      }
        : endpoint === "taskEdit" ? { version: 1, title: "Synthetic edited title" } : {};
  const request = new NextRequest(`https://synthetic-app.example${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://synthetic-app.example" },
    ...(method === "GET" ? {} : { body: options.body ?? JSON.stringify(defaultBody) }),
  });
  const context = { params: Promise.resolve({ projectId, taskId }) };
  switch (endpoint) {
    case "projectCreate": return (await import("../../src/app/api/v1/projects/route")).POST(request);
    case "projectRead": return (await import("../../src/app/api/v1/projects/[projectId]/route")).GET(request, context);
    case "taskCreate": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/route")).POST(request, context);
    case "taskRead": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route")).GET(request, context);
    case "taskEdit": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route")).PATCH(request, context);
    case "taskState": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route")).PATCH(request, context);
  }
}

async function expectError(response: Response, status: keyof typeof errors) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ error: errors[status] });
}

beforeEach(() => {
  fixtures.writes.length = 0;
  fixtures.personExists = true;
  fixtures.projectExists = true;
  fixtures.member = true;
  fixtures.role = "developer";
  fixtures.taskExists = true;
  fixtures.taskProjectId = fixtures.projectId;
  fixtures.assigneeId = fixtures.personId;
  fixtures.status = "to_do";
  fixtures.failure = "";
  fixtures.allowProjectCreation = false;
  fixtures.created.length = 0;
  fixtures.transaction.length = 0;
  fixtures.getUser.mockResolvedValue({
    data: { user: {
      id: fixtures.authId,
      identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-developer" } }],
    } },
    error: null,
  });
  fixtures.query.mockImplementation(async (statement: string | { text: string; values?: readonly unknown[] }, values?: readonly unknown[]) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const parameters = values ?? (typeof statement === "string" ? [] : statement.values ?? []);
    if (/^\s*(begin|start transaction|commit|rollback)\b/i.test(sql)) {
      fixtures.transaction.push(sql.trim().split(/\s+/)[0].toUpperCase());
      return { rows: [], rowCount: 0 };
    }
    const insertTable = /^\s*insert\s+into\s+"?app"?\."?(projects|memberships)"?/i.exec(sql)?.[1]?.toLowerCase();
    if (fixtures.allowProjectCreation && insertTable) {
      fixtures.created.push({ table: insertTable, values: parameters });
      const row = insertTable === "projects"
        ? { id: fixtures.otherProjectId, key: fixtures.projectKey, name: fixtures.projectName, last_task_number: 0 }
        : { id: "88888888-8888-4888-8888-888888888888", project_id: fixtures.otherProjectId, person_id: fixtures.personId, role: "product_manager" };
      return { rows: [row], rowCount: 1 };
    }
    if (/\b(insert|update|delete|merge|truncate|call)\b/i.test(sql)) {
      fixtures.writes.push(sql);
      throw new Error("Authorization stubs must never issue writes");
    }
    if (fixtures.failure && new RegExp(`\\b${fixtures.failure}\\b`, "i").test(sql)) {
      throw new Error("synthetic-private-database-detail");
    }
    let rows: Record<string, unknown>[];
    if (/\bapp\.tasks\b/i.test(sql)) {
      const pathMatches = !/project_id\s*=\s*\$\d/i.test(sql) || parameters.includes(fixtures.taskProjectId);
      rows = fixtures.taskExists && pathMatches ? [{
        id: fixtures.taskId, project_id: fixtures.taskProjectId,
        assignee_id: fixtures.assigneeId, status: fixtures.status,
      }] : [];
    } else if (/\bapp\.memberships\b/i.test(sql)) {
      // A statement joining projects (task 4.1 project read) gets the project's columns.
      const project = /\bapp\.projects\b/i.test(sql)
        ? { id: fixtures.projectId, key: fixtures.projectKey, name: fixtures.projectName } : {};
      rows = fixtures.member && fixtures.projectExists && parameters.includes(fixtures.personId) && parameters.includes(fixtures.projectId)
        ? [{ id: "77777777-7777-4777-8777-777777777777", person_id: fixtures.personId, project_id: fixtures.projectId, role: fixtures.role, ...project }] : [];
    } else if (/\bapp\.projects\b/i.test(sql)) {
      rows = fixtures.projectExists && parameters.includes(fixtures.projectId)
        ? [{ id: fixtures.projectId, key: fixtures.projectKey, name: fixtures.projectName }] : [];
    } else if (/\bapp\.people\b/i.test(sql)) {
      rows = fixtures.personExists && parameters.includes(fixtures.authId) ? [{ id: fixtures.personId, auth_user_id: fixtures.authId }] : [];
    } else {
      throw new Error(`Unexpected database operation in test: ${sql}`);
    }
    return { rows, rowCount: rows.length };
  });
});

afterEach(() => {
  // Inspect attempted writes even if a handler catches the fake's error.
  expect(fixtures.writes).toEqual([]);
});

describe("protected API authorization stubs", () => {
  it.each(endpoints)("refuses anonymous %s with the stable 401 envelope before database access", async (endpoint) => {
    fixtures.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await requestEndpoint(endpoint), 401);
    expect(fixtures.query).not.toHaveBeenCalled();
  });

  it.each(endpoints)("returns 401 for an ordinary signed-out Supabase session on %s", async (endpoint) => {
    fixtures.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expectError(await requestEndpoint(endpoint), 401);
    expect(fixtures.query).not.toHaveBeenCalled();
  });

  it.each(endpoints)("returns safe 500 when session lookup throws for %s", async (endpoint) => {
    fixtures.getUser.mockRejectedValue(new Error("synthetic-private-provider-detail"));
    await expectError(await requestEndpoint(endpoint), 500);
  });

  // Installed auth-js error-codes.d.ts includes these invalid-session codes;
  // errors.d.ts exposes AuthApiError(message, status, code).
  describe.each(["refresh_token_not_found", "refresh_token_already_used", "session_expired"])("invalid session code %s", (code) => {
    it.each(endpoints)("returns 401 when getUser returns the error on %s", async (endpoint) => {
      fixtures.getUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError("synthetic-private-session-detail", 400, code),
      });
      await expectError(await requestEndpoint(endpoint), 401);
      expect(fixtures.query).not.toHaveBeenCalled();
    });

    it.each(endpoints)("returns 401 when getUser throws the error on %s", async (endpoint) => {
      fixtures.getUser.mockRejectedValue(new AuthApiError("synthetic-private-session-detail", 400, code));
      await expectError(await requestEndpoint(endpoint), 401);
      expect(fixtures.query).not.toHaveBeenCalled();
    });
  });

  it.each(endpoints)("retains safe 500 for a returned operational provider error on %s", async (endpoint) => {
    fixtures.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("synthetic-private-provider-detail", 503, "unexpected_failure"),
    });
    await expectError(await requestEndpoint(endpoint), 500);
    expect(fixtures.query).not.toHaveBeenCalled();
  });

  it.each(endpoints.filter((endpoint) => endpoint !== "projectCreate"))("conceals %s from a non-member", async (endpoint) => {
    fixtures.member = false;
    await expectError(await requestEndpoint(endpoint), 404);
  });

  it.each(endpoints.filter((endpoint) => endpoint !== "projectCreate"))("conceals %s from an unmapped authenticated identity", async (endpoint) => {
    fixtures.personExists = false;
    await expectError(await requestEndpoint(endpoint), 404);
  });

  // Task 4.1, Q6: creation from a valid session with no people row is 401, not 404.
  it("refuses project creation with 401 when the session has no registered person, creating nothing", async () => {
    fixtures.personExists = false;
    fixtures.allowProjectCreation = true;
    await expectError(await requestEndpoint("projectCreate"), 401);
    expect(fixtures.created).toEqual([]);
  });

  // Group 7.3 replaces the read stub; full DTO/history tests use their own
  // richer database fixture in task-detail-read.test.ts.
  it("refuses an unassigned project developer reading task detail", async () => {
    fixtures.assigneeId = fixtures.otherPersonId;
    await expectError(await requestEndpoint("taskRead"), 403);
  });

  // Task 4.1: "Project details require membership" now returns 200 with the project.
  it.each(["developer", "product_manager"])("returns the project with the requester's %s role", async (role) => {
    fixtures.role = role;
    const response = await requestEndpoint("projectRead");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      id: fixtures.projectId, key: fixtures.projectKey, name: fixtures.projectName, role,
    });
  });

  // Task 4.1: "Project creation is functional"; any signed-in person may create (D1),
  // and the creator becomes the product manager (D2, D3).
  it("creates a project for a signed-in person who belongs to no project", async () => {
    fixtures.member = false;
    fixtures.allowProjectCreation = true;
    const response = await requestEndpoint("projectCreate");
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      key: "WEB",
      name: "Synthetic project",
      role: "product_manager",
    });
    expect(fixtures.created.map((write) => write.table)).toEqual(["projects", "memberships"]);
    expect(fixtures.transaction).toEqual(["BEGIN", "COMMIT"]);
  });

  it.each(["taskCreate", "taskEdit"] as Endpoint[])("refuses a developer calling %s directly", async (endpoint) => {
    await expectError(await requestEndpoint(endpoint), 403);
  });

  it.each(["projectRead", "taskRead", "taskEdit", "taskState"] as Endpoint[])("conceals missing projects on %s", async (endpoint) => {
    fixtures.projectExists = false;
    await expectError(await requestEndpoint(endpoint), 404);
  });

  it.each(["taskRead", "taskEdit", "taskState"] as Endpoint[])("conceals missing tasks on %s", async (endpoint) => {
    fixtures.role = "product_manager";
    fixtures.taskExists = false;
    await expectError(await requestEndpoint(endpoint), 404);
  });

  it.each(["taskRead", "taskEdit", "taskState"] as Endpoint[])("conceals tasks belonging to another project on %s", async (endpoint) => {
    fixtures.role = "product_manager";
    fixtures.taskProjectId = fixtures.otherProjectId;
    await expectError(await requestEndpoint(endpoint), 404);
  });

  it.each(endpoints.filter((endpoint) => endpoint !== "projectCreate"))("rejects malformed project UUID on %s", async (endpoint) => {
    await expectError(await requestEndpoint(endpoint, { projectId: "not-a-uuid" }), 400);
  });

  it.each(["taskRead", "taskEdit", "taskState"] as Endpoint[])("rejects malformed task UUID on %s", async (endpoint) => {
    await expectError(await requestEndpoint(endpoint, { taskId: "not-a-uuid" }), 400);
  });

  it.each(["projectCreate", "taskCreate", "taskEdit", "taskState"] as Endpoint[])("rejects malformed JSON on %s without mutation", async (endpoint) => {
    fixtures.role = "product_manager";
    await expectError(await requestEndpoint(endpoint, { body: "{broken" }), 400);
  });

  it.each(["people", "projects", "memberships", "tasks"] as const)("returns safe 500 for an operational %s lookup failure", async (lookup) => {
    fixtures.failure = lookup;
    await expectError(await requestEndpoint("taskRead"), 500);
  });
});

describe("task state role and assignment authorization (task 4.3 403 matrix, L2)", () => {
  type Actor = "assigned developer" | "unassigned developer" | "product manager";
  const ACTORS: readonly Actor[] = ["assigned developer", "unassigned developer", "product manager"];
  const STATUSES = ["to_do", "in_progress", "in_review", "done"] as const;
  const TARGETS = ["To Do", "In Progress", "In Review", "Done"] as const;
  // identity-and-access "Task state transition is functional and enforces lifecycle permissions".
  const ALLOWED = new Set([
    "assigned developer|to_do|In Progress",
    "assigned developer|in_progress|In Review",
    "product manager|in_review|Done",
    "product manager|in_review|In Progress",
  ]);
  const denied = ACTORS.flatMap((actor) => STATUSES.flatMap((status) => TARGETS
    .filter((target) => !ALLOWED.has(`${actor}|${status}|${target}`))
    .map((target) => [actor, status, target] as const)));

  function actAs(actor: Actor): void {
    if (actor !== "assigned developer") fixtures.assigneeId = fixtures.otherPersonId;
    if (actor === "product manager") fixtures.role = "product_manager";
  }

  it("covers every combination of role, assignment and current state that is not allowed", () => {
    // 3 actors x 4 current states x 4 requested states, less the four allowed transitions.
    expect(denied).toHaveLength(44);
  });

  it.each(denied)("refuses the %s's request on a %s task for %s with 403 FORBIDDEN and writes nothing", async (actor, status, target) => {
    actAs(actor);
    fixtures.status = status;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target, version: 1 }) }), 403);
    expect(fixtures.status).toBe(status);
  });

  it.each(["To Do", "In Progress", "In Review", "Done"])("refuses any request on a Done task, including %s, with 403", async (target) => {
    fixtures.role = "product_manager";
    fixtures.assigneeId = fixtures.otherPersonId;
    fixtures.status = "done";
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target, version: 1 }) }), 403);
  });

  it("refuses the assigned developer's request for changes with feedback (Developer cannot request changes)", async () => {
    fixtures.status = "in_review";
    await expectError(await requestEndpoint("taskState", {
      body: JSON.stringify({ state: "In Progress", version: 1, feedback: "Synthetic feedback" }),
    }), 403);
  });

  it("refuses the PM's In Progress request with feedback on a To Do task with 403, before the feedback rule", async () => {
    fixtures.role = "product_manager";
    fixtures.assigneeId = fixtures.otherPersonId;
    fixtures.status = "to_do";
    await expectError(await requestEndpoint("taskState", {
      body: JSON.stringify({ state: "In Progress", version: 1, feedback: "Synthetic feedback" }),
    }), 403);
  });

  it("refuses an unassigned developer even with the largest valid version (403 before the version guard)", async () => {
    fixtures.assigneeId = fixtures.otherPersonId;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: "In Progress", version: 2_147_483_647 }) }), 403);
  });

  it.each([
    "{}", "null", "[]", '"In Progress"',
    '{"state":null,"version":1}', '{"state":42,"version":1}',
    '{"state":"in_progress","version":1}', '{"state":"in progress","version":1}', '{"state":"Unknown","version":1}',
    '{"state":"constructor","version":1}', '{"state":"toString","version":1}', '{"state":"__proto__","version":1}',
    '{"state":"In Progress"}', '{"state":"In Progress","version":null}', '{"state":"In Progress","version":0}',
    '{"state":"In Progress","version":-1}', '{"state":"In Progress","version":1.5}', '{"state":"In Progress","version":"1"}',
    '{"state":"In Progress","version":2147483648}', '{"state":"In Progress","version":true}',
    '{"version":1}',
    '{"state":"In Progress","version":1,"assigneeId":"22222222-2222-4222-8222-222222222222"}',
    '{"state":"In Progress","version":1,"note":"x"}',
    '{"state":"Done","version":1,"feedback":"Synthetic feedback"}',
    '{"state":"In Review","version":1,"feedback":"Synthetic feedback"}',
    '{"state":"To Do","version":1,"feedback":"Synthetic feedback"}',
  ])("rejects the invalid state body %s with 400 INVALID_REQUEST", async (body) => {
    await expectError(await requestEndpoint("taskState", { body }), 400);
  });

  it("rejects an invalid state body with 400 before the session check (check order)", async () => {
    fixtures.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: "Done", version: 1, feedback: "x" }) }), 400);
    expect(fixtures.query).not.toHaveBeenCalled();
  });
});
