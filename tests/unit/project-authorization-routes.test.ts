import { NextRequest } from "next/server";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 3.2; identity-and-access requirements “Protected route
// authorization stubs”, “Protected API errors use stable safe responses”, and
// “Access is enforced by project role on the server”. No formal IDs exist.
// Exercise real handlers/services/repositories with only external boundaries
// replaced. Fixtures are synthetic; no network, credentials, or database is used.
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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({
    appOrigin: "https://synthetic-app.example",
    databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
    databaseCaCert: "synthetic-test-ca",
    supabaseUrl: "https://synthetic.supabase.co",
    supabasePublishableKey: "synthetic-publishable-key",
  }),
}));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: fixtures.getUser } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = fixtures.query;
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
  const request = new NextRequest(`https://synthetic-app.example${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://synthetic-app.example" },
    ...(method === "GET" ? {} : { body: options.body ?? JSON.stringify(endpoint === "taskState" ? { state: "In Progress" } : {}) }),
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
      rows = fixtures.member && fixtures.projectExists && parameters.includes(fixtures.personId) && parameters.includes(fixtures.projectId)
        ? [{ id: "77777777-7777-4777-8777-777777777777", person_id: fixtures.personId, project_id: fixtures.projectId, role: fixtures.role }] : [];
    } else if (/\bapp\.projects\b/i.test(sql)) {
      rows = fixtures.projectExists && parameters.includes(fixtures.projectId) ? [{ id: fixtures.projectId }] : [];
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

  it.each(["developer", "product_manager"])("allows a %s to reach project and task read stubs", async (role) => {
    fixtures.role = role;
    await expectError(await requestEndpoint("projectRead"), 501);
    await expectError(await requestEndpoint("taskRead"), 501);
  });

  it("requires only authentication for the project creation stub", async () => {
    fixtures.member = false;
    fixtures.personExists = false;
    await expectError(await requestEndpoint("projectCreate"), 501);
  });

  it.each(["taskCreate", "taskEdit"] as Endpoint[])("refuses a developer calling %s directly", async (endpoint) => {
    await expectError(await requestEndpoint(endpoint), 403);
  });

  it.each(["taskCreate", "taskEdit"] as Endpoint[])("allows the project's PM to reach %s", async (endpoint) => {
    fixtures.role = "product_manager";
    await expectError(await requestEndpoint(endpoint), 501);
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

describe("task state role and assignment authorization", () => {
  it.each([
    ["to_do", "In Progress"],
    ["in_progress", "In Review"],
  ])("allows the assigned developer to request %s → %s without changing state", async (current, target) => {
    fixtures.status = current;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target }) }), 501);
    expect(fixtures.status).toBe(current);
  });

  it.each([
    ["to_do", "In Progress"],
    ["in_progress", "In Review"],
  ])("refuses an unassigned developer's %s → %s request", async (current, target) => {
    fixtures.status = current;
    fixtures.assigneeId = fixtures.otherPersonId;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target }) }), 403);
  });

  it.each(["Done", "In Progress"])("allows the PM's In Review → %s request without changing state", async (target) => {
    fixtures.role = "product_manager";
    fixtures.status = "in_review";
    fixtures.assigneeId = fixtures.otherPersonId;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target }) }), 501);
    expect(fixtures.status).toBe("in_review");
  });

  it.each(["Done", "In Progress"])("refuses an assigned developer's PM-only In Review → %s request", async (target) => {
    fixtures.status = "in_review";
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target }) }), 403);
  });

  it.each([
    ["to_do", "In Progress"],
    ["in_progress", "In Review"],
  ])("refuses the PM's developer-only %s → %s request", async (current, target) => {
    fixtures.role = "product_manager";
    fixtures.status = current;
    await expectError(await requestEndpoint("taskState", { body: JSON.stringify({ state: target }) }), 403);
  });

  it.each([
    "{}", "null", "[]", '{"state":null}', '{"state":42}',
    '{"state":"in_progress"}', '{"state":"Unknown"}',
    '{"state":"constructor"}', '{"state":"toString"}', '{"state":"__proto__"}',
  ])("rejects missing or invalid state in %s", async (body) => {
    await expectError(await requestEndpoint("taskState", { body }), 400);
  });
});
