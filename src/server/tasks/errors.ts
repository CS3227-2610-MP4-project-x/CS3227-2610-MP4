import "server-only";

// design.md "API Error Contract" and T7: stable codes with fixed server-chosen messages that never
// contain user input (Q2). Shared codes keep the identity-and-access messages. The table is the
// tasks module's own, as R8 accepted for the projects module.
const ERRORS = {
  INVALID_REQUEST: { status: 400, message: "Invalid request" },
  ACCEPTANCE_CRITERIA_REQUIRED: { status: 400, message: "At least one acceptance criterion is required" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  ASSIGNEE_NOT_DEVELOPER: { status: 409, message: "The assignee must be a developer in this project" },
  VERSION_CONFLICT: { status: 409, message: "The task was changed by someone else. Reload and try again" },
} as const satisfies Record<string, Readonly<{ status: number; message: string }>>;

const INTERNAL_ERROR = { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" } as const;

export type TaskErrorCode = keyof typeof ERRORS;

export class TaskError extends Error {
  constructor(readonly code: TaskErrorCode) {
    super(ERRORS[code].message);
    this.name = "TaskError";
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Maps a TaskError to its safe envelope; anything else becomes a generic 500. */
export function taskErrorResponse(error: unknown): Response {
  if (error instanceof TaskError) {
    const { status, message } = ERRORS[error.code];
    return errorResponse(status, error.code, message);
  }
  return errorResponse(INTERNAL_ERROR.status, INTERNAL_ERROR.code, INTERNAL_ERROR.message);
}
