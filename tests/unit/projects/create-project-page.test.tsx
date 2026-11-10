import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 4.5 D1/D2/D3/D7; real page access over synthetic external boundaries.
const f = vi.hoisted(() => ({
  composition: {} as Record<string, unknown>, getUser: vi.fn(), findPerson: vi.fn(),
  projectExists: vi.fn(), findRole: vi.fn(), listProjects: vi.fn(), listMembers: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("server-only", () => ({}));
import { ProjectError } from "@/server/projects";
vi.mock("@/server/composition", () => ({ getServerComposition: () => f.composition }));
vi.mock("@/server/auth/supabase-auth", () => ({ createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => { throw new Error(`REDIRECT:${url}`); },
  notFound: (): never => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const projectId = "53000000-0000-4000-8000-000000000001";
const personId = "53000000-0000-4000-8000-000000000002";
const members = [
  { personId, githubUsername: "Synthetic-PM", role: "product_manager" },
  { personId: "53000000-0000-4000-8000-000000000003", githubUsername: "Synthetic-Dev", role: "developer" },
];

beforeEach(() => {
  f.getUser.mockResolvedValue({ data: { user: {
    id: "53000000-0000-4000-8000-000000000004",
    identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "Synthetic-PM", avatar_url: "https://avatars.githubusercontent.com/u/424242" } }],
  } }, error: null });
  f.findPerson.mockResolvedValue(personId);
  f.projectExists.mockResolvedValue(true);
  f.findRole.mockResolvedValue("product_manager");
  f.listProjects.mockResolvedValue([]);
  f.listMembers.mockResolvedValue(members);
  f.composition = {
    config: {}, peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    projectService: { listProjectsForPerson: f.listProjects, listMembers: f.listMembers },
  };
});

async function settings() {
  const { default: Page } = await import("@/app/projects/[projectId]/settings/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({}) }));
}

describe("Signed-in people use the create-project page (4.5)", () => {
  it("shows prominent create-project links on the successful empty dashboard", async () => {
    const { default: Home } = await import("@/app/page");
    const html = renderToStaticMarkup(await Home());
    expect(html).toMatch(/<a\b[^>]*href="\/projects\/new"[^>]*>[\s\S]*?Create project/i);
    expect(html).toContain("workspace-project-link-primary");
    for (const label of ["Project progress", "Task summary", "My tasks"]) expect(html).toContain(label);
  });

  it("redirects populated membership lists to the selected project's dashboard", async () => {
    f.listProjects.mockResolvedValue([{ id: projectId, key: "WEB", name: "Synthetic", role: "developer" }]);
    const { default: Home } = await import("@/app/page");
    await expect(Home()).rejects.toThrow(`REDIRECT:/projects/${projectId}/dashboard`);
  });

  it("renders a dynamic static-route page with labeled key/name inputs without project access lookup", async () => {
    const page = await import("@/app/projects/new/page");
    expect(page.dynamic).toBe("force-dynamic");
    const html = renderToStaticMarkup(await page.default());
    expect(html).toMatch(/<label\b[^>]*>[\s\S]*?(?:Project )?key/i);
    expect(html).toMatch(/<label\b[^>]*>[\s\S]*?(?:Project )?name/i);
    expect(html).toMatch(/<button\b[^>]*>[\s\S]*?Create project/i);
    expect(f.findRole).not.toHaveBeenCalled();
    expect(f.projectExists).not.toHaveBeenCalled();
  });

  it("redirects a signed-out create visitor", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { default: Page } = await import("@/app/projects/new/page");
    await expect(Page()).rejects.toThrow("REDIRECT:/sign-in");
  });
});

describe("Members within project settings (4.5)", () => {
  it("renders current members/roles and preserves a repository section for the PM", async () => {
    const html = await settings();
    expect(f.listMembers).toHaveBeenCalledWith(projectId, personId);
    expect(html).toMatch(/Members/i);
    expect(html).toMatch(/repositor/i);
    expect(html).toContain("Synthetic-PM");
    expect(html).toContain("Synthetic-Dev");
    expect(html).toMatch(/Product manager/i);
    expect(html).toMatch(/Developer/i);
    expect(html).not.toMatch(/Remove member|Delete member/i);
  });

  it("shows developers a safe unavailable members view without reading or disclosing the list", async () => {
    f.findRole.mockResolvedValue("developer");
    const html = await settings();
    expect(f.listMembers).not.toHaveBeenCalled();
    expect(html).not.toContain("Synthetic-Dev");
    expect(html).not.toMatch(/Add member|Transfer (?:product manager|ownership)/i);
    expect(html).toMatch(/members/i);
    expect(html).toMatch(/unavailable|product manager|not available|access/i);
  });

  it.each(["nonmember", "missing"])("conceals settings from %s", async (state) => {
    if (state === "nonmember") f.findRole.mockResolvedValue(null);
    else f.projectExists.mockResolvedValue(false);
    await expect(settings()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.listMembers).not.toHaveBeenCalled();
  });

  it("redirects a signed-out settings visitor", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(settings()).rejects.toThrow("REDIRECT:/sign-in");
    expect(f.listMembers).not.toHaveBeenCalled();
  });

  it("contains operational failure and offers safe retry guidance without member data", async () => {
    f.listMembers.mockRejectedValue(new Error("synthetic-private-member-db-detail"));
    const html = await settings();
    expect(f.listMembers).toHaveBeenCalledWith(projectId, personId);
    expect(html).not.toContain("synthetic-private-member-db-detail");
    expect(html).not.toContain("Synthetic-Dev");
    const membersSection = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)]
      .map((match) => match[0]).find((section) => /<h[1-6]\b[^>]*>\s*Members\s*<\/h[1-6]>/i.test(section));
    expect(membersSection).toMatch(/try again|retry/i);
  });

  it("uses safe not-found when the independent member read rejects access after the page guard succeeded", async () => {
    f.listMembers.mockRejectedValue(new ProjectError("NOT_FOUND"));
    await expect(settings()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.listMembers).toHaveBeenCalledWith(projectId, personId);
  });

  it("shows safe unavailable members when the independent read finds the caller is no longer PM", async () => {
    f.listMembers.mockRejectedValue(new ProjectError("FORBIDDEN"));
    const html = await settings();
    expect(f.listMembers).toHaveBeenCalledWith(projectId, personId);
    expect(html).toMatch(/members/i);
    const membersSection = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)]
      .map((match) => match[0]).find((section) => /<h[1-6]\b[^>]*>\s*Members\s*<\/h[1-6]>/i.test(section));
    expect(membersSection).toMatch(/unavailable|not available|product manager|permission|access/i);
    expect(html).not.toContain("Synthetic-Dev");
    expect(html).not.toMatch(/Add member|Transfer (?:product manager|ownership)/i);
    expect(membersSection).not.toMatch(/try again|retry/i);
  });
});
