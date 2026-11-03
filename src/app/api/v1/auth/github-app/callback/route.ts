import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import {
  GitHubRepositoryLinkError,
  githubRepositoryLinkCookieName,
  githubRepositoryLinkErrorResponse,
  verifiedGitHubIdentity,
} from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  let composition: ReturnType<typeof getServerComposition>;
  try { composition = getServerComposition(); } catch (error) { return githubRepositoryLinkErrorResponse(error); }

  const cookieStore = await cookies();
  const name = githubRepositoryLinkCookieName();
  const stateCookie = cookieStore.get(name)?.value ?? "";
  cookieStore.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: composition.config.appOrigin.startsWith("https://"),
    path: "/api/v1/auth/github-app/callback",
    maxAge: 0,
  });

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const denied = request.nextUrl.searchParams.has("error");
  if (denied || !code || !state || !stateCookie) return githubRepositoryLinkErrorResponse(new GitHubRepositoryLinkError(400));

  try {
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return githubRepositoryLinkErrorResponse(new GitHubRepositoryLinkError(401));
    const identity = verifiedGitHubIdentity(data.user);
    const location = await composition.githubRepositoryLinkService.completeSetupAuthorization(identity, stateCookie, state, code);
    const response = NextResponse.redirect(location, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return githubRepositoryLinkErrorResponse(error);
  }
}
