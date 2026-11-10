import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 3.3: identity-and-access “Sign in with GitHub” and
// “Access is enforced by project role on the server” (no requirement IDs).
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  hookHarnessActive: false,
  hookCursor: 0,
  hookState: [] as unknown[],
  replace: vi.fn(),
  refresh: vi.fn(),
  assign: vi.fn(),
  fetch: vi.fn(),
  getServerComposition: vi.fn(),
  completeGitHubSignIn: vi.fn(),
  findPersonIdByAuthUserId: vi.fn(),
  listProjectsForPerson: vi.fn(),
  cookieGet: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
}));

// The existing stack uses Node rather than a DOM test library. This small hook
// harness exercises the client event handler and its rendered state with no
// browser credentials or dependency changes. Page rendering uses real hooks.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      if (!boundary.hookHarnessActive) return actual.useState(initial);
      const slot = boundary.hookCursor++;
      if (!(slot in boundary.hookState)) {
        boundary.hookState[slot] = typeof initial === "function" ? initial() : initial;
      }
      return [boundary.hookState[slot], (next: unknown) => {
        boundary.hookState[slot] = typeof next === "function" ? next(boundary.hookState[slot]) : next;
      }];
    },
  };
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: boundary.cookieGet }) }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: boundary.redirect,
  useRouter: () => ({ replace: boundary.replace, push: boundary.replace, refresh: boundary.refresh }),
}));
vi.mock("@/server/composition", () => ({ getServerComposition: boundary.getServerComposition }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: boundary.getUser } }),
}));

const origin = "http://localhost:3000";
const username = "synthetic-developer";
const avatar = "https://avatars.githubusercontent.com/u/424242?v=4";
const personId = "22222222-2222-4222-8222-222222222222";

function signedInUser() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_metadata: { user_name: "editable-display-name", avatar_url: "https://example.test/editable.png" },
    identities: [{
      provider: "github",
      provider_id: "424242",
      identity_data: { user_name: username, avatar_url: avatar },
    }],
  };
}

beforeEach(() => {
  boundary.cookieGet.mockReset();
  boundary.hookHarnessActive = false;
  boundary.hookCursor = 0;
  boundary.hookState = [];
  boundary.getUser.mockResolvedValue({ data: { user: signedInUser() }, error: null });
  boundary.findPersonIdByAuthUserId.mockResolvedValue(personId);
  boundary.listProjectsForPerson.mockResolvedValue([]);
  boundary.getServerComposition.mockReturnValue({
    config: { appOrigin: origin },
    authService: { completeGitHubSignIn: boundary.completeGitHubSignIn },
    // Task 4.4 B3: the "my projects" read (seam chosen by the 4.4 test-writer).
    peopleRepository: { findPersonIdByAuthUserId: boundary.findPersonIdByAuthUserId },
    projectService: { listProjectsForPerson: boundary.listProjectsForPerson },
  });
  boundary.completeGitHubSignIn.mockResolvedValue(undefined);
});

afterEach(() => { boundary.hookHarnessActive = false; vi.unstubAllGlobals(); });

