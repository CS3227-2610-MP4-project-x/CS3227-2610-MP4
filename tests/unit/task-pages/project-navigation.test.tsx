import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ids, visibleText } from "./support";

// Task 4.4 (OpenSpec change project-task-management), design.md "Board, Detail and Review Queue
// Decisions (4.4)" B4 as resolved by thegrimbee (O1-a, 8 November 2026), handoff assumption A4,
// and ui-spec "Top Navigation". No requirement IDs exist.
//   Task 4.7 D1 supersedes O1-a: Dashboard is enabled for both roles; Board is shown to
//   every member; Review Queue, Reports (disabled until 8.3) and Settings are shown to the
//   product manager only. Navigation only hides links; the pages' server checks are the
//   protection (B2), which the page tests cover.
//
// Seams chosen by the test-writer (reported in the 4.4 handoff):
//   - src/components/project-navigation/project-navigation.tsx exporting
//     ProjectNavigation({ projectId, role }) with role "product_manager" | "developer".
//     A disabled tab is not a link and carries aria-disabled="true".
//   - src/app/projects/[projectId]/layout.tsx, default export
//     ProjectLayout({ children, params: Promise<{ projectId }> }), which resolves the person's
//     role with the page-access helper and renders ProjectNavigation above children. The
//     existing settings page renders unchanged inside it (A4).
// UI fixes approved by thegrimbee after the frontend check (handoff change log); seams chosen by
// the test-writer:
//   - F2: the layout sets no min-h-screen and no page background; pages own them.
//   - F3: the layout shows the project name above the tabs, read with the existing
//     composition.projectService.getProject(projectId, personId) (ProjectView { id, key, name,
//     role }) after the page-access helper. A failed name read reveals no detail.
//   - F5: the Board tab is current (aria-current="page") on the board and on task detail
//     (selected segment "tasks"); Review Queue and Settings on their own segments.
//   - F6: a disabled tab carries the class `project-nav-link-disabled` (not on enabled tabs)
//     and a "Coming soon" hint (title attribute or visible text).

