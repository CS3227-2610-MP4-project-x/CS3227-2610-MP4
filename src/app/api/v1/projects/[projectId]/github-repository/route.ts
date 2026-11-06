import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubRepositoryLinkErrorResponse, isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    if (request.headers.get("origin") !== composition.config.appOrigin || request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const { projectId } = await context.params;
    if (!isValidProjectId(projectId)) return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "snapshotId") || !Object.hasOwn(body, "repositoryId") ||
      typeof (body as Record<string, unknown>).snapshotId !== "string" || !isValidProjectId((body as Record<string, string>).snapshotId) ||
      !Number.isSafeInteger((body as Record<string, unknown>).repositoryId) || Number((body as Record<string, unknown>).repositoryId) <= 0) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    await composition.githubRepositoryLinkService.linkSnapshotRepository(projectId,
      (body as { snapshotId: string }).snapshotId, (body as { repositoryId: number }).repositoryId,
      verifiedGitHubIdentity(data.user));
    return Response.json({ linked: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return githubRepositoryLinkErrorResponse(error); }
}
