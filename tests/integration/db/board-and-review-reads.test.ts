/**
 * OpenSpec task 4.4 (tasks-board-detail-review-queue): PostgreSQL integration tests for the board,
 * review-queue and "my projects" reads, run through the real repositories as `app_runtime`
 * (design.md D-K). No formal requirement IDs exist; cited by name: task-management "Project
 * members read the task board", "Board cards and board reads" and "Product manager reads the
 * review queue"; design.md "Board, Detail and Review Queue Decisions (4.4)" B3, B5, B7.
 *
 * Seams chosen by the 4.4 test-writer (reported in the handoff):
 *   new TaskBoardRepository(database)
 *     listProjectTasks(projectId) / listAssignedTasks(projectId, assigneeId)
 *       -> [{ id, taskKey, title, status, version, assignee: { id, githubUsername }, dueDate }]
 *   new ReviewQueueRepository(database)
 *     listInReviewTasks(projectId)
 *       -> [{ id, taskKey, title, version, assignee, dueDate, attachedCommits: [{ id, sha, ... }],
 *             submissionCheckResultId }]
 *   ProjectRepository.listProjectsForMember(personId) -> [{ id, key, name, role }]
 * All reads exclude deleted tasks; task lists are ordered by task number, then id (B7). Task
 * numbers are unique per project, so the id tie-breaker cannot be observed here.
 *
 * Fixtures are written by the superuser client; the repositories read as `app_runtime`.
 * Needs TEST_DATABASE_URL (a disposable PostgreSQL superuser URL); skipped otherwise. Every
 * person, project and task is synthetic.
 */
import { randomBytes } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProjectRepository } from "@/server/projects";
import { ReviewQueueRepository } from "@/server/review-queue";
import { TaskBoardRepository } from "@/server/task-board";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  SCHEMA,
  addMembership,
  allocateTaskNumber,
  createPerson,
  createProjectWithTeam,
  insertRow,
  insertTaskChild,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

type Status = "to_do" | "in_progress" | "in_review" | "done";

