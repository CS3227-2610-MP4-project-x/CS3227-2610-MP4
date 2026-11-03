import type { NextRequest } from "next/server";
import { handleTaskStateStub } from "@/server/auth/project-authorization";
import { getServerComposition } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskStateStub(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
