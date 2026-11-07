import type { NextRequest } from "next/server";
import { getServerComposition } from "@/server/composition";
import { handleTaskStateChange } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
