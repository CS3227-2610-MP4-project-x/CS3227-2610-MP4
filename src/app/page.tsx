import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyDashboard } from "@/components/project-dashboard";
import { projectSelectionCookieName, projectSwitchHref, selectRememberedProject } from "@/lib/project-selection";
import { requireWorkspaceSession } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { readMyProjects } from "@/server/projects";

export const dynamic = "force-dynamic";

export default async function Home() {
  const composition = getServerComposition();
  const { authUserId, profile } = await requireWorkspaceSession(composition.config);
  const projects = await readMyProjects(composition.peopleRepository, composition.projectService, authUserId);

  if (projects === null) {
    return <main className="workspace-page">
      <div className="workspace-shell">
        <p className="workspace-projects-message" role="alert">Your projects could not be loaded. Reload the page to try again.</p>
      </div>
    </main>;
  }

  if (projects.length > 0) {
    let rememberedId: string | undefined;
    try {
      rememberedId = (await cookies()).get(projectSelectionCookieName(authUserId))?.value;
    } catch {
      // A browser preference is optional; membership order supplies a safe fallback.
    }
    const selected = selectRememberedProject(projects, rememberedId);
    if (selected) redirect(projectSwitchHref(selected.id, selected.role, "dashboard"));
  }

  return <EmptyDashboard identity={profile} />;
}
