import type { ProjectView } from "@/server/projects";

/** A browser-only preference; membership is always resolved separately on the server. */
export function projectSelectionCookieName(accountId: string): string {
  const accountToken = accountId.toLowerCase().replaceAll("-", "");
  return `no-pressure-project-${accountToken}`;
}

/** The supplied project list is the authoritative membership-scoped order. */
export function selectRememberedProject(
  projects: readonly ProjectView[],
  rememberedId: string | undefined,
): ProjectView | undefined {
  return projects.find((project) => project.id === rememberedId) ?? projects[0];
}

export function projectSwitchHref(
  projectId: string,
  role: ProjectView["role"],
  section: string | null,
): string {
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  if (section === "board" || section === "dashboard") return `${projectPath}/${section}`;
  if (role === "product_manager" && (section === "review-queue" || section === "settings")) {
    return `${projectPath}/${section}`;
  }
  return `${projectPath}/dashboard`;
}
