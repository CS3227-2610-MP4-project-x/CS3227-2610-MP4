import { beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";

// Task 4.5 D3/D4/D8. Real public service/repository on disposable synthetic PostgreSQL.
// Read-only runtime sessions turn any attempted member-read write into a database error.
vi.mock("server-only", () => ({}));
import { ProjectError, ProjectRepository, ProjectService, projectErrorResponse } from "@/server/projects";
import { addMembership, createPerson, createProjectWithTeam, ENTITY_TABLES, MEMBERSHIP_ROLE, runtimePool, SCHEMA } from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

dbDescribe("project member read (4.5)", () => {
  const db = useMigratedDatabase();
  let admin: pg.Client;
  let service: ProjectService;
  beforeAll(async () => {
    admin = db().admin;
    const pool = runtimePool(async () => {
      const client = await db().connectAsRuntime();
      await client.query("SET default_transaction_read_only = on");
      return client;
    });
    service = new ProjectService(new ProjectRepository(pool as unknown as ConstructorParameters<typeof ProjectRepository>[0]), { findPeopleByGitHubUsername: async () => [] });
  });

  async function named(personId: string, username: string) {
    await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.people} SET github_username = $1 WHERE id = $2`, [username, personId]);
  }
  async function snapshot() {
    const result = await admin.query(`SELECT
      (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM ${SCHEMA}.${ENTITY_TABLES.projects} p) AS projects,
      (SELECT jsonb_agg(row_to_json(m) ORDER BY m.id) FROM ${SCHEMA}.${ENTITY_TABLES.memberships} m) AS memberships,
      (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM ${SCHEMA}.${ENTITY_TABLES.people} p) AS people`);
    return result.rows;
  }
  async function refused(projectId: string, personId: string, code: string) {
    const error = await service.listMembers(projectId, personId).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectError);
    expect((await projectErrorResponse(error).json()).error.code).toBe(code);
  }

  it("lists only this project's members including PM, ordered by lower(username) then person ID, without writes", async () => {
    const team = await createProjectWithTeam(admin);
    const other = await createProjectWithTeam(admin);
    await named(team.productManagerId, "zeta-PM");
    await named(team.developerId, "Alpha");
    const sameName = await createPerson(admin, { github_username: "aLPHA" });
    await addMembership(admin, team.projectId, sameName, MEMBERSHIP_ROLE.developer);
    const beta = await createPerson(admin, { github_username: "beta" });
    await addMembership(admin, team.projectId, beta, MEMBERSHIP_ROLE.developer);
    await named(other.developerId, "aaa-outside-project");
    const before = await snapshot();

    const result = await service.listMembers(team.projectId, team.productManagerId);

    const tied = [team.developerId, sameName].sort().map((personId) => ({ personId, githubUsername: personId === sameName ? "aLPHA" : "Alpha", role: "developer" }));
    expect(result).toEqual([
      ...tied,
      { personId: beta, githubUsername: "beta", role: "developer" },
      { personId: team.productManagerId, githubUsername: "zeta-PM", role: "product_manager" },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("returns the full member list without an implicit first-page limit", async () => {
    const team = await createProjectWithTeam(admin);
    const ids = [team.productManagerId, team.developerId];
    for (let i = 0; i < 103; i++) {
      const personId = await createPerson(admin);
      await addMembership(admin, team.projectId, personId, MEMBERSHIP_ROLE.developer);
      ids.push(personId);
    }
    expect((await service.listMembers(team.projectId, team.productManagerId)).map((row) => row.personId).sort()).toEqual(ids.sort());
  });

  it("independently denies current developers, nonmembers and missing projects without writes", async () => {
    const team = await createProjectWithTeam(admin);
    const outsider = await createPerson(admin);
    const before = await snapshot();
    await refused(team.projectId, team.developerId, "FORBIDDEN");
    await refused(team.projectId, outsider, "NOT_FOUND");
    await refused("55000000-0000-4000-8000-000000000099", team.productManagerId, "NOT_FOUND");
    expect(await snapshot()).toEqual(before);
  });

  it("rechecks roles after transfer rather than persisting access or list data", async () => {
    const team = await createProjectWithTeam(admin);
    await service.listMembers(team.projectId, team.productManagerId);
    await admin.query("BEGIN");
    try {
      await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.memberships} SET role = 'developer' WHERE project_id = $1 AND person_id = $2`, [team.projectId, team.productManagerId]);
      await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.memberships} SET role = 'product_manager' WHERE project_id = $1 AND person_id = $2`, [team.projectId, team.developerId]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    await refused(team.projectId, team.productManagerId, "FORBIDDEN");
    const records = await service.listMembers(team.projectId, team.developerId);
    expect(records.find((row) => row.personId === team.developerId)?.role).toBe("product_manager");
    expect(records.find((row) => row.personId === team.productManagerId)?.role).toBe("developer");
  });
});