const f = vi.hoisted(() => ({
  composition: {} as Record<string, unknown>,
  segment: "board" as string | null,
  getUser: vi.fn(),
  findPerson: vi.fn(),
  projectExists: vi.fn(),
  findRole: vi.fn(),
  getProject: vi.fn(),
  readProjectBinding: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
  notFound: vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: f.redirect,
  notFound: f.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/projects/10000000-0000-4000-8000-000000000005${f.segment ? `/${f.segment}` : ""}${f.segment === "tasks" ? "/10000000-0000-4000-8000-000000000006" : ""}`,
  useSelectedLayoutSegment: () => f.segment,
  useSelectedLayoutSegments: () => (f.segment === "tasks" ? ["tasks", "10000000-0000-4000-8000-000000000006"] : f.segment ? [f.segment] : []),
}));
vi.mock("@/server/composition", () => ({ getServerComposition: () => f.composition }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }),
}));

const projectId = ids.project;
const LAYOUT = "../../../src/app/projects/[projectId]/layout";
type Role = "product_manager" | "developer";

beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: ids.authUser } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(ids.pm);
  f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("product_manager");
  f.segment = "board";
  f.getProject.mockReset().mockImplementation(async (id: string) => ({
    id, key: "WEB", name: "Synthetic <i>layout</i> project", role: "product_manager",
  }));
  f.composition = {
    config: {},
    peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    projectService: { getProject: f.getProject },
    githubRepositoryLinkService: { readProjectBinding: f.readProjectBinding },
  };
  f.readProjectBinding.mockReset().mockResolvedValue({ owner: "synthetic-owner", name: "synthetic-repository" });
});

async function navigation(role: Role): Promise<string> {
  const { ProjectNavigation } = await import("@/components/project-navigation/project-navigation");
  return renderToStaticMarkup(<ProjectNavigation projectId={projectId} role={role} />);
}

/** Anchors whose visible text contains `label`. */
function links(html: string, label: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]).filter((anchor) => visibleText(anchor).includes(label));
}

function hrefOf(anchor: string): string | undefined {
  return /\bhref="([^"]*)"/.exec(anchor)?.[1];
}

function expectLinkedTab(html: string, label: string, href: string) {
  const found = links(html, label);
  expect(found, `${label} tab`).toHaveLength(1);
  expect(hrefOf(found[0])).toBe(href);
}

describe("project navigation tabs (B4, O1-a)", () => {
  // Task 4.5 approved addendum: "Return to Project Space". This ordinary link
  // precedes every project tab for both roles, without using browser history.
  it.each([
    ["developer", "board"], ["developer", "tasks"],
    ["product_manager", "board"], ["product_manager", "tasks"],
  ] as const)("shows %s a return link before project tabs on %s", async (role, segment) => {
    f.segment = segment;
    const html = await navigation(role);
    const back = links(html, "Back to Project Space");
    expect(back).toHaveLength(1);
    expect(hrefOf(back[0])).toBe("/");
    expect(back[0]).not.toMatch(/aria-current="page"|aria-disabled="true"/);
    const tabLabels = role === "product_manager"
      ? ["Dashboard", "Board", "Review Queue", "Reports", "Settings"]
      : ["Dashboard", "Board"];
    const visible = visibleText(html);
    const backPosition = visible.indexOf("Back to Project Space");
    for (const label of tabLabels) {
      const tabPosition = visible.indexOf(label);
      expect(tabPosition).toBeGreaterThan(backPosition);
    }
  });

  it("shows product manager report navigation after the D9 readiness gate", async () => {
    const html = await navigation("product_manager");

    expectLinkedTab(html, "Dashboard", `/projects/${projectId}/dashboard`);
    expectLinkedTab(html, "Board", `/projects/${projectId}/board`);
    expectLinkedTab(html, "Review Queue", `/projects/${projectId}/review-queue`);
    expectLinkedTab(html, "Reports", `/projects/${projectId}/reports`);
    expectLinkedTab(html, "Settings", `/projects/${projectId}/settings`);
  });

  it("shows a developer Dashboard and Board only", async () => {
    const html = await navigation("developer");

    expectLinkedTab(html, "Dashboard", `/projects/${projectId}/dashboard`);
    expectLinkedTab(html, "Board", `/projects/${projectId}/board`);
    expect(visibleText(html)).not.toContain("Review Queue");
    expect(visibleText(html)).not.toContain("Reports");
    expect(visibleText(html)).not.toContain("Settings");
    expect(html).not.toContain("/review-queue");
    expect(html).not.toContain("/settings");
  });

  it("keeps the tabs in the ui-spec order", async () => {
    const text = visibleText(await navigation("product_manager"));

    const positions = ["Dashboard", "Board", "Review Queue", "Reports", "Settings"].map((label) => text.indexOf(label));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("is a labelled navigation landmark", async () => {
    expect(await navigation("developer")).toMatch(/<nav\b[^>]*aria-label="[^"]+"/);
  });

  it.each([
    ["dashboard", "Dashboard"], ["board", "Board"], ["tasks", "Board"], ["review-queue", "Review Queue"], ["settings", "Settings"], ["reports", "Reports"],
  ] as const)("marks the right tab current on segment %s (F5)", async (segment, label) => {
    f.segment = segment;

    const html = await navigation("product_manager");

    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>[\s\S]*?<\/a>/g)].map((match) => visibleText(match[0]));
    expect(current).toEqual([label]);
  });

  it("keeps the ready Reports link free of disabled and coming-soon presentation", async () => {
    const html = await navigation("product_manager");
    const reportLinks = links(html, 'Reports');
    expect(reportLinks).toHaveLength(1);
    expect(reportLinks[0]).not.toMatch(/aria-disabled="true"|project-nav-link-disabled|coming soon/i);
  });
});

describe("project layout (A4)", () => {
  async function layout(): Promise<string> {
    const { default: ProjectLayout } = await import(LAYOUT);
    return renderToStaticMarkup(await ProjectLayout({
      children: <p>synthetic-child-content</p>,
      params: Promise.resolve({ projectId }),
    }));
  }

  it("renders the product manager's tabs above the page", async () => {
    const html = await layout();

    expect(html).toContain("synthetic-child-content");
    expect(html.indexOf("/review-queue")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("/review-queue")).toBeLessThan(html.indexOf("synthetic-child-content"));
    expect(html).toContain(`/projects/${projectId}/settings`);
  });

  it("renders a developer's tabs without the product-manager tabs", async () => {
    f.findPerson.mockResolvedValue(ids.developer);
    f.findRole.mockResolvedValue("developer");

    const html = await layout();

    expect(html).toContain("synthetic-child-content");
    expect(html).toContain(`/projects/${projectId}/board`);
    expect(html).not.toContain("/review-queue");
    expect(html).not.toContain("/settings");
  });

  it("still renders the existing settings page under the shared layout for the product manager", async () => {
    // A4: the layout also wraps src/app/projects/[projectId]/settings/page.tsx, which is unchanged.
    f.getUser.mockResolvedValue({ data: { user: {
      id: ids.authUser,
      identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-pm" } }],
    } }, error: null });
    const { default: SettingsPage } = await import("../../../src/app/projects/[projectId]/settings/page");
    const settings = await SettingsPage({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({}) });
    const { default: ProjectLayout } = await import(LAYOUT);

    const html = renderToStaticMarkup(await ProjectLayout({ children: settings, params: Promise.resolve({ projectId }) }));

    expect(html).toMatch(/<h1\b[^>]*>Project settings<\/h1>/);
    expect(html).toContain("synthetic-repository");
    expect(html).toContain(`href="/projects/${projectId}/settings"`);
    expect(html.indexOf(`href="/projects/${projectId}/settings"`)).toBeLessThan(html.indexOf("Project settings</h1>"));
  });

  it("leaves the page height and background to the pages (F2)", async () => {
    const html = await layout();

    expect(html).not.toMatch(/\bmin-h-screen\b/);
    expect(html).not.toMatch(/\bbg-\[#1a1a1a\]/);
  });

  it("shows the project name, as plain text, above the tabs (F3)", async () => {
    const html = await layout();

    expect(f.getProject).toHaveBeenCalledWith(projectId, ids.pm);
    const name = html.indexOf("Synthetic &lt;i&gt;layout&lt;/i&gt; project");
    expect(name).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain("<i>layout</i>");
    expect(name).toBeLessThan(html.indexOf("<nav"));
  });

  it("reveals no detail when the project name cannot be read (F3)", async () => {
    f.getProject.mockRejectedValue(new Error("synthetic-private-db-detail"));

    const result = await layout().then((html) => ({ html }), (error: unknown) => ({ error }));

    if ("html" in result) expect(result.html).not.toContain("synthetic-private-db-detail");
    else expect(String((result.error as Error)?.message)).not.toContain("synthetic-private-db-detail");
  });

  it("shows a nonmember the safe not-found result", async () => {
    f.findRole.mockResolvedValue(null);

    await expect(layout()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects a request without a valid session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(layout()).rejects.toThrow("REDIRECT:/sign-in");
  });
});
