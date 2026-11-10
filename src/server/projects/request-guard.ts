import "server-only";

import { ProjectError, projectErrorResponse } from "./errors";

/**
 * Shared check for the mutating project routes (design.md D8, Q4): the Origin must equal
 * APP_ORIGIN (else 403), then the media type must be application/json (else 400). Returns a
 * refusal response, or null when the request may proceed. Media-type parameters such as
 * `charset` are ignored, as in the existing project and github-repository routes.
 */
export function refuseUnsafeMutation(request: Request, appOrigin: string): Response | null {
  if (request.headers.get("origin") !== appOrigin) {
    return projectErrorResponse(new ProjectError("FORBIDDEN"));
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return projectErrorResponse(new ProjectError("INVALID_REQUEST"));
  }
  return null;
}
