import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubEvidenceErrorResponse } from "@/server/github-evidence";
import { isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status: number) => Response.json({ error: { code: status === 401 ? "UNAUTHENTICATED" : "INVALID_REQUEST", message: status === 401 ? "Authentication required" : "Invalid request" } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    const { projectId, taskId } = await context.params;
    if (!isValidProjectId(projectId) || !UUID.test(taskId)) return fail(400);
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return fail(401);
    const result = await composition.githubEvidenceService.listBranches(projectId, taskId, verifiedGitHubIdentity(data.user));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return githubEvidenceErrorResponse(error); }
}
