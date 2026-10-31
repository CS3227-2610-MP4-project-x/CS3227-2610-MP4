/**
 * Requirement "Membership integrity is enforced by the database" (D-C).
 * AC5: Person in several projects. AC6: Second membership in the same project.
 * AC7: Second product manager; a PM swap (demote then promote) succeeds in one transaction.
 *
 * The D-C refusal while the incoming developer has open tasks is service logic and is
 * not tested here; the schema only has to allow the swap.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  SCHEMA,
  addMembership,
  createPerson,
  createProject,
  createProjectWithTeam,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const MEMBERSHIPS = `${SCHEMA}.${ENTITY_TABLES.memberships}`;

dbDescribe("membership integrity (AC5-AC7)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("AC5: accepts one person in two projects with a different role in each", async () => {
    const person = await createPerson(runtime);
    const first = await createProject(runtime);
    const second = await createProject(runtime);

    await addMembership(runtime, first.id, person, MEMBERSHIP_ROLE.productManager);
    await addMembership(runtime, second.id, person, MEMBERSHIP_ROLE.developer);

    const { rows } = await runtime.query<{ project_id: string; role: string }>(
      `SELECT project_id, role FROM ${MEMBERSHIPS} WHERE person_id = $1 ORDER BY role`,
      [person],
    );
    expect(rows).toEqual([
      { project_id: second.id, role: MEMBERSHIP_ROLE.developer },
      { project_id: first.id, role: MEMBERSHIP_ROLE.productManager },
    ]);
  });

  it("rejects a role other than product manager or developer", async () => {
    const person = await createPerson(runtime);
    const project = await createProject(runtime);
    await expectIntegrityRejection(
      runtime.query(`INSERT INTO ${MEMBERSHIPS} (project_id, person_id, role) VALUES ($1, $2, 'owner')`, [
        project.id,
        person,
      ]),
    );
  });

  it("AC6: rejects a second membership for the same person and project, with the same role", async () => {
    const person = await createPerson(runtime);
    const project = await createProject(runtime);
    await addMembership(runtime, project.id, person, MEMBERSHIP_ROLE.developer);
    await expectIntegrityRejection(addMembership(runtime, project.id, person, MEMBERSHIP_ROLE.developer));
  });

  it("AC6: rejects a second membership for the same person and project, with a different role", async () => {
    const person = await createPerson(runtime);
    const project = await createProject(runtime);
    await addMembership(runtime, project.id, person, MEMBERSHIP_ROLE.developer);
    await expectIntegrityRejection(addMembership(runtime, project.id, person, MEMBERSHIP_ROLE.productManager));
  });

  it("rejects a membership for a project or person that does not exist", async () => {
    const person = await createPerson(runtime);
    const project = await createProject(runtime);
    await expectIntegrityRejection(
      addMembership(runtime, "00000000-0000-4000-8000-000000000001", person, MEMBERSHIP_ROLE.developer),
    );
    await expectIntegrityRejection(
      addMembership(runtime, project.id, "00000000-0000-4000-8000-000000000002", MEMBERSHIP_ROLE.developer),
    );
  });

  it("AC7: rejects a second product manager membership in a project", async () => {
    const team = await createProjectWithTeam(runtime);
    const other = await createPerson(runtime);
    await expectIntegrityRejection(addMembership(runtime, team.projectId, other, MEMBERSHIP_ROLE.productManager));
  });

  it("AC7: rejects promoting a developer while the project still has a product manager", async () => {
    const team = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(
      runtime.query(`UPDATE ${MEMBERSHIPS} SET role = $3 WHERE project_id = $1 AND person_id = $2`, [
        team.projectId,
        team.developerId,
        MEMBERSHIP_ROLE.productManager,
      ]),
    );
  });

  it("AC7: allows product managers in different projects", async () => {
    const first = await createProjectWithTeam(runtime);
    const second = await createProjectWithTeam(runtime);
    expect(first.productManagerId).not.toBe(second.productManagerId);
  });

  it("AC7: swaps the product manager in one transaction (demote, then promote)", async () => {
    const team = await createProjectWithTeam(runtime);
    const setRole = `UPDATE ${MEMBERSHIPS} SET role = $3, version = version + 1
                      WHERE project_id = $1 AND person_id = $2`;

    await runtime.query("BEGIN");
    try {
      await runtime.query(setRole, [team.projectId, team.productManagerId, MEMBERSHIP_ROLE.developer]);
      await runtime.query(setRole, [team.projectId, team.developerId, MEMBERSHIP_ROLE.productManager]);
      await runtime.query("COMMIT");
    } catch (error) {
      await runtime.query("ROLLBACK");
      throw error;
    }

    const { rows } = await runtime.query<{ person_id: string; role: string }>(
      `SELECT person_id, role FROM ${MEMBERSHIPS} WHERE project_id = $1`,
      [team.projectId],
    );
    const roles = Object.fromEntries(rows.map((row) => [row.person_id, row.role]));
    expect(roles).toEqual({
      [team.productManagerId]: MEMBERSHIP_ROLE.developer,
      [team.developerId]: MEMBERSHIP_ROLE.productManager,
    });
    expect(rows.filter((row) => row.role === MEMBERSHIP_ROLE.productManager)).toHaveLength(1);
  });
});
