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
  writes: [] as { sql: string; parameters: readonly unknown[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({
  appEnvironment: "production", appOrigin: "https://synthetic-app.example",
  databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
  databaseCaCert: "synthetic-test-ca", supabaseUrl: "https://synthetic.supabase.co",
  supabasePublishableKey: "synthetic-publishable-key",
  githubAppClientId: "synthetic-app-client", githubAppClientSecret: "synthetic-app-secret",
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

const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const personId = "22222222-2222-4222-8222-222222222222";
const authId = "11111111-1111-4111-8111-111111111111";
const selected = { installationId: "123", repositoryOwner: "synthetic-owner", repositoryName: "synthetic-repository" };
const token = "synthetic-callback-only-token";
const privateDetail = "synthetic-private-provider-detail";
const errors = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
} as const;

async function start(body: unknown = selected, options: { raw?: string; projectId?: string; origin?: string } = {}) {
  const id = options.projectId ?? projectId;
  const { POST } = await import("../../../src/app/api/v1/projects/[projectId]/github-repository/authorization/route");
  return POST(new NextRequest(`${origin}/api/v1/projects/${id}/github-repository/authorization`, {
    method: "POST", headers: { "content-type": "application/json", origin: options.origin ?? origin },
    body: options.raw ?? JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: id }) });
}

type Authorization = { state: string; cookie: string; cookieName: string; startResponse: Response };

async function authorize(): Promise<Authorization> {
  const response = await start();
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(Object.keys(data)).toEqual(["authorizationUrl"]);
  const url = new URL(data.authorizationUrl);
  expect(url.origin).toBe("https://github.com");
  expect(url.pathname).toBe("/login/oauth/authorize");
  const state = url.searchParams.get("state");
  expect(state).toBeTruthy();
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0] ?? [...boundary.cookies].map(([name, value]) => `${name}=${value}`)[0];
  expect(cookie).toBeTruthy();
  const cookieName = cookie.slice(0, cookie.indexOf("="));
  boundary.cookies.set(cookieName, decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)));
  return { state: state!, cookie, cookieName, startResponse: response };
}

async function callback(authorization: Authorization, options: {
  state?: string; cookie?: string; query?: string; requestOrigin?: string;
} = {}) {
  const { GET } = await import("../../../src/app/api/v1/auth/github-app/callback/route");
  const query = options.query ?? new URLSearchParams({ code: "synthetic-code", state: options.state ?? authorization.state }).toString();
  return GET(new NextRequest(`${options.requestOrigin ?? origin}/api/v1/auth/github-app/callback?${query}`, {
    headers: { cookie: options.cookie ?? authorization.cookie, host: "untrusted.example", "x-forwarded-host": "untrusted.example" },
  }));
}

async function expectError(response: Response, status?: keyof typeof errors) {
  if (status) expect(response.status).toBe(status);
  else expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(text).not.toContain(token);
  expect(text).not.toContain(privateDetail);
  expect(text).not.toContain("synthetic-app-secret");
  const data = JSON.parse(text);
  expect(data).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
  if (status) expect(data.error).toEqual(errors[status]);
}

function expectConsumed(response: Response, authorization: Authorization) {
  const header = response.headers.get("set-cookie") ?? "";
  const expiredInResponse = header.includes(`${authorization.cookieName}=`) &&
    (/max-age=0/i.test(header) || /expires=Thu, 01 Jan 1970/i.test(header));
  const options = boundary.cookieOptions.get(authorization.cookieName);
  const expiredInStore = !boundary.cookies.get(authorization.cookieName) || options?.maxAge === 0;
  expect(expiredInResponse || expiredInStore).toBe(true);
}

