import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 5.1: github-evidence “Product manager links one repository through a
// GitHub App” and “GitHub access tokens are not exposed or persisted”. No formal
// requirement IDs exist. Only external boundaries are replaced; fixtures are
// synthetic and neither real credentials nor a network/database are used.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(), query: vi.fn(), fetch: vi.fn(),
  cookies: new Map<string, string>(),
  cookieOptions: new Map<string, Record<string, unknown>>(),
  role: "product_manager" as string | null,
  personExists: true, projectExists: true,
  githubId: "424242", sessionGithubId: "424242",
  oauthGithubId: 424242,
  installationAvailable: true, repositoryAvailable: true,
  repositoryInstallationId: 123,
  providerFailure: "", databaseFailure: false, inTransaction: false,
  attempt: null as null | { id: string; project_id: string; person_id: string; expected_github_user_id: string; github_user_id: string; state_hash: Buffer; status: string; installation_id: string | null; expires: number },
  snapshot: false, snapshotExpires: 0,
  writes: [] as { sql: string; parameters: readonly unknown[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({
  appEnvironment: "production", appOrigin: "https://synthetic-app.example",
  databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
  databaseCaCert: "synthetic-test-ca", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "synthetic-publishable-key",
  githubAppClientId: "synthetic-app-client", githubAppClientSecret: "synthetic-app-secret",
  githubAppId: "123", githubAppSlug: "synthetic-app", githubAppPrivateKey: testPrivateKey,
  ai: { provider: "soclaas", apiKey: "synthetic-soclaas-key", model: "synthetic-model:1b" },
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
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...boundary.cookies].map(([name, value]) => ({ name, value })),
  get: (name: string) => {
    const value = boundary.cookies.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set: (input: string | { name: string; value: string; [key: string]: unknown }, value?: string,
    options?: Record<string, unknown>) => {
    const name = typeof input === "string" ? input : input.name;
    boundary.cookies.set(name, typeof input === "string" ? value ?? "" : input.value);
    boundary.cookieOptions.set(name, typeof input === "string" ? options ?? {} : input);
  },
  delete: (name: string) => boundary.cookies.delete(name),
}) }));

const testPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const personId = "22222222-2222-4222-8222-222222222222";
const authId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "77777777-7777-4777-8777-777777777777";
const token = "synthetic-callback-only-token";
const privateDetail = "synthetic-private-provider-detail";
const errors = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
} as const;
async function expectError(response: Response, status?: keyof typeof errors) {
  if (status) expect(response.status).toBe(status);
  else expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.text();
  for (const sensitive of [token, privateDetail, "synthetic-app-secret"]) expect(body).not.toContain(sensitive);
  const data = JSON.parse(body);
  expect(data).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  if (status) expect(data.error).toEqual(errors[status]);
}
type Endpoint = "setup" | "snapshot" | "link";
async function request(endpoint: Endpoint, body: unknown = { snapshotId, repositoryId: 456 }, requestOrigin = origin) {
  const root = `${origin}/api/v1/projects/${projectId}/github-repository`;
  const path = endpoint === "setup" ? `${root}/setup-url` : endpoint === "snapshot" ? `${root}/snapshots/${snapshotId}` : root;
  const req = new NextRequest(path, { method: endpoint === "link" ? "POST" : "GET",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    ...(endpoint === "link" ? { body: JSON.stringify(body) } : {}),
  });
  const context = { params: Promise.resolve({ projectId, snapshotId }) };
  if (endpoint === "setup") return (await import("../../../src/app/api/v1/projects/[projectId]/github-repository/setup-url/route")).GET(req, context);
  if (endpoint === "snapshot") return (await import("../../../src/app/api/v1/projects/[projectId]/github-repository/snapshots/[snapshotId]/route")).GET(req, context);
  return (await import("../../../src/app/api/v1/projects/[projectId]/github-repository/route")).POST(req, context);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T03:00:00Z"));
  vi.stubGlobal("fetch", boundary.fetch);
  boundary.cookies.clear(); boundary.cookieOptions.clear(); boundary.writes.length = 0;
  boundary.role = "product_manager"; boundary.personExists = true; boundary.projectExists = true;
  boundary.githubId = "424242"; boundary.sessionGithubId = "424242"; boundary.oauthGithubId = 424242;
  boundary.installationAvailable = true; boundary.repositoryAvailable = true;
  boundary.repositoryInstallationId = 123; boundary.providerFailure = ""; boundary.databaseFailure = false;
  boundary.inTransaction = false; boundary.attempt = null; boundary.snapshot = false;
  boundary.getUser.mockImplementation(async () => ({ data: { user: {
    id: authId, identities: [{ provider: "github", provider_id: boundary.sessionGithubId,
      identity_data: { user_name: "synthetic-pm" } }],
  } }, error: null }));
  boundary.query.mockImplementation(async (statement: string | { text: string; values?: readonly unknown[] }, values?: readonly unknown[]) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const parameters = values ?? (typeof statement === "string" ? [] : statement.values ?? []);
    if (/^\s*begin\b/i.test(sql)) { boundary.inTransaction = true; return { rows: [], rowCount: 0 }; }
    if (/^\s*(commit|rollback)\b/i.test(sql)) { boundary.inTransaction = false; return { rows: [], rowCount: 0 }; }
    if (/^\s*set\b/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO app.github_repository_setup_attempts/i.test(sql)) {
      boundary.attempt = { id: "88888888-8888-4888-8888-888888888888", project_id: projectId, person_id: personId,
        expected_github_user_id: boundary.githubId, github_user_id: boundary.githubId, state_hash: parameters[3] as Buffer,
        status: "setup_pending", installation_id: null, expires: Date.now() + 600000 };
      return { rows: [boundary.attempt], rowCount: 1 };
    }
    if (/UPDATE app.github_repository_setup_attempts/i.test(sql)) {
      const a = boundary.attempt;
      const expectedStatus = /SET status = 'verified'/.test(sql) ? "oauth_pending" : "setup_pending";
      if (!a || !a.state_hash.equals(parameters[0] as Buffer) || a.status !== expectedStatus || a.expires <= Date.now() ||
          boundary.role !== "product_manager" || boundary.githubId !== a.expected_github_user_id || boundary.sessionGithubId !== a.expected_github_user_id) return { rows: [], rowCount: 0 };
      if (expectedStatus === "setup_pending") { a.state_hash = parameters[1] as Buffer; a.installation_id = String(parameters[2]); a.status = "oauth_pending"; }
      else a.status = "verified";
      return { rows: [a], rowCount: 1 };
    }
    if (/INSERT INTO app.github_repository_snapshots\b/i.test(sql)) {
      boundary.snapshot = true; boundary.snapshotExpires = Date.now() + 600000;
      return { rows: [{ id: snapshotId }], rowCount: 1 };
    }
    if (/FROM app.github_repository_snapshots s/i.test(sql)) {
      if (!boundary.snapshot || parameters[0] !== snapshotId || parameters[1] !== projectId || boundary.snapshotExpires <= Date.now()) return { rows: [], rowCount: 0 };
      return { rows: [{ repository_id: "456", owner: "synthetic-owner", name: "synthetic-repository", is_private: true,
        default_branch: "main", attempt_id: boundary.attempt!.id, installation_id: "123", person_id: personId, github_user_id: boundary.githubId }], rowCount: 1 };
    }
    if (/\b(insert|update|delete)\b/i.test(sql)) {
      boundary.writes.push({ sql, parameters });
      if (boundary.databaseFailure) throw new Error(privateDetail);
      return { rows: [{ id: projectId }], rowCount: 1 };
    }
    const person = { id: personId, person_id: personId, auth_user_id: authId,
      github_user_id: boundary.githubId, github_username: "synthetic-pm" };
    const project = { id: projectId, project_id: projectId,
      github_installation_id: "99", github_repository_id: "98",
      github_repository_owner: "previous-owner", github_repository_name: "previous-repository", version: 1 };
    let rows: Record<string, unknown>[];
    if (/\bapp\.memberships\b/i.test(sql)) {
      rows = boundary.role && boundary.projectExists && boundary.personExists
        ? [{ ...person, ...project, role: boundary.role, person_id: personId }] : [];
    } else if (/\bapp\.people\b/i.test(sql)) rows = boundary.personExists ? [person] : [];
    else if (/\bapp\.projects\b/i.test(sql)) rows = boundary.projectExists ? [project] : [];
    else throw new Error(`Unexpected database read: ${sql}`);
    return { rows, rowCount: rows.length };
  });
  boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    expect(boundary.inTransaction, "GitHub calls must not hold a database transaction open").toBe(false);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (boundary.providerFailure === "network") throw new Error(`${privateDetail}: ${token}`);
    if (boundary.providerFailure === url.pathname) return Response.json({ message: `${privateDetail}: ${token}` }, { status: 403 });
    if (url.origin === "https://github.com" && url.pathname === "/login/oauth/access_token") {
      return Response.json({ access_token: token, token_type: "bearer", scope: "" });
    }
    if (url.origin !== "https://api.github.com") throw new Error(`Unexpected provider origin: ${url.origin}`);
    if (url.pathname === "/user") return Response.json({ id: boundary.oauthGithubId, login: "synthetic-pm" });
    if (url.pathname === "/user/installations") return Response.json({ total_count: boundary.installationAvailable ? 1 : 0,
      installations: boundary.installationAvailable ? [{ id: 123, account: { login: "synthetic-owner" } }] : [] });
    if (url.pathname === "/user/installations/123/repositories") return Response.json({ total_count: boundary.repositoryAvailable ? 1 : 0,
      repositories: boundary.repositoryAvailable ? [{ id: 456, name: "synthetic-repository",
        full_name: `${"synthetic-owner"}/${"synthetic-repository"}`, owner: { login: "synthetic-owner" },
        private: true, default_branch: "main", installation: { id: boundary.repositoryInstallationId } }] : [] });
    if (url.pathname === "/app/installations/123/access_tokens") return Response.json({ token: "synthetic-installation-token" });
    if (url.pathname === "/repos/synthetic-owner/synthetic-repository") return Response.json({ id: 456 });
    throw new Error(`Unexpected provider path: ${url.pathname}`);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("approved PM setup, snapshot and final-link authorization", () => {
  it.each<Endpoint>(["setup", "snapshot", "link"])("rejects anonymous %s before provider access", async (endpoint) => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await request(endpoint), 401);
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["setup", "snapshot", "link"])("refuses a developer calling %s", async (endpoint) => {
    boundary.role = "developer";
    await expectError(await request(endpoint), 403);
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });
  it.each<Endpoint>(["setup", "snapshot", "link"])("conceals project data from nonmembers on %s", async (endpoint) => {
    boundary.role = null;
    await expectError(await request(endpoint), 404);
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });
  it("refuses a cross-origin final link without changing the prior binding", async () => {
    await expectError(await request("link", undefined, "https://untrusted.example"), 400);
    expect(boundary.writes).toEqual([]); expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { snapshotId }, { snapshotId, repositoryId: "456" }, { snapshotId, repositoryId: 0 },
    { snapshotId, repositoryId: 456, installationId: "123" },
    { snapshotId, repositoryId: 456, repositoryOwner: "untrusted-owner" },
  ])("rejects invalid final selection and fields outside the approved schema: %j", async (body) => {
    await expectError(await request("link", body), 400);
    expect(boundary.writes).toEqual([]); expect(boundary.fetch).not.toHaveBeenCalled();
  });
});
describe("untrusted App setup return", () => {
  it.each(["", "state=synthetic", "installation_id=123", "installation_id=-1&state=synthetic", "installation_id=abc&state=synthetic"])("rejects malformed return %s without linking", async (query) => {
    const { GET } = await import("../../../src/app/api/v1/auth/github-app/setup-callback/route");
    await expectError(await GET(new NextRequest(`${origin}/api/v1/auth/github-app/setup-callback?${query}`)));
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(boundary.writes.filter(({ sql }) => /update\s+app\.projects/i.test(sql))).toEqual([]);
  });
});