dbDescribe("board, review queue and my-projects reads (task 4.4)", () => {
  const db = useMigratedDatabase();
  let admin: pg.Client;
  let board: TaskBoardRepository;
  let queue: ReviewQueueRepository;
  let projects: ProjectRepository;

  beforeAll(async () => {
    admin = db().admin;
    const pool = runtimePool(() => db().connectAsRuntime());
    board = new TaskBoardRepository(pool as unknown as ConstructorParameters<typeof TaskBoardRepository>[0]);
    queue = new ReviewQueueRepository(pool as unknown as ConstructorParameters<typeof ReviewQueueRepository>[0]);
    projects = new ProjectRepository(pool as unknown as ConstructorParameters<typeof ProjectRepository>[0]);
  });

  interface Team { projectId: string; projectKey: string; pm: string; devA: string; devB: string }

  async function team(): Promise<Team> {
    const base = await createProjectWithTeam(admin);
    const devB = await createPerson(admin);
    await addMembership(admin, base.projectId, devB, MEMBERSHIP_ROLE.developer);
    return { projectId: base.projectId, projectKey: base.projectKey, pm: base.productManagerId, devA: base.developerId, devB };
  }

  async function username(personId: string): Promise<string> {
    const { rows } = await admin.query(`SELECT github_username FROM ${SCHEMA}.${ENTITY_TABLES.people} WHERE id = $1`, [personId]);
    return rows[0].github_username as string;
  }

  async function task(t: Team, assigneeId: string, status: Status, title: string, dueDate = "2026-12-01") {
    const number = await allocateTaskNumber(admin, t.projectId);
    const row = await insertRow(admin, ENTITY_TABLES.tasks, {
      project_id: t.projectId, number, title, description: "Synthetic description",
      assignee_id: assigneeId, due_date: dueDate, status,
    });
    return { id: row.id as string, number, key: `${t.projectKey}-${number}` };
  }

  async function remove(taskId: string): Promise<void> {
    await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.tasks} SET deleted_at = now() WHERE id = $1`, [taskId]);
  }

  async function check(t: Team, taskId: string): Promise<string> {
    const anchorSha = randomBytes(20).toString("hex");
    const row = await insertTaskChild(admin, ENTITY_TABLES.checkResults, { taskId, projectId: t.projectId, actorId: t.devA }, {
      path_rules_hash: randomBytes(32).toString("hex"),
      result: JSON.stringify({ anchorSha, criteria: [], possibleGaps: [], omittedFiles: [] }),
    });
    return row.id as string;
  }

  async function submission(t: Team, taskId: string, checkResultId: string | null, createdAt: string): Promise<void> {
    await insertTaskChild(admin, ENTITY_TABLES.taskEvents, { taskId, projectId: t.projectId, actorId: t.devA }, {
      event_type: "submission", from_status: "in_progress", to_status: "in_review",
      check_result_id: checkResultId, created_at: createdAt,
    });
  }

  async function attach(t: Team, taskId: string): Promise<string> {
    const sha = randomBytes(20).toString("hex");
    await insertTaskChild(admin, ENTITY_TABLES.attachedCommits, { taskId, projectId: t.projectId, actorId: t.devA }, { commit_sha: sha });
    return sha;
  }

  // -------------------------------------------------------------------------
  // Board
  // -------------------------------------------------------------------------

  it("lists every non-deleted task of the project for the product manager, by task number", async () => {
    const t = await team();
    const other = await team();
    const first = await task(t, t.devA, "to_do", "Synthetic first", "2026-12-03");
    const second = await task(t, t.devB, "in_review", "Synthetic second");
    const deleted = await task(t, t.devA, "in_progress", "Synthetic deleted");
    const third = await task(t, t.devA, "done", "Synthetic third");
    await remove(deleted.id);
    await task(other, other.devA, "to_do", "Synthetic other project");

    const records = await board.listProjectTasks(t.projectId);

    expect(records.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
    expect(records[0]).toMatchObject({
      id: first.id, taskKey: first.key, title: "Synthetic first", status: "to_do", version: 1,
      assignee: { id: t.devA, githubUsername: await username(t.devA) }, dueDate: "2026-12-03",
    });
    expect(records[1]).toMatchObject({ status: "in_review", assignee: { id: t.devB } });
  });

  it("lists only the developer's own non-deleted tasks", async () => {
    const t = await team();
    const own = await task(t, t.devA, "in_progress", "Synthetic own");
    await task(t, t.devB, "to_do", "Synthetic someone else's");
    const ownDeleted = await task(t, t.devA, "to_do", "Synthetic own deleted");
    const ownLater = await task(t, t.devA, "to_do", "Synthetic own later");
    await remove(ownDeleted.id);

    const records = await board.listAssignedTasks(t.projectId, t.devA);

    expect(records.map((item) => item.id)).toEqual([own.id, ownLater.id]);
    expect(JSON.stringify(records)).not.toContain("Synthetic someone else's");
    expect(JSON.stringify(records)).not.toContain(await username(t.devB));
  });

  it("does not list a developer's tasks from another project", async () => {
    const t = await team();
    const other = await team();
    await addMembership(admin, other.projectId, t.devA, MEMBERSHIP_ROLE.developer);
    await task(other, t.devA, "to_do", "Synthetic elsewhere");

    expect(await board.listAssignedTasks(t.projectId, t.devA)).toEqual([]);
  });

  it("reads the current version after an update", async () => {
    const t = await team();
    const created = await task(t, t.devA, "to_do", "Synthetic versioned");
    await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.tasks} SET title = 'Synthetic renamed' WHERE id = $1`, [created.id]);

    const [record] = await board.listProjectTasks(t.projectId);

    expect(record).toMatchObject({ id: created.id, title: "Synthetic renamed", version: 2 });
  });

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  it("lists only non-deleted In Review tasks of the project, by task number", async () => {
    const t = await team();
    const other = await team();
    const reviewA = await task(t, t.devA, "in_review", "Synthetic review A");
    await task(t, t.devA, "in_progress", "Synthetic not in review");
    const reviewDeleted = await task(t, t.devB, "in_review", "Synthetic review deleted");
    const reviewB = await task(t, t.devB, "in_review", "Synthetic review B");
    await task(t, t.devB, "done", "Synthetic done");
    await remove(reviewDeleted.id);
    await task(other, other.devA, "in_review", "Synthetic other project review");

    const records = await queue.listInReviewTasks(t.projectId);

    expect(records.map((item) => item.id)).toEqual([reviewA.id, reviewB.id]);
    expect(records[0]).toMatchObject({
      id: reviewA.id, taskKey: reviewA.key, title: "Synthetic review A", version: 1,
      assignee: { id: t.devA, githubUsername: await username(t.devA) }, dueDate: "2026-12-01",
    });
  });

  it("includes each entry's attached commits", async () => {
    const t = await team();
    const review = await task(t, t.devA, "in_review", "Synthetic with commits");
    const shas = [await attach(t, review.id), await attach(t, review.id)];

    const [record] = await queue.listInReviewTasks(t.projectId);

    expect(record.attachedCommits.map((item) => item.sha).sort()).toEqual([...shas].sort());
  });

  it("references the check result of the most recent submission event", async () => {
    const t = await team();
    const review = await task(t, t.devA, "in_review", "Synthetic resubmitted");
    const firstCheck = await check(t, review.id);
    const latestCheck = await check(t, review.id);
    // Inserted latest-first so insertion order cannot stand in for event time.
    await submission(t, review.id, latestCheck, "2026-11-03T00:00:00Z");
    await submission(t, review.id, firstCheck, "2026-11-01T00:00:00Z");

    const [record] = await queue.listInReviewTasks(t.projectId);

    expect(record.submissionCheckResultId).toBe(latestCheck);
  });

  it("references no result when the most recent submission has no check, even if an earlier one did", async () => {
    const t = await team();
    const review = await task(t, t.devA, "in_review", "Synthetic latest without check");
    const earlierCheck = await check(t, review.id);
    await submission(t, review.id, earlierCheck, "2026-11-01T00:00:00Z");
    await submission(t, review.id, null, "2026-11-02T00:00:00Z");

    const [record] = await queue.listInReviewTasks(t.projectId);

    expect(record.submissionCheckResultId).toBeNull();
  });

  it("references no result when the task has no submission event", async () => {
    const t = await team();
    await task(t, t.devA, "in_review", "Synthetic without submission");

    const [record] = await queue.listInReviewTasks(t.projectId);

    expect(record.submissionCheckResultId).toBeNull();
    expect(record.attachedCommits).toEqual([]);
  });

  it("lists each In Review task once, whatever its number of submissions and commits", async () => {
    const t = await team();
    const review = await task(t, t.devA, "in_review", "Synthetic many events");
    await attach(t, review.id);
    await attach(t, review.id);
    await submission(t, review.id, await check(t, review.id), "2026-11-01T00:00:00Z");
    await submission(t, review.id, await check(t, review.id), "2026-11-02T00:00:00Z");

    const records = await queue.listInReviewTasks(t.projectId);

    expect(records.map((item) => item.id)).toEqual([review.id]);
  });

  // -------------------------------------------------------------------------
  // My projects (B3)
  // -------------------------------------------------------------------------

  it("lists the projects a person is a member of, with that person's role", async () => {
    const t = await team();
    const other = await team();
    await addMembership(admin, other.projectId, t.devA, MEMBERSHIP_ROLE.developer);
    const outsider = await createPerson(admin);
    const { rows } = await admin.query(`SELECT id::text AS id, key, name FROM ${SCHEMA}.${ENTITY_TABLES.projects} WHERE id = ANY($1::uuid[])`, [[t.projectId, other.projectId]]);
    const byId = new Map(rows.map((row) => [row.id as string, row]));

    const forDeveloper = await projects.listProjectsForMember(t.devA);
    const forManager = await projects.listProjectsForMember(t.pm);

    expect([...forDeveloper].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [t.projectId, other.projectId].sort().map((id) => ({ id, key: byId.get(id)!.key, name: byId.get(id)!.name, role: "developer" })),
    );
    expect(forManager).toEqual([{ id: t.projectId, key: byId.get(t.projectId)!.key, name: byId.get(t.projectId)!.name, role: "product_manager" }]);
    expect(await projects.listProjectsForMember(outsider)).toEqual([]);
  });

  it("orders a person's projects by name, then id (B3)", async () => {
    const person = await createPerson(admin);
    // Same-case ASCII names, so the order does not depend on the collation.
    const names = ["Synthetic Gamma", "Synthetic Alpha", "Synthetic Beta", "Synthetic Alpha"];
    const created: { id: string; name: string }[] = [];
    for (const name of names) {
      const project = await createProjectWithTeam(admin);
      await admin.query(`UPDATE ${SCHEMA}.${ENTITY_TABLES.projects} SET name = $2 WHERE id = $1`, [project.projectId, name]);
      await addMembership(admin, project.projectId, person, MEMBERSHIP_ROLE.developer);
      created.push({ id: project.projectId, name });
    }
    const { rows } = await admin.query<{ id: string }>(
      `SELECT id::text AS id FROM ${SCHEMA}.${ENTITY_TABLES.projects} WHERE id = ANY($1::uuid[]) AND name = 'Synthetic Alpha' ORDER BY id`,
      [created.map((project) => project.id)],
    );
    const byName = (name: string) => created.filter((project) => project.name === name).map((project) => project.id);

    const listed = await projects.listProjectsForMember(person);

    expect(listed.map((project) => project.id)).toEqual([
      ...rows.map((row) => row.id), ...byName("Synthetic Beta"), ...byName("Synthetic Gamma"),
    ]);
  });
});
