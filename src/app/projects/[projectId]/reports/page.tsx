import { notFound } from "next/navigation";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { ProjectError } from "@/server/projects";
import { ProgressReport } from "@/components/progress-report";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  if (access.role !== "product_manager") {
    return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8">
      <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
        <h1 className="text-2xl font-semibold">Progress Reports</h1>
        <p role="status" className="mt-3 text-sm text-neutral-300">This page is available to the product manager.</p>
      </div>
    </main>;
  }

  let initialDate: string;
  let members;
  try {
    initialDate = await composition.projectAiUsageService.readCurrentSgtDate();
    members = await composition.projectService.listMembers(projectId, access.personId);
  } catch (error) {
    if (error instanceof ProjectError && error.code === "NOT_FOUND") notFound();
    return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8">
      <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
        <h1 className="text-2xl font-semibold">Progress Reports</h1>
        <p role="alert" className="mt-3 text-sm text-amber-200">Report data is unavailable. Reload this page to try again.</p>
      </div>
    </main>;
  }

  return <ProgressReport projectId={projectId} initialStartDate={initialDate} initialEndDate={initialDate} members={members} />;
}
