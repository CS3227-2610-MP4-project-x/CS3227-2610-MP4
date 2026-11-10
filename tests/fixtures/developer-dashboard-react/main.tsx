import { createRoot } from "react-dom/client";
import { ProjectNavigation } from "../../../src/components/project-navigation/project-navigation";
import { DeveloperDashboard } from "../../../src/components/project-dashboard/developer-dashboard";
import { EmptyDashboard } from "../../../src/components/project-dashboard/empty-dashboard";
import { ProjectDashboard } from "../../../src/components/project-dashboard/project-dashboard";
import { developerDashboard, developerIdentity, developerProjectId, developerTasks } from "../developer-dashboard";
import "../../../src/app/globals.css";
const url = new URL(window.location.href);
const empty = url.searchParams.get("empty") === "1";
const projects = [
  { id: developerProjectId, key: "ALP", name: "Synthetic Alpha", role: "developer" as const },
  { id: "49000000-0000-4000-8000-000000000002", key: "BET", name: "Synthetic Beta", role: "product_manager" as const },
];
const selected = projects.find(project => url.pathname.startsWith(`/projects/${project.id}/`)) ?? projects[0];
const dashboard = empty ? { ...developerDashboard(), totalTasks: 0, completedTasks: 0, progressPercent: 0 } : developerDashboard();
createRoot(document.getElementById("root")!).render(url.searchParams.get("no-projects") === "1"
  ? <EmptyDashboard identity={developerIdentity} />
  : <>
    <div className="project-navigation-shell"><div className="px-5 sm:px-8"><div className="mx-auto max-w-7xl"><ProjectNavigation projectId={selected.id} role={selected.role} projects={projects} accountId="synthetic-account" identity={developerIdentity} /></div></div></div>
    {selected.role === "product_manager"
      ? <ProjectDashboard projectId={selected.id} role={selected.role} dashboard={dashboard} members={[]} />
      : <DeveloperDashboard projectId={selected.id} dashboard={dashboard} tasks={empty ? [] : developerTasks()} />}
  </>);
