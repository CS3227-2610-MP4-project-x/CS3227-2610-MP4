import "server-only";

// design.md "API Error Contract": stable codes with fixed server-chosen messages that never
// contain user input (Q2). Statuses and messages for the shared codes follow identity-and-access
// "Error codes and messages are stable".
const ERRORS = {
  INVALID_REQUEST: { status: 400, message: "Invalid request" },
  FORBIDDEN: { status: 403, message: "Insufficient permissions" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  PROJECT_KEY_TAKEN: { status: 409, message: "A project with this key already exists" },
  GITHUB_USERNAME_AMBIGUOUS: { status: 409, message: "The GitHub username matches more than one person" },
  ALREADY_MEMBER: { status: 409, message: "The person is already a member of this project" },
  TRANSFER_TARGET_NOT_DEVELOPER: {
    status: 409,
    message: "The product manager role can only be transferred to a developer in this project",
  },
  TRANSFER_BLOCKED_OPEN_TASKS: {
    status: 409,
    message: "Reassign the developer's open tasks before transferring the product manager role",
  },
} as const satisfies Record<string, Readonly<{ status: number; message: string }>>;

const INTERNAL_ERROR = { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" } as const;

export type ProjectErrorCode = keyof typeof ERRORS;

export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode) {
    super(ERRORS[code].message);
    this.name = "ProjectError";
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Maps a ProjectError to its safe envelope; anything else becomes a generic 500. */
export function projectErrorResponse(error: unknown): Response {
  if (error instanceof ProjectError) {
    const { status, message } = ERRORS[error.code];
    return errorResponse(status, error.code, message);
  }
  return errorResponse(INTERNAL_ERROR.status, INTERNAL_ERROR.code, INTERNAL_ERROR.message);
}