describe("protected workspace", () => {
  it("shows the verified GitHub username, avatar, and sign-out action", async () => {
    const { default: Home } = await import("../../src/app/page");
    const markup = renderToStaticMarkup(await Home());

    expect(markup).toMatch(/<main\b/);
    expect(markup).toContain(username);
    expect(markup).toContain(avatar.replaceAll("&", "&amp;"));
    expect(markup).toMatch(/<button\b[^>]*>[\s\S]*?Sign out[\s\S]*?<\/button>/i);
    expect(markup).not.toContain("editable-display-name");
    expect(markup).not.toContain("https://example.test/editable.png");
  });

  it("redirects a person without a session to /sign-in", async () => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { default: Home } = await import("../../src/app/page");

    await expect(Home()).rejects.toThrow("REDIRECT:/sign-in");
    expect(boundary.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("does not render the workspace when session verification fails", async () => {
    boundary.getUser.mockRejectedValue(new Error("synthetic-private-provider-detail"));
    const { default: Home } = await import("../../src/app/page");

    await expect(Home()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("does not accept editable metadata as the GitHub identity", async () => {
    boundary.getUser.mockResolvedValue({
      data: { user: { ...signedInUser(), identities: [] } }, error: null,
    });
    const { default: Home } = await import("../../src/app/page");

    await expect(Home()).rejects.toThrow("REDIRECT:/sign-in");
  });
});

// Approved selected-project routing supersedes the former project list entry point.
describe("selected-project landing", () => {
  const projects = [
    { id: "33333333-3333-4333-8333-333333333301", key: "ALP", name: "Alpha", role: "developer" },
    { id: "33333333-3333-4333-8333-333333333302", key: "BET", name: "Beta", role: "product_manager" },
  ];
  async function home() { const { default: Home } = await import("../../src/app/page"); return renderToStaticMarkup(await Home()); }
  it("reopens an accessible remembered project after reading current memberships", async () => {
    boundary.listProjectsForPerson.mockResolvedValue(projects);
    boundary.cookieGet.mockReturnValue({ value: projects[1].id });
    await expect(home()).rejects.toThrow(`REDIRECT:/projects/${projects[1].id}/dashboard`);
    expect(boundary.listProjectsForPerson).toHaveBeenCalledWith(personId);
  });
  it.each([undefined, { value: "malformed" }, { value: "33333333-3333-4333-8333-333333333399" }])("falls back to first currently accessible project for %s", remembered => {
    boundary.listProjectsForPerson.mockResolvedValue(projects); boundary.cookieGet.mockReturnValue(remembered);
    return expect(home()).rejects.toThrow(`REDIRECT:/projects/${projects[0].id}/dashboard`);
  });
  it("renders all three empty dashboard cards and a create-project action for no memberships", async () => {
    const html = await home();
    for (const label of ["Project Progress", "Task Summary", "My tasks"]) expect(html.toLowerCase()).toContain(label.toLowerCase());
    expect(html).toMatch(/href="\/projects\/new"/); expect(html).toMatch(/Create project/i);
    expect(html).not.toMatch(/NaN|Infinity/); expect(boundary.redirect).not.toHaveBeenCalled();
  });
  it("treats an unregistered person as a successful empty state", async () => {
    boundary.findPersonIdByAuthUserId.mockResolvedValue(null);
    const html = await home(); expect(boundary.listProjectsForPerson).not.toHaveBeenCalled();
    expect(html).toMatch(/Create project/); expect(html).not.toMatch(/could not|unavailable/i);
  });
  it("does not redirect or fabricate empty success when memberships fail", async () => {
    boundary.listProjectsForPerson.mockRejectedValue(new Error("synthetic-private-db-detail"));
    const html = await home(); expect(boundary.redirect).not.toHaveBeenCalled();
    expect(html).toMatch(/could not|unavailable|try again/i); expect(html).not.toContain("synthetic-private-db-detail");
    expect(html).toMatch(/role="(?:alert|status)"/);
  });
});

describe("callback destinations", () => {
  it("opens the workspace after establishing a valid session", async () => {
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");
    const response = await GET(new NextRequest(`${origin}/api/v1/auth/callback?code=synthetic-code`));

    expect(boundary.completeGitHubSignIn).toHaveBeenCalledWith(expect.anything(), "synthetic-code");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["", "?error=access_denied&error_description=synthetic-private-provider-detail"])(
    "redirects a callback without a code to the generic sign-in failure (%s)", async (query) => {
      const { GET } = await import("../../src/app/api/v1/auth/callback/route");
      const response = await GET(new NextRequest(`${origin}/api/v1/auth/callback${query}`));

      expect(boundary.completeGitHubSignIn).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${origin}/sign-in?auth=failed`);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("redirects session establishment failure without exposing the error", async () => {
    boundary.completeGitHubSignIn.mockRejectedValue(new Error("synthetic-private-provider-detail"));
    const { GET } = await import("../../src/app/api/v1/auth/callback/route");
    const response = await GET(new NextRequest(`${origin}/api/v1/auth/callback?code=synthetic-code`));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/sign-in?auth=failed`);
    expect(await response.text()).not.toContain("synthetic-private-provider-detail");
  });
});


type ElementProps = { children?: ReactNode; onClick?: () => void | Promise<void>; disabled?: boolean };

function elements(node: ReactNode): Array<{ type: unknown; props: ElementProps }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return isValidElement<ElementProps>(node) ? textContent(node.props.children) : "";
}

async function accountHarness() {
  const { AccountControl } = await import("../../src/components/auth/account-control");
  boundary.hookHarnessActive = true;
  vi.stubGlobal("fetch", boundary.fetch);
  vi.stubGlobal("window", { location: { assign: boundary.assign, replace: boundary.assign } });
  const render = () => {
    boundary.hookCursor = 0;
    return AccountControl({ githubUsername: username, avatarUrl: avatar });
  };
  let tree = render();
  let signOut = elements(tree).find((node) => node.type === "button" && /sign out/i.test(textContent(node.props.children)));
  if (!signOut) {
    const toggle = elements(tree).find((node) => node.type === "button" && node.props.onClick);
    expect(toggle, "account action must be accessible from the account control").toBeDefined();
    await toggle!.props.onClick!();
    tree = render();
    signOut = elements(tree).find((node) => node.type === "button" && /sign out/i.test(textContent(node.props.children)));
  }
  expect(signOut, "account control must offer sign-out").toBeDefined();
  return { render, signOut: signOut! };
}

describe("workspace sign-out interactions", () => {
  it("posts sign-out and navigates to /sign-in after success", async () => {
    boundary.fetch.mockResolvedValue({ ok: true, status: 204 });
    const { signOut } = await accountHarness();

    await signOut.props.onClick!();

    expect(boundary.fetch).toHaveBeenCalledWith("/api/v1/auth/sign-out", expect.objectContaining({ method: "POST" }));
    await vi.waitFor(() => {
      const destinations = [...boundary.replace.mock.calls, ...boundary.assign.mock.calls].map(([value]) => value);
      expect(destinations).toContain("/sign-in");
    });
  });

  it.each(["server", "network"])("keeps the account visible with a generic error on %s failure", async (failure) => {
    if (failure === "network") boundary.fetch.mockRejectedValue(new Error("synthetic-private-provider-detail"));
    else boundary.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "synthetic-private-provider-detail" });
    const { render, signOut } = await accountHarness();

    await signOut.props.onClick!();

    await vi.waitFor(() => expect(textContent(render())).toContain("Try again later"));
    const tree = render();
    expect(textContent(tree)).toContain(username);
    expect(textContent(tree)).not.toContain("synthetic-private-provider-detail");
    expect(elements(tree).some((node) => node.type === "button" && /sign out/i.test(textContent(node.props.children)) && !node.props.disabled)).toBe(true);
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(boundary.assign).not.toHaveBeenCalled();
  });
});
