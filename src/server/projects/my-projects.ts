import "server-only";

import type { ProjectView } from "./types";

type PersonByAuthUser = Readonly<{ findPersonIdByAuthUserId(authUserId: string): Promise<string | null> }>;
type ProjectsForPerson = Readonly<{ listProjectsForPerson(personId: string): Promise<readonly ProjectView[]> }>;

/**
 * The "my projects" read for `/` (design.md B3): the signed-in person's projects, ordered by the
 * repository (name, then id), or null when the read fails. A session whose person is not yet
 * registered has no projects. A failure carries no detail to the caller.
 */
export async function readMyProjects(
  people: PersonByAuthUser,
  projects: ProjectsForPerson,
  authUserId: string,
): Promise<readonly ProjectView[] | null> {
  try {
    const personId = await people.findPersonIdByAuthUserId(authUserId);
    return personId ? await projects.listProjectsForPerson(personId) : [];
  } catch {
    return null;
  }
}
