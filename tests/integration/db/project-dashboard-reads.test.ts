/** Task 4.7 D2-D6: real aggregate repository, isolated synthetic PostgreSQL fixtures.
 * Public contract: new ProjectDashboardRepository(pool).readSnapshot(projectId)
 * returns {stateCounts, memberCount, completedToday, members:[{personId,
 * githubUsername,role,stateCounts}]}. Runtime credentials come only from the harness.
 */
import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";
import { addMembership, allocateTaskNumber, createPerson, createProjectWithTeam, ENTITY_TABLES, insertRow, insertTaskChild, runtimePool, SCHEMA } from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";
import type { ProjectDashboardRepository } from "@/server/project-dashboard";
vi.mock("server-only", () => ({}));
type State = "to_do" | "in_progress" | "in_review" | "done";
type Team = Awaited<ReturnType<typeof createProjectWithTeam>>;

dbDescribe("Project dashboard aggregate reads (4.7 D2-D6)", () => {
  const db = useMigratedDatabase();
  let admin: pg.Client;
  let repository: ProjectDashboardRepository;
  let Repository: typeof ProjectDashboardRepository;
  beforeAll(async () => {
    admin = db().admin;
    ({ ProjectDashboardRepository: Repository } = await import("@/server/project-dashboard"));
    repository = new Repository(runtimePool(() => db().connectAsRuntime()));
  });
  async function task(t: Team, person: string, status: State) {
    const number = await allocateTaskNumber(admin, t.projectId);
    const row = await insertRow(admin, ENTITY_TABLES.tasks, { project_id: t.projectId, number, title: "Synthetic private task title", description: "Synthetic private description", assignee_id: person, due_date: "2026-12-01", status });
    return row.id as string;
  }
  async function event(t: Team, taskId: string, at: string, eventType = "state_change", toStatus = "done") {
    await insertTaskChild(admin, ENTITY_TABLES.taskEvents, { taskId, projectId: t.projectId, actorId: t.productManagerId }, { event_type: eventType, from_status: "in_review", to_status: toStatus, created_at: at });
  }
  async function boundaries() {
    const result = await admin.query<{ start: string; end: string }>(`SELECT
      to_char((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start,
      to_char(((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') + interval '1 day') AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end`);
    return result.rows[0];
  }
  it("isolates projects, excludes deleted tasks from every aggregate and includes zero developers", async () => {
    const t = await createProjectWithTeam(admin); const other = await createProjectWithTeam(admin);
    const zero = await createPerson(admin); await addMembership(admin, t.projectId, zero, "developer");
    await task(t, t.developerId, "to_do"); await task(t, t.developerId, "done");
    const deleted = await task(t, t.developerId, "done");
    await event(t, deleted, (await boundaries()).start);
    await admin.query(`UPDATE ${SCHEMA}.tasks SET deleted_at = now() WHERE id = $1`, [deleted]);
    const foreign = await task(other, other.developerId, "done"); await event(other, foreign, (await boundaries()).start);
    const result = await repository.readSnapshot(t.projectId);
    expect(result).toMatchObject({ stateCounts: { to_do: 1, in_progress: 0, in_review: 0, done: 1 }, memberCount: 3, completedToday: 0 });
    expect(result.members.find(row => row.personId === zero)?.stateCounts).toEqual({ to_do: 0, in_progress: 0, in_review: 0, done: 0 });
    expect(result.members.some(row => row.personId === other.developerId)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Synthetic private|description|taskKey|evidence/);
  });
  it("counts distinct approval events at SGT start inclusive and next midnight exclusive using database time", async () => {
    const t = await createProjectWithTeam(admin); const { start, end } = await boundaries();
    const atStart = await task(t, t.developerId, "done");
    await event(t, atStart, start); await event(t, atStart, new Date(Date.parse(start) + 1000).toISOString());
    const before = await task(t, t.developerId, "done"); await event(t, before, new Date(Date.parse(start) - 1).toISOString());
    const last = await task(t, t.developerId, "done"); await event(t, last, new Date(Date.parse(end) - 1).toISOString());
    const next = await task(t, t.developerId, "done"); await event(t, next, end);
    const wrongType = await task(t, t.developerId, "done"); await event(t, wrongType, start, "submission", "in_review");
    expect((await repository.readSnapshot(t.projectId)).completedToday).toBe(2);
  });
  it("ignores later task edits and non-Done events when determining completion date", async () => {
    const t = await createProjectWithTeam(admin); const { start } = await boundaries();
    const old = await task(t, t.developerId, "done"); await event(t, old, new Date(Date.parse(start) - 1000).toISOString());
    await admin.query(`UPDATE ${SCHEMA}.tasks SET title = $2 WHERE id = $1`, [old, "Synthetic edited today"]);
    const current = await task(t, t.developerId, "done"); await event(t, current, start);
    await admin.query(`UPDATE ${SCHEMA}.tasks SET description = $2 WHERE id = $1`, [current, "Synthetic edited later"]);
    const pending = await task(t, t.developerId, "in_progress"); await event(t, pending, start, "state_change", "in_progress");
    expect((await repository.readSnapshot(t.projectId)).completedToday).toBe(1);
  });
  it("retains the promoted developer's Done allocation and current membership count after PM transfer", async () => {
    const t = await createProjectWithTeam(admin); await task(t, t.developerId, "done");
    await admin.query("BEGIN");
    try {
      await admin.query(`UPDATE ${SCHEMA}.memberships SET role = 'developer' WHERE project_id = $1 AND person_id = $2`, [t.projectId, t.productManagerId]);
      await admin.query(`UPDATE ${SCHEMA}.memberships SET role = 'product_manager' WHERE project_id = $1 AND person_id = $2`, [t.projectId, t.developerId]);
      await admin.query("COMMIT");
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
    const result = await repository.readSnapshot(t.projectId);
    expect(result.memberCount).toBe(2); expect(result.stateCounts.done).toBe(1);
    expect(result.members.filter(row => row.personId === t.developerId)).toEqual([
      expect.objectContaining({ role: "product_manager", stateCounts: { to_do: 0, in_progress: 0, in_review: 0, done: 1 } }),
    ]);
  });
  it("orders current allocation members by lowercase username then person ID", async () => {
    const t = await createProjectWithTeam(admin);
    await admin.query(`UPDATE ${SCHEMA}.people SET github_username = 'Zulu' WHERE id = $1`, [t.productManagerId]);
    await admin.query(`UPDATE ${SCHEMA}.people SET github_username = 'beta' WHERE id = $1`, [t.developerId]);
    const a = await createPerson(admin, { github_username: "ALPHA" }); const b = await createPerson(admin, { github_username: "alpha" });
    await addMembership(admin, t.projectId, b, "developer"); await addMembership(admin, t.projectId, a, "developer");
    const result = await repository.readSnapshot(t.projectId);
    expect(result.members.map(row => row.personId)).toEqual([... [a, b].sort(), t.developerId, t.productManagerId]);
  });
  it("keeps counts, allocation and approval-today metrics in one snapshot under a competing write", async () => {
    const t = await createProjectWithTeam(admin); const id = await task(t, t.developerId, "to_do"); const { start } = await boundaries();
    let wrote = false;
    const pool = runtimePool(async () => {
      const client = await db().connectAsRuntime(); const query = client.query.bind(client);
      // Instrument only the database boundary. Insert a real competing committed write
      // after the first SELECT, so separate READ COMMITTED queries would mix snapshots.
      client.query = (async (...args: unknown[]) => {
        const result = await (query as (...values: unknown[]) => Promise<unknown>)(...args);
        const sql = typeof args[0] === "string" ? args[0] : String((args[0] as { text?: string })?.text);
        if (!wrote && /\bSELECT\b/i.test(sql)) {
          wrote = true; await admin.query("BEGIN");
          try {
            await admin.query(`UPDATE ${SCHEMA}.tasks SET status = 'done' WHERE id = $1`, [id]);
            await event(t, id, start); await admin.query("COMMIT");
          } catch (error) { await admin.query("ROLLBACK"); throw error; }
        }
        return result;
      }) as typeof client.query;
      return client;
    });
    const result = await new Repository(pool).readSnapshot(t.projectId);
    expect(wrote).toBe(true);
    const allocatedDone = result.members.reduce((sum, row) => sum + row.stateCounts.done, 0);
    expect([ [0, 0, 0], [1, 1, 1] ]).toContainEqual([result.stateCounts.done, allocatedDone, result.completedToday]);
    expect(Object.values(result.stateCounts).reduce((sum, n) => sum + n, 0)).toBe(1);
  });
});
