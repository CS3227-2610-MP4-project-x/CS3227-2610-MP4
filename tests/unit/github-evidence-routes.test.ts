import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tasks 5.1/5.3: approved task-scoped GitHub evidence contracts. All identities,
// provider data and database rows are synthetic. Only external boundaries are replaced.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(), query: vi.fn(), listBranches: vi.fn(), listCommits: vi.fn(), fetchDiff: vi.fn(),
  getCommitIdentity: vi.fn(), isAncestor: vi.fn(), getCommitAuthor: vi.fn(), getRepositoryDefaultBranch: vi.fn(), transaction: [] as string[], saved: new Set<string>(),
  status: "in_progress", existing: [] as { commit_sha: string; source_branch: string | null }[], member: true, role: "developer", assigned: true, linked: true, exists: true,
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
    getCommitIdentity = boundary.getCommitIdentity;
    isAncestor = boundary.isAncestor;
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
type Endpoint = "branches" | "commits" | "attach" | "replace";
async function request(endpoint: Endpoint, options: { query?: string; body?: unknown; raw?: string; origin?: string; taskId?: string } = {}) {
  const id = options.taskId ?? taskId;
  const root = `${origin}/api/v1/projects/${projectId}/tasks/${id}`;
  const path = (endpoint === "attach" || endpoint === "replace") ? `${root}/attached-commits` : `${root}/github-evidence/${endpoint}`;
  const req = new NextRequest(`${path}${options.query ? `?${options.query}` : ""}`, {
    method: endpoint === "replace" ? "PUT" : endpoint === "attach" ? "POST" : "GET",
    headers: { "content-type": "application/json", origin: options.origin ?? origin },
    ...((endpoint === "attach" || endpoint === "replace") ? { body: options.raw ?? JSON.stringify(options.body ?? (endpoint === "replace" ? { attachments: [{ sha, sourceBranch: "main" }] } : { commitShas: [sha] })) } : {}),
  });
  const context = { params: Promise.resolve({ projectId, taskId: id }) };
  if (endpoint === "branches") return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/github-evidence/branches/route")).GET(req, context);
  if (endpoint === "commits") return (await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/github-evidence/commits/route")).GET(req, context);
  const route = await import("../../src/app/api/v1/projects/[projectId]/tasks/[taskId]/attached-commits/route");
  return endpoint === "replace" ? route.PUT(req, context) : route.POST(req, context);
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
  boundary.status = "in_progress"; boundary.existing = [];
  boundary.member = true; boundary.role = "developer"; boundary.assigned = true;
  boundary.linked = true; boundary.exists = true; boundary.writes.length = 0; boundary.saved.clear(); boundary.transaction.length = 0;
  boundary.getUser.mockResolvedValue({ data: { user: { id: authId,
    identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-developer" } }],
  } }, error: null });
  boundary.query.mockImplementation(async (input: string | { text: string; values?: readonly unknown[] }, params?: readonly unknown[]) => {
    const sql = typeof input === "string" ? input : input.text;
    const values = params ?? (typeof input === "string" ? [] : input.values ?? []);
    if (/^\s*(begin|commit|rollback|set)\b/i.test(sql)) { boundary.transaction.push(sql.trim().toUpperCase()); return { rows: [], rowCount: 0 }; }
    if (/^\s*(insert|update|delete)\b/i.test(sql)) {
      boundary.writes.push({ sql, values });
      if (/INSERT INTO app.attached_commits/i.test(sql)) boundary.saved.add(String(values[1]));
      return { rows: [{ sha, commit_sha: sha, id: taskId }], rowCount: 1 };
    }
    if (/t\.status\s*=\s*'in_progress'/i.test(sql) && boundary.status !== "in_progress") return { rows: [], rowCount: 0 };
    const row = { id: personId, person_id: personId, auth_user_id: authId,
      github_user_id: "424242", github_username: "synthetic-developer",
      project_id: projectId, project_key: "TASK", key: "TASK", task_id: taskId,
      task_number: 42, number: 42, canonical_task_id: "TASK-42", task_key: "TASK-42",
      role: boundary.role, assignee_id: boundary.assigned ? personId : "66666666-6666-4666-8666-666666666666",
      status: boundary.status, branch: "feature/task-42", github_branch: "feature/task-42",
      github_installation_id: boundary.linked ? "123" : null,
      github_repository_id: boundary.linked ? "456" : null,
      github_repository_owner: boundary.linked ? "synthetic-owner" : null,
      github_repository_name: boundary.linked ? "synthetic-repository" : null,
      default_branch: "main", version: 1 };
    if (/\bapp\.attached_commits\b/i.test(sql)) return { rows: boundary.existing, rowCount: boundary.existing.length };
    if (!boundary.exists || (/\bapp\.memberships\b/i.test(sql) && !boundary.member)) return { rows: [], rowCount: 0 };
    return { rows: [row], rowCount: 1 };
  });
  boundary.getCommitIdentity.mockImplementation(async (_repo, value) => ({ ok: true, value: { sha: value, author: { id: 424242, login: "synthetic-developer" } } }));
  boundary.isAncestor.mockResolvedValue({ ok: true, value: true });
  boundary.listBranches.mockResolvedValue({ ok: true, value: [{ name: "main", sha }, { name: "feature/task-42", sha }] });
  boundary.listCommits.mockResolvedValue({ ok: true, value: [{ sha, message: "TASK-42: synthetic implementation", authorId: 424242,
    authorLogin: "synthetic-developer", date: "2026-11-03T01:00:00Z" }] });
  boundary.getCommitAuthor.mockResolvedValue({ ok: true, value: { id: 424242, login: "synthetic-developer" } });
  boundary.getRepositoryDefaultBranch.mockResolvedValue({ ok: true, value: "main" });
  boundary.fetchDiff.mockResolvedValue({ ok: true, value: "synthetic diff" });
});
afterEach(() => vi.useRealTimers());

