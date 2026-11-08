import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Group 7.3: task-management "Authorized members read task detail" and
// completion-assessment "Developer and product manager access to check history".
// Real GET/composition/auth/services; only auth and PostgreSQL are synthetic.
// The database boundary supplies ordered rows, as PostgreSQL would. These tests
// verify the API contract; PostgreSQL execution/ordering needs integration tests.
const f = vi.hoisted(() => ({
  authId: "10000000-0000-4000-8000-000000000001",
  personId: "10000000-0000-4000-8000-000000000002",
  projectId: "10000000-0000-4000-8000-000000000003",
  taskId: "10000000-0000-4000-8000-000000000004",
  otherId: "10000000-0000-4000-8000-000000000005",
  getUser: vi.fn(), query: vi.fn(), writes: [] as string[],
  member: true, exists: true, projectExists: true, deleted: false,
  role: "developer", assigned: true, foreign: false, empty: false, branch: "feature/check" as string | null,
  fail: false, reassignDuringRead: false, dueDate: "2026-11-30" as string | Date, version: 17,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({
  appEnvironment: "development", appOrigin: "https://synthetic-app.example",
  databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
  databaseCaCert: "synthetic-test-ca", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "synthetic-publishable-key", githubAppClientId: "synthetic-client",
  githubAppClientSecret: "synthetic-secret", ai: { provider: "fake" },
}) }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }),
}));
vi.mock("pg", () => {
  class Pool { query = f.query; }
  return { Pool, default: { Pool } };
});

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const earlier = "2026-11-01T00:00:00.000Z";
const later = "2026-11-02T00:00:00.000Z";
const actor = () => ({ id: f.assigned ? f.personId : f.otherId, githubUsername: "synthetic-developer" });
const criteria = () => [
  { id: id(1), position: 1, description: "Validate input" },
  { id: id(2), position: 1, description: "Return safe errors" },
  { id: id(3), position: 2, description: "Record evidence" },
];
const commits = () => [1, 2, 3].map((n) => ({ id: id(10 + n), sha: String(n).repeat(40), attachedBy: actor(), attachedAt: n < 3 ? earlier : later }));
const updates = () => [1, 2, 3].map((n) => ({ id: id(20 + n), author: actor(), body: `Synthetic update ${n}`, createdAt: n < 3 ? earlier : later }));
const feedback = () => [1, 2, 3].map((n) => ({ id: id(30 + n), author: { id: f.otherId, githubUsername: "synthetic-pm" }, feedback: `Synthetic feedback ${n}`, createdAt: n < 3 ? earlier : later }));
const history = () => [3, 2, 1].map((n) => ({
  id: id(40 + n), anchorSha: String(n).repeat(40), createdAt: n > 1 ? later : earlier, redacted: n === 2,
  payload: { anchorSha: String(n).repeat(40), criteria: [{ criterionId: id(1), criterion: "Validate input", status: "addressed", evidence: ["+ validate(input);"] }], possibleGaps: [], omittedFiles: [] },
}));
function expected() {
  return {
    // Task 4.3, design.md L1: `version` is the task's current integer version (databaseTask's 17).
    task: { id: f.taskId, projectKey: "WEB", taskKey: "WEB-12", title: "Validate requests", description: "Synthetic plain text <script>input</script>", status: "in_progress", version: f.version, assignee: actor(), dueDate: "2026-11-30", branchName: f.branch, acceptanceCriteria: f.empty ? [] : criteria() },
    attachedCommits: f.empty ? [] : commits(), progressUpdates: f.empty ? [] : updates(),
    reviewFeedback: f.empty ? [] : feedback(), checkHistory: f.empty ? [] : history(),
  };
}
function databaseTask() {
  const dto = expected();
  // Synthetic private columns deliberately accompany public data. No mapper may
  // spread database rows into the public response.
  return {
    id: f.taskId, project_id: f.projectId, number: 12, task_number: 12,
    project_key: "WEB", task_key: "WEB-12", title: dto.task.title, description: dto.task.description,
    status: "in_progress", assignee_id: dto.task.assignee.id, assignee_github_username: dto.task.assignee.githubUsername,
    due_date: "2026-11-30", branch_name: f.branch, assignee: actor(),
    acceptance_criteria: dto.task.acceptanceCriteria, criteria: dto.task.acceptanceCriteria,
    attached_commits: dto.attachedCommits, progress_updates: dto.progressUpdates,
    review_feedback: dto.reviewFeedback, check_history: dto.checkHistory,
    auth_user_id: f.authId, github_user_id: "987654", token: "synthetic-private-token",
    version: f.version, deleted_at: null, role: f.role, person_id: f.personId,
  };
}
const rows = (data: Record<string, unknown>[]) => ({ rows: data, rowCount: data.length });

