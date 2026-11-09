import "server-only";
import type { ProjectAccessRepository } from "@/server/repositories/project-access-repository";
import type { ProjectDashboardRepository } from "./repository";
import type { ProjectDashboardView } from "./types";

export class ProjectDashboardError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor() { super("Resource not found"); this.name = "ProjectDashboardError"; }
}

type DashboardReads = Pick<ProjectDashboardRepository, "readSnapshot">;
type DashboardAccess = Pick<ProjectAccessRepository, "projectExists" | "findProjectRole">;

/** Independently rechecks membership for every direct dashboard read. */
export class ProjectDashboardService {
  constructor(private readonly repository: DashboardReads, private readonly access: DashboardAccess) {}

  async getDashboard(projectId: string, personId: string): Promise<ProjectDashboardView> {
    if (!await this.access.projectExists(projectId) || !await this.access.findProjectRole(projectId, personId)) {
      throw new ProjectDashboardError();
    }
    const snapshot = await this.repository.readSnapshot(projectId);
    const completedTasks = snapshot.stateCounts.done;
    const totalTasks = Object.values(snapshot.stateCounts).reduce((sum, count) => sum + count, 0);
    const allocation = snapshot.members.filter(member => member.role === "developer" ||
      Object.values(member.stateCounts).some(count => count > 0)).slice().sort((left, right) => {
      const leftName = left.githubUsername.toLowerCase();
      const rightName = right.githubUsername.toLowerCase();
      return leftName < rightName ? -1 : leftName > rightName ? 1 :
        left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0;
    });
    return {
      totalTasks, completedTasks,
      progressPercent: totalTasks === 0 ? 0 : Math.round(completedTasks / totalTasks * 100),
      memberCount: snapshot.memberCount,
      completedToday: snapshot.completedToday,
      allocation: allocation.map(member => ({
        personId: member.personId, githubUsername: member.githubUsername, role: member.role,
        stateCounts: { to_do: member.stateCounts.to_do, in_progress: member.stateCounts.in_progress,
          in_review: member.stateCounts.in_review, done: member.stateCounts.done },
      })),
    };
  }
}
