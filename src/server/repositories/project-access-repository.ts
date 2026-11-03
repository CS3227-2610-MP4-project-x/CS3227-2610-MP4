import "server-only";

import type { PeopleQuery } from "./people-repository";

export type ProjectRole = "developer" | "product_manager";

export class ProjectAccessRepository {
  constructor(private readonly database: PeopleQuery) {}

  async projectExists(projectId: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `SELECT id::text AS id
         FROM app.projects
        WHERE id = $1::uuid`,
      [projectId],
    );
    return result.rows.length > 0;
  }

  async findProjectRole(projectId: string, personId: string): Promise<ProjectRole | null> {
    const result = await this.database.query<{ role: ProjectRole }>(
      `SELECT role
         FROM app.memberships
        WHERE project_id = $1::uuid
          AND person_id = $2::uuid`,
      [projectId, personId],
    );
    return result.rows[0]?.role ?? null;
  }
}
