import { notFound } from "next/navigation";
import { DeveloperDashboard, ProjectDashboard } from "@/components/project-dashboard";
import { ReadFailureNotice, TaskPageShell } from "@/components/tasks/task-page-parts";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import type { ProjectDashboardView } from "@/server/project-dashboard";
import type { ProjectMemberView } from "@/server/projects";
import type { DashboardTaskCard } from "@/server/task-board";

export const dynamic = "force-dynamic";

export default async function ProjectDashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  let dashboard: ProjectDashboardView;
  try {
    dashboard = await composition.projectDashboardService.getDashboard(projectId, access.personId);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "NOT_FOUND") notFound();
    return <TaskPageShell crumb="Dashboard"><ReadFailureNotice>The project dashboard could not be loaded. Reload the page to try again.</ReadFailureNotice></TaskPageShell>;
  }

  if (access.role === "developer") {
    let tasks: readonly DashboardTaskCard[] | null = null;
    try {
      tasks = await composition.taskBoardService.getDashboardTasks(projectId, access);
    } catch {
      // Keep read failures distinct from a successful empty assignment list.
    }
    if (tasks === null) return <TaskPageShell crumb="Dashboard"><ReadFailureNotice>Your dashboard tasks could not be loaded. Reload the page to try again.</ReadFailureNotice></TaskPageShell>;
    return <DeveloperDashboard projectId={projectId} dashboard={dashboard} tasks={tasks} />;
  }

  let members: readonly ProjectMemberView[] | null;
  try { members = await composition.projectService.listMembers(projectId, access.personId); }
  catch { members = null; }

  return <ProjectDashboard projectId={projectId} role={access.role} dashboard={dashboard} members={members} />;
}
