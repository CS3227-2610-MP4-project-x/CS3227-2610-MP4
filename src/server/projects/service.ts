import "server-only";

import { ProjectError } from "./errors";
import type { ProjectRepository, ProjectTransaction } from "./repository";
import type { CreateProjectInput, MemberView, PersonLookup, PersonMatch, ProjectMemberView, ProjectView } from "./types";

/** Project creation, reading, membership and product manager transfer (design.md D1 to D10, S2). */
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly people: PersonLookup,
  ) {}

  /** The creator becomes the only product manager in the creating transaction (D2, D10). */
  async createProject(personId: string, input: CreateProjectInput): Promise<ProjectView> {
    return this.projects.transaction(async (transaction) => {
      const project = await transaction.insertProject(input.key, input.name);
      await transaction.insertMembership(project.id, personId, "product_manager");
      return { id: project.id, key: project.key, name: project.name, role: "product_manager" };
    });
  }

  async getProject(projectId: string, personId: string): Promise<ProjectView> {
    const project = await this.projects.findProjectForMember(projectId, personId);
    if (!project) throw new ProjectError("NOT_FOUND");
    return { id: project.id, key: project.key, name: project.name, role: project.role };
  }

  /** The person's projects for the "my projects" entry on `/` (design.md B3); order is the repository's. */
  async listProjectsForPerson(personId: string): Promise<readonly ProjectView[]> {
    const projects = await this.projects.listProjectsForMember(personId);
    return projects.map((project) => ({ id: project.id, key: project.key, name: project.name, role: project.role }));
  }

  /** Current PM-only member read. Authorization is rechecked here for direct service callers. */
  async listMembers(projectId: string, actorPersonId: string): Promise<readonly ProjectMemberView[]> {
    const access = await this.projects.findProjectForMember(projectId, actorPersonId);
    if (!access) throw new ProjectError("NOT_FOUND");
    if (access.role !== "product_manager") throw new ProjectError("FORBIDDEN");
    return this.projects.listMembersForProject(projectId);
  }

  /** Adds a registered person as a developer; only the product manager may (D5, S2). */
  async addMember(projectId: string, actorPersonId: string, githubUsername: string): Promise<MemberView> {
    const person = await this.findOnePerson(githubUsername);
    return this.projects.transaction(async (transaction) => {
      await requireProductManager(transaction, projectId, actorPersonId);
      await transaction.insertMembership(projectId, person.id, "developer");
      return { personId: person.id, githubUsername: person.githubUsername, role: "developer" };
    });
  }

  /**
   * Swaps the product manager and a developer in one transaction, after locking both
   * membership rows and checking the developer's open tasks (D-C, D6, S7).
   * Returns the caller's new view, with role `developer`.
   */
  async transferProductManager(projectId: string, actorPersonId: string, githubUsername: string): Promise<ProjectView> {
    const target = await this.findOnePerson(githubUsername);
    return this.projects.transaction(async (transaction) => {
      const roles = await transaction.lockMemberships(projectId, [...new Set([actorPersonId, target.id])]);
      const actorRole = roles.get(actorPersonId);
      if (!actorRole) throw new ProjectError("NOT_FOUND");
      if (actorRole !== "product_manager") throw new ProjectError("FORBIDDEN");
      if (target.id === actorPersonId || roles.get(target.id) !== "developer") {
        throw new ProjectError("TRANSFER_TARGET_NOT_DEVELOPER");
      }
      if (await transaction.hasOpenAssignedTasks(projectId, target.id)) {
        throw new ProjectError("TRANSFER_BLOCKED_OPEN_TASKS");
      }
      // Demote first: the partial unique index allows at most one product manager per project.
      await transaction.setRole(projectId, actorPersonId, "developer");
      await transaction.setRole(projectId, target.id, "product_manager");
      const project = await transaction.findProject(projectId);
      if (!project) throw new Error("Project disappeared during transfer.");
      return { id: project.id, key: project.key, name: project.name, role: "developer" };
    });
  }

  private async findOnePerson(githubUsername: string): Promise<PersonMatch> {
    const matches = await this.people.findPeopleByGitHubUsername(githubUsername);
    if (matches.length === 0) throw new ProjectError("NOT_FOUND");
    if (matches.length > 1) throw new ProjectError("GITHUB_USERNAME_AMBIGUOUS");
    return matches[0];
  }
}

async function requireProductManager(transaction: ProjectTransaction, projectId: string, personId: string): Promise<void> {
  const role = await transaction.findRoleForShare(projectId, personId);
  if (!role) throw new ProjectError("NOT_FOUND");
  if (role !== "product_manager") throw new ProjectError("FORBIDDEN");
}
