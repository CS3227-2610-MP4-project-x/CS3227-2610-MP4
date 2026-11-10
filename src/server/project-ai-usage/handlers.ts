import "server-only";

import { ProjectAiUsageError } from "./errors";
import type { ProjectAiUsageService } from "./types";

const NO_STORE = { "Cache-Control": "no-store" };
const ERRORS = {
  INVALID_REQUEST: { status: 400, message: "Invalid request" },
  UNAUTHENTICATED: { status: 401, message: "Authentication required" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(code: keyof typeof ERRORS): Response {
  const detail = ERRORS[code];
  return Response.json({ error: { code, message: detail.message } }, { status: detail.status, headers: NO_STORE });
}

function dateQuery(request: Request): { startDate?: string; endDate?: string } | Response {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((key) => key !== "startDate" && key !== "endDate")) return errorResponse("INVALID_REQUEST");
  const starts = params.getAll("startDate");
  const ends = params.getAll("endDate");
  if (starts.length > 1 || ends.length > 1 || (starts.length === 0) !== (ends.length === 0)) {
    return errorResponse("INVALID_REQUEST");
  }
  if (starts.length === 0) return {};
  const startDate = starts[0];
  const endDate = ends[0];
  if (startDate === undefined || endDate === undefined) return errorResponse("INVALID_REQUEST");
  return { startDate, endDate };
}

export function createProjectAiUsageHandler(deps: {
  appOrigin: string;
  resolveAccess(projectId: string): Promise<{ personId: string; role: "product_manager" | "developer" } | Response>;
  service: ProjectAiUsageService;
}) {
  return async (request: Request, projectId: string): Promise<Response> => {
    if (!UUID.test(projectId)) return errorResponse("INVALID_REQUEST");
    const range = dateQuery(request);
    if (range instanceof Response) return range;

    let access: Awaited<ReturnType<typeof deps.resolveAccess>>;
    try {
      access = await deps.resolveAccess(projectId);
    } catch {
      return errorResponse("INTERNAL_ERROR");
    }
    if (access instanceof Response) return access;
    if (access.role !== "product_manager") return errorResponse("FORBIDDEN");

    try {
      const result = await deps.service.readProjectUsage({ projectId, actorId: access.personId, range });
      return Response.json(result, { status: 200, headers: NO_STORE });
    } catch (error) {
      if (error instanceof ProjectAiUsageError) return errorResponse(error.code);
      return errorResponse("INTERNAL_ERROR");
    }
  };
}
