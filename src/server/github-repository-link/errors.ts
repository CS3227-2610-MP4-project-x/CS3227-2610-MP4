import "server-only";

export type LinkErrorStatus = 400 | 401 | 403 | 404 | 500;

const ERRORS: Readonly<Record<LinkErrorStatus, Readonly<{ code: string; message: string }>>> = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
};

export class GitHubRepositoryLinkError extends Error {
  constructor(readonly status: LinkErrorStatus) {
    super(ERRORS[status].message);
    this.name = "GitHubRepositoryLinkError";
  }
}

export function githubRepositoryLinkErrorResponse(error: unknown): Response {
  const status = error instanceof GitHubRepositoryLinkError ? error.status : 500;
  return Response.json({ error: ERRORS[status] }, { status, headers: { "Cache-Control": "no-store" } });
}

export function linkFailure(status: LinkErrorStatus): never {
  throw new GitHubRepositoryLinkError(status);
}
