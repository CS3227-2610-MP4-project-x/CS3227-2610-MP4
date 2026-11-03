import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubRepositoryLinkErrorResponse, isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ projectId: string; snapshotId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    const { projectId, snapshotId } = await context.params;
    if (!isValidProjectId(projectId) || !isValidProjectId(snapshotId)) return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const repositories = await composition.githubRepositoryLinkService.readSnapshot(projectId, snapshotId, verifiedGitHubIdentity(data.user));
    return Response.json({ repositories: repositories.map(({ repositoryId, owner, name, isPrivate, defaultBranch }) => ({ repositoryId, owner, name, private: isPrivate, defaultBranch })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return githubRepositoryLinkErrorResponse(error); }
}
