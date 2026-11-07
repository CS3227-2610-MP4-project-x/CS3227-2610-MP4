import { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { CompletionAssessmentError } from "@/server/completion-assessment";
import { githubRepositoryLinkErrorResponse, isValidProjectId, verifiedGitHubIdentity } from "@/server/github-repository-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const INVALID_REQUEST = { error: { code: "INVALID_REQUEST", message: "Invalid request" } };

function invalidRequest(): Response {
  return Response.json(INVALID_REQUEST, { status: 400, headers: NO_STORE });
}

function safeError(code: string, status: number, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

const SERVICE_ERRORS: Readonly<Record<string, Readonly<{ status: number; message: string }>>> = {
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  CHECK_REQUIRES_COMMITS: { status: 409, message: "Attach commits before running an acceptance criteria check" },
  INCOMPARABLE_COMMIT_TIPS: { status: 409, message: "Select commits with one common descendant tip" },
  EVIDENCE_UNAVAILABLE: { status: 503, message: "GitHub evidence is unavailable" },
  INVALID_OUTPUT: { status: 502, message: "The assessment returned invalid output" },
  RATE_LIMITED: { status: 429, message: "Too many AI requests" },
  QUOTA_EXCEEDED: { status: 429, message: "AI usage quota exceeded" },
  AI_UNAVAILABLE: { status: 503, message: "AI service is unavailable" },
  AI_ERROR: { status: 502, message: "AI assessment failed" },
};

function serviceErrorResponse(error: unknown): Response {
  if (error instanceof CompletionAssessmentError) {
    return safeError(error.code, error.status, error.message);
  }

  // Snapshot authorization errors use the same stable error codes and safe messages,
  // but are owned by the task snapshot service rather than the assessment service.
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    const mapped = SERVICE_ERRORS[error.code];
    if (mapped) return safeError(error.code, mapped.status, mapped.message);
  }

  return safeError("INTERNAL_ERROR", 500, "Internal server error");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; taskId: string }> },
): Promise<Response> {
  try {
    const composition = getServerComposition();
    const { projectId, taskId } = await context.params;
    if (!isValidProjectId(projectId) || !TASK_ID.test(taskId) ||
      request.headers.get("origin") !== composition.config.appOrigin ||
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return invalidRequest();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidRequest();
    }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
      return invalidRequest();
    }

    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return safeError("UNAUTHENTICATED", 401, "Authentication required");

    let identity;
    try {
      identity = verifiedGitHubIdentity(data.user);
    } catch (identityError) {
      return githubRepositoryLinkErrorResponse(identityError);
    }

    const result = await composition.completionAssessmentService.runCheck(projectId, taskId, identity);
    return Response.json(result, { status: 200, headers: NO_STORE });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
