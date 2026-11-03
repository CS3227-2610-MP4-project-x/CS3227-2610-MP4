import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubEvidenceErrorResponse } from "@/server/github-evidence";
import { isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    const { projectId, taskId } = await context.params;
    if (!isValidProjectId(projectId) || !UUID.test(taskId) || request.headers.get("origin") !== composition.config.appOrigin ||
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return invalid();
    let body: unknown;
    try { body = await request.json(); } catch { return invalid(); }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !Array.isArray((body as Record<string, unknown>).commitShas) || (body as { commitShas: unknown[] }).commitShas.length === 0 ||
      (body as { commitShas: unknown[] }).commitShas.some((sha) => typeof sha !== "string" || !/^[0-9a-f]{7,64}$/i.test(sha))) return invalid();
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const result = await composition.githubEvidenceService.attachCommits(projectId, taskId, verifiedGitHubIdentity(data.user), (body as { commitShas: string[] }).commitShas);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return githubEvidenceErrorResponse(error); }
}
