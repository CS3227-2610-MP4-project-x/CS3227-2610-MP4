import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.1 (projects-membership-4-1). identity-and-access "Mutating project routes
// check the request origin" (all five scenarios); design.md D8 (C2 resolution) and Q4 (check
// order). No formal requirement IDs exist.
//
// The real route handlers run. Supabase Auth, server config and `pg` are replaced; the `pg`
// fake records every call and answers nothing, so a refused request is shown to reach
// neither the session lookup nor the database. All values are synthetic.
//
// Task 4.3 adds `PATCH .../tasks/{taskId}/state` and `POST .../tasks/{taskId}/progress-updates`,
// which the approved delta adds to the requirement's route list ("Origin list" conflict
// resolution; design.md "Task Lifecycle Decisions (4.3)" check order). Their bodies are valid
// ({state, version} and {body}), so a matching Origin proceeds to the session check (401).
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  query: vi.fn(),
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

const appOrigin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";

type MutatingRoute = "create" | "members" | "transfer" | "taskState" | "progressUpdate";
const routes: MutatingRoute[] = ["create", "members", "transfer", "taskState", "progressUpdate"];

const validBodies: Record<MutatingRoute, unknown> = {
  create: { key: "WEB", name: "Synthetic project" },
  members: { githubUsername: "synthetic-target" },
  transfer: { githubUsername: "synthetic-target" },
  taskState: { state: "In Progress", version: 1 },
  progressUpdate: { body: "Synthetic progress update" },
};

interface RequestOptions {
  origin?: string | null;
  contentType?: string | null;
}

async function call(route: MutatingRoute, options: RequestOptions = {}): Promise<Response> {
  const taskPath = `/api/v1/projects/${projectId}/tasks/${taskId}`;
  const path = route === "create" ? "/api/v1/projects"
    : route === "members" ? `/api/v1/projects/${projectId}/members`
      : route === "taskState" ? `${taskPath}/state`
        : route === "progressUpdate" ? `${taskPath}/progress-updates`
          : `/api/v1/projects/${projectId}/product-manager-transfer`;
  const method = route === "taskState" ? "PATCH" : "POST";
  const headers = new Headers();
  const origin = options.origin === undefined ? appOrigin : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  // A byte body, so no content type is added implicitly when the header is omitted.
  const body = new TextEncoder().encode(JSON.stringify(validBodies[route]));
  const request = new NextRequest(`${appOrigin}${path}`, { method, headers, body });
  const context = { params: Promise.resolve({ projectId }) };
  const taskContext = { params: Promise.resolve({ projectId, taskId }) };
  switch (route) {
    case "create": return (await import("../../src/app/api/v1/projects/route")).POST(request);
    case "members": return (await import("../../src/app/api/v1/projects/[projectId]/members/route")).POST(request, context);
    case "transfer": return (await import("../../src/app/api/v1/projects/[projectId]/product-manager-transfer/route")).POST(request, context);
    case "taskState": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route")).PATCH(request, taskContext);
    case "progressUpdate": return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/progress-updates/route")).POST(request, taskContext);
  }
}

async function expectError(response: Response, status: number, code: string, message: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ error: { code, message } });
}

function expectUntouched(): void {
  expect(boundary.getUser).not.toHaveBeenCalled();
  expect(boundary.query).not.toHaveBeenCalled();
  expect(boundary.connect).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
  boundary.query.mockRejectedValue(new Error("The database must not be reached in this test"));
  boundary.connect.mockRejectedValue(new Error("The database must not be reached in this test"));
});

afterEach(() => {
  vi.clearAllMocks();
});

const badOrigins: [string, string | null][] = [
  ["a missing Origin", null],
  ["a different host", "https://evil.example"],
  ["a different scheme", "http://synthetic-app.example"],
  ["a different port", "https://synthetic-app.example:8443"],
  ["a look-alike suffix", "https://synthetic-app.example.evil.example"],
  ["the opaque origin null", "null"],
];

describe.each(routes)("mutating route %s request-origin check", (route) => {
  it.each(badOrigins)("refuses %s with 403 FORBIDDEN before the session or database", async (_label, origin) => {
    await expectError(await call(route, { origin }), 403, "FORBIDDEN", "Insufficient permissions");
    expectUntouched();
  });

  it.each([
    ["a missing Content-Type", null],
    ["text/plain", "text/plain"],
    ["form data", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=synthetic"],
  ])("refuses %s with 400 INVALID_REQUEST before the session or database", async (_label, contentType) => {
    await expectError(await call(route, { contentType }), 400, "INVALID_REQUEST", "Invalid request");
    expectUntouched();
  });

  it("returns 403, not 400, when both the Origin and the content type are bad", async () => {
    await expectError(await call(route, { origin: "https://evil.example", contentType: "text/plain" }), 403, "FORBIDDEN", "Insufficient permissions");
    expectUntouched();
  });

  it("returns 403, not 401, for a bad Origin without a valid session", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await call(route, { origin: null }), 403, "FORBIDDEN", "Insufficient permissions");
    expectUntouched();
  });

  it("proceeds to authentication when the Origin matches and the body is JSON", async () => {
    await expectError(await call(route), 401, "UNAUTHENTICATED", "Authentication required");
    expect(boundary.getUser).toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.connect).not.toHaveBeenCalled();
  });
});
