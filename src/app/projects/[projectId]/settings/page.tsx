import Link from "next/link";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { verifiedGitHubIdentity } from "@/server/github-repository-link";
import { ProjectRepositorySettings } from "@/components/github-repository/project-repository-settings";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ githubSnapshot?: string }>;
}) {
  const { projectId } = await params;
  const { githubSnapshot } = await searchParams;
  let bindingState: { kind: "linked"; binding: { owner: string; name: string } } | { kind: "unlinked" } | { kind: "unavailable" } = { kind: "unavailable" };
  try {
    const composition = getServerComposition();
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (!error && data.user) {
      const binding = await composition.githubRepositoryLinkService.readProjectBinding(projectId, verifiedGitHubIdentity(data.user));
      bindingState = binding ? { kind: "linked", binding: { owner: binding.owner, name: binding.name } } : { kind: "unlinked" };
    }
  } catch { /* The panel provides a safe retry state when session or project access is unavailable. */ }
  return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8"><div className="mx-auto max-w-5xl">
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-neutral-400"><Link href="/" className="hover:text-white">Workspace</Link><span aria-hidden="true"> / </span><span>Project settings</span></nav>
    <h1 className="mb-6 text-3xl font-semibold tracking-tight">Project settings</h1>
    <ProjectRepositorySettings projectId={projectId} snapshotId={githubSnapshot} initialBindingState={bindingState} />
  </div></main>;
}
