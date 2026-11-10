import { resolveProjectAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { createProjectAiUsageHandler } from "@/server/project-ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const composition = getServerComposition();
  const handler = createProjectAiUsageHandler({
    appOrigin: composition.config.appOrigin,
    resolveAccess: (projectId) => resolveProjectAccess(composition, projectId),
    service: composition.projectAiUsageService,
  });
  const { projectId } = await context.params;
  return handler(request, projectId);
}
