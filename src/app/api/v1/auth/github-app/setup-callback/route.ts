import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubRepositoryLinkErrorResponse, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const composition = getServerComposition();
    const installationId = request.nextUrl.searchParams.get("installation_id") ?? "";
    const state = request.nextUrl.searchParams.get("state") ?? "";
    if (!/^[1-9]\d{0,18}$/.test(installationId) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
      return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const authorization = await composition.githubRepositoryLinkService.beginOAuthFromSetup(
      verifiedGitHubIdentity(data.user), state, installationId,
    );
    const cookieStore = await cookies();
    cookieStore.set("github_app_link_state", authorization.oauthState, {
      httpOnly: true, sameSite: "lax", secure: composition.config.appOrigin.startsWith("https://"),
      path: "/api/v1/auth/github-app/callback", maxAge: 600,
    });
    const response = NextResponse.redirect(authorization.authorizationUrl, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return githubRepositoryLinkErrorResponse(error); }
}
