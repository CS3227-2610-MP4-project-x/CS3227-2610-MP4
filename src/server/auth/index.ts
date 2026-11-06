import "server-only";

// Auth module public entry for the request-access helpers only (design.md Q7, S5). It does not
// re-export project-authorization.ts; other auth files keep their existing direct imports.
export {
  getAuthenticatedUserId,
  resolveProjectAccess,
  resolveSessionPerson,
  type AccessResult,
} from "./request-access";
