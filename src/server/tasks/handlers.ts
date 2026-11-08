import "server-only";

import { resolveProjectAccess } from "@/server/auth";
import type { ServerComposition } from "@/server/composition";
import { refuseUnsafeMutation } from "@/server/projects";
import type { TaskAccessRecord } from "@/server/repositories/task-access-repository";
import { TaskError, taskErrorResponse } from "./errors";
import { permittedTransition, storedStateOf } from "./states";
import type { ParseResult, ProjectRole, StateChangeInput } from "./types";
import {
  isUuid,
  parseCreateTaskBody,
  parseDeleteTaskBody,
  parseEditTaskBody,
  parseProgressUpdateBody,
  parseReassignTaskBody,
  parseStateChangeBody,
} from "./validation";

// Route handlers for tasks 4.2 and 4.3. Check order (design.md T8, Q4 and the 4.3 check order):
// Origin (403); content type, body and path IDs (400); session (401); membership (404); task
// exists in the project (404); role, or the 403 matrix on the task's current state (403); the
// state route's feedback rule (400); then domain errors (409). GET has no Origin check.

type TaskRouteContext = Readonly<{ params: Promise<{ projectId: string; taskId?: string }> }>;

type TaskWrite<T> = Readonly<{ projectId: string; taskId: string; personId: string; input: T }>;

/** A request that passed every check up to the role check, with the task it names. */
type TaskRequest<T> = TaskWrite<T> & Readonly<{ role: ProjectRole; task: TaskAccessRecord }>;

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
 * The shared checks before a write to one task: the admission checks, session, membership and
 * the task lookup (design.md T8, U9). Returns the validated request, the actor's role and the
 * task's current assignee and state, or a refusal. The caller applies its own role rule.
 */
async function admitTaskRequest<T>(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
  parseBody: (body: unknown) => ParseResult<T>,
): Promise<TaskRequest<T> | Response> {
  const { projectId, taskId } = await context.params;
  const admitted = await admitWrite(request, composition, [projectId, taskId], parseBody);
  if (admitted instanceof Response) return admitted;
  // Only narrows the type: admitWrite has already refused a missing or malformed task ID.
  if (taskId === undefined) return refusal("INVALID_REQUEST");
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  let task: TaskAccessRecord | null;
  try {
    task = await composition.taskAccessRepository.findTaskInProject(projectId, taskId);
  } catch (error) {
    return taskErrorResponse(error);
  }
  if (!task) return refusal("NOT_FOUND");
  return { projectId, taskId, personId: access.personId, role: access.role, task, input: admitted.input };
}

/** The checks before a product manager's write to one task: admission, then the PM role (403). */
async function authorizeTaskWrite<T>(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
  parseBody: (body: unknown) => ParseResult<T>,
): Promise<TaskWrite<T> | Response> {
  const admitted = await admitTaskRequest(request, context, composition, parseBody);
  if (admitted instanceof Response) return admitted;
  if (admitted.role !== "product_manager") return refusal("FORBIDDEN");
  return { projectId: admitted.projectId, taskId: admitted.taskId, personId: admitted.personId, input: admitted.input };
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

/**
 * Runs the transition the 403 matrix allowed, after the feedback rule: feedback is required for
 * a request for changes and refused with any other transition (design.md L2, L3).
 */
async function applyStateChange(composition: ServerComposition, change: TaskRequest<StateChangeInput>): Promise<Response> {
  const { projectId, taskId, personId, role, task, input } = change;
  const transition = permittedTransition({ personId, role }, { assigneeId: task.assigneeId, status: task.state }, storedStateOf(input.state));
  if (!transition) return refusal("FORBIDDEN");
  const lifecycle = composition.taskLifecycleService;
  if (transition === "requestChanges") {
    if (!input.feedback?.ok) return refusal("INVALID_REQUEST");
    const feedback = input.feedback.value;
    return respond(async () => json(await lifecycle.requestChanges(projectId, taskId, personId, { version: input.version, feedback }), 200));
  }
  if (input.feedback) return refusal("INVALID_REQUEST");
  switch (transition) {
    case "start":
      return respond(async () => json(await lifecycle.startTask(projectId, taskId, personId, input.version), 200));
    case "submit":
      return respond(async () => json(await lifecycle.submitTask(projectId, taskId, personId, input.version), 200));
    case "approve":
      return respond(async () => json(await lifecycle.approveTask(projectId, taskId, personId, input.version), 200));
  }
}

/**
 * `PATCH /api/v1/projects/{projectId}/tasks/{taskId}/state`: a lifecycle transition (design.md
 * L1 to L7). The 403 matrix is applied here to the task as read, and again by the service under
 * the row lock, where a changed version is 409.
 */
export async function handleTaskStateChange(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const change = await admitTaskRequest(request, context, composition, parseStateChangeBody);
  if (change instanceof Response) return change;
  return applyStateChange(composition, change);
}

/**
 * `POST /api/v1/projects/{projectId}/tasks/{taskId}/progress-updates`: the assigned developer
 * posts a progress update; 201 with the stored update (design.md L4).
 */
export async function handleProgressUpdateCreate(
  request: Request,
  context: TaskRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const post = await admitTaskRequest(request, context, composition, parseProgressUpdateBody);
  if (post instanceof Response) return post;
  if (post.role !== "developer" || post.task.assigneeId !== post.personId) return refusal("FORBIDDEN");
  return respond(async () =>
    json(await composition.taskLifecycleService.postProgressUpdate(post.projectId, post.taskId, post.personId, post.input), 201));
}
