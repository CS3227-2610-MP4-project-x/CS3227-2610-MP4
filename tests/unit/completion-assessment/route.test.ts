import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Group 7.3: completion-assessment's task-scoped POST, safe API errors and
// advisory-only behavior. The real composition, authorization, repositories and
// check service run; only external boundaries are replaced with synthetic data.
// Task 4.2 owns the separate checkHistory read contract and its PM API tests.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(), query: vi.fn(), gatewayRun: vi.fn(), recordCacheHit: vi.fn(),
  defaultBranch: vi.fn(), branches: vi.fn(), file: vi.fn(), ancestor: vi.fn(), diff: vi.fn(),
  role: "developer", assigned: true, visible: true, shas: [] as string[],
  saved: null as null | Record<string, unknown>,
  writes: [] as { sql: string; values: readonly unknown[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({
  appOrigin: "https://synthetic-app.example", appEnvironment: "production",
  databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
  databaseCaCert: "synthetic-ca", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "synthetic-key", githubAppId: "123", githubAppSlug: "synthetic-app",
  githubAppPrivateKey: "synthetic-private-key", githubAppClientId: "synthetic-client",
  githubAppClientSecret: "synthetic-secret",
  ai: { provider: "fake", model: "synthetic-model" },
}) }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: boundary.getUser } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = boundary.query;
    async connect() { return { query: boundary.query, release: vi.fn() }; }
  }
  return { Pool, default: { Pool } };
});
vi.mock("@/server/github", async (original) => ({
  ...await original<typeof import("@/server/github")>(),
  GitHubAppAdapter: class {
    getRepositoryDefaultBranch = boundary.defaultBranch;
    listBranches = boundary.branches;
    fetchFileAtCommit = boundary.file;
    isAncestor = boundary.ancestor;
    fetchDiff = boundary.diff;
  },
}));
vi.mock("@/server/ai", async (original) => ({
  ...await original<typeof import("@/server/ai")>(),
  LlmGateway: class { run = boundary.gatewayRun; recordCacheHit = boundary.recordCacheHit; },
}));

const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const personId = "22222222-2222-4222-8222-222222222222";
const authId = "11111111-1111-4111-8111-111111111111";
const criterionId = "55555555-5555-4555-8555-555555555555";
const checkId = "66666666-6666-4666-8666-666666666666";
const sha = "a".repeat(40);
const timestamp = "2026-11-07T03:00:00.000Z";
const privateDetail = "synthetic-private-provider-or-database-detail";
const payload = {
  assessmentVersion: 2, anchorSha: sha,
  criteria: [{ criterionId, criterion: "Validate callback state", status: "addressed", evidence: [], modelStatus: "addressed",
    verification: { state: "verified", reasonCodes: [] }, evidenceFiles: [{ path: "src/domain/callback.ts", commitSha: sha,
      excerpts: [{ hunkId: "H1", lines: [{ reference: "L1", text: "+validateState();" }] }] }] }],
  possibleGaps: ["Consider malformed callback tests"], omittedFiles: [],
};
const expectedCheck = { id: checkId, anchorSha: sha, createdAt: timestamp, redacted: false, payload };

