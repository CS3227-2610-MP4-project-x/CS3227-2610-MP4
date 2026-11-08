import Link from "next/link";
import { AccountControl } from "@/components/auth/account-control";
import { requireWorkspaceSession } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { readMyProjects, type ProjectView } from "@/server/projects";

export const dynamic = "force-dynamic";

const ROLE_NAMES: Readonly<Record<ProjectView["role"], string>> = {
  product_manager: "Product manager",
  developer: "Developer",
};

export default async function Home() {
  const composition = getServerComposition();
  const { authUserId, profile } = await requireWorkspaceSession(composition.config);
  // design.md B3: null means the read failed; the page shows a safe message in place of the list.
  const projects = await readMyProjects(composition.peopleRepository, composition.projectService, authUserId);

  return (
    <main className="workspace-page">
      <div className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-brand">
            <span className="brand-mark" aria-hidden="true">C</span>
            <div>
              <p className="workspace-kicker">CS3227 · PROJECT SPACE</p>
              <h1>Workspace</h1>
            </div>
          </div>
          <AccountControl githubUsername={profile.githubUsername} avatarUrl={profile.avatarUrl} />
        </header>

        <nav className="workspace-nav" aria-label="Main navigation">
          <Link className="workspace-nav-link workspace-nav-link-active" href="/" aria-current="page">Dashboard</Link>
          <span className="workspace-nav-link workspace-nav-link-disabled" aria-disabled="true">Board</span>
        </nav>

        <section className="workspace-welcome" aria-labelledby="welcome-title">
          <div className="welcome-copy">
            <p className="workspace-kicker">YOUR PROJECT, IN ONE PLACE</p>
            <h2 id="welcome-title">Good to have you here, {profile.githubUsername}.</h2>
            <p>Your signed-in workspace is ready. Project tasks and progress will appear here.</p>
          </div>
          <div className="workspace-status" aria-label="Session active">
            <span className="status-dot" />
            Session active
          </div>
        </section>

        <section className="workspace-projects" aria-labelledby="my-projects-title">
          <p className="workspace-kicker">YOUR PROJECTS</p>
          <h2 id="my-projects-title">My projects</h2>
          {projects === null ? (
            <p className="workspace-projects-message" role="alert">Your projects could not be loaded. Reload the page to try again.</p>
          ) : projects.length === 0 ? (
            <p className="workspace-projects-message">You are not a member of any projects yet.</p>
          ) : (
            <ul className="workspace-project-list">
              {projects.map((project) => (
                <li key={project.id} className="workspace-project">
                  <div className="workspace-project-copy">
                    <span className="workspace-project-name">{project.name}</span>
                    <span className="workspace-project-meta">{project.key} · {ROLE_NAMES[project.role]}</span>
                  </div>
                  <Link className="workspace-project-link" href={`/projects/${encodeURIComponent(project.id)}/board`}>Open board</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="workspace-placeholder" aria-label="Project overview">
          <div className="placeholder-heading">
            <div>
              <p className="workspace-kicker">PROJECT OVERVIEW</p>
              <h2>Project Progress</h2>
            </div>
            <span className="placeholder-chip">Getting started</span>
          </div>
          <p className="placeholder-description">Your project summary will show here once a project is available.</p>
          <div className="placeholder-track" aria-hidden="true"><span /></div>
          <div className="placeholder-footnote">
            <span>Tasks completed</span>
            <span>Progress will appear here</span>
          </div>
        </section>
      </div>
    </main>
  );
}
