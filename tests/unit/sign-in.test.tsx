import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 3.3, identity-and-access: “Sign in with GitHub” and
// “Access is enforced by project role on the server” (no requirement IDs).
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  getServerComposition: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: boundary.redirect }));
vi.mock("@/server/composition", () => ({ getServerComposition: boundary.getServerComposition }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: boundary.getUser } }),
}));

beforeEach(() => {
  boundary.getServerComposition.mockReturnValue({ config: { appOrigin: "http://localhost:3000" } });
  boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("public sign-in page", () => {
  it("offers GitHub sign-in to a person without a valid session", async () => {
    const { default: SignIn } = await import("../../src/app/sign-in/page");
    const markup = renderToStaticMarkup(await SignIn({ searchParams: Promise.resolve({}) }));

    expect(markup).toMatch(/<main\b/);
    expect(markup).toMatch(/<h1\b/);
    expect(markup).toMatch(/<a\b[^>]*href="\/api\/v1\/auth\/sign-in"[^>]*>[\s\S]*?GitHub[\s\S]*?<\/a>/i);
    expect(markup).not.toMatch(/role="alert"/);
    expect(boundary.redirect).not.toHaveBeenCalled();
  });

  it("shows a generic callback error without reflecting provider or server details", async () => {
    const { default: SignIn } = await import("../../src/app/sign-in/page");
    const markup = renderToStaticMarkup(await SignIn({
      searchParams: Promise.resolve({ auth: "failed", error_description: "synthetic-private-provider-detail" }),
    }));

    expect(markup).toMatch(/role="alert"/);
    expect(markup).toMatch(/sign.in|try again/i);
    expect(markup).not.toContain("synthetic-private-provider-detail");
    expect(markup).toContain('href="/api/v1/auth/sign-in"');
  });

  it("redirects an authenticated person to the workspace", async () => {
    boundary.getUser.mockResolvedValue({
      data: { user: {
        id: "11111111-1111-4111-8111-111111111111",
        identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-developer" } }],
      } }, error: null,
    });
    const { default: SignIn } = await import("../../src/app/sign-in/page");

    await expect(SignIn({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/");
    expect(boundary.redirect).toHaveBeenCalledWith("/");
  });
});
