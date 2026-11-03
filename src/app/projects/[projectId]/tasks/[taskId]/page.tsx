import Link from "next/link";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { verifiedGitHubIdentity } from "@/server/github-repository-link";
import { CommitPicker } from "@/components/github-evidence/commit-picker";

export const dynamic = "force-dynamic";

export default async function TaskEvidencePage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { projectId, taskId } = await params;
  let task: { taskKey: string; title: string } | null = null;
  try {
    const composition = getServerComposition();
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (!error && data.user) task = await composition.githubEvidenceService.getTaskIdentity(
      projectId, taskId, verifiedGitHubIdentity(data.user),
    );
  } catch { /* Keep authorization and provider details out of this minimal host page. */ }

  return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm text-neutral-400"><Link href="/" className="hover:text-white">Workspace</Link><span aria-hidden="true"> / </span><span>Task evidence</span></nav>
      <h1 className="text-3xl font-semibold tracking-tight">{task ? task.title : "Task evidence"}</h1>
      {task ? <>
        <p className="mt-2 text-sm text-neutral-400">{task.taskKey} · Attach commits authored by your verified GitHub account.</p>
        <section aria-labelledby="commit-evidence-heading" className="mt-8 rounded-2xl border border-white/10 bg-[#222] p-6">
          <h2 id="commit-evidence-heading" className="text-lg font-semibold">Commit evidence</h2>
          <p className="mt-1 text-sm text-neutral-400">Choose your commits from the project repository and attach them to this task.</p>
          <div className="mt-5"><CommitPicker projectId={projectId} taskId={taskId} /></div>
        </section>
      </> : <p role="status" className="mt-4 max-w-xl rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-neutral-300">This task is unavailable or you are not its assigned developer.</p>}
    </div>
  </main>;
}
