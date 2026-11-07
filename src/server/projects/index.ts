import "server-only";

// Projects module public entry (design.md S1).
export { ProjectError, projectErrorResponse } from "./errors";
export { handleMemberAdd, handleProductManagerTransfer, handleProjectCreate, handleProjectRead } from "./handlers";
export { ProjectRepository } from "./repository";
// design.md T14: the Origin and content-type guard is shared with the task routes.
export { refuseUnsafeMutation } from "./request-guard";
export { ProjectService } from "./service";
export type { MemberView, PersonLookup, ProjectView } from "./types";
export { parseCreateProjectBody, parseGitHubUsernameBody } from "./validation";
