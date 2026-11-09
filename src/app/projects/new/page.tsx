import Link from "next/link";
import { CreateProjectForm } from "@/components/projects";
import { requireWorkspaceSession } from "@/server/auth";
import { getServerComposition } from "@/server/composition";

export const dynamic = "force-dynamic";

export default async function CreateProjectPage() {
  const composition = getServerComposition();
  await requireWorkspaceSession(composition.config);
  return (
    <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-neutral-400">
          <Link href="/" className="hover:text-white">Workspace</Link><span aria-hidden="true"> / </span><span>Create project</span>
        </nav>
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-neutral-400">New workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create project</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">Choose a project key and name. You will become its product manager.</p>
        </header>
        <CreateProjectForm />
      </div>
    </main>
  );
}
