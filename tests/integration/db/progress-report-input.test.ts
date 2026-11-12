import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createProgressReportRepository, createProgressReportService, resolveReportRange } from "@/server/progress-report";
import { dbDescribe, useMigratedDatabase } from "./support/harness";
import { addMembership, createPerson, createProjectWithTeam, createTask, ENTITY_TABLES, insertTaskChild, runtimePool } from "./support/fixtures";

const rangeResult = resolveReportRange({ startDate: "2026-11-09", endDate: "2026-11-09" }, "2026-11-09");
if (rangeResult.kind !== "valid") throw new Error("Synthetic test range must be valid");
const range = rangeResult.range;

dbDescribe("progress report actual PostgreSQL reads (8.1 D1-D3/D5/D8)", () => {
  const database = useMigratedDatabase();
  function repository() { return createProgressReportRepository(runtimePool(database().connectAsRuntime)); }

  it("projects real schema, excludes foreign/deleted tasks, and uses exact SGT boundaries", async () => {
    const { admin } = database();
    const team = await createProjectWithTeam(admin);
    const other = await createProjectWithTeam(admin);
    const live = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId, status: "in_progress" });
    const deleted = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
    const foreign = await createTask(admin, { projectId: other.projectId, assigneeId: other.developerId });
    await admin.query("UPDATE app.tasks SET deleted_at = $2 WHERE id = $1", [deleted.id, "2026-11-08T00:00:00Z"]);
    const context = { projectId: team.projectId, taskId: live.id, actorId: team.developerId };
    const insideStart = await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "At start", created_at: range.startUtc });
    const insideEnd = await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "Last millisecond", created_at: "2026-11-09T15:59:59.999Z" });
    const before = await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "Before", created_at: "2026-11-08T15:59:59.999Z" });
    const after = await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "After", created_at: range.endUtcExclusive });
    await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, { ...context, taskId: deleted.id }, { body: "Deleted activity", created_at: range.startUtc });
    await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, { projectId: other.projectId, taskId: foreign.id, actorId: other.developerId }, { body: "Foreign activity", created_at: range.startUtc });
    const snapshot = await repository().withReadSnapshot((session) => session.readInputs({ projectId: team.projectId, range }));
    expect(snapshot.projectId).toBe(team.projectId);
    expect(snapshot.tasks.map((task) => task.taskId)).toEqual([live.id]);
    expect(snapshot.tasks[0]).toMatchObject({ taskKey: `${team.projectKey}-${live.number}`, title: "Synthetic task", status: "in_progress", dueDate: "2026-11-30", currentAssignee: { personId: team.developerId } });
    expect(snapshot.activity.map((row) => row.sourceId)).toEqual([insideStart.id, insideEnd.id]);
    expect(snapshot.activity.every((row) => row.taskId === live.id && row.type === "progress_update")).toBe(true);
    expect(snapshot.activity.map((row) => row.sourceId)).not.toEqual(expect.arrayContaining([before.id, after.id]));
    expect(snapshot.activity[0]).toMatchObject({ occurredAt: range.startUtc, actor: { personId: team.developerId }, payload: { body: "At start" } });
    expect(JSON.stringify(snapshot)).not.toContain("Synthetic description");
  });

  it("reads membership and SGT clock from PostgreSQL and refuses developer/nonmember access", async () => {
    const { admin } = database();
    const team = await createProjectWithTeam(admin);
    const foreign = await createProjectWithTeam(admin);
    const repo = repository();
    await repo.withReadSnapshot(async (session) => {
      expect(await session.readAccess({ projectId: team.projectId, personId: team.productManagerId })).toBe("product_manager");
      expect(await session.readAccess({ projectId: team.projectId, personId: team.developerId })).toBe("developer");
      expect(await session.readAccess({ projectId: team.projectId, personId: foreign.productManagerId })).toBe("not_found");
      const expected = await admin.query("SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') AS day");
      expect(await session.readCurrentSgtDate()).toBe(expected.rows[0].day);
    });
    const readBySha = vi.fn();
    const service = createProgressReportService({ repository: repo, githubMetadata: { readBySha } });
    await expect(service.assemble({ projectId: team.projectId, personId: team.developerId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.assemble({ projectId: team.projectId, personId: foreign.productManagerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(readBySha).not.toHaveBeenCalled();
  });

  it("projects persisted check counts, lifecycle transitions, reassignment and attached commits without raw evidence", async () => {
    const { admin } = database();
    const team = await createProjectWithTeam(admin);
    const nextDeveloper = await createPerson(admin);
    await addMembership(admin, team.projectId, nextDeveloper, "developer");
    const task = await createTask(admin, { projectId: team.projectId, assigneeId: nextDeveloper, status: "in_progress" });
    const secondTask = await createTask(admin, { projectId: team.projectId, assigneeId: nextDeveloper });
    const context = { projectId: team.projectId, taskId: task.id, actorId: team.developerId };
    const anchorSha = "c".repeat(40);
    // Persisted JSON shape and SQL column names supplied by dispatcher from the shipped schema.
    const result = JSON.stringify({
      anchorSha,
      criteria: [{ criterionId: "criterion-a", criterion: "EXCLUDED_CRITERION_TEXT", status: "addressed", evidence: ["EXCLUDED_CHECK_EVIDENCE"] }],
      possibleGaps: ["EXCLUDED_GAP_ONE", "EXCLUDED_GAP_TWO"],
      omittedFiles: ["EXCLUDED_OMITTED_FILE"],
    });
    const earlierCheck = await insertTaskChild(admin, ENTITY_TABLES.checkResults, context, { result, created_at: "2026-11-08T15:59:59.999Z" });
    const currentCheck = await insertTaskChild(admin, ENTITY_TABLES.checkResults, context, { result, redacted: true, created_at: "2026-11-09T00:00:00Z" });
    const submitOld = await insertTaskChild(admin, ENTITY_TABLES.taskEvents, context, {
      event_type: "submission", from_status: "in_progress", to_status: "in_review", check_result_id: earlierCheck.id, created_at: "2026-11-08T17:00:00Z",
    });
    const submitNew = await insertTaskChild(admin, ENTITY_TABLES.taskEvents, context, {
      event_type: "submission", from_status: "in_progress", to_status: "in_review", check_result_id: currentCheck.id, created_at: "2026-11-09T01:00:00Z",
    });
    const pmContext = { ...context, actorId: team.productManagerId };
    const feedback = await insertTaskChild(admin, ENTITY_TABLES.taskEvents, pmContext, {
      event_type: "review_feedback", from_status: "in_review", to_status: "in_progress", feedback: "Please revise", created_at: "2026-11-09T02:00:00Z",
    });
    await insertTaskChild(admin, ENTITY_TABLES.taskEvents, pmContext, {
      event_type: "review_feedback", from_status: "in_review", to_status: "in_progress", feedback: "Please revise again", created_at: "2026-11-09T03:00:00Z",
    });
    const assigned = await insertTaskChild(admin, ENTITY_TABLES.taskEvents, pmContext, {
      event_type: "assignment_change", previous_assignee_id: team.developerId, new_assignee_id: nextDeveloper, created_at: "2026-11-09T04:00:00Z",
    });
    const approved = await insertTaskChild(admin, ENTITY_TABLES.taskEvents, pmContext, {
      event_type: "state_change", from_status: "in_review", to_status: "done", created_at: "2026-11-09T05:00:00Z",
    });
    const attachmentTime = "2026-11-10T00:00:00.000Z";
    await insertTaskChild(admin, ENTITY_TABLES.attachedCommits, context, { commit_sha: anchorSha, created_at: attachmentTime });
    await insertTaskChild(admin, ENTITY_TABLES.attachedCommits, { ...context, taskId: secondTask.id }, { commit_sha: anchorSha, created_at: attachmentTime });
    const repo = repository();
    const snapshot = await repo.withReadSnapshot((session) => session.readInputs({ projectId: team.projectId, range }));
    const checks = snapshot.activity.filter((row) => row.type === "criteria_check");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ sourceId: currentCheck.id, payload: {
      resultId: currentCheck.id, createdAt: "2026-11-09T00:00:00.000Z", model: "synthetic-model", anchorSha, redacted: true,
      criteria: [{ criterionId: "criterion-a", status: "addressed" }], gapCount: 2, omissionCount: 1,
    } });
    expect(snapshot.activity).toHaveLength(7);
    expect(snapshot.activity.find((row) => row.sourceId === submitOld.id)).toMatchObject({ type: "submission", actor: { personId: team.developerId }, payload: { fromStatus: "in_progress", toStatus: "in_review", checkResultId: earlierCheck.id } });
    expect(snapshot.activity.find((row) => row.sourceId === submitNew.id)).toMatchObject({ type: "submission", payload: { checkResultId: currentCheck.id } });
    expect(snapshot.activity.find((row) => row.sourceId === feedback.id)).toMatchObject({ type: "review_feedback", actor: { personId: team.productManagerId }, payload: { fromStatus: "in_review", toStatus: "in_progress", feedback: "Please revise" } });
    expect(snapshot.activity.find((row) => row.sourceId === assigned.id)).toMatchObject({ type: "assignment_change", payload: { fromAssigneeId: team.developerId, toAssigneeId: nextDeveloper } });
    expect(snapshot.activity.find((row) => row.sourceId === approved.id)).toMatchObject({ type: "state_change", actor: { personId: team.productManagerId }, payload: { fromStatus: "in_review", toStatus: "done" } });
    expect(snapshot.tasks.find((row) => row.taskId === task.id)).toMatchObject({ currentAssignee: { personId: nextDeveloper }, requestChangesCount: 2 });
    expect(snapshot.attachedCommits).toEqual(expect.arrayContaining([
      { taskId: task.id, taskKey: `${team.projectKey}-${task.number}`, sha: anchorSha, attachedAt: attachmentTime },
      { taskId: secondTask.id, taskKey: `${team.projectKey}-${secondTask.number}`, sha: anchorSha, attachedAt: attachmentTime },
    ]));
    const serialized = JSON.stringify(snapshot);
    for (const marker of ["EXCLUDED_CRITERION_TEXT", "EXCLUDED_CHECK_EVIDENCE", "EXCLUDED_GAP_ONE", "EXCLUDED_GAP_TWO", "EXCLUDED_OMITTED_FILE"]) expect(serialized).not.toContain(marker);
  });

  it("holds one consistent snapshot across competing updates and sees them in the next snapshot", async () => {
    const { admin } = database();
    const team = await createProjectWithTeam(admin);
    const task = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
    const context = { projectId: team.projectId, taskId: task.id, actorId: team.developerId };
    await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "Before snapshot", created_at: range.startUtc });
    const repo = repository();
    const during = await repo.withReadSnapshot(async (session) => {
      await session.readAccess({ projectId: team.projectId, personId: team.productManagerId });
      // A separate connection commits while the report's read snapshot remains open.
      await admin.query("UPDATE app.tasks SET title = $2 WHERE id = $1", [task.id, "After concurrent update"]);
      await insertTaskChild(admin, ENTITY_TABLES.progressUpdates, context, { body: "After snapshot", created_at: "2026-11-09T00:00:00Z" });
      return session.readInputs({ projectId: team.projectId, range });
    });
    expect(during.tasks[0].title).toBe("Synthetic task");
    expect(during.activity).toHaveLength(1);
    const after = await repo.withReadSnapshot((session) => session.readInputs({ projectId: team.projectId, range }));
    expect(after.tasks[0].title).toBe("After concurrent update");
    expect(after.activity).toHaveLength(2);
  });
});
