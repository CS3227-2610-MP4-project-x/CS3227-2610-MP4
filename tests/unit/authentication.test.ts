import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 3.1: identity-and-access "Sign in with GitHub", design D-I and E1–E5.
// There are no requirement IDs. These synthetic fakes replace the external
// Supabase, cookie, and PostgreSQL boundaries; no credentials or network are used.
const boundary = vi.hoisted(() => {
  const cookies = new Map<string, string>();
  const cookieOptions = new Map<string, Record<string, unknown>>();
  const people = new Map<string, Record<string, unknown>>();
  const identity = {
    authUserId: "11111111-1111-4111-8111-111111111111",
    githubId: "424242",
    username: "synthetic-developer",
  };
  const query = vi.fn(async (statement: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const parameters = values ?? (typeof statement === "string" ? [] : statement.values ?? []);
    const normalized = sql.trim().toLowerCase();
    if (/\b(insert into|update)\s+(?:(?:app|public)\.)?people\b/.test(normalized)) {
      // The fake models the documented unique auth_user_id and username refresh.
      // Parameter assertions below independently verify identity is bound as data.
      const prior = people.get(identity.authUserId);
      const person = {
        ...prior,
        id: prior?.id ?? "22222222-2222-4222-8222-222222222222",
        auth_user_id: identity.authUserId,
        github_user_id: identity.githubId,
        github_username: parameters.find((value) => value === identity.username),
      };
      people.set(identity.authUserId, person);
      return { rows: [person], rowCount: 1 };
    }
    return { rows: normalized.includes("people") ? [...people.values()] : [], rowCount: people.size };
  });
  const signInWithOAuth = vi.fn();
  const exchangeCodeForSession = vi.fn();
  const getUser = vi.fn();
  const signOut = vi.fn();
  const createServerClient = vi.fn();
  const poolCreated = vi.fn();
  return { cookies, cookieOptions, people, identity, query, signInWithOAuth, exchangeCodeForSession, getUser, signOut, createServerClient, poolCreated };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...boundary.cookies].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = boundary.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (nameOrCookie: string | { name: string; value: string }, value?: string, options?: Record<string, unknown>) => {
      const name = typeof nameOrCookie === "string" ? nameOrCookie : nameOrCookie.name;
      const cookieValue = typeof nameOrCookie === "string" ? value ?? "" : nameOrCookie.value;
      boundary.cookies.set(name, cookieValue);
      boundary.cookieOptions.set(name, options ?? {});
    },
    delete: (name: string) => boundary.cookies.delete(name),
  }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: boundary.createServerClient }));
vi.mock("pg", () => {
  class Pool {
    constructor(options: unknown) {
      boundary.poolCreated(options);
    }
    query = boundary.query;
    async connect() {
      return { query: boundary.query, release: vi.fn() };
    }
    async end() {}
  }
  return { Pool, default: { Pool } };
});

const appOrigin = "http://localhost:3000";
const providerUrl = "https://synthetic.supabase.co/auth/v1/authorize?provider=github";
const sessionCookie = "sb-synthetic-auth-token";

