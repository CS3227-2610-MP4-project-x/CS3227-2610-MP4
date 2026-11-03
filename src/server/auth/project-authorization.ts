import "server-only";

import type { NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import type { ServerComposition } from "@/server/composition";
import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { StoredTaskState, TaskAccessRecord } from "@/server/repositories/task-access-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_SESSION_AUTH_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
]);
const STATE_TO_STORAGE: ReadonlyMap<string, StoredTaskState> = new Map([
  ["To Do", "to_do"],
  ["In Progress", "in_progress"],
  ["In Review", "in_review"],
  ["Done", "done"],
]);

type ErrorStatus = 400 | 401 | 403 | 404 | 500 | 501;
type RouteContext = Readonly<{ params: Promise<{ projectId: string; taskId?: string }> }>;
type AccessResult = Readonly<{ personId: string; role: ProjectRole }>;

const ERRORS: Readonly<Record<ErrorStatus, Readonly<{ code: string; message: string }>>> = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
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

function isUnauthenticatedAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const authError = error as { name?: unknown; status?: unknown; code?: unknown };
  return authError.name === "AuthSessionMissingError" ||
    (authError.name === "AuthApiError" && (
      authError.status === 401 ||
      (typeof authError.code === "string" && INVALID_SESSION_AUTH_CODES.has(authError.code))
    ));
}

async function getAuthenticatedUserId(
  composition: ServerComposition,
): Promise<string | Response> {
  try {
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error) return response(isUnauthenticatedAuthError(error) ? 401 : 500);
    if (!data.user) return response(401);
    if (!UUID_PATTERN.test(data.user.id)) return response(401);
    return data.user.id;
  } catch (error) {
    return response(isUnauthenticatedAuthError(error) ? 401 : 500);
  }
}

async function resolveProjectAccess(
  composition: ServerComposition,
  projectId: string,
): Promise<AccessResult | Response> {
  const authUserId = await getAuthenticatedUserId(composition);
  if (authUserId instanceof Response) return authUserId;
  try {
    const personId = await composition.peopleRepository.findPersonIdByAuthUserId(authUserId);
    if (!personId) return response(404);
    if (!await composition.projectAccessRepository.projectExists(projectId)) return response(404);
    const role = await composition.projectAccessRepository.findProjectRole(projectId, personId);
    if (!role) return response(404);
    return { personId, role };
  } catch {
    return response(500);
  }
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

/** Authenticated users may reach the project-creation stub; creation is not implemented here. */
export async function handleProjectCreationStub(
  request: NextRequest,
  composition: ServerComposition,
): Promise<Response> {
  if (!await hasJsonObjectBody(request)) return invalidRequest();
  const authUserId = await getAuthenticatedUserId(composition);
  return isResponse(authUserId) ? authUserId : response(501);
}

/** Runs the project read stub after verifying session, person mapping, and membership. */
export async function handleProjectReadStub(
  request: NextRequest,
  context: RouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const projectId = await projectIdFrom(context);
  if (isResponse(projectId)) return projectId;
  const access = await resolveProjectAccess(composition, projectId);
  return isResponse(access) ? access : response(501);
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
