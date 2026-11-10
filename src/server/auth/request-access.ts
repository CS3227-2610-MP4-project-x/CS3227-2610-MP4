import "server-only";

import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import type { ServerComposition } from "@/server/composition";
import type { ProjectRole } from "@/server/repositories/project-access-repository";
import { isUuid } from "./uuid";

// Session and membership helpers moved from project-authorization.ts (design.md Q5, Q7, Q8),
// plus the Q6 session-to-person step. Behaviour of the moved helpers is unchanged.

const INVALID_SESSION_AUTH_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
]);

type ErrorStatus = 401 | 404 | 500;

export type AccessResult = Readonly<{ personId: string; role: ProjectRole }>;

const ERRORS: Readonly<Record<ErrorStatus, Readonly<{ code: string; message: string }>>> = {
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  404: { code: "NOT_FOUND", message: "Resource not found" },
  500: { code: "INTERNAL_ERROR", message: "Internal server error" },
};

function response(status: ErrorStatus): Response {
  return Response.json({ error: ERRORS[status] }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

/** Returns the verified Supabase Auth user ID, or a safe 401 or 500 response. */
export async function getAuthenticatedUserId(
  composition: ServerComposition,
): Promise<string | Response> {
  try {
    const client = await createRequestSupabaseClient(composition.config);
    const { data, error } = await client.auth.getUser();
    if (error) return response(isUnauthenticatedAuthError(error) ? 401 : 500);
    if (!data.user) return response(401);
    if (!isUuid(data.user.id)) return response(401);
    return data.user.id;
  } catch (error) {
    return response(isUnauthenticatedAuthError(error) ? 401 : 500);
  }
}

/** Resolves the caller's person and role in the project, concealing non-members with 404. */
export async function resolveProjectAccess(
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

/** Maps the session to a registered person ID; no person row is 401 (design.md Q6). */
export async function resolveSessionPerson(
  composition: ServerComposition,
): Promise<string | Response> {
  const authUserId = await getAuthenticatedUserId(composition);
  if (authUserId instanceof Response) return authUserId;
  try {
    const personId = await composition.peopleRepository.findPersonIdByAuthUserId(authUserId);
    return personId ?? response(401);
  } catch {
    return response(500);
  }
}
