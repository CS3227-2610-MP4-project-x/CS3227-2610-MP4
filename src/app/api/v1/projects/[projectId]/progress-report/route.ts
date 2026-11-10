import "server-only";

import { resolveProjectAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { createProgressReportHandlers } from "@/server/progress-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const composition = getServerComposition();
  const handlers = createProgressReportHandlers({
    config: composition.config,
    resolveAccess: (projectId) => resolveProjectAccess(composition, projectId),
    progressReportGenerationService: composition.progressReportGenerationService,
  });
  return handlers.postProgressReport(request, await context.params);
}