async function setupReturn(state: string) {
  const { GET } = await import("../../../src/app/api/v1/auth/github-app/setup-callback/route");
  return GET(new NextRequest(`${origin}/api/v1/auth/github-app/setup-callback?installation_id=123&state=${state}`));
}
async function startOAuth() {
  const start = await request("setup"); expect(start.status).toBe(200);
  const { setupUrl } = await start.json();
  const setup = new URL(setupUrl); expect(setup.pathname).toBe("/apps/synthetic-app/installations/new");
  const setupState = setup.searchParams.get("state")!;
  const returned = await setupReturn(setupState); expect(returned.status).toBe(303);
  const state = new URL(returned.headers.get("location")!).searchParams.get("state")!;
  return { state, setupState };
}
async function oauthReturn(state: string, query?: string) {
  const { GET } = await import("../../../src/app/api/v1/auth/github-app/callback/route");
  return GET(new NextRequest(`${origin}/api/v1/auth/github-app/callback?${query ?? new URLSearchParams({ code: "synthetic-code", state })}`));
}
describe("verified setup and repository snapshot lifecycle", () => {
  it("verifies identity and installation before showing a snapshot and linking", async () => {
    const { state } = await startOAuth();
    expect(boundary.fetch).not.toHaveBeenCalled();
    const response = await oauthReturn(state); expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/projects/${projectId}/settings?githubSnapshot=${snapshotId}`);
    const snapshot = await request("snapshot"); expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toEqual({ repositories: [{ repositoryId: 456, owner: "synthetic-owner", name: "synthetic-repository", private: true, defaultBranch: "main" }] });
    const link = await request("link"); expect(link.status).toBeLessThan(300);
    expect(boundary.writes.filter(({ sql }) => /UPDATE app.projects/i.test(sql))).toHaveLength(1);
    expect(JSON.stringify(boundary.writes)).not.toContain(token);
    expect(JSON.stringify(boundary.attempt)).not.toContain(token);
  });
  it("accepts installation-scoped repository metadata without a nested installation object", async () => {
    const originalFetch = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/user/installations/123/repositories") return Response.json({ total_count: 1,
        repositories: [{ id: 456, name: "synthetic-repository", full_name: "synthetic-owner/synthetic-repository",
          owner: { login: "synthetic-owner" }, private: true, default_branch: "main" }] });
      return originalFetch(input);
    });
    const { state } = await startOAuth(); expect((await oauthReturn(state)).status).toBe(303);
    const writes = boundary.writes.filter(({ sql }) => /INSERT INTO app.github_repository_snapshot_repositories/.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].parameters).toEqual([snapshotId, 456, "synthetic-owner", "synthetic-repository", true, "main", 0]);
    const paths = boundary.fetch.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).pathname);
    expect(paths.indexOf("/user/installations")).toBeLessThan(paths.indexOf("/user/installations/123/repositories"));
    const snapshot = await request("snapshot"); expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toEqual({ repositories: [{ repositoryId: 456, owner: "synthetic-owner", name: "synthetic-repository", private: true, defaultBranch: "main" }] });
  });
  it("does not query installation-scoped repositories before verifying user installation access", async () => {
    const { state } = await startOAuth(); boundary.installationAvailable = false;
    await expectError(await oauthReturn(state), 403);
    const paths = boundary.fetch.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).pathname);
    expect(paths).not.toContain("/user/installations/123/repositories");
    expect(boundary.snapshot).toBe(false);
  });
  it("consumes setup state once", async () => {
    const { setupState } = await startOAuth();
    await expectError(await setupReturn(setupState), 403);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("rejects an expired setup attempt", async () => {
    const start = await request("setup"); const { setupUrl } = await start.json();
    vi.advanceTimersByTime(600001);
    await expectError(await setupReturn(new URL(setupUrl).searchParams.get("state")!), 403);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it.each(["identity", "installation", "provider"])("preserves prior link when OAuth verification fails: %s", async (reason) => {
    const { state } = await startOAuth();
    if (reason === "identity") boundary.oauthGithubId = 999;
    if (reason === "installation") boundary.installationAvailable = false;
    if (reason === "provider") boundary.providerFailure = "network";
    await expectError(await oauthReturn(state));
    expect(boundary.snapshot).toBe(false);
    expect(boundary.writes.filter(({ sql }) => /UPDATE app.projects/i.test(sql))).toEqual([]);
  });
  it("consumes OAuth state even after provider failure", async () => {
    const { state } = await startOAuth(); boundary.providerFailure = "network";
    await expectError(await oauthReturn(state)); boundary.providerFailure = "";
    boundary.cookies.set("github_app_link_state", state); boundary.fetch.mockClear();
    await expectError(await oauthReturn(state), 403); expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("rejects OAuth state mismatch before provider calls", async () => {
    const { state } = await startOAuth();
    await expectError(await oauthReturn(`${state}-mismatch`), 400);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it("refuses an expired snapshot without replacing the prior binding", async () => {
    const { state } = await startOAuth(); expect((await oauthReturn(state)).status).toBe(303);
    vi.advanceTimersByTime(600001);
    await expectError(await request("snapshot"), 404);
    await expectError(await request("link"), 404);
    expect(boundary.writes.filter(({ sql }) => /UPDATE app.projects/i.test(sql))).toEqual([]);
  });
  it("does not return a snapshot under another project", async () => {
    const { state } = await startOAuth(); expect((await oauthReturn(state)).status).toBe(303);
    const otherProjectId = "99999999-9999-4999-8999-999999999999";
    const { GET } = await import("../../../src/app/api/v1/projects/[projectId]/github-repository/snapshots/[snapshotId]/route");
    await expectError(await GET(new NextRequest(`${origin}/api/v1/projects/${otherProjectId}/github-repository/snapshots/${snapshotId}`),
      { params: Promise.resolve({ projectId: otherProjectId, snapshotId }) }), 404);
  });
  it("preserves the previous binding if App access is revoked before final linking", async () => {
    const { state } = await startOAuth(); expect((await oauthReturn(state)).status).toBe(303);
    boundary.providerFailure = "/app/installations/123/access_tokens";
    await expectError(await request("link"), 403);
    expect(boundary.writes.filter(({ sql }) => /UPDATE app.projects/i.test(sql))).toEqual([]);
  });
});
