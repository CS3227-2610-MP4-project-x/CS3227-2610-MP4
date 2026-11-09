import { redirect } from "next/navigation";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getVerifiedGitHubProfile } from "@/server/auth/session-identity";
import { getServerComposition } from "@/server/composition";

export const dynamic = "force-dynamic";

type SignInPageProps = Readonly<{
  searchParams: Promise<{ auth?: string | string[] }>;
}>;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  let hasSession = false;
  try {
    const { config } = getServerComposition();
    const client = await createRequestSupabaseClient(config);
    const profile = await getVerifiedGitHubProfile(client);
    hasSession = Boolean(profile);
  } catch {
    // Keep the public sign-in page available if local auth configuration is absent.
  }
  if (hasSession) redirect("/");

  const params = await searchParams;
  const hasAuthError = params.auth === "failed";

  return (
    <main className="sign-in-page">
      <div className="sign-in-shell">
        <header className="sign-in-brand">
          <span className="brand-mark" aria-hidden="true">NP</span>
          <span>NoPressure</span>
        </header>

        <section className="sign-in-card" aria-labelledby="sign-in-title">
          <p className="workspace-kicker">ACCOUNT ACCESS</p>
          <h1 id="sign-in-title">Your team workspace</h1>
          <p className="sign-in-description">
            Sign in with GitHub to access your projects and tasks.
          </p>

          {hasAuthError && (
            <p className="sign-in-error" role="alert">We couldn’t sign you in. Please try again.</p>
          )}

          <a className="github-sign-in-button" href="/api/v1/auth/sign-in">
            <svg className="github-mark" aria-hidden="true" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.05c-3.1.68-3.76-1.32-3.76-1.32-.5-1.29-1.24-1.63-1.24-1.63-1.02-.7.08-.69.08-.69 1.12.08 1.71 1.14 1.71 1.14 1 1.7 2.61 1.21 3.25.92.1-.72.4-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.53 0-1.22.44-2.22 1.15-3-.11-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.61 1.53.22 2.67.11 2.95.72.78 1.15 1.78 1.15 3 0 4.3-2.61 5.25-5.1 5.52.4.35.76 1.03.76 2.08V22c0 .29.2.63.77.53A11.1 11.1 0 0 0 12 .9Z" />
            </svg>
            <span>Continue with GitHub</span>
          </a>
          <p className="sign-in-note">Secure sign-in · Your GitHub identity stays private</p>
        </section>

        <footer className="sign-in-footer">
          <span>NoPressure</span>
          <span className="footer-dot" />
          <span>Built for focused collaboration</span>
        </footer>
      </div>
    </main>
  );
}
