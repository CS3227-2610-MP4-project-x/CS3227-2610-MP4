import type { NextRequest } from "next/server";
import { getServerComposition } from "@/server/composition";
import { handleTaskStateChange } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A submission looks up its commit tip on GitHub first, bounded by SUBMISSION_TIP_TIMEOUT_MS
// (60 s), then runs one short transaction. 150 s matches the acceptance-criteria-check route
// (design.md G11), leaving a wide margin.
export const maxDuration = 150;

// design.md "Task Lifecycle Decisions (4.3)" L1 to L7: a lifecycle transition.
export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskStateChange(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
