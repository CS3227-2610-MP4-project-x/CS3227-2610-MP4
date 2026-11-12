import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Task 3.3, identity-and-access “Sign in with GitHub”, callback failure
// scenario. No requirement ID exists. No network or real credentials are used.
const boundary = vi.hoisted(() => ({
  getServerComposition: vi.fn(),
  createRequestSupabaseClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/composition", () => ({ getServerComposition: boundary.getServerComposition }));
vi.mock("@/server/auth/supabase-auth", () => ({ createRequestSupabaseClient: boundary.createRequestSupabaseClient }));

describe("callback bootstrap failure", () => {
  it("redirects to a relative generic failure destination without trusting the request host", async () => {
    boundary.getServerComposition.mockImplementation(() => {
      throw new Error("synthetic-private-configuration-detail");
    });
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");

    const response = await GET(new NextRequest("https://untrusted.example/api/v1/auth/callback?code=synthetic-code", {
      headers: { host: "untrusted.example", "x-forwarded-host": "another-untrusted.example" },
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/sign-in?auth=failed");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.createRequestSupabaseClient).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("synthetic-private-configuration-detail");
  });
});
