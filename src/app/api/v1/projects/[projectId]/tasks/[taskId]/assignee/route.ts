import type { NextRequest } from "next/server";
import { getServerComposition } from "@/server/composition";
import { handleTaskReassign } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// design.md T1, T9, T16: the product manager reassigns a task.
export async function PUT(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskReassign(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
