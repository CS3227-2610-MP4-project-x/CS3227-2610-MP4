import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 3.3, design “Session refresh request boundary” and identity-and-access
// “Sign in with GitHub”. No requirement ID exists. Supabase is deterministic.
type CookieUpdate = {
  name: string;
  value: string;
  options?: { path?: string; maxAge?: number; httpOnly?: boolean; sameSite?: "strict" | "lax" | "none"; secure?: boolean };
};
type CookieAdapter = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: CookieUpdate[], headers: Record<string, string>): void;
};

const boundary = vi.hoisted(() => ({
  getServerConfig: vi.fn(),
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getServerComposition: vi.fn(),
  pool: vi.fn(),
  inputCookies: [] as Array<{ name: string; value: string }>,
  refreshedCookies: [] as CookieUpdate[],
  refreshedHeaders: {} as Record<string, string>,
}));

vi.mock("@/server/config", () => ({ getServerConfig: boundary.getServerConfig }));
vi.mock("@supabase/ssr", () => ({ createServerClient: boundary.createServerClient }));
// Session refresh must not construct the application service/repository graph.
vi.mock("@/server/composition", () => ({ getServerComposition: boundary.getServerComposition }));
vi.mock("pg", () => ({ Pool: boundary.pool, default: { Pool: boundary.pool } }));

beforeEach(() => {
  boundary.inputCookies = [];
  boundary.refreshedCookies = [];
  boundary.refreshedHeaders = {};
  boundary.getServerConfig.mockReturnValue({
    appOrigin: "https://synthetic-app.example",
    supabaseUrl: "https://synthetic.supabase.co",
    supabasePublishableKey: "sb_publishable_synthetic_test_key",
  });
  boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
  boundary.createServerClient.mockImplementation((_url, _key, options: { cookies: CookieAdapter }) => ({
    auth: {
      getUser: async () => {
        boundary.inputCookies = options.cookies.getAll();
        if (boundary.refreshedCookies.length) {
          options.cookies.setAll(boundary.refreshedCookies, boundary.refreshedHeaders);
        }
        return boundary.getUser();
      },
    },
  }));
});

describe("session refresh Proxy", () => {
  it("passes the incoming request cookies to Supabase and verifies the session", async () => {
    const { proxy } = await import("../../src/proxy");
    const request = new NextRequest("https://synthetic-app.example/", {
      headers: { cookie: "sb-synthetic-auth-token=synthetic-expired-session; preference=compact" },
    });

    const response = await proxy(request);

    expect(boundary.createServerClient).toHaveBeenCalledWith(
      "https://synthetic.supabase.co", "sb_publishable_synthetic_test_key", expect.anything(),
    );
    expect(boundary.inputCookies).toEqual(expect.arrayContaining([
      { name: "sb-synthetic-auth-token", value: "synthetic-expired-session" },
      { name: "preference", value: "compact" },
    ]));
    expect(boundary.getUser).toHaveBeenCalledOnce();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("forwards refreshed session cookies to the downstream request and browser response", async () => {
    boundary.refreshedCookies = [{
      name: "sb-synthetic-auth-token", value: "synthetic-refreshed-session",
      options: { path: "/", maxAge: 3600 },
    }];
    boundary.refreshedHeaders = { "cache-control": "private, no-store", pragma: "no-cache" };
    const { proxy } = await import("../../src/proxy");
    const request = new NextRequest("https://synthetic-app.example/", {
      headers: { cookie: "sb-synthetic-auth-token=synthetic-expired-session; preference=compact" },
    });

    const response = await proxy(request);

    expect(request.cookies.get("sb-synthetic-auth-token")?.value).toBe("synthetic-refreshed-session");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-synthetic-auth-token=synthetic-refreshed-session");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("preference=compact");
    expect(response.cookies.get("sb-synthetic-auth-token")).toMatchObject({
      name: "sb-synthetic-auth-token", value: "synthetic-refreshed-session",
      path: "/", maxAge: 3600, httpOnly: true, sameSite: "lax", secure: true,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it.each([
    ["https://synthetic-app.example", true],
    ["http://localhost:3000", false],
  ])("uses server-managed cookie protections for %s", async (appOrigin, secure) => {
    boundary.getServerConfig.mockReturnValue({
      appOrigin, supabaseUrl: "https://synthetic.supabase.co", supabasePublishableKey: "sb_publishable_synthetic_test_key",
    });
    boundary.refreshedCookies = [{
      name: "sb-synthetic-auth-token", value: "synthetic-refreshed-session",
      options: { path: "/", httpOnly: false, sameSite: "none", secure: !secure },
    }];
    const { proxy } = await import("../../src/proxy");

    const response = await proxy(new NextRequest(`${appOrigin}/`));

    expect(response.cookies.get("sb-synthetic-auth-token")).toMatchObject({ httpOnly: true, sameSite: "lax", secure });
  });

  it.each([
    ["signed in", { id: "11111111-1111-4111-8111-111111111111" }],
    ["signed out", null],
  ])("passes through a %s request without checking project membership or roles", async (_state, user) => {
    boundary.getUser.mockResolvedValue({ data: { user }, error: null });
    const { proxy } = await import("../../src/proxy");

    const response = await proxy(new NextRequest("https://synthetic-app.example/projects/synthetic-project"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(boundary.getServerComposition).not.toHaveBeenCalled();
    expect(boundary.pool).not.toHaveBeenCalled();
  });

  it("keeps ordinary page handling when session refresh throws without exposing provider details", async () => {
    boundary.getUser.mockRejectedValue(new Error("synthetic-private-provider-detail"));
    const { proxy } = await import("../../src/proxy");

    const response = await proxy(new NextRequest("https://synthetic-app.example/sign-in"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("synthetic-private-provider-detail");
  });
});
