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

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
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

// Task 4.4, design.md "Board, Detail and Review Queue Decisions (4.4)" B3: a minimal "my
// projects" list on `/` shows each project's name, key and the person's role, and links to its
// board. It is not the project dashboard (B1). Seam chosen by the 4.4 test-writer:
// composition.projectService.listProjectsForPerson(personId) -> [{ id, key, name, role }], with
// personId from the session (peopleRepository.findPersonIdByAuthUserId). B3 (amended
// 2026-11-08): ordered by project name, then id (SQL order covered by the integration test);
// a failed read shows a safe error in place of the list; no projects shows an empty state.
describe("my projects entry point (B3)", () => {
  const projects = [
    { id: "33333333-3333-4333-8333-333333333301", key: "WEB", name: "Synthetic web project", role: "product_manager" },
    { id: "33333333-3333-4333-8333-333333333302", key: "API", name: "Synthetic api project", role: "developer" },
  ];

  async function home(): Promise<string> {
    const { default: Home } = await import("../../src/app/page");
    return renderToStaticMarkup(await Home());
  }

  it("reads the signed-in person's projects", async () => {
    await home();

    expect(boundary.findPersonIdByAuthUserId).toHaveBeenCalledWith(signedInUser().id);
    expect(boundary.listProjectsForPerson).toHaveBeenCalledWith(personId);
  });

  it("lists each project's name and key with a link to its board", async () => {
    boundary.listProjectsForPerson.mockResolvedValue(projects);

    const markup = await home();

    for (const project of projects) {
      expect(markup).toContain(project.name);
      expect(markup).toContain(project.key);
      expect(markup).toMatch(new RegExp(`<a\\b[^>]*href="/projects/${project.id}/board"`));
    }
  });

  it.each([
    ["product_manager", /product manager/i],
    ["developer", /developer/i],
  ] as const)("shows the person's role %s as a readable name", async (role, label) => {
    boundary.listProjectsForPerson.mockResolvedValue([{ ...projects[0], role }]);

    const markup = (await home()).replaceAll(username, "");

    expect(markup).toMatch(label);
    expect(markup).not.toContain(role === "product_manager" ? "product_manager" : ">developer<");
  });

  it("shows an empty-state message and no project link when the person has no projects", async () => {
    const markup = await home();

    expect(markup).not.toMatch(/href="\/projects\/[^/"?]+\/board(?:[?"#])/);
    expect(markup).toMatch(/<a\b[^>]*href="\/projects\/new"[^>]*>[\s\S]*?Create project/i);
    expect(markup.replaceAll(username, "")).toMatch(/no projects|any projects|not a member/i);
  });

  it("shows the empty state, not an error, when the session has no registered person (reviewer round 1)", async () => {
    boundary.findPersonIdByAuthUserId.mockResolvedValue(null);

    const markup = (await home()).replaceAll(username, "");

    expect(boundary.listProjectsForPerson).not.toHaveBeenCalled();
    expect(boundary.redirect).not.toHaveBeenCalled();
    expect(markup).toMatch(/no projects|any projects|not a member/i);
    expect(markup).not.toMatch(/could not|couldn.t|unable|unavailable|try again/i);
    expect(markup).not.toMatch(/href="\/projects\/[^/"?]+\/board(?:[?"#])/);
    expect(markup).toMatch(/<a\b[^>]*href="\/projects\/new"[^>]*>[\s\S]*?Create project/i);
  });

  it("keeps the order the read returns (project name, then id)", async () => {
    const ordered = [
      { id: "33333333-3333-4333-8333-333333333311", key: "ALP", name: "Alpha synthetic project", role: "developer" },
      { id: "33333333-3333-4333-8333-333333333312", key: "BET", name: "Beta synthetic project", role: "developer" },
      { id: "33333333-3333-4333-8333-333333333313", key: "GAM", name: "Gamma synthetic project", role: "product_manager" },
    ];
    boundary.listProjectsForPerson.mockResolvedValue(ordered);

    const markup = await home();

    const positions = ordered.map((project) => markup.indexOf(`/projects/${project.id}/board`));
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("shows a safe error in place of the list when the read fails, and still renders the page", async () => {
    boundary.listProjectsForPerson.mockRejectedValue(new Error("synthetic-private-db-detail"));

    const markup = await home();

    expect(boundary.redirect).not.toHaveBeenCalled();
    expect(markup).toContain(username);
    expect(markup).toMatch(/<button\b[^>]*>[\s\S]*?Sign out[\s\S]*?<\/button>/i);
    expect(markup).toMatch(/could not|couldn.t|unable|unavailable|try again/i);
    expect(markup).not.toContain("synthetic-private-db-detail");
    expect(markup).not.toMatch(/href="\/projects\/[^/"?]+\/board(?:[?"#])/);
    expect(markup).toMatch(/<a\b[^>]*href="\/projects\/new"[^>]*>[\s\S]*?Create project/i);
  });

  it("renders project names as plain text", async () => {
    boundary.listProjectsForPerson.mockResolvedValue([{ ...projects[0], name: "Synthetic <b>bold</b> name" }]);

    const markup = await home();

    expect(markup).not.toContain("<b>bold</b>");
    expect(markup).toContain("&lt;b&gt;bold&lt;/b&gt;");
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
