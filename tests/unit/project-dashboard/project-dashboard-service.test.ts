import { describe, expect, it, vi } from "vitest";
import { counts, dashboardIds as ids, dashboardSnapshot, dashboardStates } from "../../fixtures/project-dashboard";

vi.mock("server-only", () => ({}));
import { ProjectDashboardService } from "@/server/project-dashboard";
import { calculateAllocation } from "@/components/project-dashboard";

// Independent public test contract for approved task 4.7 D2-D6:
// new ProjectDashboardService({readSnapshot(projectId)}, {projectExists, findProjectRole})
// .getDashboard(projectId, personId) -> aggregate DashboardView, or error.code NOT_FOUND.
// readSnapshot returns counts and current members from ONE database snapshot.
// calculateAllocation(view.allocation, selectedStates) -> rows with count and percentage;
// strips stateCounts and omits a PM row unless counted tasks remain in the selection.
function setup(snapshot = dashboardSnapshot()) {
  const repository = { readSnapshot: vi.fn(async () => snapshot) };
  const access = { projectExists: vi.fn(async () => true), findProjectRole: vi.fn(async (): Promise<"developer" | "product_manager" | null> => "developer") };
  const service = new ProjectDashboardService(repository, access);
  return { repository, access, service, read: () => service.getDashboard(ids.project, ids.alpha) };
}

describe("Dashboard reads expose authorized aggregates (4.7 D2/D3)", () => {
  it.each(["developer", "product_manager"] as const)("independently authorizes the current %s and returns project-wide counts", async role => {
    const f = setup(); f.access.findProjectRole.mockResolvedValue(role);
    const result = await f.read();
    expect(f.access.findProjectRole).toHaveBeenCalledWith(ids.project, ids.alpha);
    expect(f.repository.readSnapshot).toHaveBeenCalledWith(ids.project);
    expect(result).toMatchObject({ totalTasks: 3, completedTasks: 1, progressPercent: 33, memberCount: 4, completedToday: 1 });
    expect(result.allocation.map(row => row.githubUsername)).toEqual(["alpha", "Beta", "zero"]);
  });
  it.each(["missing", "nonmember"])("refuses %s without reading aggregates", async reason => {
    const f = setup();
    if (reason === "missing") f.access.projectExists.mockResolvedValue(false);
    else f.access.findProjectRole.mockResolvedValue(null);
    await expect(f.read()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.repository.readSnapshot).not.toHaveBeenCalled();
  });
  it("checks membership again after access is lost instead of caching a prior authorization", async () => {
    const f = setup(); await f.read(); f.access.findProjectRole.mockResolvedValue(null);
    await expect(f.read()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.repository.readSnapshot).toHaveBeenCalledTimes(1);
  });
  it("whitelists aggregate fields even if the repository returns accidental private extras", async () => {
    const snapshot = dashboardSnapshot();
    Object.assign(snapshot, { tasks: [{ id: "private-task", title: "private-title", evidence: "private-evidence" }], memberChoices: ["private-choice"] });
    Object.assign(snapshot.members[0], { authUserId: "private-auth", description: "private-description" });
    const view = await setup(snapshot).read();
    expect(Object.keys(view).sort()).toEqual(["allocation", "completedTasks", "completedToday", "memberCount", "progressPercent", "totalTasks"]);
    for (const row of view.allocation) expect(Object.keys(row).sort()).toEqual(["githubUsername", "personId", "role", "stateCounts"]);
    expect(JSON.stringify(view)).not.toContain("private-");
  });
  it("does not convert an operational read failure to a successful zero view", async () => {
    const f = setup(); f.repository.readSnapshot.mockRejectedValue(new Error("synthetic read failure"));
    await expect(f.read()).rejects.toBeDefined();
  });
});

describe("Dashboard progress and task summary agree; allocation filters (4.7 D4/D5)", () => {
  it("returns explicit finite zero metrics for an empty project, retaining zero developers", async () => {
    const snapshot = dashboardSnapshot(); snapshot.stateCounts = counts();
    snapshot.completedToday = 0; for (const member of snapshot.members) member.stateCounts = counts();
    const view = await setup(snapshot).read();
    expect(view).toMatchObject({ totalTasks: 0, completedTasks: 0, progressPercent: 0, memberCount: 4 });
    expect(calculateAllocation(view.allocation, dashboardStates).map(row => [row.count, row.percentage])).toEqual([[0, 0], [0, 0], [0, 0]]);
  });
  it("defaults to project-wide allocation and uses whole nearest percentages", async () => {
    const view = await setup().read();
    expect(calculateAllocation(view.allocation, dashboardStates).map(row => [row.githubUsername, row.count, row.percentage])).toEqual([
      ["alpha", 2, 67], ["Beta", 1, 33], ["zero", 0, 0],
    ]);
  });
  it("uses selected states as denominator without changing project or today metrics", async () => {
    const view = await setup().read(); const before = structuredClone(view);
    expect(calculateAllocation(view.allocation, ["in_progress"]).map(row => [row.count, row.percentage])).toEqual([[0, 0], [1, 100], [0, 0]]);
    expect(calculateAllocation(view.allocation, ["to_do", "done"]).map(row => [row.count, row.percentage])).toEqual([[2, 100], [0, 0], [0, 0]]);
    expect(view).toEqual(before);
  });
  it.each([{ selection: [] }, { selection: ["in_review"] }] as const)("gives zeros for empty or unmatched selections $selection", async ({ selection }) => {
    const view = await setup().read();
    expect(calculateAllocation(view.allocation, selection).map(row => [row.count, row.percentage])).toEqual([[0, 0], [0, 0], [0, 0]]);
  });
  it("includes retained PM tasks once and only in applicable selections", async () => {
    const snapshot = dashboardSnapshot(); snapshot.members[1].stateCounts = counts(0, 0, 0, 1); snapshot.stateCounts.done++;
    const view = await setup(snapshot).read();
    expect(view).toMatchObject({ totalTasks: 4, completedTasks: 2, progressPercent: 50 });
    expect(calculateAllocation(view.allocation, ["done"]).filter(row => row.role === "product_manager")).toEqual([
      { personId: ids.pm, githubUsername: "manager", role: "product_manager", count: 1, percentage: 50 },
    ]);
    expect(calculateAllocation(view.allocation, ["to_do"]).some(row => row.role === "product_manager")).toBe(false);
  });
  it("orders case-insensitive username ties by person ID", async () => {
    const snapshot = dashboardSnapshot(); snapshot.members[0].githubUsername = "ALPHA";
    const view = await setup(snapshot).read();
    expect(view.allocation.map(row => row.personId)).toEqual([ids.alpha, ids.beta, ids.zero]);
  });
  it("permits independently rounded rows to sum to 99 rather than changing a row", async () => {
    const snapshot = dashboardSnapshot();
    for (const member of snapshot.members) member.stateCounts = counts();
    for (const i of [0, 2, 3]) snapshot.members[i].stateCounts = counts(1);
    snapshot.stateCounts = counts(3);
    const view = await setup(snapshot).read();
    expect(calculateAllocation(view.allocation, dashboardStates).map(row => row.percentage)).toEqual([33, 33, 33]);
  });
});
