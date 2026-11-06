import type { NextRequest } from "next/server";
import { getServerComposition } from "@/server/composition";
import { handleProductManagerTransfer } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  try {
    return await handleProductManagerTransfer(request, context, getServerComposition());
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