beforeEach(() => {
  Object.assign(f, { member: true, exists: true, projectExists: true, deleted: false, role: "developer", assigned: true, foreign: false, empty: false, branch: "feature/check", fail: false, reassignDuringRead: false, dueDate: "2026-11-30", version: 17 });
  f.writes.length = 0;
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: f.authId } }, error: null });
  f.query.mockReset().mockImplementation(async (statement: string | { text: string; values?: readonly unknown[] }, values?: readonly unknown[]) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const parameters = values ?? (typeof statement === "string" ? [] : statement.values ?? []);
    if (/^\s*(insert|update|delete|merge|truncate|call|begin|commit)\b/i.test(sql)) {
      f.writes.push(sql); throw new Error("Task detail must be read-only");
    }
    if (f.fail) throw new Error("synthetic-private-db-detail");
    if (/\bapp\.tasks\b/i.test(sql)) {
      if (!f.exists || f.deleted || f.foreign || !parameters.includes(f.taskId) || !parameters.includes(f.projectId)) return rows([]);
      const task = databaseTask();
      // Only the detail snapshot changes: the initial lightweight access lookup
      // still observes the original assignee.
      if (f.reassignDuringRead && /\bapp\.acceptance_criteria\b/i.test(sql)) {
        task.assignee_id = f.otherId;
        task.assignee = { id: f.otherId, githubUsername: "synthetic-developer" };
      }
      // pg parses an uncast DATE as local midnight. A SQL text projection returns
      // the original calendar date instead, which must remain timezone independent.
      const projectsDateAsText = /(?:\b\w+\.)?due_date\s*::\s*text\b/i.test(sql);
      return rows([{ ...task, due_date: projectsDateAsText ? "2026-11-30" : f.dueDate }]);
    }
    if (/\bapp\.memberships\b/i.test(sql)) return rows(f.member && f.projectExists ? [{ id: id(50), project_id: f.projectId, person_id: f.personId, role: f.role }] : []);
    if (/\bapp\.projects\b/i.test(sql)) return rows(f.projectExists ? [{ id: f.projectId, key: "WEB", name: "Synthetic project" }] : []);
    if (/\bapp\.people\b/i.test(sql)) return rows([{ id: f.personId, auth_user_id: f.authId }]);
    if (/\bapp\.check_results\b/i.test(sql)) return rows((f.empty ? [] : history()).map((h) => ({ id: h.id, created_at: h.createdAt, redacted: h.redacted, result: h.payload, task_id: f.taskId, model: "private-model", commit_set_hash: "private-hash" })));
    throw new Error(`Unhandled synthetic read: ${sql}`);
  });
});
afterEach(() => { expect(f.writes).toEqual([]); });

async function get(options: { projectId?: string; taskId?: string } = {}) {
  const projectId = options.projectId ?? f.projectId;
  const taskId = options.taskId ?? f.taskId;
  const { GET } = await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/route");
  return GET(new NextRequest(`https://synthetic-app.example/api/v1/projects/${projectId}/tasks/${taskId}`), { params: Promise.resolve({ projectId, taskId }) });
}
const errors = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
} as const;
async function expectError(response: Response, status: keyof typeof errors) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: errors[status] });
  expect(f.writes).toEqual([]);
}

