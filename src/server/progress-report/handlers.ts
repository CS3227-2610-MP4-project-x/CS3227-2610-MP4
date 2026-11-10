import "server-only";

import { refuseUnsafeMutation } from "@/server/projects";
import { resolveReportRange } from "./input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const ERRORS: Readonly<Record<string, { status: number; message: string }>> = {
  UNAUTHENTICATED: { status: 401, message: "Authentication required" },
  INVALID_REQUEST: { status: 400, message: "Invalid request" },
  REPORT_RANGE_TOO_LONG: { status: 400, message: "Choose a range of seven days or fewer" },
  REPORT_INPUT_BUDGET_EXCEEDED: { status: 400, message: "Choose a shorter range to fit the report input limit" },
  REPORT_INPUT_CHANGED: { status: 409, message: "Report input changed during generation; retry the request" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_OUTPUT: { status: 502, message: "The report returned invalid output" },
  RATE_LIMITED: { status: 429, message: "Too many AI requests" },
  QUOTA_EXCEEDED: { status: 429, message: "AI usage quota exceeded" },
  AI_UNAVAILABLE: { status: 503, message: "AI service is unavailable" },
  AI_ERROR: { status: 502, message: "AI report generation failed" },
};

function errorResponse(code: string, resetsAt?: string): Response {
  const safe = ERRORS[code] ?? ERRORS.INTERNAL_ERROR;
  const safeCode = ERRORS[code] ? code : "INTERNAL_ERROR";
  return Response.json({ error: { code: safeCode, message: safe.message, ...(safeCode === "QUOTA_EXCEEDED" && resetsAt ? { resetsAt } : {}) } }, { status: safe.status, headers: NO_STORE });
}

export type ProgressReportHandlersOptions = Readonly<{
  config: Readonly<{ appOrigin: string }>;
  resolveAccess(projectId: string): Promise<{ personId: string; role: "product_manager" | "developer" } | Response>;
  progressReportGenerationService: Readonly<{ generate(request: { projectId: string; personId: string; startDate?: string; endDate?: string }): Promise<unknown> }>;
}>;

export function createProgressReportHandlers(options: ProgressReportHandlersOptions) {
  return {
    async postProgressReport(request: Request, params: { projectId: string }): Promise<Response> {
      const unsafe = refuseUnsafeMutation(request, options.config.appOrigin);
      if (unsafe) return unsafe;
      if (!UUID.test(params.projectId)) return errorResponse("INVALID_REQUEST");
      let body: unknown;
      try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST"); }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return errorResponse("INVALID_REQUEST");
      const record = body as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (!(keys.length === 0 || (keys.length === 2 && keys[0] === "endDate" && keys[1] === "startDate"))) return errorResponse("INVALID_REQUEST");
      let rangeInput: { startDate?: string; endDate?: string } = {};
      if (keys.length === 2) {
        if (typeof record.startDate !== "string" || typeof record.endDate !== "string") return errorResponse("INVALID_REQUEST");
        rangeInput = { startDate: record.startDate, endDate: record.endDate };
        const range = resolveReportRange(rangeInput, "2000-01-01");
        if (range.kind === "invalid_range") return errorResponse("INVALID_REQUEST");
        if (range.kind === "range_too_long") return errorResponse("REPORT_RANGE_TOO_LONG");
      }
      let access: Awaited<ReturnType<ProgressReportHandlersOptions["resolveAccess"]>>;
      try { access = await options.resolveAccess(params.projectId); } catch { return errorResponse("INTERNAL_ERROR"); }
      if (access instanceof Response) return access;
      if (access.role !== "product_manager") return errorResponse("FORBIDDEN");
      try {
        const result = await options.progressReportGenerationService.generate({ projectId: params.projectId, personId: access.personId, ...rangeInput });
        return Response.json(result, { status: 200, headers: NO_STORE });
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
        const resetsAt = code === "QUOTA_EXCEEDED" && typeof error === "object" && error !== null && "resetsAt" in error && typeof error.resetsAt === "string" ? error.resetsAt : undefined;
        return errorResponse(code, resetsAt);
      }
    },
  };
}
