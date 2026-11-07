import "server-only";

import type { ProjectRole } from "@/server/repositories/project-access-repository";

export type { ProjectRole };

/** A project as one member sees it (design.md D3, D4, Q1). */
export type ProjectView = Readonly<{ id: string; key: string; name: string; role: ProjectRole }>;

/** The person a product manager added as a developer (design.md Q1). */
export type MemberView = Readonly<{ personId: string; githubUsername: string; role: "developer" }>;

/** A registered person matched by GitHub username (design.md S4). */
export type PersonMatch = Readonly<{ id: string; githubUsername: string }>;

/** Exact, case-insensitive GitHub-username lookup over registered people (design.md D5, S4). */
export type PersonLookup = Readonly<{
  findPeopleByGitHubUsername(githubUsername: string): Promise<readonly PersonMatch[]>;
}>;

/** A validated `POST /api/v1/projects` body (design.md D3). */
export type CreateProjectInput = Readonly<{ key: string; name: string }>;
