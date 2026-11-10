import type { NextRequest } from "next/server";
import { getServerComposition } from "@/server/composition";
import { handleProgressUpdateCreate } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// design.md "Task Lifecycle Decisions (4.3)" L4: the assigned developer posts a progress update.
export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleProgressUpdateCreate(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
