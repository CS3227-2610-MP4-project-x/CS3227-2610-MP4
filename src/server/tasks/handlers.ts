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

/**
 * The shared checks before a product manager's write to one task: request guard, body, path
 * IDs, session, membership, task lookup, then role. Returns the validated write or a refusal.
 */
async function authorizeTaskWrite<T>(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
  parseBody: (body: unknown) => ParseResult<T>,
): Promise<TaskWrite<T> | Response> {
  const guard = refuseUnsafeMutation(request, composition.config.appOrigin);
  if (guard) return guard;
  const parsed = parseBody(await readJsonBody(request));
  const { projectId, taskId } = await context.params;
  if (!isUuid(projectId) || !isUuid(taskId)) return refusal("INVALID_REQUEST");
  if (!parsed.ok) return refusal(parsed.code);
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  try {
    if (!await composition.taskAccessRepository.findTaskInProject(projectId, taskId)) return refusal("NOT_FOUND");
  } catch (error) {
    return taskErrorResponse(error);
  }
  if (access.role !== "product_manager") return refusal("FORBIDDEN");
  return { projectId, taskId, personId: access.personId, input: parsed.value };
}

/** `POST /api/v1/projects/{projectId}/tasks`: the PM creates a task (design.md T1, T2). */
export async function handleTaskCreate(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const guard = refuseUnsafeMutation(request, composition.config.appOrigin);
  if (guard) return guard;
  const parsed = parseCreateTaskBody(await readJsonBody(request));
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return refusal("INVALID_REQUEST");
  if (!parsed.ok) return refusal(parsed.code);
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  if (access.role !== "product_manager") return refusal("FORBIDDEN");
  try {
    return json(await composition.taskService.createTask(projectId, access.personId, parsed.value), 201);
  } catch (error) {
    return taskErrorResponse(error);
  }
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
  try {
    return json(await composition.taskService.getTask(projectId, taskId), 200);
  } catch (error) {
    return taskErrorResponse(error);
  }
}

/** `PATCH /api/v1/projects/{projectId}/tasks/{taskId}`: the PM edits fields and criteria (design.md T4). */
export async function handleTaskEdit(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseEditTaskBody);
  if (write instanceof Response) return write;
  try {
    return json(await composition.taskService.editTask(write.projectId, write.taskId, write.personId, write.input), 200);
  } catch (error) {
    return taskErrorResponse(error);
  }
}

/** `PUT /api/v1/projects/{projectId}/tasks/{taskId}/assignee`: the PM reassigns (design.md T9). */
export async function handleTaskReassign(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseReassignTaskBody);
  if (write instanceof Response) return write;
  try {
    return json(await composition.taskService.reassignTask(write.projectId, write.taskId, write.personId, write.input), 200);
  } catch (error) {
    return taskErrorResponse(error);
  }
}

/** `DELETE /api/v1/projects/{projectId}/tasks/{taskId}`: the PM soft-deletes; 204 with no body (design.md T1, T12). */
export async function handleTaskDelete(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const write = await authorizeTaskWrite(request, context, composition, parseDeleteTaskBody);
  if (write instanceof Response) return write;
  try {
    await composition.taskService.deleteTask(write.projectId, write.taskId, write.personId, write.input.version);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
