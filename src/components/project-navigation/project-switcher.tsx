"use client";

import { useEffect } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { PendingLink } from "@/components/ui/pending-link";
import type { ProjectView } from "@/server/projects";
import { projectSelectionCookieName, projectSwitchHref } from "@/lib/project-selection";

type Props = Readonly<{
  projectId: string;
  projects: readonly ProjectView[];
  accountId: string;
}>;

function rememberProject(accountId: string, projectId: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${projectSelectionCookieName(accountId)}=${encodeURIComponent(projectId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // This preference improves the next visit; navigation must still succeed when storage fails.
  }
}

export function ProjectSwitcher({ projectId, projects, accountId }: Props) {
  const section = useSelectedLayoutSegment();
  const selected = projects.find((project) => project.id === projectId);

  useEffect(() => {
    rememberProject(accountId, projectId);
  }, [accountId, projectId]);

  return <details className="project-switcher">
    <summary aria-label={`Switch project. Current project: ${selected?.name ?? "Selected project"}`}>
      <span className="project-switcher-mark" aria-hidden="true">▱</span>
      <span className="project-switcher-name">{selected?.name ?? "Selected project"}</span>
      <span className="project-switcher-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="project-switcher-menu">
      <p className="project-switcher-heading">Your projects</p>
      {projects.length > 0 ? <ul>
        {projects.map((project) => <li key={project.id}>
          <PendingLink href={projectSwitchHref(project.id, project.role, section)}
            aria-current={project.id === projectId ? "page" : undefined}
            onClick={() => rememberProject(accountId, project.id)}>
            <span className="project-switcher-option-name">{project.name}</span>
            <span className="project-switcher-option-meta">{project.key} · {project.role === "product_manager" ? "Product manager" : "Developer"}</span>
          </PendingLink>
        </li>)}
      </ul> : <p className="project-switcher-empty">No projects available.</p>}
      <PendingLink className="project-switcher-create" href="/projects/new">
        <span className="project-switcher-create-icon" aria-hidden="true">+</span> Create project
      </PendingLink>
    </div>
  </details>;
}