describe("task-scoped GitHub evidence authorization", () => {
  it.each<Endpoint>(["branches", "commits", "attach", "replace"])("rejects anonymous %s requests before provider calls", async (endpoint) => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await error(await request(endpoint), 401);
    expect(boundary.listBranches).not.toHaveBeenCalled(); expect(boundary.listCommits).not.toHaveBeenCalled();
    expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach", "replace"])("refuses a PM using the developer %s route", async (endpoint) => {
    boundary.role = "product_manager";
    await error(await request(endpoint), 403); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach", "replace"])("refuses a developer not assigned to the task on %s", async (endpoint) => {
    boundary.assigned = false;
    await error(await request(endpoint), 403); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["branches", "commits", "attach", "replace"])("conceals a task from nonmembers on %s", async (endpoint) => {
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
      /FOR SHARE OF t, m, p/.test(sql) && boundary.transaction.at(-1) === "BEGIN" ? { rows: [], rowCount: 0 } : original(sql, values));
    await error(await request("attach"), 403);
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual(["BEGIN", "ROLLBACK"]);
  });
});

// Task 11.1: approved github-evidence replacement and provenance contract.
describe("complete attachment replacement", () => {
  const selection = [{ sha: secondSha, sourceBranch: "feature/task-42" }];
  it("adds new evidence and removes omitted attachments in one transaction", async () => {
    boundary.existing = [{ commit_sha: sha, source_branch: "main" }];
    const response = await request("replace", { body: { attachments: selection } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ attachments: selection });
    expect(boundary.getCommitIdentity).toHaveBeenCalledWith(expect.anything(), secondSha);
    expect(boundary.isAncestor).toHaveBeenCalledWith(expect.anything(), secondSha, sha);
    expect(boundary.transaction).toEqual(["BEGIN", "COMMIT"]);
    expect(boundary.writes.some(({ sql }) => /DELETE FROM app.attached_commits/i.test(sql))).toBe(true);
    expect(boundary.writes.some(({ sql, values }) => /INSERT INTO app.attached_commits/i.test(sql) && values.includes("feature/task-42"))).toBe(true);
    expect(boundary.writes.every(({ sql }) => !/check_results|task_events/.test(sql))).toBe(true);
  });
  it("accepts an empty set to remove every attachment without provider evidence", async () => {
    boundary.existing = [{ commit_sha: sha, source_branch: "main" }];
    const response = await request("replace", { body: { attachments: [] } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ attachments: [] });
    expect(boundary.getCommitIdentity).not.toHaveBeenCalled();
    expect(boundary.writes.some(({ sql }) => /DELETE FROM app.attached_commits/i.test(sql))).toBe(true);
    expect(boundary.transaction).toEqual(["BEGIN", "COMMIT"]);
  });
  it("preserves recorded and legacy provenance regardless of submitted branch", async () => {
    boundary.existing = [{ commit_sha: sha, source_branch: "feat/original" }, { commit_sha: secondSha, source_branch: null }];
    const response = await request("replace", { body: { attachments: [{ sha, sourceBranch: "main" }, { sha: secondSha, sourceBranch: "main" }] } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attachments: [{ sha, sourceBranch: "feat/original" }, { sha: secondSha, sourceBranch: null }] });
    expect(boundary.getCommitIdentity).not.toHaveBeenCalled(); expect(boundary.isAncestor).not.toHaveBeenCalled();
    expect(boundary.writes.some(({ sql }) => /UPDATE app.attached_commits/i.test(sql))).toBe(false);
  });
  it.each([{}, { attachments: null }, { attachments: [], approved: true }, { attachments: [{ sha }] },
    { attachments: [{ sha: "bad", sourceBranch: "main" }] }, { attachments: [{ sha, sourceBranch: "" }] },
    { attachments: [{ sha, sourceBranch: 1 }] }, { attachments: [{ sha, sourceBranch: "main", author: 42 }] },
    { attachments: [{ sha, sourceBranch: "main" }, { sha, sourceBranch: "main" }] },
  ])("rejects invalid replacement input %j without writes", async (body) => {
    await error(await request("replace", { body }), 400); expect(boundary.writes).toEqual([]);
  });
  it("rejects malformed JSON and a cross-origin replacement", async () => {
    await error(await request("replace", { raw: "{invalid" }), 400);
    await error(await request("replace", { body: { attachments: [] }, origin: "https://untrusted.example" }), 400);
    expect(boundary.writes).toEqual([]);
  });
  it.each(["to_do", "in_review", "done"])("refuses replacement while %s", async (status) => {
    boundary.status = status;
    await error(await request("replace", { body: { attachments: selection } }));
    expect(boundary.writes).toEqual([]); expect(boundary.getCommitIdentity).not.toHaveBeenCalled();
  });
  it.each(["unknown branch", "null branch", "unreachable", "foreign author", "provider failure"])("keeps all existing evidence on %s", async (failure) => {
    boundary.existing = [{ commit_sha: sha, source_branch: "main" }];
    const attachments = [{ ...selection[0] }] as { sha: string; sourceBranch: string | null }[];
    if (failure === "unknown branch") attachments[0].sourceBranch = "feat/nonexistent";
    if (failure === "null branch") attachments[0].sourceBranch = null;
    if (failure === "unreachable") boundary.isAncestor.mockResolvedValue({ ok: true, value: false });
    if (failure === "foreign author") boundary.getCommitIdentity.mockResolvedValue({ ok: true, value: { sha: secondSha, author: { id: 999, login: "other" } } });
    if (failure === "provider failure") boundary.isAncestor.mockResolvedValue({ ok: false, category: "unavailable", detail: secret });
    await error(await request("replace", { body: { attachments } }));
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual([]);
  });
  it("rechecks task assignment and state before making transaction writes", async () => {
    boundary.getCommitIdentity.mockImplementation(async () => {
      expect(boundary.transaction).toEqual([]);
      boundary.status = "in_review";
      return { ok: true, value: { sha: secondSha, author: { id: 424242, login: "synthetic-developer" } } };
    });
    const original = boundary.query.getMockImplementation()!;
    boundary.query.mockImplementation(async (sql: string, values?: readonly unknown[]) =>
      /FOR (?:SHARE|UPDATE)/i.test(sql) && boundary.status !== "in_progress" ? { rows: [], rowCount: 0 } : original(sql, values));
    await error(await request("replace", { body: { attachments: selection } }));
    expect(boundary.writes).toEqual([]); expect(boundary.transaction).toEqual(["BEGIN", "ROLLBACK"]);
  });
});


describe("add-only attachments respect the evidence edit state", () => {
  it.each(["to_do", "in_review", "done"])("refuses POST while %s before provider verification", async (status) => {
    boundary.status = status;
    await error(await request("attach"));
    expect(boundary.getCommitAuthor).not.toHaveBeenCalled();
    expect(boundary.writes).toEqual([]);
    expect(boundary.transaction).toEqual([]);
  });
  it("rolls back POST when the task leaves In Progress during provider verification", async () => {
    boundary.getCommitAuthor.mockImplementation(async () => {
      expect(boundary.transaction).toEqual([]);
      boundary.status = "in_review";
      return { ok: true, value: { id: 424242, login: "synthetic-developer" } };
    });
    await error(await request("attach"));
    expect(boundary.writes).toEqual([]);
    expect(boundary.transaction).toEqual(["BEGIN", "ROLLBACK"]);
  });
});
