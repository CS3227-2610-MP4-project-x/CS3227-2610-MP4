import { dashboardIds, dashboardView } from "./project-dashboard";
export const developerIdentity = { githubUsername: "synthetic-developer", avatarUrl: null };
export const developerProjectId = dashboardIds.project;
export const developerDashboard = () => ({ ...dashboardView(), totalTasks: 8, completedTasks: 4, progressPercent: 50 });
export function developerTasks() {
  return (["To Do", "In Progress", "In Review", "Done"] as const).map((state, i) => ({
    id: `48000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    taskKey: `SYN-${i + 1}`, title: `Synthetic ${state} task`, description: `Synthetic description ${i + 1}`,
    state, dueDate: "2026-12-01", version: 1,
    assignee: { id: dashboardIds.alpha, githubUsername: developerIdentity.githubUsername },
    branchName: i === 0 ? null : `synthetic/branch-${i + 1}`,
    progressUpdateCount: i + 2, attachedCommitCount: i + 3,
  }));
}
