import type { NextRequest } from "next/server";
import { handleTaskEditStub, handleTaskReadStub } from "@/server/auth/project-authorization";
import { getServerComposition } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskReadStub(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskEditStub(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
