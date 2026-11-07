import "server-only";

import type { NextRequest } from "next/server";
import type { ServerComposition } from "@/server/composition";
import { resolveProjectAccess } from "@/server/auth/request-access";
import { TaskDetailServiceError } from "./read-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = Readonly<{ params: Promise<{ projectId: string; taskId: string }> }>;
const ERRORS = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
} as const;
type Status = keyof typeof ERRORS;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: Status): Response { return json({ error: ERRORS[status] }, status); }

function serviceError(value: unknown): Response {
  if (!(value instanceof TaskDetailServiceError)) return error(500);
  switch (value.code) {
    case "FORBIDDEN": return error(403);
    case "NOT_FOUND": return error(404);
    case "INTERNAL_ERROR": return error(500);
  }
}

export async function handleTaskDetailRead(
  _request: NextRequest,
  context: Context,
  composition: ServerComposition,
): Promise<Response> {
  const { projectId, taskId } = await context.params;
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(taskId)) return error(400);
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  try {
    const task = await composition.taskDetailService.getTaskDetail(projectId, taskId, access);
    return json(task, 200);
  } catch (cause) {
    return serviceError(cause);
  }
}