function verifiedUser() {
  return {
    id: boundary.identity.authUserId,
    app_metadata: { provider: "github", providers: ["github"] },
    // User-editable metadata must not override the verified provider identity.
    user_metadata: { user_name: "forged-display-name", provider_id: "999999" },
    identities: [{
      id: boundary.identity.githubId,
      identity_id: "33333333-3333-4333-8333-333333333333",
      user_id: boundary.identity.authUserId,
      provider: "github",
      provider_id: boundary.identity.githubId,
      identity_data: {
        sub: "999999",
        provider_id: "999999",
        user_name: boundary.identity.username,
        preferred_username: boundary.identity.username,
      },
    }],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  boundary.cookies.clear();
  boundary.cookieOptions.clear();
  boundary.people.clear();
  boundary.identity.githubId = "424242";
  boundary.identity.username = "synthetic-developer";
  vi.stubEnv("SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_test_key");
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_APP_SLUG", "synthetic-app");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "synthetic-private-key");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "synthetic-github-app-client-id");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "synthetic-github-app-client-secret");
  vi.stubEnv("APP_ORIGIN", appOrigin);
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("AI_PROVIDER", "fake");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@localhost:5432/synthetic?sslmode=verify-full");
  vi.stubEnv("DATABASE_CA_CERT", "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----");

  boundary.createServerClient.mockImplementation((_url, _key, options) => {
    const writeCookie = (value: string) => options.cookies.setAll([
      { name: sessionCookie, value, options: { path: "/", maxAge: value ? 3600 : 0 } },
    ]);
    boundary.signInWithOAuth.mockImplementation(async () => {
      options.cookies.setAll([{ name: "sb-synthetic-code-verifier", value: "synthetic-verifier", options: { path: "/" } }]);
      return { data: { provider: "github", url: providerUrl }, error: null };
    });
    boundary.exchangeCodeForSession.mockImplementation(async () => {
      writeCookie("synthetic-session");
      return { data: { user: verifiedUser(), session: { access_token: "synthetic-access-token", user: verifiedUser() } }, error: null };
    });
    boundary.getUser.mockImplementation(async () => ({
      data: { user: boundary.cookies.get(sessionCookie) ? verifiedUser() : null }, error: null,
    }));
    boundary.signOut.mockImplementation(async () => {
      writeCookie("");
      return { error: null };
    });
    return { auth: {
      signInWithOAuth: boundary.signInWithOAuth,
      exchangeCodeForSession: boundary.exchangeCodeForSession,
      getUser: boundary.getUser,
      signOut: boundary.signOut,
    } };
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("GitHub sign-in through server-side Supabase Auth", () => {
  it("starts GitHub sign-in using the configured app callback despite an untrusted request host", async () => {
    const { GET } = await import("../../src/app/api/v1/auth/sign-in/route");
    const response = await GET(new NextRequest("https://untrusted.example/api/v1/auth/sign-in"));

    expect(boundary.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      options: expect.objectContaining({ redirectTo: `${appOrigin}/api/v1/auth/callback` }),
    }));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toBe(providerUrl);
    expect(boundary.cookies.get("sb-synthetic-code-verifier")).toBe("synthetic-verifier");
  });

  it("exchanges the callback code, establishes a session, and creates the first verified GitHub person", async () => {
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");
    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=synthetic-code&github_user_id=999999&github_username=forged`));

    expect(boundary.exchangeCodeForSession).toHaveBeenCalledWith("synthetic-code");
    expect(boundary.cookies.get(sessionCookie)).toBe("synthetic-session");
    expect(boundary.cookieOptions.get(sessionCookie)).toMatchObject({ httpOnly: true, sameSite: "lax" });
    expect(boundary.people.size).toBe(1);
    expect(boundary.people.get(boundary.identity.authUserId)).toMatchObject({
      auth_user_id: boundary.identity.authUserId,
      github_user_id: boundary.identity.githubId,
      github_username: "synthetic-developer",
    });
    const writes = boundary.query.mock.calls.filter(([statement]) => /\b(insert into|update)\s+(?:(?:app|public)\.)?people\b/i.test(
      typeof statement === "string" ? statement : statement.text,
    ));
    expect(writes.length).toBeGreaterThan(0);
    const boundValues = writes.flatMap(([statement, values]) => values ?? (typeof statement === "string" ? [] : statement.values ?? []));
    expect(boundValues).toContain(boundary.identity.authUserId);
    expect(boundValues.map(String)).toContain(boundary.identity.githubId);
    expect(boundValues).toContain(boundary.identity.username);
    for (const [statement] of writes) {
      const sql = typeof statement === "string" ? statement : statement.text;
      expect(sql).not.toContain(boundary.identity.username);
      expect(sql).not.toContain(boundary.identity.authUserId);
    }
  });

  it("refreshes a changed GitHub username on repeat sign-in while preserving the person", async () => {
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");
    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=first-code`));
    const originalPersonId = boundary.people.get(boundary.identity.authUserId)?.id;
    boundary.identity.username = "renamed-synthetic-developer";

    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=second-code`));

    expect(boundary.people.size).toBe(1);
    expect(boundary.people.get(boundary.identity.authUserId)).toMatchObject({
      id: originalPersonId,
      github_user_id: boundary.identity.githubId,
      github_username: "renamed-synthetic-developer",
    });
    expect(boundary.exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });

  it("adapts the legacy Supabase identity id when provider_id is absent", async () => {
    boundary.identity.githubId = "515151";
    const user = verifiedUser();
    const legacyIdentity: Record<string, unknown> = { ...user.identities[0], id: "515151" };
    delete legacyIdentity.provider_id;
    boundary.getUser.mockResolvedValueOnce({
      data: { user: { ...user, identities: [legacyIdentity] } }, error: null,
    });
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");

    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=legacy-synthetic-code`));

    expect(boundary.people.get(boundary.identity.authUserId)).toMatchObject({
      github_user_id: "515151", github_username: boundary.identity.username,
    });
    const boundValues = boundary.query.mock.calls.flatMap(([statement, values]) =>
      values ?? (typeof statement === "string" ? [] : statement.values ?? []));
    expect(boundValues.map(String)).toContain("515151");
    expect(boundValues.map(String)).not.toContain("999999");
  });

  it("ends the session on POST sign-out", async () => {
    const callback = await import("../../src/app/api/v1/auth/callback/route");
    await callback.GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=synthetic-code`));
    expect(boundary.cookies.get(sessionCookie)).toBeTruthy();
    const { POST } = await import("../../src/app/api/v1/auth/sign-out/route");

    await POST(new NextRequest(`${appOrigin}/api/v1/auth/sign-out`, {
      method: "POST", headers: { origin: appOrigin },
    }));

    expect(boundary.signOut).toHaveBeenCalledOnce();
    expect(boundary.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(boundary.cookies.get(sessionCookie) || undefined).toBeUndefined();
    expect((await boundary.getUser()).data.user).toBeNull();
  });

  it("enforces secure server-managed session cookies for an HTTPS application", async () => {
    vi.stubEnv("APP_ORIGIN", "https://synthetic-app.example");
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");

    await GET(new NextRequest("https://synthetic-app.example/api/v1/auth/callback?code=synthetic-code"));

    expect(boundary.cookieOptions.get(sessionCookie)).toMatchObject({
      httpOnly: true, sameSite: "lax", secure: true,
    });
  });

  it("clears the newly established session if verified identity persistence fails", async () => {
    boundary.query.mockRejectedValueOnce(new Error("Synthetic database failure"));
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");

    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=synthetic-code`));

    expect(boundary.exchangeCodeForSession).toHaveBeenCalledWith("synthetic-code");
    expect(boundary.query).toHaveBeenCalled();
    expect(boundary.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(boundary.people.size).toBe(0);
    expect(boundary.cookies.get(sessionCookie) || undefined).toBeUndefined();
    expect((await boundary.getUser()).data.user).toBeNull();
  });

  it.each([undefined, "https://untrusted.example"])("rejects sign-out with Origin %s and preserves the session", async (origin) => {
    boundary.cookies.set(sessionCookie, "existing-session");
    const { POST } = await import("../../src/app/api/v1/auth/sign-out/route");

    const response = await POST(new NextRequest(`${appOrigin}/api/v1/auth/sign-out`, {
      method: "POST", headers: origin ? { origin } : {},
    }));

    expect(response.status).toBe(403);
    expect(boundary.signOut).not.toHaveBeenCalled();
    expect(boundary.cookies.get(sessionCookie)).toBe("existing-session");
  });

  it.each(["", "?code=", "?error=access_denied&error_description=synthetic-provider-detail"])(
    "refuses a callback without a usable authorization code (%s)", async (query) => {
      boundary.cookies.set(sessionCookie, "existing-session");
      const { GET } = await import("../../src/app/api/v1/auth/callback/route");

      const response = await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback${query}`));

      expect(boundary.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
      expect(boundary.signOut).not.toHaveBeenCalled();
      expect(boundary.cookies.get(sessionCookie)).toBe("existing-session");
      const destination = response.headers.get("location");
      expect(destination).toBeTruthy();
      expect(new URL(destination!).origin).toBe(appOrigin);
      expect(destination).not.toContain("synthetic-provider-detail");
    },
  );

  it("preserves an existing session when Supabase rejects the callback code", async () => {
    boundary.cookies.set(sessionCookie, "existing-session");
    boundary.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: "Synthetic invalid code" },
    });
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");

    await GET(new NextRequest(`${appOrigin}/api/v1/auth/callback?code=invalid-synthetic-code`));

    expect(boundary.exchangeCodeForSession).toHaveBeenCalledWith("invalid-synthetic-code");
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.signOut).not.toHaveBeenCalled();
    expect(boundary.cookies.get(sessionCookie)).toBe("existing-session");
  });

  it.each([
    "https://untrusted.example/auth/v1/authorize?provider=github",
    "https://synthetic.supabase.co/untrusted?provider=github",
    "https://synthetic.supabase.co/auth/v1/authorize?provider=other",
  ])("refuses an unexpected Supabase authorization destination (%s)", async (url) => {
    boundary.signInWithOAuth.mockResolvedValueOnce({ data: { provider: "github", url }, error: null });
    const { GET } = await import("../../src/app/api/v1/auth/sign-in/route");

    const response = await GET(new NextRequest(`${appOrigin}/api/v1/auth/sign-in`));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("sign-in failure logging", () => {
  it("logs which configuration variable is invalid, once, without any configured value", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("APP_ENV", "staging");
    const { GET } = await import("../../src/app/api/v1/auth/sign-in/route");

    const response = await GET(new NextRequest(`${appOrigin}/api/v1/auth/sign-in`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "AUTHENTICATION_FAILED", message: "Sign-in could not be started." },
    });
    expect(consoleError).toHaveBeenCalledOnce();
    const line = String(consoleError.mock.calls[0][0]);
    expect(line).toContain("server configuration");
    expect(line).toContain("APP_ENV");
    for (const value of ["staging", "synthetic-github-app-client-secret", "synthetic-private-key", "sb_publishable_synthetic_test_key"]) {
      expect(line).not.toContain(value);
    }
    consoleError.mockRestore();
  });

  it("logs an unexpected sign-in start failure and keeps the generic response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.signInWithOAuth.mockRejectedValueOnce(new Error("Synthetic Supabase failure"));
    const { GET } = await import("../../src/app/api/v1/auth/sign-in/route");

    const response = await GET(new NextRequest(`${appOrigin}/api/v1/auth/sign-in`));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0][0])).toBe(
      "[server] GitHub sign-in start failed: Error: Synthetic Supabase failure",
    );
    consoleError.mockRestore();
  });
});

describe("server configuration inventory (design E5)", () => {
  it.each([
    "sslmode=disable",
    "sslmode=verify-full&sslmode=disable",
    "sslmode=verify-full&sslcert=synthetic.pem",
    "sslmode=verify-full&sslkey=synthetic.pem",
    "sslmode=verify-full&sslrootcert=synthetic.pem",
    "sslmode=verify-full&ssl=0",
    "sslmode=verify-full&ssl=1",
    "sslmode=verify-full&sslnegotiation=direct",
  ])("rejects DATABASE_URL TLS overrides (%s)", async (query) => {
    vi.stubEnv("DATABASE_URL", `postgresql://synthetic:synthetic@localhost:5432/synthetic?${query}`);
    const { getServerConfig } = await import("../../src/server/config");

    expect(() => getServerConfig()).toThrow("DATABASE_URL");
    expect(boundary.poolCreated).not.toHaveBeenCalled();
  });

  it("configures the pool to verify the server certificate against the configured CA", async () => {
    const { getServerComposition } = await import("../../src/server/composition");

    getServerComposition();

    expect(boundary.poolCreated).toHaveBeenCalledOnce();
    const options = boundary.poolCreated.mock.calls[0][0];
    expect(options).toMatchObject({
      ssl: {
        ca: "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----",
        rejectUnauthorized: true,
      },
    });
    const connection = new URL(options.connectionString);
    expect(connection.searchParams.has("sslmode")).toBe(false);
    expect(connection.searchParams.has("ssl")).toBe(false);
    expect(connection.searchParams.has("sslcert")).toBe(false);
    expect(connection.searchParams.has("sslkey")).toBe(false);
    expect(connection.searchParams.has("sslrootcert")).toBe(false);
  });

  it("documents each environment variable read by application code in .env.example", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const template = readFileSync(`${root}.env.example`, "utf8");
    const documented = new Set([...template.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
    const files = readdirSync(`${root}src/server/config`, { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && /\.[cm]?tsx?$/.test(entry));
    expect(files.length).toBeGreaterThan(0);
    const names = files.flatMap((file) => {
      const source = readFileSync(`${root}src/server/config/${file}`, "utf8");
      return [...source.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)]
        .map((match) => match[1] ?? match[2]);
    });
    expect(names).toEqual(expect.arrayContaining(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_ORIGIN"]));
    expect(names.filter((name) => !documented.has(name))).toEqual([]);
  });
});
