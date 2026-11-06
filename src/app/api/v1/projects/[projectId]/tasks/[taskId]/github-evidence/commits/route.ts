import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { githubEvidenceErrorResponse } from "@/server/github-evidence";
import { isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status: number) => Response.json({ error: { code: status === 401 ? "UNAUTHENTICATED" : "INVALID_REQUEST", message: status === 401 ? "Authentication required" : "Invalid request" } }, { status, headers: { "Cache-Control": "no-store" } });
const allowed = new Set(["since", "until", "branch", "page", "perPage"]);

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; taskId: string }> }): Promise<Response> {
  try {
    const composition = getServerComposition();
    const { projectId, taskId } = await context.params;
    if (!isValidProjectId(projectId) || !UUID.test(taskId)) return fail(400);
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => !allowed.has(key)) || [...allowed].some((key) => params.getAll(key).length > 1)) return fail(400);
    const int = (name: "page" | "perPage") => {
      const value = params.get(name);
      if (value === null) return undefined;
      if (!/^[1-9]\d*$/.test(value)) return Number.NaN;
      return Number(value);
    };
    const page = int("page"); const perPage = int("perPage");
    if (Number.isNaN(page) || Number.isNaN(perPage)) return fail(400);
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return fail(401);
    const result = await composition.githubEvidenceService.listCommits(projectId, taskId, verifiedGitHubIdentity(data.user), {
      since: params.get("since") ?? undefined, until: params.get("until") ?? undefined,
      branch: params.get("branch") ?? undefined, page, perPage,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return githubEvidenceErrorResponse(error); }
}
