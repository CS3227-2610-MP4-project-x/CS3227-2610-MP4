import { redirect } from "next/navigation";
import Link from "next/link";
import { AccountControl } from "@/components/auth/account-control";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getVerifiedGitHubProfile } from "@/server/auth/session-identity";
import { getServerComposition } from "@/server/composition";

export const dynamic = "force-dynamic";

export default async function Home() {
  let profile = null;
  try {
    const { config } = getServerComposition();
    const client = await createRequestSupabaseClient(config);
    profile = await getVerifiedGitHubProfile(client);
  } catch {
    redirect("/sign-in");
  }

  if (!profile) redirect("/sign-in");

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
