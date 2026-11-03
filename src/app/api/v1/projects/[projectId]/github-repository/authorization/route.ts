import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import {
  GitHubRepositoryLinkError,
  githubRepositoryLinkCookieName,
  githubRepositoryLinkErrorResponse,
  isRepositorySelection,
  isValidProjectId,
  STATE_TTL_SECONDS,
  verifiedGitHubIdentity,
} from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    if (request.headers.get("origin") !== composition.config.appOrigin) {
      return githubRepositoryLinkErrorResponse(new GitHubRepositoryLinkError(400));
    }
    let body: unknown;
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      body = await request.json();
    } catch {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const { projectId } = await context.params;
    if (!isValidProjectId(projectId) || !isRepositorySelection(body)) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      return Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const identity = verifiedGitHubIdentity(data.user);
    const authorization = await composition.githubRepositoryLinkService.startAuthorization(projectId, identity, body);
    const cookieStore = await cookies();
    cookieStore.set(githubRepositoryLinkCookieName(), authorization.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: composition.config.appOrigin.startsWith("https://"),
      path: "/api/v1/auth/github-app/callback",
      maxAge: STATE_TTL_SECONDS,
    });
    return Response.json({ authorizationUrl: authorization.authorizationUrl }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return githubRepositoryLinkErrorResponse(error);
  }
}
