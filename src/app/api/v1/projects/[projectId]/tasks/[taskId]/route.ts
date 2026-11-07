import type { NextRequest } from "next/server";
import { handleTaskEditStub } from "@/server/auth/project-authorization";
import { getServerComposition } from "@/server/composition";
import { handleTaskDetailRead } from "@/server/task-detail";
import { handleTaskDelete } from "@/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// design.md M1: task reads use the Group 7.3 task-detail read.
export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskDetailRead(request, context, getServerComposition());
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

// design.md T1, T16: soft delete calls the tasks module directly.
export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    return await handleTaskDelete(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