function putSelectionOnSecondPage(resource: "installation" | "repository", failSecondPage = false) {
  const originalFetch = boundary.fetch.getMockImplementation()!;
  const path = resource === "installation" ? "/user/installations" : "/user/installations/123/repositories";
  const secondPageVisited = vi.fn();
  boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== path) return originalFetch(input);
    if (url.searchParams.get("page") === "2") {
      secondPageVisited();
      if (failSecondPage) return Response.json({ message: `${privateDetail}: ${token}` }, { status: 503 });
      return originalFetch(input);
    }
    const next = new URL(url);
    next.searchParams.set("page", "2");
    const firstPage = resource === "installation"
      ? { total_count: 2, installations: [{ id: 999, account: { login: "another-synthetic-owner" } }] }
      : { total_count: 2, repositories: [{ id: 999, name: "another-synthetic-repository",
        full_name: `${selected.repositoryOwner}/another-synthetic-repository`, owner: { login: selected.repositoryOwner } }] };
    return Response.json(firstPage, { headers: { Link: `<${next}>; rel="next"` } });
  });
  return secondPageVisited;
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
  boundary.inTransaction = false;
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
      repositories: boundary.repositoryAvailable ? [{ id: 456, name: selected.repositoryName,
        full_name: `${selected.repositoryOwner}/${selected.repositoryName}`, owner: { login: selected.repositoryOwner },
        installation: { id: boundary.repositoryInstallationId } }] : [] });
    throw new Error(`Unexpected provider path: ${url.pathname}`);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("repository authorization initiation", () => {
  it("returns a separate GitHub App OAuth URL with cookie-bound state and no mutation", async () => {
    const authorization = await authorize();
    const url = new URL((await start().then((response) => response.json())).authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe("synthetic-app-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/v1/auth/github-app/callback`);
    expect(authorization.startResponse.headers.get("cache-control")).toContain("no-store");
    const header = authorization.startResponse.headers.get("set-cookie");
    if (header) {
      expect(header).toMatch(/httponly/i); expect(header).toMatch(/samesite=lax/i);
      expect(/max-age=600/i.test(header) || /expires=Tue, 03 Nov 2026 03:10:00 GMT/i.test(header)).toBe(true);
    } else {
      const options = boundary.cookieOptions.get(authorization.cookieName);
      expect(options).toMatchObject({ httpOnly: true, sameSite: "lax" });
      expect(options?.maxAge === 600 || (options?.expires instanceof Date &&
        options.expires.getTime() === new Date("2026-11-03T03:10:00Z").getTime())).toBe(true);
    }
    expect(boundary.writes).toEqual([]);
  });

  it("rejects an anonymous request before database access", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectError(await start(), 401);
    expect(boundary.query).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });

  it("refuses a developer", async () => {
    boundary.role = "developer";
    await expectError(await start(), 403); expect(boundary.writes).toEqual([]);
  });

  it.each(["non-member", "missing-project", "unmapped-person"])("conceals a %s", async (scenario) => {
    if (scenario === "non-member") boundary.role = null;
    if (scenario === "missing-project") boundary.projectExists = false;
    if (scenario === "unmapped-person") boundary.personExists = false;
    await expectError(await start(), 404); expect(boundary.writes).toEqual([]);
  });

  it.each([
    null, [], {}, { ...selected, installationId: 123 }, { ...selected, installationId: "0" },
    { ...selected, installationId: "-1" }, { ...selected, installationId: "1.5" },
    { ...selected, installationId: "1e3" }, { ...selected, installationId: "" },
    { ...selected, installationId: null }, { ...selected, installationId: {} },
    { ...selected, repositoryOwner: "" }, { ...selected, repositoryName: "" },
    { ...selected, repositoryOwner: "owner/other" }, { ...selected, repositoryName: "../other" },
    { ...selected, repositoryId: 987 }, { ...selected, githubUserId: 999999 },
  ])("rejects an invalid or surplus mutation field in %j", async (body) => {
    await expectError(await start(body), 400); expect(boundary.writes).toEqual([]);
  });

  it("rejects malformed JSON", async () => {
    await expectError(await start(undefined, { raw: "{broken" }), 400); expect(boundary.writes).toEqual([]);
  });

  it("rejects a malformed project UUID", async () => {
    await expectError(await start(selected, { projectId: "not-a-uuid" }), 400); expect(boundary.writes).toEqual([]);
  });
});

describe("repository authorization callback", () => {
  it("verifies the selection, replaces only the binding, consumes state, and uses APP_ORIGIN for its redirect", async () => {
    const authorization = await authorize();
    const response = await callback(authorization, { requestOrigin: "https://untrusted.example" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/projects/${projectId}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expectConsumed(response, authorization);
    expect(boundary.writes).toHaveLength(1);
    const write = boundary.writes[0];
    expect(write.sql).toMatch(/\bupdate\s+app\.projects\b/i);
    for (const column of ["github_installation_id", "github_repository_id", "github_repository_owner", "github_repository_name"]) {
      expect(write.sql).toContain(column);
    }
    expect(write.parameters.map(String)).toEqual(expect.arrayContaining([projectId, "123", "456", selected.repositoryOwner, selected.repositoryName]));
    expect(JSON.stringify(boundary.writes)).not.toContain(token);
    expect(JSON.stringify(boundary.writes)).not.toContain("synthetic-app-secret");
    expect(await response.text()).not.toContain(token);
    const readCalls = boundary.fetch.mock.calls.filter(([input]) =>
      (input instanceof Request ? input.url : String(input)).startsWith("https://api.github.com"));
    expect(readCalls.length).toBeGreaterThan(0);
    for (const [input, init] of readCalls) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    }
  });

  it.each(["missing-cookie", "mismatched-state", "tampered-cookie", "expired-state"])("rejects %s before provider access", async (scenario) => {
    const authorization = await authorize();
    const options: { state?: string; cookie?: string } = {};
    if (scenario === "missing-cookie") { boundary.cookies.clear(); options.cookie = ""; }
    if (scenario === "mismatched-state") options.state = `${authorization.state}-different`;
    if (scenario === "tampered-cookie") {
      options.cookie = `${authorization.cookie}tampered`;
      boundary.cookies.set(authorization.cookieName, `${boundary.cookies.get(authorization.cookieName)}tampered`);
    }
    if (scenario === "expired-state") vi.setSystemTime(new Date("2026-11-03T03:10:01Z"));
    boundary.fetch.mockClear();
    await expectError(await callback(authorization, options));
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });

  it.each(["", "state=only-state", "code=only-code", "error=access_denied&error_description=synthetic-private-provider-detail"])("rejects incomplete/denied callback %s", async (query) => {
    const authorization = await authorize();
    boundary.fetch.mockClear();
    const response = await callback(authorization, { query });
    await expectError(response);
    expectConsumed(response, authorization);
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });

  it.each(["signed-out", "developer", "non-member", "changed-verified-identity", "changed-session-identity"])("preserves the old link for a %s PM", async (scenario) => {
    const authorization = await authorize();
    if (scenario === "signed-out") boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (scenario === "developer") boundary.role = "developer";
    if (scenario === "non-member") boundary.role = null;
    if (scenario === "changed-verified-identity") boundary.githubId = "515151";
    if (scenario === "changed-session-identity") boundary.sessionGithubId = "515151";
    const response = await callback(authorization);
    await expectError(response); expectConsumed(response, authorization); expect(boundary.writes).toEqual([]);
  });

  it.each(["role", "verified-identity"])("preserves the old binding if the PM %s changes during the last GitHub read", async (change) => {
    const authorization = await authorize();
    const originalFetch = boundary.fetch.getMockImplementation()!;
    const changedDuringProviderCall = vi.fn();
    boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const response = await originalFetch(input);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/user/installations/123/repositories") {
        if (change === "role") boundary.role = "developer";
        else boundary.githubId = "515151";
        changedDuringProviderCall();
      }
      return response;
    });

    const response = await callback(authorization);

    expect(changedDuringProviderCall).toHaveBeenCalledOnce();
    await expectError(response);
    expectConsumed(response, authorization);
    // No persistence operation can replace any of the previous four binding
    // values returned by the database fixture when authorization changes.
    expect(boundary.writes).toEqual([]);
  });

  it.each(["installation", "repository"] as const)("links the selected %s when it is on the next GitHub page", async (resource) => {
    const authorization = await authorize();
    const secondPageVisited = putSelectionOnSecondPage(resource);

    const response = await callback(authorization);

    expect(secondPageVisited).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/projects/${projectId}`);
    expectConsumed(response, authorization);
    expect(boundary.writes).toHaveLength(1);
    expect(boundary.writes[0].parameters.map(String)).toEqual(expect.arrayContaining([
      projectId, "123", "456", selected.repositoryOwner, selected.repositoryName,
    ]));
  });

  it.each(["installation", "repository"] as const)("safely refuses linking when the next %s page fails", async (resource) => {
    const authorization = await authorize();
    const secondPageVisited = putSelectionOnSecondPage(resource, true);

    const response = await callback(authorization);

    expect(secondPageVisited).toHaveBeenCalledOnce();
    await expectError(response);
    expectConsumed(response, authorization);
    expect(boundary.writes).toEqual([]);
  });

  it.each(["wrong-oauth-user", "inaccessible-installation", "inaccessible-repository"])("preserves the old link for %s", async (scenario) => {
    const authorization = await authorize();
    if (scenario === "wrong-oauth-user") boundary.oauthGithubId = 999999;
    if (scenario === "inaccessible-installation") boundary.installationAvailable = false;
    if (scenario === "inaccessible-repository") boundary.repositoryAvailable = false;
    const response = await callback(authorization);
    await expectError(response); expectConsumed(response, authorization); expect(boundary.writes).toEqual([]);
  });

  it.each(["network", "/login/oauth/access_token", "/user", "/user/installations", "/user/installations/123/repositories"])("contains provider failure at %s without mutating or leaking details", async (failure) => {
    const authorization = await authorize();
    boundary.providerFailure = failure;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await callback(authorization);
      await expectError(response); expectConsumed(response, authorization); expect(boundary.writes).toEqual([]);
      expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(token);
      expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(privateDetail);
    } finally { log.mockRestore(); warn.mockRestore(); }
  });

  it("contains a binding-write failure and still consumes state", async () => {
    const authorization = await authorize();
    boundary.databaseFailure = true;
    const response = await callback(authorization);
    await expectError(response); expectConsumed(response, authorization);
    expect(JSON.stringify(boundary.writes)).not.toContain(token);
  });

  it("does not accept a replay after the browser consumes the state cookie", async () => {
    const authorization = await authorize();
    const response = await callback(authorization);
    expect(response.status).toBe(303); expectConsumed(response, authorization);
    boundary.cookies.clear(); boundary.fetch.mockClear(); boundary.writes.length = 0;
    await expectError(await callback(authorization, { cookie: "" }));
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.writes).toEqual([]);
  });
});
