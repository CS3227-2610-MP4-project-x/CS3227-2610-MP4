import "server-only";

import type { NextRequest } from "next/server";
import type { ServerComposition } from "@/server/composition";
import { handleProjectCreate, handleProjectRead } from "@/server/projects";
import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { StoredTaskState, TaskAccessRecord } from "@/server/repositories/task-access-repository";
import { resolveProjectAccess, type AccessResult } from "./request-access";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_TO_STORAGE: ReadonlyMap<string, StoredTaskState> = new Map([
  ["To Do", "to_do"],
  ["In Progress", "in_progress"],
  ["In Review", "in_review"],
  ["Done", "done"],
]);

type ErrorStatus = 400 | 403 | 404 | 500 | 501;
type RouteContext = Readonly<{ params: Promise<{ projectId: string; taskId?: string }> }>;

const ERRORS: Readonly<Record<ErrorStatus, Readonly<{ code: string; message: string }>>> = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  403: { code: "FORBIDDEN", message: "Insufficient permissions" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
  501: { code: "NOT_IMPLEMENTED", message: "Endpoint not implemented" },
};

function response(status: ErrorStatus): Response {
  return Response.json({ error: ERRORS[status] }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalidRequest(): Response {
  return response(400);
}

async function projectIdFrom(context: RouteContext): Promise<string | Response> {
  const { projectId } = await context.params;
  return UUID_PATTERN.test(projectId) ? projectId : invalidRequest();
}

async function taskAccess(
  composition: ServerComposition,
  projectId: string,
  taskId: string,
): Promise<(AccessResult & { task: TaskAccessRecord }) | Response> {
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  try {
    const task = await composition.taskAccessRepository.findTaskInProject(projectId, taskId);
    if (!task) return response(404);
    return { ...access, task };
  } catch {
    return response(500);
  }
}

async function taskIdsFrom(context: RouteContext): Promise<{ projectId: string; taskId: string } | Response> {
  const { projectId, taskId } = await context.params;
  if (!UUID_PATTERN.test(projectId) || !taskId || !UUID_PATTERN.test(taskId)) return invalidRequest();
  return { projectId, taskId };
}

async function hasJsonObjectBody(request: NextRequest): Promise<boolean> {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return false;
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body);
  } catch {
    return false;
  }
}

async function requestedState(request: NextRequest): Promise<StoredTaskState | null> {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return null;
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const state = (body as Record<string, unknown>).state;
    return typeof state === "string" ? STATE_TO_STORAGE.get(state) ?? null : null;
  } catch {
    return null;
  }
}

function stateTransitionAllowed(
  role: ProjectRole,
  personId: string,
  task: TaskAccessRecord,
  target: StoredTaskState,
): boolean {
  if (role === "developer") {
    return task.assigneeId === personId && (
      (task.state === "to_do" && target === "in_progress") ||
      (task.state === "in_progress" && target === "in_review")
    );
  }
  return role === "product_manager" && task.state === "in_review" &&
    (target === "done" || target === "in_progress");
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Project creation is functional (task 4.1); delegates to the projects module (design.md Q5). */
export async function handleProjectCreationStub(
  request: NextRequest,
  composition: ServerComposition,
): Promise<Response> {
  return handleProjectCreate(request, composition);
}

/** Project read is functional (task 4.1); delegates to the projects module (design.md Q5). */
export async function handleProjectReadStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  return handleProjectRead(request, context, composition);
}

/** Runs the task creation stub only for a product manager in the path project. */
export async function handleTaskCreationStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const projectId = await projectIdFrom(context);
  if (isResponse(projectId)) return projectId;
  if (!await hasJsonObjectBody(request)) return invalidRequest();
  const access = await resolveProjectAccess(composition, projectId);
  if (isResponse(access)) return access;
  return access.role === "product_manager" ? response(501) : response(403);
}

/** Runs the task read stub only after membership and path-scoped task lookup. */
export async function handleTaskReadStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const ids = await taskIdsFrom(context);
  if (isResponse(ids)) return ids;
  const access = await taskAccess(composition, ids.projectId, ids.taskId);
  return isResponse(access) ? access : response(501);
}

/** Runs the task field-edit stub only for a project manager. */
export async function handleTaskEditStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const ids = await taskIdsFrom(context);
  if (isResponse(ids)) return ids;
  if (!await hasJsonObjectBody(request)) return invalidRequest();
  const access = await taskAccess(composition, ids.projectId, ids.taskId);
  if (isResponse(access)) return access;
  return access.role === "product_manager" ? response(501) : response(403);
}

/** Validates transition vocabulary and role/assignment authorization without mutation. */
export async function handleTaskStateStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const ids = await taskIdsFrom(context);
  if (isResponse(ids)) return ids;
  const target = await requestedState(request);
  if (!target) return invalidRequest();
  const access = await taskAccess(composition, ids.projectId, ids.taskId);
  if (isResponse(access)) return access;
  return stateTransitionAllowed(access.role, access.personId, access.task, target)
    ? response(501)
    : response(403);
}
