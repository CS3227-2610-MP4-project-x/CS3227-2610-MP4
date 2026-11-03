import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tasks 5.1/5.3: approved task-scoped GitHub evidence contracts. All identities,
// provider data and database rows are synthetic. Only external boundaries are replaced.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(), query: vi.fn(), listBranches: vi.fn(), listCommits: vi.fn(), fetchDiff: vi.fn(),
  getCommitAuthor: vi.fn(), getRepositoryDefaultBranch: vi.fn(), transaction: [] as string[], saved: new Set<string>(),
  member: true, role: "developer", assigned: true, linked: true, exists: true,
  writes: [] as { sql: string; values: readonly unknown[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({
  ai: { provider: "soclaas", apiKey: "synthetic-soclaas-key", model: "synthetic-model:1b" },
  appOrigin: "https://synthetic-app.example", appEnvironment: "production",
  databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
  databaseCaCert: "synthetic-ca", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "synthetic-key", githubAppId: "123", githubAppSlug: "synthetic-app",
  githubAppPrivateKey: "synthetic-private-key", githubAppClientId: "synthetic-client",
  githubAppClientSecret: "synthetic-secret",
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
vi.mock("@/server/github", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/github")>(),
  GitHubAppAdapter: class {
    listBranches = boundary.listBranches;
    listCommits = boundary.listCommits;
    fetchDiff = boundary.fetchDiff;
    getCommitAuthor = boundary.getCommitAuthor;
    getRepositoryDefaultBranch = boundary.getRepositoryDefaultBranch;
  },
}));
const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const personId = "22222222-2222-4222-8222-222222222222";
const authId = "11111111-1111-4111-8111-111111111111";
const sha = "a".repeat(40);
const secondSha = "b".repeat(40);
const secret = "synthetic-private-provider-detail";
type Endpoint = "branches" | "commits" | "attach";
async function request(endpoint: Endpoint, options: { query?: string; body?: unknown; raw?: string; origin?: string; taskId?: string } = {}) {
  const id = options.taskId ?? taskId;
  const root = `${origin}/api/v1/projects/${projectId}/tasks/${id}`;
  const path = endpoint === "attach" ? `${root}/attached-commits` : `${root}/github-evidence/${endpoint}`;
  const req = new NextRequest(`${path}${options.query ? `?${options.query}` : ""}`, {
    method: endpoint === "attach" ? "POST" : "GET",
    headers: { "content-type": "application/json", origin: options.origin ?? origin },
    ...(endpoint === "attach" ? { body: options.raw ?? JSON.stringify(options.body ?? { commitShas: [sha] }) } : {}),
  });
  const context = { params: Promise.resolve({ projectId, taskId: id }) };
  if (endpoint === "branches") return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/github-evidence/branches/route")).GET(req, context);
  if (endpoint === "commits") return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/github-evidence/commits/route")).GET(req, context);
  return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/attached-commits/route")).POST(req, context);
}
async function error(response: Response, status?: number) {
  if (status) expect(response.status).toBe(status);
  else expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.text();
  expect(body).not.toContain(secret);
  expect(body).not.toContain("synthetic-private-key");
  expect(JSON.parse(body)).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T03:00:00Z"));
  vi.clearAllMocks();
  boundary.member = true; boundary.role = "developer"; boundary.assigned = true;
  boundary.linked = true; boundary.exists = true; boundary.writes.length = 0; boundary.saved.clear(); boundary.transaction.length = 0;
  boundary.getUser.mockResolvedValue({ data: { user: { id: authId,
    identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-developer" } }],
  } }, error: null });
  boundary.query.mockImplementation(async (input: string | { text: string; values?: readonly unknown[] }, params?: readonly unknown[]) => {
    const sql = typeof input === "string" ? input : input.text;
    const values = params ?? (typeof input === "string" ? [] : input.values ?? []);
    if (/^\s*(begin|commit|rollback|set)\b/i.test(sql)) { boundary.transaction.push(sql.trim().toUpperCase()); return { rows: [], rowCount: 0 }; }
    if (/\b(insert|update|delete)\b/i.test(sql)) {
      boundary.writes.push({ sql, values });
      if (/INSERT INTO app.attached_commits/i.test(sql)) boundary.saved.add(String(values[1]));
      return { rows: [{ sha, commit_sha: sha, id: taskId }], rowCount: 1 };
    }
    const row = { id: personId, person_id: personId, auth_user_id: authId,
      github_user_id: "424242", github_username: "synthetic-developer",
      project_id: projectId, project_key: "TASK", key: "TASK", task_id: taskId,
      task_number: 42, number: 42, canonical_task_id: "TASK-42", task_key: "TASK-42",
      role: boundary.role, assignee_id: boundary.assigned ? personId : "66666666-6666-4666-8666-666666666666",
      status: "in_progress", branch: "feature/task-42", github_branch: "feature/task-42",
      github_installation_id: boundary.linked ? "123" : null,
      github_repository_id: boundary.linked ? "456" : null,
      github_repository_owner: boundary.linked ? "synthetic-owner" : null,
      github_repository_name: boundary.linked ? "synthetic-repository" : null,
      default_branch: "main", version: 1 };
    if (/\bapp\.attached_commits\b/i.test(sql)) return { rows: [], rowCount: 0 };
    if (!boundary.exists || (/\bapp\.memberships\b/i.test(sql) && !boundary.member)) return { rows: [], rowCount: 0 };
    return { rows: [row], rowCount: 1 };
  });
  boundary.listBranches.mockResolvedValue({ ok: true, value: [{ name: "main", sha }, { name: "feature/task-42", sha }] });
  boundary.listCommits.mockResolvedValue({ ok: true, value: [{ sha, message: "TASK-42: synthetic implementation", authorId: 424242,
    authorLogin: "synthetic-developer", date: "2026-11-03T01:00:00Z" }] });
  boundary.getCommitAuthor.mockResolvedValue({ ok: true, value: { id: 424242, login: "synthetic-developer" } });
  boundary.getRepositoryDefaultBranch.mockResolvedValue({ ok: true, value: "main" });
  boundary.fetchDiff.mockResolvedValue({ ok: true, value: "synthetic diff" });
});
afterEach(() => vi.useRealTimers());

describe("task-scoped GitHub evidence authorization", () => {
  it.each<Endpoint>(["branches", "commits", "attach"])("rejects anonymous %s requests before provider calls", async (endpoint) => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await error(await request(endpoint), 401);
    expect(boundary.listBranches).not.toHaveBeenCalled(); expect(boundary.listCommits).not.toHaveBeenCalled();
    expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach"])("refuses a PM using the developer %s route", async (endpoint) => {
    boundary.role = "product_manager";
    await error(await request(endpoint), 403); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach"])("refuses a developer not assigned to the task on %s", async (endpoint) => {
    boundary.assigned = false;
    await error(await request(endpoint), 403); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach"])("conceals a task from nonmembers on %s", async (endpoint) => {
    boundary.member = false;
    await error(await request(endpoint), 404); expect(boundary.writes).toEqual([]);
  });
  it("refuses a forged task UUID", async () => {
    await error(await request("commits", { taskId: "not-a-uuid" }), 400);
    expect(boundary.listCommits).not.toHaveBeenCalled();
  });
  it("refuses cross-origin attachment before any write", async () => {
    await error(await request("attach", { origin: "https://untrusted.example" }), 400);
    expect(boundary.writes).toEqual([]);
  });
});
describe("commit list contract", () => {
  it("uses the current SGT day, default pagination and task branch", async () => {
    const response = await request("commits"); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ since: "2026-11-02T16:00:00.000Z", until: "2026-11-03T16:00:00.000Z",
      branch: "feature/task-42", page: 1, perPage: 50, nextPage: null,
      commits: [{ sha, shortSha: expect.any(String), message: "TASK-42: synthetic implementation", authoredAt: "2026-11-03T01:00:00Z", mentionsTaskId: true }] });
  });
  it.each(["page=0", "page=1.5", "perPage=0", "perPage=101", "perPage=abc", "since=invalid", "since=2026-11-03T01:00:00Z&until=2026-11-03T01:00:00Z", "branch=unknown"])("rejects invalid filters %s", async (query) => {
    await error(await request("commits", { query }), 400); expect(boundary.listCommits).not.toHaveBeenCalled();
  });
  it("distinguishes an empty provider result from unavailable evidence", async () => {
    boundary.listCommits.mockResolvedValue({ ok: true, value: [] });
    const response = await request("commits"); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ commits: [], nextPage: null });
  });
  it("returns an explicit next page when more matching commits exist", async () => {
    boundary.listCommits.mockResolvedValue({ ok: true, value: [sha, secondSha].map((value) => ({ sha: value,
      message: "synthetic message", authorId: 424242, authorLogin: "synthetic-developer", date: "2026-11-03T01:00:00Z" })) });
    const response = await request("commits", { query: "page=1&perPage=1" }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 1, perPage: 1, nextPage: 2, commits: [{ sha }] });
  });
  it("reports revoked provider access safely without pretending no commits exist", async () => {
    boundary.listCommits.mockResolvedValue({ ok: false, category: "forbidden", status: 403, detail: secret });
    await error(await request("commits")); expect(boundary.writes).toEqual([]);
  });
});
describe("attachment transport validation", () => {
  it.each([{}, { commitShas: [] }, { commitShas: ["bad-sha"] }, { commitShas: [sha], githubUserId: 999 }, { commitShas: [sha], approved: true }])("rejects invalid or surplus fields %j", async (body) => {
    await error(await request("attach", { body }), 400); expect(boundary.writes).toEqual([]);
  });
  it("rejects malformed JSON", async () => {
    await error(await request("attach", { raw: "{invalid" }), 400); expect(boundary.writes).toEqual([]);
  });
});

