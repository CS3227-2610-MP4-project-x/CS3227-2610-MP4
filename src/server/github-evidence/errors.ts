import "server-only";

export type EvidenceErrorStatus = 400 | 401 | 403 | 404 | 500 | 503;
const errors: Record<EvidenceErrorStatus, { code: string; message: string }> = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
  503: { code: "EVIDENCE_UNAVAILABLE", message: "GitHub evidence is unavailable" },
};
export class GitHubEvidenceError extends Error {
  constructor(readonly status: EvidenceErrorStatus) { super(errors[status].message); this.name = "GitHubEvidenceError"; }
}
export function evidenceFailure(status: EvidenceErrorStatus): never { throw new GitHubEvidenceError(status); }
export function githubEvidenceErrorResponse(error: unknown): Response {
  const status = error instanceof GitHubEvidenceError ? error.status : 500;
  return Response.json({ error: errors[status] }, { status, headers: { "Cache-Control": "no-store" } });
}
