import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { dashboardIds as ids, dashboardView } from "../../fixtures/project-dashboard";
import { developerTasks } from "../../fixtures/developer-dashboard";
import { visibleText } from "./support";

// Task 4.7 D1-D3/D7-D8. Real page + public components; external session and
// service boundaries are synthetic. No private implementation methods are mocked.
const f = vi.hoisted(() => ({ composition: {} as Record<string, unknown>, getUser: vi.fn(), findPerson: vi.fn(),
  getDashboardTasks: vi.fn(), projectExists: vi.fn(), findRole: vi.fn(), getDashboard: vi.fn(), listMembers: vi.fn(),
  redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`); }),
  notFound: vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", redirect: f.redirect, notFound: f.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/composition", () => ({ getServerComposition: () => f.composition }));
vi.mock("@/server/auth/supabase-auth", () => ({ createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }) }));
const PAGE = "../../../src/app/projects/[projectId]/dashboard/page";
beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: {
    id: "47000000-0000-4000-8000-000000000099",
    user_metadata: { user_name: "untrusted-metadata-name" },
    identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "verified-synthetic", avatar_url: "https://avatars.githubusercontent.com/u/424242" } }],
  } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(ids.pm); f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("product_manager"); f.getDashboard.mockReset().mockResolvedValue(dashboardView());
  f.listMembers.mockReset().mockResolvedValue([{ personId: ids.alpha, githubUsername: "synthetic-choice", role: "developer" }]);
  f.getDashboardTasks.mockReset().mockResolvedValue(developerTasks());
  f.composition = {
    config: {}, peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    taskBoardService: { getDashboardTasks: f.getDashboardTasks },
    projectDashboardService: { getDashboard: f.getDashboard }, projectService: { listMembers: f.listMembers },
  };
});
async function render() { const { default: Page } = await import(PAGE); return renderToStaticMarkup(await Page({ params: Promise.resolve({ projectId: ids.project }) })); }
it("is dynamic and calls the independently authorized dashboard service with the authenticated person", async () => {
  expect((await import(PAGE)).dynamic).toBe("force-dynamic"); await render();
  expect(f.getDashboard).toHaveBeenCalledWith(ids.project, ids.pm);
});
it("redirects signed-out visitors before any aggregate/member-choice read", async () => {
  f.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(render()).rejects.toThrow("REDIRECT:/sign-in");
  expect(f.getDashboard).not.toHaveBeenCalled(); expect(f.listMembers).not.toHaveBeenCalled();
});
it.each(["missing", "nonmember"])("shows safe not-found for %s without aggregate disclosure", async reason => {
  if (reason === "missing") f.projectExists.mockResolvedValue(false); else f.findRole.mockResolvedValue(null);
  await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(f.getDashboard).not.toHaveBeenCalled(); expect(f.listMembers).not.toHaveBeenCalled();
});
it("handles membership loss between page access and dashboard service as not-found", async () => {
  f.getDashboard.mockRejectedValue(Object.assign(new Error("synthetic-private-access-detail"), { code: "NOT_FOUND" }));
  await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
});
it("retains the PM role label while account identity belongs to the shared layout", async () => {
  const html = await render();
  expect(visibleText(html)).toMatch(/product manager/i);
  expect(html).not.toContain("verified-synthetic"); expect(html).not.toContain("untrusted-metadata-name");
  expect(html).not.toContain("https://avatars.githubusercontent.com/u/424242");
  expect(html).not.toMatch(/class="account-control"/);
});
it("loads creation choices only for the PM and renders the existing New Task control", async () => {
  const html = await render(); expect(visibleText(html)).toContain("New Task");
  expect(f.listMembers).toHaveBeenCalledWith(ids.project, ids.pm);
});
it("does not fetch or serialize task-creation choices for a developer", async () => {
  f.findPerson.mockResolvedValue(ids.alpha); f.findRole.mockResolvedValue("developer");
  const html = await render(); expect(f.getDashboard).toHaveBeenCalledWith(ids.project, ids.alpha);
  expect(f.listMembers).not.toHaveBeenCalled();
  for (const text of ["New Task", "synthetic-choice", "Review Queue", "Progress Report"]) expect(visibleText(html)).not.toContain(text);
});
it("shows a safe accessible reload message for read failure instead of fabricated zero metrics", async () => {
  f.getDashboard.mockRejectedValue(new Error("synthetic-private-db-password-detail"));
  const html = await render(); expect(visibleText(html)).toMatch(/unavailable|could not.*load/i);
  expect(visibleText(html)).toMatch(/reload/i); expect(html).toMatch(/role="(?:alert|status)"/);
  expect(html).not.toContain("synthetic-private-db-password-detail"); expect(html).not.toContain("0%"); expect(html).not.toContain("role=\"progressbar\"");
});
it("a member-choice failure preserves dashboard metrics and safely disables task creation", async () => {
  f.listMembers.mockRejectedValue(new Error("synthetic-private-member-detail"));
  const html = await render(); expect(visibleText(html)).toContain("33%");
  expect(visibleText(html)).toMatch(/could not.*load|unavailable/i); expect(html).not.toContain("synthetic-private-member-detail");
});

it("loads the developer own-task projection with authenticated access and omits allocation", async () => {
  f.findPerson.mockResolvedValue(ids.alpha); f.findRole.mockResolvedValue("developer");
  const html = await render();
  expect(f.getDashboardTasks).toHaveBeenCalledWith(ids.project, { personId: ids.alpha, role: "developer" });
  expect(visibleText(html)).toMatch(/My tasks/i); expect(visibleText(html)).not.toContain("Task Allocation");
  expect(visibleText(html)).toContain(developerTasks()[0].description);
});
it("does not issue the developer task read for product managers", async () => {
  await render(); expect(f.getDashboardTasks).not.toHaveBeenCalled();
});
it("shows a safe reload error when the developer task projection fails", async () => {
  f.findPerson.mockResolvedValue(ids.alpha); f.findRole.mockResolvedValue("developer");
  f.getDashboardTasks.mockRejectedValue(new Error("synthetic-private-task-detail"));
  const html = await render(); expect(visibleText(html)).toMatch(/could not|unavailable/i);
  expect(html).not.toContain("synthetic-private-task-detail"); expect(html).not.toContain("0%");
});
