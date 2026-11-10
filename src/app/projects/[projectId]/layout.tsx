import type { ReactNode } from "react";
import { ProjectNavigation } from "@/components/project-navigation/project-navigation";
import { requireProjectPageAccess, requireWorkspaceSession } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { readMyProjects, type ProjectView } from "@/server/projects";

// design.md B4 and handoff assumption A4: the shared project navigation above every project page.
// The role only chooses which tabs to show; each page still checks access itself (B2). Page height
// and background belong to the pages (F2).
export default async function ProjectLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const { personId, role } = await requireProjectPageAccess(composition, projectId);
  const { authUserId, profile } = await requireWorkspaceSession(composition.config);
  const [currentProject, membershipProjects] = await Promise.all([
    readProject(composition, projectId, personId),
    readMyProjects(composition.peopleRepository, composition.projectService, authUserId),
  ]);
  // If the full list read fails, retain the membership-checked current project in the selector.
  const projects = membershipProjects ?? (currentProject ? [currentProject] : []);
  return (
    <div className="text-neutral-100">
      <div className="project-navigation-shell">
        <div className="px-5 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <ProjectNavigation projectId={projectId} role={role} projects={projects} accountId={authUserId} identity={profile} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

// Preserve a membership-checked current-project option if the full membership list is unavailable.
async function readProject(
  composition: ReturnType<typeof getServerComposition>,
  projectId: string,
  personId: string,
): Promise<ProjectView | null> {
  try {
    return await composition.projectService.getProject(projectId, personId);
  } catch {
    return null;
  }
}
