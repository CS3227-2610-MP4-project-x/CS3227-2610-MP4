import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { TaskBoardService } from "@/server/task-board";
import { developerProjectId, developerTasks } from "../../fixtures/developer-dashboard";

function fixture() {
  const records = developerTasks().map(({ state, ...task }, i) => ({ ...task, status: ["to_do", "in_progress", "in_review", "done"][i] as "to_do" | "in_progress" | "in_review" | "done" }));
  const repository = { listProjectTasks: vi.fn(), listAssignedTasks: vi.fn(), listAssignedDashboardTasks: vi.fn().mockResolvedValue(records) };
  return { records, repository, service: new TaskBoardService(repository), access: { personId: records[0].assignee.id, role: "developer" as const } };
}
it("reads only assigned dashboard records, maps stored states and preserves metadata", async () => {
  const { service, repository, access } = fixture();
  const result = await service.getDashboardTasks(developerProjectId, access);
  expect(repository.listAssignedDashboardTasks).toHaveBeenCalledWith(developerProjectId, access.personId);
  expect(repository.listProjectTasks).not.toHaveBeenCalled();
  expect(repository.listAssignedTasks).not.toHaveBeenCalled();
  expect(result).toEqual(developerTasks());
});
it("rechecks assignee so concurrent reassignment cannot disclose another developer's text", async () => {
  const { service, repository, records, access } = fixture();
  repository.listAssignedDashboardTasks.mockResolvedValue([records[0], { ...records[1], title: "private-other-task", assignee: { id: "other", githubUsername: "other" } }]);
  const result = await service.getDashboardTasks(developerProjectId, access);
  expect(result).toEqual([developerTasks()[0]]);
  expect(JSON.stringify(result)).not.toContain("private-other-task");
});
it("propagates unavailable reads rather than fabricating an empty success", async () => {
  const { service, repository, access } = fixture();
  repository.listAssignedDashboardTasks.mockRejectedValue(new Error("synthetic failure"));
  await expect(service.getDashboardTasks(developerProjectId, access)).rejects.toThrow("synthetic failure");
});