type RequestOptions = {
  projectId?: string; taskId?: string; raw?: string; body?: unknown;
  origin?: string | null; contentType?: string | null;
};
async function request(options: RequestOptions = {}) {
  const project = options.projectId ?? projectId;
  const task = options.taskId ?? taskId;
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? origin);
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/json");
  const req = new NextRequest(`${origin}/api/v1/projects/${project}/tasks/${task}/acceptance-criteria-check`, {
    method: "POST", headers,
    body: options.raw ?? JSON.stringify(Object.hasOwn(options, "body") ? options.body : {}),
  });
  const route = await import("../../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/acceptance-criteria-check/route");
  return route.POST(req, { params: Promise.resolve({ projectId: project, taskId: task }) });
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ error: { code, message: expect.any(String) } });
  expect(text).not.toContain(privateDetail);
  expect(text).not.toContain("synthetic-private-key");
  expect(text).not.toContain("stack");
  expect(boundary.writes).toEqual([]);
}
function expectNoAssessment() {
  expect(boundary.gatewayRun).not.toHaveBeenCalled();
  expect(boundary.recordCacheHit).not.toHaveBeenCalled();
  expect(boundary.file).not.toHaveBeenCalled();
  expect(boundary.diff).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.role = "developer"; boundary.assigned = true; boundary.visible = true;
  boundary.shas = [sha]; boundary.saved = null; boundary.writes.length = 0;
  boundary.getUser.mockResolvedValue({ data: { user: { id: authId,
    identities: [{ provider: "github", provider_id: "424242" }],
  } }, error: null });
  boundary.query.mockImplementation(async (sql: string, values: readonly unknown[] = []) => {
    if (/^\s*SELECT/i.test(sql) && /FROM app.tasks t/.test(sql)) {
      // Check both scoped task identifiers and the server-verified identity.
      if (!boundary.visible || values[0] !== taskId || values[1] !== projectId ||
          values[2] !== authId || values[3] !== "424242") return { rows: [], rowCount: 0 };
      return { rows: [{ task_id: taskId, project_id: projectId, person_id: personId,
        role: boundary.role, assignee_id: boundary.assigned ? personId : checkId,
        criteria: [{ id: criterionId, description: "Validate callback state", position: 1 }],
        attached_commit_shas: boundary.shas, github_repository_id: "456", github_installation_id: "123",
        github_repository_owner: "synthetic-owner", github_repository_name: "synthetic-repository",
      }], rowCount: 1 };
    }
    if (/^\s*SELECT/i.test(sql) && /FROM app.check_results/.test(sql)) {
      return { rows: boundary.saved ? [boundary.saved] : [], rowCount: boundary.saved ? 1 : 0 };
    }
    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
      boundary.writes.push({ sql, values });
      if (/^\s*INSERT INTO app.check_results/.test(sql)) {
        boundary.saved = { id: checkId, created_at: timestamp, redacted: values[5], result: JSON.parse(String(values[6])) };
        return { rows: [boundary.saved], rowCount: 1 };
      }
    }
    throw new Error(`Unexpected database operation: ${privateDetail}`);
  });
  boundary.defaultBranch.mockResolvedValue({ ok: true, value: "main" });
  boundary.branches.mockResolvedValue({ ok: true, value: [{ name: "main", sha }] });
  boundary.file.mockResolvedValue({ ok: true, value: JSON.stringify({
    version: 1, domainLogic: ["src/domain/"], apiHandlers: [], tests: [], ui: [], lockfileNames: [], generatedPathPrefixes: [],
  }) });
  boundary.ancestor.mockResolvedValue({ ok: true, value: true });
  boundary.diff.mockResolvedValue({ ok: true, value: [
    "diff --git a/src/domain/callback.ts b/src/domain/callback.ts",
    "--- a/src/domain/callback.ts", "+++ b/src/domain/callback.ts", "@@ -0,0 +1 @@", "+validateState();", "",
  ].join("\n") });
  boundary.gatewayRun.mockImplementation(async (options: { validate: (value: unknown) => { ok: boolean; value?: unknown } }) => {
    const validated = options.validate({ criteria: [{ criterionId, status: "addressed", evidenceRefs: ["L1"] }], possibleGaps: payload.possibleGaps });
    if (!validated.ok) throw new Error("Synthetic provider fixture failed validation");
    return { ok: true, value: validated.value, model: "synthetic-model", redaction: { redactionCount: 0 } };
  });
  boundary.recordCacheHit.mockResolvedValue(undefined);
});

