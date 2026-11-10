import Link from "next/link";
import { notFound } from "next/navigation";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { verifiedGitHubIdentity } from "@/server/github-repository-link";
import { ProjectRepositorySettings } from "@/components/github-repository/project-repository-settings";
import { MembersSettings } from "@/components/projects";
import { ProjectError, type ProjectMemberView } from "@/server/projects";
import { ProjectAiUsage } from "@/components/project-ai-usage";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ githubSnapshot?: string }>;
}) {
  const { projectId } = await params;
  const { githubSnapshot } = await searchParams;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  let usageToday: string | null = null;
  if (access.role === "product_manager") {
    try { usageToday = await composition.projectAiUsageService.readCurrentSgtDate(); }
    catch { /* Keep the usage panel unavailable when the server SGT clock cannot be read. */ }
  }
  let bindingState: { kind: "linked"; binding: { owner: string; name: string } } | { kind: "unlinked" } | { kind: "unavailable" } = { kind: "unavailable" };
  try {
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (!error && data.user) {
      const binding = await composition.githubRepositoryLinkService.readProjectBinding(projectId, verifiedGitHubIdentity(data.user));
      bindingState = binding ? { kind: "linked", binding: { owner: binding.owner, name: binding.name } } : { kind: "unlinked" };
    }
  } catch { /* The panel provides a safe retry state when session or project access is unavailable. */ }
  let members: readonly ProjectMemberView[] | null = null;
  let membersUnavailable = false;
  if (access.role === "product_manager") {
    try { members = await composition.projectService.listMembers(projectId, access.personId); }
    catch (error) {
      if (error instanceof ProjectError && error.code === "NOT_FOUND") notFound();
      if (error instanceof ProjectError && error.code === "FORBIDDEN") membersUnavailable = true;
    }
  }
  return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8"><div className="mx-auto max-w-5xl">
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-neutral-400"><Link href="/" className="hover:text-white">Workspace</Link><span aria-hidden="true"> / </span><span>Project settings</span></nav>
    <h1 className="mb-6 text-3xl font-semibold tracking-tight">Project settings</h1>
    {access.role === "product_manager" ? membersUnavailable
      ? <section aria-labelledby="project-members-heading" className="mb-6 rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
          <h2 id="project-members-heading" className="text-2xl font-semibold tracking-tight">Members</h2>
          <p role="status" className="mt-3 text-sm text-neutral-300">Members are unavailable because project manager access could not be confirmed.</p>
        </section>
      : members === null
      ? <section aria-labelledby="project-members-heading" className="mb-6 rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
          <h2 id="project-members-heading" className="text-2xl font-semibold tracking-tight">Members</h2>
          <p role="alert" className="mt-3 text-sm text-amber-200">Members could not be loaded. Reload Project Settings to try again.</p>
        </section>
      : <div className="mb-6"><MembersSettings projectId={projectId} members={members} /></div>
      : <section aria-labelledby="project-members-heading" className="mb-6 rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
          <h2 id="project-members-heading" className="text-xl font-semibold">Members</h2>
          <p role="status" className="mt-3 text-sm text-neutral-400">Members settings are available to the project manager.</p>
        </section>}
    <ProjectRepositorySettings projectId={projectId} snapshotId={githubSnapshot} initialBindingState={bindingState} />
    {access.role === "product_manager" && (usageToday
      ? <div className="mt-6"><ProjectAiUsage projectId={projectId} initialStartDate={usageToday} initialEndDate={usageToday} environment={composition.config.appEnvironment} /></div>
      : <section aria-labelledby="project-ai-usage-heading" className="mt-6 rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
          <h2 id="project-ai-usage-heading" className="text-2xl font-semibold tracking-tight">AI usage</h2>
          <p role="alert" className="mt-3 text-sm text-amber-200">Usage is unavailable because the current SGT date could not be loaded. Reload Project Settings to try again.</p>
        </section>)}
  </div></main>;
}
