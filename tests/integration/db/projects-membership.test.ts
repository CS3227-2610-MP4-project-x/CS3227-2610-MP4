/**
 * OpenSpec task 4.1 (projects-membership-4-1): PostgreSQL integration tests for the project
 * and membership service, run through the real ProjectService and ProjectRepository as
 * `app_runtime` (design.md D-K). No formal requirement IDs exist; cited by name:
 * task-management "Signed-in people create projects", "Project membership and roles",
 * "Product manager transfers the role" (including "Competing transfers" and "Losing a
 * competing transfer"), "Transfer targets are identified by GitHub username" and "Projects
 * and tasks have readable IDs" ("Project key cannot change"). Decisions: D-C, D-D, D-E, D2,
 * D5, D6, D10, S1, S2, S4, S7, and the handoff assumptions A-2 and A-3.
 *
 * The service is wired as the composition root wires it: new ProjectService(new
 * ProjectRepository(pool), new PeopleRepository(pool)), so the real GitHub-username lookup
 * (S4, D5) runs against PostgreSQL. Every person and project is synthetic, and each test
 * uses its own rows.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProjectError, ProjectRepository, ProjectService, projectErrorResponse } from "@/server/projects";
import { PeopleRepository } from "@/server/repositories/people-repository";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  SCHEMA,
  addMembership,
  createPerson,
  createProject,
  createProjectWithTeam,
  createTask,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

const PEOPLE = `${SCHEMA}.${ENTITY_TABLES.people}`;
const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;
const MEMBERSHIPS = `${SCHEMA}.${ENTITY_TABLES.memberships}`;
const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const LOCK_WAIT_TIMEOUT_MS = 10_000;

function uniqueKey(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`.replace(/^[^A-Z]/, "K").slice(0, 10);
}

function uniqueUsername(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function expectProjectFailure(operation: Promise<unknown>, status: number, code: string): Promise<void> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  expect(error, `expected ProjectError ${code}`).toBeInstanceOf(ProjectError);
  const response = projectErrorResponse(error);
  expect(response.status).toBe(status);
  expect((await response.json() as { error: { code: string } }).error.code).toBe(code);
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  if (error === undefined) return undefined;
  return ((await projectErrorResponse(error).json()) as { error: { code: string } }).error.code;
}

dbDescribe("project creation, membership and product manager transfer (task 4.1)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let service: ProjectService;
  let peopleRepository: PeopleRepository;

  async function rolesOf(projectId: string): Promise<Record<string, string>> {
    const { rows } = await runtime.query<{ person_id: string; role: string }>(
      `SELECT person_id, role FROM ${MEMBERSHIPS} WHERE project_id = $1`,
      [projectId],
    );
    return Object.fromEntries(rows.map((row) => [row.person_id, row.role]));
  }

  async function productManagerCount(projectId: string): Promise<number> {
    const { rows } = await runtime.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${MEMBERSHIPS} WHERE project_id = $1 AND role = $2`,
      [projectId, MEMBERSHIP_ROLE.productManager],
    );
    return rows[0].n;
  }

  async function projectRow(projectId: string): Promise<{ key: string; name: string } | undefined> {
    const { rows } = await runtime.query<{ key: string; name: string }>(`SELECT key, name FROM ${PROJECTS} WHERE id = $1`, [projectId]);
    return rows[0];
  }

  async function setUsername(personId: string, username: string): Promise<void> {
    await runtime.query(`UPDATE ${PEOPLE} SET github_username = $2 WHERE id = $1`, [personId, username]);
  }

  async function usernameOf(personId: string): Promise<string> {
    const { rows } = await runtime.query<{ github_username: string }>(`SELECT github_username FROM ${PEOPLE} WHERE id = $1`, [personId]);
    return rows[0].github_username;
  }

  /** Waits until at least `count` backends in this test database are waiting on a lock. */
  async function waitForLockWaiters(count = 1): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    for (;;) {
      const { rows } = await db().admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (rows[0].n >= count) return;
      if (Date.now() > deadline) throw new Error("timed out waiting for a blocked transaction");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    const pool = runtimePool(() => db().connectAsRuntime());
    peopleRepository = new PeopleRepository(pool as unknown as ConstructorParameters<typeof PeopleRepository>[0]);
    service = new ProjectService(new ProjectRepository(pool as unknown as ConstructorParameters<typeof ProjectRepository>[0]), peopleRepository);
  });

  // -------------------------------------------------------------------------
  // GitHub-username lookup (D5, S4): PeopleRepository.findPeopleByGitHubUsername
  // -------------------------------------------------------------------------

  it("finds a person by exact username in any letter case and returns the stored username", async () => {
    const person = await createPerson(runtime);
    const stored = uniqueUsername("Synthetic-Lookup");
    await setUsername(person, stored);
    for (const submitted of [stored, stored.toLowerCase(), stored.toUpperCase()]) {
      expect(await peopleRepository.findPeopleByGitHubUsername(submitted)).toEqual([{ id: person, githubUsername: stored }]);
    }
  });

  it("matches the whole username only: no prefix, suffix, substring or pattern match", async () => {
    const person = await createPerson(runtime);
    const stored = uniqueUsername("exact");
    await setUsername(person, stored);
    for (const submitted of [stored.slice(0, -1), `${stored}x`, `x${stored}`, stored.slice(1, -1), `${stored.slice(0, 5)}%`, `${stored.slice(0, -1)}_`]) {
      expect(await peopleRepository.findPeopleByGitHubUsername(submitted)).toEqual([]);
    }
  });

  it("returns every person whose username differs only in letter case", async () => {
    const shared = uniqueUsername("case-twin");
    const lower = await createPerson(runtime);
    const upper = await createPerson(runtime);
    await setUsername(lower, shared.toLowerCase());
    await setUsername(upper, shared.toUpperCase());
    const matches = await peopleRepository.findPeopleByGitHubUsername(shared);
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(expect.arrayContaining([
      { id: lower, githubUsername: shared.toLowerCase() },
      { id: upper, githubUsername: shared.toUpperCase() },
    ]));
  });

  it("returns no match for an unregistered username", async () => {
    expect(await peopleRepository.findPeopleByGitHubUsername(uniqueUsername("nobody"))).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Creation (Signed-in people create projects, D2, D10)
  // -------------------------------------------------------------------------

  it("creates a project whose creator is its only product manager and only member", async () => {
    const creator = await createPerson(runtime);
    const key = uniqueKey("C");
    const view = await service.createProject(creator, { key, name: "Synthetic created project" });
    expect(view).toEqual({ id: expect.any(String), key, name: "Synthetic created project", role: MEMBERSHIP_ROLE.productManager });
    expect(await projectRow(view.id)).toEqual({ key, name: "Synthetic created project" });
    expect(await rolesOf(view.id)).toEqual({ [creator]: MEMBERSHIP_ROLE.productManager });
    expect(await productManagerCount(view.id)).toBe(1);
  });

  it("refuses a duplicate key with PROJECT_KEY_TAKEN and leaves the existing project unchanged", async () => {
    const existing = await createProjectWithTeam(runtime);
    const before = await projectRow(existing.projectId);
    const rolesBefore = await rolesOf(existing.projectId);
    const creator = await createPerson(runtime);
    await expectProjectFailure(service.createProject(creator, { key: existing.projectKey, name: "Synthetic duplicate" }), 409, "PROJECT_KEY_TAKEN");
    expect(await projectRow(existing.projectId)).toEqual(before);
    expect(await rolesOf(existing.projectId)).toEqual(rolesBefore);
    const { rows } = await runtime.query(`SELECT 1 FROM ${MEMBERSHIPS} WHERE person_id = $1`, [creator]);
    expect(rows).toEqual([]);
  });

  it("leaves no project row when creating the product manager membership fails (A-3)", async () => {
    const creator = await createPerson(runtime);
    const key = uniqueKey("A");
    const admin = db().admin;
    // Test-only trigger created by the harness superuser and dropped in this test. It fails
    // only for this synthetic creator, so no other test is affected.
    await admin.query(
      `CREATE FUNCTION app.test_fail_membership_insert() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.person_id = '${creator}'::uuid THEN
           RAISE EXCEPTION 'synthetic membership failure';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await admin.query(
      `CREATE TRIGGER test_fail_membership_insert BEFORE INSERT ON app.memberships
         FOR EACH ROW EXECUTE FUNCTION app.test_fail_membership_insert()`,
    );
    try {
      const error = await service.createProject(creator, { key, name: "Synthetic atomic" }).then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeDefined();
      expect(projectErrorResponse(error).status).toBe(500);
    } finally {
      await admin.query("DROP TRIGGER test_fail_membership_insert ON app.memberships");
      await admin.query("DROP FUNCTION app.test_fail_membership_insert()");
    }
    const { rows } = await runtime.query(`SELECT 1 FROM ${PROJECTS} WHERE key = $1`, [key]);
    expect(rows).toEqual([]);
  });

  it("keeps the creator's developer role in another project", async () => {
    const team = await createProjectWithTeam(runtime);
    const view = await service.createProject(team.developerId, { key: uniqueKey("K"), name: "Synthetic second project" });
    expect((await rolesOf(team.projectId))[team.developerId]).toBe(MEMBERSHIP_ROLE.developer);
    expect(await rolesOf(view.id)).toEqual({ [team.developerId]: MEMBERSHIP_ROLE.productManager });
  });

  it("lets two concurrent creations with the same key produce exactly one project", async () => {
    const [first, second] = [await createPerson(runtime), await createPerson(runtime)];
    const key = uniqueKey("R");
    const codes = await Promise.all([
      errorCode(service.createProject(first, { key, name: "Synthetic race one" })),
      errorCode(service.createProject(second, { key, name: "Synthetic race two" })),
    ]);
    expect(codes.sort()).toEqual(["PROJECT_KEY_TAKEN", undefined].sort());
    const { rows } = await runtime.query<{ id: string }>(`SELECT id FROM ${PROJECTS} WHERE key = $1`, [key]);
    expect(rows).toHaveLength(1);
    expect(await productManagerCount(rows[0].id)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  it("returns the project with the member's role and conceals it from non-members", async () => {
    const team = await createProjectWithTeam(runtime);
    const outsider = await createPerson(runtime);
    expect(await service.getProject(team.projectId, team.productManagerId)).toMatchObject({ id: team.projectId, key: team.projectKey, role: MEMBERSHIP_ROLE.productManager });
    expect(await service.getProject(team.projectId, team.developerId)).toMatchObject({ id: team.projectId, role: MEMBERSHIP_ROLE.developer });
    await expectProjectFailure(service.getProject(team.projectId, outsider), 404, "NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // Adding members (Project membership and roles, D5)
  // -------------------------------------------------------------------------

  it("adds a registered person as a developer by case-insensitive username and returns the stored username", async () => {
    const team = await createProjectWithTeam(runtime);
    const person = await createPerson(runtime);
    const stored = uniqueUsername("Synthetic-Member");
    await setUsername(person, stored);
    const view = await service.addMember(team.projectId, team.productManagerId, stored.toUpperCase());
    expect(view).toEqual({ personId: person, githubUsername: stored, role: MEMBERSHIP_ROLE.developer });
    expect((await rolesOf(team.projectId))[person]).toBe(MEMBERSHIP_ROLE.developer);
    // The new developer can see the project and be assigned its tasks.
    expect(await service.getProject(team.projectId, person)).toMatchObject({ role: MEMBERSHIP_ROLE.developer });
    await expect(createTask(runtime, { projectId: team.projectId, assigneeId: person })).resolves.toMatchObject({ number: 1 });
  });

  it("keeps a person's membership in another project when they are added to a second one", async () => {
    const first = await createProjectWithTeam(runtime);
    const second = await createProjectWithTeam(runtime);
    const username = await usernameOf(first.developerId);
    await service.addMember(second.projectId, second.productManagerId, username);
    expect((await rolesOf(first.projectId))[first.developerId]).toBe(MEMBERSHIP_ROLE.developer);
    expect((await rolesOf(second.projectId))[first.developerId]).toBe(MEMBERSHIP_ROLE.developer);
  });

  it("refuses an unregistered username with NOT_FOUND and an ambiguous one with GITHUB_USERNAME_AMBIGUOUS", async () => {
    const team = await createProjectWithTeam(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.addMember(team.projectId, team.productManagerId, uniqueUsername("nobody")), 404, "NOT_FOUND");
    const shared = uniqueUsername("dup");
    await setUsername(await createPerson(runtime), shared.toLowerCase());
    await setUsername(await createPerson(runtime), shared.toUpperCase());
    await expectProjectFailure(service.addMember(team.projectId, team.productManagerId, shared), 409, "GITHUB_USERNAME_AMBIGUOUS");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("refuses an existing member, including the product manager, with ALREADY_MEMBER and keeps the role", async () => {
    const team = await createProjectWithTeam(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.addMember(team.projectId, team.productManagerId, await usernameOf(team.developerId)), 409, "ALREADY_MEMBER");
    await expectProjectFailure(service.addMember(team.projectId, team.productManagerId, await usernameOf(team.productManagerId)), 409, "ALREADY_MEMBER");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("refuses a developer actor with FORBIDDEN and adds nothing", async () => {
    const team = await createProjectWithTeam(runtime);
    const person = await createPerson(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.addMember(team.projectId, team.developerId, await usernameOf(person)), 403, "FORBIDDEN");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("adds a person exactly once when two adds run concurrently", async () => {
    const team = await createProjectWithTeam(runtime);
    const person = await createPerson(runtime);
    const username = await usernameOf(person);
    const codes = await Promise.all([
      errorCode(service.addMember(team.projectId, team.productManagerId, username)),
      errorCode(service.addMember(team.projectId, team.productManagerId, username)),
    ]);
    expect(codes.sort()).toEqual(["ALREADY_MEMBER", undefined].sort());
    const { rows } = await runtime.query(`SELECT 1 FROM ${MEMBERSHIPS} WHERE project_id = $1 AND person_id = $2`, [team.projectId, person]);
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Transfer (D-C, D6, Transfer targets are identified by GitHub username)
  // -------------------------------------------------------------------------

  it("transfers the role in one change, found by username in any case, leaving exactly one product manager", async () => {
    const team = await createProjectWithTeam(runtime);
    const username = await usernameOf(team.developerId);
    const view = await service.transferProductManager(team.projectId, team.productManagerId, username.toUpperCase());
    expect(view).toEqual({ id: team.projectId, key: team.projectKey, name: "Synthetic project", role: MEMBERSHIP_ROLE.developer });
    expect(await rolesOf(team.projectId)).toEqual({
      [team.productManagerId]: MEMBERSHIP_ROLE.developer,
      [team.developerId]: MEMBERSHIP_ROLE.productManager,
    });
    expect(await productManagerCount(team.projectId)).toBe(1);
  });

  it.each(["to_do", "in_progress", "in_review"] as const)("refuses the transfer while the target has a %s task", async (status) => {
    const team = await createProjectWithTeam(runtime);
    await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, status });
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(
      service.transferProductManager(team.projectId, team.productManagerId, await usernameOf(team.developerId)),
      409,
      "TRANSFER_BLOCKED_OPEN_TASKS",
    );
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("is not blocked by the target's deleted or Done tasks", async () => {
    const team = await createProjectWithTeam(runtime);
    const deleted = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, status: "in_progress" });
    await runtime.query(`UPDATE ${TASKS} SET deleted_at = now() WHERE id = $1`, [deleted.id]);
    await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, status: "done" });
    await service.transferProductManager(team.projectId, team.productManagerId, await usernameOf(team.developerId));
    expect((await rolesOf(team.projectId))[team.developerId]).toBe(MEMBERSHIP_ROLE.productManager);
  });

  it("refuses a target who is not a developer in the project, or the product manager themselves", async () => {
    const team = await createProjectWithTeam(runtime);
    const outsider = await createPerson(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.transferProductManager(team.projectId, team.productManagerId, await usernameOf(outsider)), 409, "TRANSFER_TARGET_NOT_DEVELOPER");
    await expectProjectFailure(service.transferProductManager(team.projectId, team.productManagerId, await usernameOf(team.productManagerId)), 409, "TRANSFER_TARGET_NOT_DEVELOPER");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("refuses unknown and ambiguous target usernames, leaving roles unchanged", async () => {
    const team = await createProjectWithTeam(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.transferProductManager(team.projectId, team.productManagerId, uniqueUsername("nobody")), 404, "NOT_FOUND");
    const shared = uniqueUsername("twin");
    await setUsername(team.developerId, shared.toLowerCase());
    await setUsername(await createPerson(runtime), shared.toUpperCase());
    await expectProjectFailure(service.transferProductManager(team.projectId, team.productManagerId, shared), 409, "GITHUB_USERNAME_AMBIGUOUS");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  it("refuses a developer trying to take the role with FORBIDDEN", async () => {
    const team = await createProjectWithTeam(runtime);
    const rolesBefore = await rolesOf(team.projectId);
    await expectProjectFailure(service.transferProductManager(team.projectId, team.developerId, await usernameOf(team.developerId)), 403, "FORBIDDEN");
    expect(await rolesOf(team.projectId)).toEqual(rolesBefore);
  });

  // -------------------------------------------------------------------------
  // Competing writes (Competing transfers, Losing a competing transfer, D6, S7)
  // -------------------------------------------------------------------------

  it("ends two concurrent transfers with exactly one product manager and refuses the loser with FORBIDDEN", async () => {
    const team = await createProjectWithTeam(runtime);
    const second = await createPerson(runtime);
    await addMembership(runtime, team.projectId, second, MEMBERSHIP_ROLE.developer);
    const [firstUsername, secondUsername] = [await usernameOf(team.developerId), await usernameOf(second)];
    const codes = await Promise.all([
      errorCode(service.transferProductManager(team.projectId, team.productManagerId, firstUsername)),
      errorCode(service.transferProductManager(team.projectId, team.productManagerId, secondUsername)),
    ]);
    expect(codes.sort()).toEqual(["FORBIDDEN", undefined].sort());
    expect(await productManagerCount(team.projectId)).toBe(1);
    expect((await rolesOf(team.projectId))[team.productManagerId]).toBe(MEMBERSHIP_ROLE.developer);
  });

  it("returns FORBIDDEN and changes nothing when another transfer commits while it waits on the locks (S7)", async () => {
    const team = await createProjectWithTeam(runtime);
    const second = await createPerson(runtime);
    await addMembership(runtime, team.projectId, second, MEMBERSHIP_ROLE.developer);
    const secondUsername = await usernameOf(second);
    const blocker = await db().connectAsRuntime();
    await blocker.query("BEGIN");
    try {
      // The competing transfer: lock the product manager's row, then swap to the developer.
      await blocker.query(`SELECT id FROM ${MEMBERSHIPS} WHERE project_id = $1 AND person_id = $2 FOR UPDATE`, [team.projectId, team.productManagerId]);
      const waiting = service.transferProductManager(team.projectId, team.productManagerId, secondUsername).then(() => undefined, (caught: unknown) => caught);
      await waitForLockWaiters();
      await blocker.query(`UPDATE ${MEMBERSHIPS} SET role = $3 WHERE project_id = $1 AND person_id = $2`, [team.projectId, team.productManagerId, MEMBERSHIP_ROLE.developer]);
      await blocker.query(`UPDATE ${MEMBERSHIPS} SET role = $3 WHERE project_id = $1 AND person_id = $2`, [team.projectId, team.developerId, MEMBERSHIP_ROLE.productManager]);
      await blocker.query("COMMIT");
      const error = await waiting;
      expect(error).toBeInstanceOf(ProjectError);
      const response = projectErrorResponse(error);
      expect(response.status).toBe(403);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    expect(await rolesOf(team.projectId)).toEqual({
      [team.productManagerId]: MEMBERSHIP_ROLE.developer,
      [team.developerId]: MEMBERSHIP_ROLE.productManager,
      [second]: MEMBERSHIP_ROLE.developer,
    });
  });

  it("refuses a transfer that waits on a concurrent task assignment to the target, once that assignment commits (D6)", async () => {
    const team = await createProjectWithTeam(runtime);
    const username = await usernameOf(team.developerId);
    const assigner = await db().connectAsRuntime();
    await assigner.query("BEGIN");
    try {
      // The assignee trigger share-locks the developer's membership row until COMMIT.
      await createTask(assigner, { projectId: team.projectId, assigneeId: team.developerId });
      const waiting = errorCode(service.transferProductManager(team.projectId, team.productManagerId, username));
      await waitForLockWaiters();
      await assigner.query("COMMIT");
      expect(await waiting).toBe("TRANSFER_BLOCKED_OPEN_TASKS");
    } finally {
      await assigner.query("ROLLBACK").catch(() => undefined);
    }
    expect(await rolesOf(team.projectId)).toEqual({
      [team.productManagerId]: MEMBERSHIP_ROLE.productManager,
      [team.developerId]: MEMBERSHIP_ROLE.developer,
    });
  });

  it("never completes a transfer while the incoming developer holds an open task when both race", async () => {
    const team = await createProjectWithTeam(runtime);
    const username = await usernameOf(team.developerId);
    const assigner = await db().connectAsRuntime();
    const assignment = (async () => {
      await assigner.query("BEGIN");
      try {
        await createTask(assigner, { projectId: team.projectId, assigneeId: team.developerId });
        await assigner.query("COMMIT");
        return true;
      } catch {
        await assigner.query("ROLLBACK");
        return false;
      }
    })();
    const [transferCode, assigned] = await Promise.all([
      errorCode(service.transferProductManager(team.projectId, team.productManagerId, username)),
      assignment,
    ]);
    const roles = await rolesOf(team.projectId);
    expect(await productManagerCount(team.projectId)).toBe(1);
    const { rows } = await runtime.query(
      `SELECT 1 FROM ${TASKS} WHERE project_id = $1 AND assignee_id = $2 AND status <> 'done' AND deleted_at IS NULL`,
      [team.projectId, team.developerId],
    );
    if (transferCode === undefined) {
      expect(roles[team.developerId]).toBe(MEMBERSHIP_ROLE.productManager);
      expect(rows).toEqual([]);
      expect(assigned).toBe(false);
    } else {
      expect(transferCode).toBe("TRANSFER_BLOCKED_OPEN_TASKS");
      expect(roles[team.productManagerId]).toBe(MEMBERSHIP_ROLE.productManager);
      expect(assigned).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Project key cannot change (D-D, A-2): the 4.1 operations never change a key.
  // -------------------------------------------------------------------------

  it("keeps the project key unchanged through adding members, transferring and a duplicate creation", async () => {
    const creator = await createPerson(runtime);
    const key = uniqueKey("I");
    const view = await service.createProject(creator, { key, name: "Synthetic immutable" });
    const developer = await createPerson(runtime);
    await service.addMember(view.id, creator, await usernameOf(developer));
    await service.transferProductManager(view.id, creator, await usernameOf(developer));
    await expectProjectFailure(service.createProject(await createPerson(runtime), { key, name: "Synthetic other" }), 409, "PROJECT_KEY_TAKEN");
    const other = await createProject(runtime);
    expect(other.key).not.toBe(key);
    const { rows } = await runtime.query<{ key: string }>(`SELECT key FROM ${PROJECTS} WHERE id = $1`, [view.id]);
    expect(rows).toEqual([{ key }]);
  });
});
