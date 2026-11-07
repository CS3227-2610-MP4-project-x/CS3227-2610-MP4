import "server-only";

import { resolveProjectAccess, resolveSessionPerson } from "@/server/auth";
import type { ServerComposition } from "@/server/composition";
import { ProjectError, projectErrorResponse } from "./errors";
import { refuseUnsafeMutation } from "./request-guard";
import { isProjectId, parseCreateProjectBody, parseGitHubUsernameBody } from "./validation";

// Route handlers for task 4.1. Check order (design.md Q4): Origin (403); content type, body
// and path ID (400); session (401); membership (404); role (403); then domain errors.

type ProjectRouteContext = Readonly<{ params: Promise<{ projectId: string }> }>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function invalidRequest(): Response {
  return projectErrorResponse(new ProjectError("INVALID_REQUEST"));
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function projectIdFrom(context: ProjectRouteContext): Promise<string | null> {
  const { projectId } = await context.params;
  return isProjectId(projectId) ? projectId : null;
}

/** `POST /api/v1/projects`: any signed-in person creates a project and becomes its PM (D1 to D3). */
export async function handleProjectCreate(request: Request, composition: ServerComposition): Promise<Response> {
  const refusal = refuseUnsafeMutation(request, composition.config.appOrigin);
  if (refusal) return refusal;
  const input = parseCreateProjectBody(await readJsonBody(request));
  if (!input) return invalidRequest();
  const personId = await resolveSessionPerson(composition);
  if (personId instanceof Response) return personId;
  try {
    return json(await composition.projectService.createProject(personId, input), 201);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

/** `GET /api/v1/projects/{projectId}`: members see the project and their role; no Origin check. */
export async function handleProjectRead(
  request: Request,
  context: ProjectRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const projectId = await projectIdFrom(context);
  if (!projectId) return invalidRequest();
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  try {
    return json(await composition.projectService.getProject(projectId, access.personId), 200);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

type ProductManagerAction = (projectId: string, actorPersonId: string, githubUsername: string) => Promise<unknown>;

/**
 * Shared flow for the PM-only routes that take a `{githubUsername}` body (D4, D8, Q3, Q4):
 * request guard, body and path ID, session, membership, role, then `action` for domain errors.
 */
async function handleProductManagerUsernameRoute(
  request: Request,
  context: ProjectRouteContext,
  composition: ServerComposition,
  action: ProductManagerAction,
  successStatus: number,
): Promise<Response> {
  const refusal = refuseUnsafeMutation(request, composition.config.appOrigin);
  if (refusal) return refusal;
  const githubUsername = parseGitHubUsernameBody(await readJsonBody(request));
  const projectId = await projectIdFrom(context);
  if (!githubUsername || !projectId) return invalidRequest();
  const access = await resolveProjectAccess(composition, projectId);
  if (access instanceof Response) return access;
  if (access.role !== "product_manager") return projectErrorResponse(new ProjectError("FORBIDDEN"));
  try {
    return json(await action(projectId, access.personId, githubUsername), successStatus);
  } catch (error) {
    return projectErrorResponse(error);
  }
}

/** `POST /api/v1/projects/{projectId}/members`: the PM adds a developer by GitHub username (D4, D5). */
export async function handleMemberAdd(
  request: Request,
  context: ProjectRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const service = composition.projectService;
  return handleProductManagerUsernameRoute(request, context, composition, service.addMember.bind(service), 201);
}

/** `POST /api/v1/projects/{projectId}/product-manager-transfer`: the PM hands the role to a developer (D-C, D4). */
export async function handleProductManagerTransfer(
  request: Request,
  context: ProjectRouteContext,
  composition: ServerComposition,
): Promise<Response> {
  const service = composition.projectService;
  return handleProductManagerUsernameRoute(
    request, context, composition, service.transferProductManager.bind(service), 200,
  );
}
