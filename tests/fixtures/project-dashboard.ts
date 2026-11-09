// Synthetic aggregates only. Task 4.7 D2-D6; no task/member-management records.
export const dashboardIds = {
  project: "47000000-0000-4000-8000-000000000001",
  pm: "47000000-0000-4000-8000-000000000002",
  alpha: "47000000-0000-4000-8000-000000000003",
  beta: "47000000-0000-4000-8000-000000000004",
  zero: "47000000-0000-4000-8000-000000000005",
};
export const dashboardStates = ["to_do", "in_progress", "in_review", "done"] as const;
export type DashboardState = typeof dashboardStates[number];
export const counts = (to_do = 0, in_progress = 0, in_review = 0, done = 0) => ({ to_do, in_progress, in_review, done });
export function dashboardSnapshot() {
  return {
    stateCounts: counts(1, 1, 0, 1), memberCount: 4, completedToday: 1,
    members: [
      { personId: dashboardIds.beta, githubUsername: "Beta", role: "developer" as const, stateCounts: counts(0, 1) },
      { personId: dashboardIds.pm, githubUsername: "manager", role: "product_manager" as const, stateCounts: counts() },
      { personId: dashboardIds.zero, githubUsername: "zero", role: "developer" as const, stateCounts: counts() },
      { personId: dashboardIds.alpha, githubUsername: "alpha", role: "developer" as const, stateCounts: counts(1, 0, 0, 1) },
    ],
  };
}
export function dashboardView() {
  const snapshot = dashboardSnapshot();
  return {
    totalTasks: 3, completedTasks: 1, progressPercent: 33, memberCount: 4, completedToday: 1,
    allocation: [snapshot.members[3], snapshot.members[0], snapshot.members[2]],
  };
}
