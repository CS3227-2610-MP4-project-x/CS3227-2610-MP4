import { describe, expect, it } from "vitest";
import { projectSelectionCookieName, projectSwitchHref, selectRememberedProject } from "@/lib/project-selection";

const projects = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Alpha", key: "ALP", role: "developer" as const },
  { id: "10000000-0000-4000-8000-000000000002", name: "Beta", key: "BET", role: "product_manager" as const },
];
// Approved task-management selected-project and section-preservation requirements; no IDs assigned.
describe("browser project preference is a hint, never authority", () => {
  it("reopens a currently accessible selection", () => expect(selectRememberedProject(projects, projects[1].id)).toEqual(projects[1]));
  it.each([undefined, "", "not-a-uuid", "10000000-0000-4000-8000-000000000099"])("falls back to the supplied name/ID order for %s", id => {
    expect(selectRememberedProject(projects, id)).toEqual(projects[0]);
  });
  it("returns no invented project for an empty membership list", () => expect(selectRememberedProject([], projects[0].id)).toBeUndefined());
  it("isolates remembered choices between accounts and makes a valid cookie token", () => {
    const first = projectSelectionCookieName(projects[0].id);
    expect(first).toMatch(/^[!#$%&'*+.^_`|~0-9a-z-]+$/i);
    expect(first).not.toEqual(projectSelectionCookieName(projects[1].id));
    expect(first).toEqual(projectSelectionCookieName(projects[0].id));
  });
});
describe("switch destination uses destination role and never source task IDs", () => {
  it.each(["developer", "product_manager"] as const)("preserves board/dashboard for %s", role => {
    for (const section of ["board", "dashboard"]) expect(projectSwitchHref(projects[1].id, role, section)).toBe(`/projects/${projects[1].id}/${section}`);
  });
  it.each(["settings", "review-queue"])("permits %s only for the destination PM", section => {
    expect(projectSwitchHref(projects[1].id, "product_manager", section)).toBe(`/projects/${projects[1].id}/${section}`);
    expect(projectSwitchHref(projects[1].id, "developer", section)).toBe(`/projects/${projects[1].id}/dashboard`);
  });
  it.each([null, "tasks", "tasks/private-source-task", "reports", "unknown"])("falls back to dashboard for %s", section => {
    expect(projectSwitchHref(projects[1].id, "product_manager", section)).toBe(`/projects/${projects[1].id}/dashboard`);
  });
});