describe("authorized task-detail GET and check history", () => {
  it.each(["developer", "product_manager"])("returns the exact safe DTO for %s without writes", async (role) => {
    f.role = role;
    if (role === "product_manager") f.assigned = false;
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(expected());
    expect(f.writes).toEqual([]);
  });
  it("returns every empty collection as an array and permits a null branch", async () => {
    f.empty = true; f.branch = null;
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected());
    expect(f.writes).toEqual([]);
  });
  it("preserves criterion position/ID ascending and child timestamp/ID ascending order", async () => {
    const response = await get(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.task.acceptanceCriteria.map((c: { id: string }) => c.id)).toEqual([id(1), id(2), id(3)]);
    for (const [key, start] of [["attachedCommits", 10], ["progressUpdates", 20], ["reviewFeedback", 30]] as const) {
      expect(body[key].map((c: { id: string }) => c.id)).toEqual([id(start + 1), id(start + 2), id(start + 3)]);
    }
  });
  it("exposes distinct older checks with newest timestamp/ID first, including the redaction flag", async () => {
    const response = await get(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checkHistory).toEqual(history());
    expect(new Set(body.checkHistory.map((h: { id: string }) => h.id)).size).toBe(3);
    expect(f.writes).toEqual([]);
  });
  it("repeated PM reads retain one history item per stored result and do not mutate records", async () => {
    f.role = "product_manager"; f.assigned = false;
    for (let n = 0; n < 2; n += 1) {
      const response = await get(); expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected());
    }
    expect(f.writes).toEqual([]);
  });
  it("refuses an unassigned project developer without exposing task or history", async () => {
    f.assigned = false; await expectError(await get(), 403);
  });
  it("denies a developer reassigned away between access lookup and the detail snapshot before reading check history", async () => {
    f.reassignDuringRead = true;
    const response = await get();
    // Assert history was not fetched even if the response assertion fails.
    const historyReads = f.query.mock.calls.filter(([statement]) => {
      const sql = typeof statement === "string" ? statement : statement.text;
      return /\bapp\.check_results\b/i.test(sql);
    });
    expect.soft(historyReads).toEqual([]);
    await expectError(response, 403);
  });
  // Task 4.3: task-management "Task detail exposes the current version" (design.md L1, M1).
  it.each(["developer", "product_manager"])("exposes the task's current integer version to the %s", async (role) => {
    f.role = role;
    if (role === "product_manager") f.assigned = false;
    f.version = 2_147_483_647;
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.task.version).toBe(2_147_483_647);
    expect(Number.isInteger(body.task.version)).toBe(true);
    expect(f.writes).toEqual([]);
  });
  it("keeps the calendar due date when pg returns Singapore local midnight as a Date", async () => {
    // 2026-11-30 00:00:00 in Asia/Singapore; no process timezone is mutated.
    f.dueDate = new Date("2026-11-29T16:00:00.000Z");
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).task.dueDate).toBe("2026-11-30");
  });
  it.each(["nonmember", "foreign task", "missing task", "deleted task", "missing project"])("conceals %s", async (kind) => {
    if (kind === "nonmember") f.member = false;
    if (kind === "foreign task") f.foreign = true;
    if (kind === "missing task") f.exists = false;
    if (kind === "deleted task") f.deleted = true;
    if (kind === "missing project") f.projectExists = false;
    await expectError(await get(), 404);
  });
  it.each(["projectId", "taskId"] as const)("rejects malformed %s before database access", async (key) => {
    await expectError(await get({ [key]: "not-a-uuid" }), 400);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("refuses anonymous reads before database access", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await get(), 401); expect(f.query).not.toHaveBeenCalled();
  });
  it("returns a safe error on database failure without leaking implementation details", async () => {
    f.fail = true; await expectError(await get(), 500);
  });
});
