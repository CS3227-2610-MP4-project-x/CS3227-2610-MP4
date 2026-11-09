import { notFound, redirect } from "next/navigation";
import { ProjectDashboard } from "@/components/project-dashboard";
import { ReadFailureNotice, TaskPageShell } from "@/components/tasks/task-page-parts";
import { requireProjectPageAccess } from "@/server/auth";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getVerifiedGitHubProfile } from "@/server/auth/session-identity";
import { getServerComposition } from "@/server/composition";
import type { ProjectDashboardView } from "@/server/project-dashboard";
import type { ProjectMemberView } from "@/server/projects";

export const dynamic = "force-dynamic";

export default async function ProjectDashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  const profile = await getVerifiedGitHubProfile(await createRequestSupabaseClient(composition.config));
  if (!profile) redirect("/sign-in");

  let dashboard: ProjectDashboardView;
  try {
    dashboard = await composition.projectDashboardService.getDashboard(projectId, access.personId);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "NOT_FOUND") notFound();
    return <TaskPageShell crumb="Dashboard"><ReadFailureNotice>The project dashboard could not be loaded. Reload the page to try again.</ReadFailureNotice></TaskPageShell>;
  }

  let members: readonly ProjectMemberView[] | null | undefined;
  if (access.role === "product_manager") {
    try { members = await composition.projectService.listMembers(projectId, access.personId); }
    catch { members = null; }
  }

  return <ProjectDashboard projectId={projectId} role={access.role} identity={profile} dashboard={dashboard} members={members} />;
}
