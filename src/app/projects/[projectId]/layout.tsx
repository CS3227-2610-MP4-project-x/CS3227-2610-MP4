import type { ReactNode } from "react";
import { ProjectNavigation } from "@/components/project-navigation/project-navigation";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";

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
  const projectName = await readProjectName(composition, projectId, personId);
  return (
    <div className="text-neutral-100">
      <div className="mx-auto max-w-5xl px-5 pt-8 sm:px-8">
        {projectName !== null && <p className="project-nav-name">{projectName}</p>}
        <ProjectNavigation projectId={projectId} role={role} />
      </div>
      {children}
    </div>
  );
}

// F3: the project name above the tabs. A failed read omits the name and reveals nothing.
async function readProjectName(
  composition: ReturnType<typeof getServerComposition>,
  projectId: string,
  personId: string,
): Promise<string | null> {
  try {
    return (await composition.projectService.getProject(projectId, personId)).name;
  } catch {
    return null;
  }
}
