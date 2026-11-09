import type { ProjectRole } from "@/server/repositories/project-access-repository";

export const DASHBOARD_STATES = ["to_do", "in_progress", "in_review", "done"] as const;
export type DashboardState = typeof DASHBOARD_STATES[number];
export type DashboardStateCounts = Readonly<Record<DashboardState, number>>;
export type DashboardMember = Readonly<{
  personId: string;
  githubUsername: string;
  role: ProjectRole;
  stateCounts: DashboardStateCounts;
}>;
export type ProjectDashboardSnapshot = Readonly<{
  stateCounts: DashboardStateCounts;
  memberCount: number;
  completedToday: number;
  members: readonly DashboardMember[];
}>;
export type ProjectDashboardView = Readonly<{
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  memberCount: number;
  completedToday: number;
  allocation: readonly DashboardMember[];
}>;
