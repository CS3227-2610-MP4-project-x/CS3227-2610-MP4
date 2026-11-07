import "server-only";

import { resolveProjectAccess } from "@/server/auth";
import type { ServerComposition } from "@/server/composition";
import { refuseUnsafeMutation } from "@/server/projects";
import { TaskError, taskErrorResponse } from "./errors";
import type { ParseResult } from "./types";
import { isUuid, parseCreateTaskBody, parseDeleteTaskBody, parseEditTaskBody, parseReassignTaskBody } from "./validation";

// Route handlers for task 4.2. Check order (design.md T8, Q4): Origin (403); content type, body
// and path IDs (400); session (401); membership (404); task exists in the project (404); role
// (403); then domain errors (409). GET has no Origin check.

type TaskRouteContext = Readonly<{ params: Promise<{ projectId: string; taskId?: string }> }>;

type TaskWrite<T> = Readonly<{ projectId: string; taskId: string; personId: string; input: T }>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function refusal(code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "ACCEPTANCE_CRITERIA_REQUIRED"): Response {
  return taskErrorResponse(new TaskError(code));
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Runs a handler's service call and maps any error to the safe task error response. */
async function respond(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    return taskErrorResponse(error);
  }
}

/**
 * The checks before the session, in T8 order: request guard (403), then path IDs and body
 * (400). Returns the parsed body or a refusal.
 */
async function admitWrite<T>(
  request: Request,
  composition: ServerComposition,
  pathIds: readonly (string | undefined)[],
  parseBody: (body: unknown) => ParseResult<T>,
): Promise<{ input: T } | Response> {
  const guard = refuseUnsafeMutation(request, composition.config.appOrigin);
  if (guard) return guard;
  const parsed = parseBody(await readJsonBody(request));
  if (!pathIds.every(isUuid)) return refusal("INVALID_REQUEST");
  if (!parsed.ok) return refusal(parsed.code);
  return { input: parsed.value };
}

/**
 * The shared checks before a product manager's write to one task: the admission checks,
 * session, membership, task lookup, then role. Returns the validated write or a refusal.
 */
async function authorizeTaskWrite<T>(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
  parseBody: (body: unknown) => ParseResult<T>,
): Promise<TaskWrite<T> | Response> {
  const { projectId, taskId } = await context.params;
  const admitted = await admitWrite(request, composition, [projectId, taskId], parseBody);
  if (admitted instanceof Response) return admitted;
  // Only narrows the type: admitWrite has already refused a missing or malformed task ID.
  if (taskId === undefined) return refusal("INVALID_REQUEST");
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  try {
    if (!await composition.taskAccessRepository.findTaskInProject(projectId, taskId)) return refusal("NOT_FOUND");
  } catch (error) {
    return taskErrorResponse(error);
  }
  if (access.role !== "product_manager") return refusal("FORBIDDEN");
  return { projectId, taskId, personId: access.personId, input: admitted.input };
}

/** `POST /api/v1/projects/{projectId}/tasks`: the PM creates a task (design.md T1, T2). */
export async function handleTaskCreate(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const { projectId } = await context.params;
  const admitted = await admitWrite(request, composition, [projectId], parseCreateTaskBody);
  if (admitted instanceof Response) return admitted;
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  if (access.role !== "product_manager") return refusal("FORBIDDEN");
  return respond(async () => json(await composition.taskService.createTask(projectId, access.personId, admitted.input), 201));
}

/** `GET /api/v1/projects/{projectId}/tasks/{taskId}`: any member reads a live task (design.md T15). */
export async function handleTaskRead(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const { projectId, taskId } = await context.params;
  if (!isUuid(projectId) || !isUuid(taskId)) return refusal("INVALID_REQUEST");
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  return respond(async () => json(await composition.taskService.getTask(projectId, taskId), 200));
}

/** `PATCH /api/v1/projects/{projectId}/tasks/{taskId}`: the PM edits fields and criteria (design.md T4). */
export async function handleTaskEdit(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseEditTaskBody);
  if (write instanceof Response) return write;
  return respond(async () =>
    json(await composition.taskService.editTask(write.projectId, write.taskId, write.personId, write.input), 200));
}

/** `PUT /api/v1/projects/{projectId}/tasks/{taskId}/assignee`: the PM reassigns (design.md T9). */
export async function handleTaskReassign(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseReassignTaskBody);
  if (write instanceof Response) return write;
  return respond(async () =>
    json(await composition.taskService.reassignTask(write.projectId, write.taskId, write.personId, write.input), 200));
}

/** `DELETE /api/v1/projects/{projectId}/tasks/{taskId}`: the PM soft-deletes; 204 with no body (design.md T1, T12). */
export async function handleTaskDelete(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseDeleteTaskBody);
  if (write instanceof Response) return write;
  return respond(async () => {
    await composition.taskService.deleteTask(write.projectId, write.taskId, write.personId, write.input.version);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