describe("Group 7.3 task-scoped acceptance check POST", () => {
  it("allows at least 150 seconds for the two AI attempts and database work (G11)", async () => {
    const route = await import("../../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/acceptance-criteria-check/route");
    expect(route).toHaveProperty("maxDuration", expect.any(Number));
    expect(Reflect.get(route, "maxDuration")).toBeGreaterThanOrEqual(150);
  });

  it("returns the assigned developer's check and creates only a derived result", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ check: expectedCheck, reused: false });
    expect(boundary.gatewayRun).toHaveBeenCalledTimes(1);
    expect(boundary.writes).toHaveLength(1);
    // Any task-state write, submission, approval or review mutation fails this assertion.
    expect(boundary.writes.every(({ sql }) => /^\s*INSERT INTO app.check_results\b/.test(sql))).toBe(true);
  });

  it("returns the same existing result on reuse without another assessment or history write", async () => {
    const first = await request();
    expect(await first.json()).toEqual({ check: expectedCheck, reused: false });
    const second = await request();
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toContain("no-store");
    expect(await second.json()).toEqual({ check: expectedCheck, reused: true });
    expect(boundary.gatewayRun).toHaveBeenCalledTimes(1);
    expect(boundary.recordCacheHit).toHaveBeenCalledTimes(1);
    expect(boundary.writes).toHaveLength(1);
  });

  it("accepts an empty JSON object with whitespace and a JSON charset", async () => {
    const response = await request({ raw: " \n { } \n", contentType: "application/json; charset=utf-8" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ check: expectedCheck, reused: false });
  });

  it.each(["product_manager", "unassigned developer"])("forbids %s before GitHub, LLM or writes", async (caller) => {
    if (caller === "product_manager") boundary.role = "product_manager";
    else boundary.assigned = false;
    await expectError(await request(), 403, "FORBIDDEN");
    expectNoAssessment();
  });

  it("conceals missing tasks and non-member projects", async () => {
    boundary.visible = false;
    await expectError(await request(), 404, "NOT_FOUND");
    expectNoAssessment();
  });

  it.each(["missing session", "auth failure"])("returns UNAUTHENTICATED for %s", async (failure) => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: failure === "auth failure" ? new Error(privateDetail) : null });
    await expectError(await request(), 401, "UNAUTHENTICATED");
    expect(boundary.query).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it("requires a verified GitHub identity", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: { id: authId, identities: [] } }, error: null });
    await expectError(await request(), 403, "FORBIDDEN");
    expect(boundary.query).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it.each<RequestOptions>([
    { projectId: "not-a-uuid" }, { taskId: "not-a-uuid" },
    { projectId: "33333333-3333-4333-0333-333333333333" },
    { taskId: "44444444-4444-0444-8444-444444444444" },
  ])("rejects malformed project/task UUIDs %j", async (options) => {
    await expectError(await request(options), 400, "INVALID_REQUEST");
    expect(boundary.getUser).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it.each([null, [], [1], "text", 42, true, { commitShas: [sha] }, { criteria: [] }, { reused: true },
    { approved: true }, { constructor: {} }].map((body) => ({ body })))("requires exactly an empty JSON object: $body", async ({ body }) => {
    await expectError(await request({ body }), 400, "INVALID_REQUEST");
    expect(boundary.getUser).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it.each(["", "{invalid", "{}{}"])("rejects malformed or absent JSON %j", async (raw) => {
    await expectError(await request({ raw }), 400, "INVALID_REQUEST");
    expect(boundary.getUser).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it.each([null, "text/plain"])("rejects missing or non-JSON content type %j", async (contentType) => {
    await expectError(await request({ contentType }), 400, "INVALID_REQUEST");
    expect(boundary.getUser).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it.each([null, "null", "https://untrusted.example", `${origin}.untrusted.example`])("rejects unsafe or missing Origin %j", async (requestOrigin) => {
    await expectError(await request({ origin: requestOrigin }), 400, "INVALID_REQUEST");
    expect(boundary.getUser).not.toHaveBeenCalled();
    expectNoAssessment();
  });

  it("returns the attach-commits prerequisite error safely", async () => {
    boundary.shas = [];
    await expectError(await request(), 409, "CHECK_REQUIRES_COMMITS");
    expectNoAssessment();
  });

  it("returns the incomparable-tip error safely", async () => {
    boundary.shas = [sha, "b".repeat(40)];
    boundary.ancestor.mockResolvedValue({ ok: true, value: false });
    await expectError(await request(), 409, "INCOMPARABLE_COMMIT_TIPS");
    expect(boundary.gatewayRun).not.toHaveBeenCalled();
  });

  it("returns evidence failures without leaking provider detail", async () => {
    boundary.file.mockResolvedValue({ ok: false, category: "unavailable", detail: privateDetail });
    await expectError(await request(), 503, "EVIDENCE_UNAVAILABLE");
    expect(boundary.gatewayRun).not.toHaveBeenCalled();
  });

  it.each([
    ["RATE_LIMITED", 429], ["QUOTA_EXCEEDED", 429], ["AI_UNAVAILABLE", 503],
    ["AI_ERROR", 502], ["INVALID_OUTPUT", 502],
  ] as const)("maps %s to the existing safe %i error contract", async (code, status) => {
    boundary.gatewayRun.mockResolvedValue({ ok: false, code, detail: privateDetail });
    await expectError(await request(), status, code);
  });

  it("contains an unexpected service/database failure", async () => {
    boundary.query.mockRejectedValue(new Error(privateDetail));
    await expectError(await request(), 500, "INTERNAL_ERROR");
    expectNoAssessment();
  });
});