describe("verified atomic attachment", () => {
  it("verifies unique SHAs once in first-seen order and succeeds idempotently", async () => {
    boundary.saved.add(sha);
    const response = await request("attach", { body: { commitShas: [secondSha, sha, secondSha, sha] } });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ attachedCommits: [{ sha: secondSha }, { sha }] });
    expect(boundary.getCommitAuthor.mock.calls.map((call) => call[1])).toEqual([secondSha, sha]);
    expect([...boundary.saved]).toEqual([sha, secondSha]);
    expect(boundary.transaction).toEqual(["BEGIN", "COMMIT"]);
    expect(boundary.writes.every(({ sql }) => /ON CONFLICT \(task_id, commit_sha\) DO NOTHING/.test(sql))).toBe(true);
  });
  it("writes nothing when any selected SHA has a foreign author", async () => {
    boundary.getCommitAuthor.mockResolvedValueOnce({ ok: true, value: { id: 424242, login: "synthetic-developer" } })
      .mockResolvedValueOnce({ ok: true, value: { id: 999, login: "synthetic-other" } });
    await error(await request("attach", { body: { commitShas: [sha, secondSha] } }), 403);
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual([]);
  });
  it("writes nothing when any selected SHA is inaccessible", async () => {
    boundary.getCommitAuthor.mockResolvedValueOnce({ ok: true, value: { id: 424242, login: "synthetic-developer" } })
      .mockResolvedValueOnce({ ok: false, category: "unavailable", detail: secret });
    await error(await request("attach", { body: { commitShas: [sha, secondSha] } }));
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual([]);
  });
  it("rechecks task authorization before the transaction writes", async () => {
    const original = boundary.query.getMockImplementation()!;
    boundary.query.mockImplementation(async (sql: string, values?: readonly unknown[]) =>
      /FOR SHARE OF t, m, p/.test(sql) ? { rows: [], rowCount: 0 } : original(sql, values));
    await error(await request("attach"), 403);
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual(["BEGIN", "ROLLBACK"]);
  });
});
