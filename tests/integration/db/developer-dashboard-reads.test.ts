import { randomBytes } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { TaskBoardRepository } from "@/server/task-board";
import { ENTITY_TABLES, SCHEMA, addMembership, createPerson, createProjectWithTeam, createTask, insertTaskChild, runtimePool, MEMBERSHIP_ROLE } from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

// Approved developer row metadata and authorization: real app_runtime read, synthetic data only.
dbDescribe("developer dashboard own-task projection", () => {
  const db = useMigratedDatabase();
  let repository: TaskBoardRepository;
  beforeAll(() => { repository = new TaskBoardRepository(runtimePool(() => db().connectAsRuntime())); });
  it("returns ordered live own tasks and independent update/commit counts without join multiplication", async () => {
    const admin = db().admin; const team = await createProjectWithTeam(admin);
    const other = await createPerson(admin); await addMembership(admin, team.projectId, other, MEMBERSHIP_ROLE.developer);
    const first = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
    const second = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
    const deleted = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
    await createTask(admin, { projectId: team.projectId, assigneeId: other });
    const elsewhere = await createProjectWithTeam(admin);
    await addMembership(admin, elsewhere.projectId, team.developerId, MEMBERSHIP_ROLE.developer);
    await createTask(admin, { projectId: elsewhere.projectId, assigneeId: team.developerId });
    await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.tasks} SET deleted_at = now() WHERE id = $1`, [deleted.id]);
    await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.tasks} SET description = $2, branch_name = $3 WHERE id = $1`, [first.id, "Synthetic dashboard description", "synthetic/dashboard"]);
    const context = { taskId: first.id, projectId: team.projectId, actorId: team.developerId };
    for (let i = 0; i < 2; i++) await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context);
    for (let i = 0; i < 3; i++) await insertTaskChild(admin, ENTITY_TABLES.attachedCommits, context, { commit_sha: randomBytes(20).toString("hex") });
    const records = await repository.listAssignedDashboardTasks(team.projectId, team.developerId);
    expect(records.map(record => record.id)).toEqual([first.id, second.id]);
    expect(records[0]).toMatchObject({ description: "Synthetic dashboard description", branchName: "synthetic/dashboard", progressUpdateCount: 2, attachedCommitCount: 3 });
    expect(records[1]).toMatchObject({ branchName: null, progressUpdateCount: 0, attachedCommitCount: 0 });
  });
});
