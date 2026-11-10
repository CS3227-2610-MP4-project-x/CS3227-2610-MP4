/**
 * OpenSpec task 4.3 (tasks-lifecycle-4-3): PostgreSQL integration tests for the task lifecycle,
 * run through the real TaskLifecycleService, TaskService and TaskRepository as `app_runtime`
 * (design.md D-K). No formal requirement IDs exist; cited by name: task-management "Task state
 * route" ("Competing transitions", "Stale version is refused"), "Task completion requires
 * product-manager approval", "Submission records attached commits and a matching check",
 * "Submission rechecks its inputs before it is stored", "Lifecycle changes are recorded as task
 * events" and "Developer submits task progress" ("Update racing with reassignment");
 * completion-assessment "AI check does not decide task completion". Decisions: design.md
 * "Task Lifecycle Decisions (4.3)" L1 to L6, T6 and U3.
 *
 * The submission tip lookup (completion-assessment) is replaced by a synthetic port that
 * computes the tip from the stored rows; no GitHub call is made. A stored check result's anchor
 * is its `result` JSON's `anchorSha`, as the check service stores it, and its `criteria_hash` is
 * the canonical hash of the criteria ordered by position then ID (completion-assessment
 * service.test.ts). Seam assumed (reported in the 4.3 handoff):
 *   new TaskLifecycleService(repository, { findSubmissionTip(projectId, taskId) })
 *   findSubmissionTip resolves null or { anchorSha, commitShas, criteria, criteriaHash }.
 *
 * Needs TEST_DATABASE_URL (a disposable PostgreSQL superuser URL); skipped otherwise. Every
 * person, project and task is synthetic, and each test uses its own rows.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TaskError, TaskLifecycleService, TaskRepository, TaskService } from "@/server/tasks";

import {
  ENTITY_TABLES,
  MEMBERSHIP_ROLE,
  SCHEMA,
  addMembership,
  createPerson,
  createProjectWithTeam,
  insertTaskChild,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const CRITERIA = `${SCHEMA}.${ENTITY_TABLES.acceptanceCriteria}`;
const EVENTS = `${SCHEMA}.${ENTITY_TABLES.taskEvents}`;
const UPDATES = `${SCHEMA}.${ENTITY_TABLES.progressUpdates}`;
const COMMITS = `${SCHEMA}.${ENTITY_TABLES.attachedCommits}`;

type TipPort = ConstructorParameters<typeof TaskLifecycleService>[1];
interface Tip { anchorSha: string; commitShas: string[]; criteria: { id: string; description: string; position: number }[]; criteriaHash: string }

async function codeOf(operation: Promise<unknown>): Promise<string | undefined> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  if (error === undefined) return undefined;
  if (!(error instanceof TaskError)) throw error;
  return error.code;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha(): string {
  return randomBytes(20).toString("hex");
}

dbDescribe("task lifecycle, competing writes and progress updates (task 4.3)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let repository: TaskRepository;
  let tasks: TaskService;
  /** What the synthetic tip port does for the next submission; reset by each test. */
  let tipBehaviour: (projectId: string, taskId: string) => Promise<Tip | null> = async () => null;
  let lifecycle: TaskLifecycleService;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    const pool = runtimePool(() => db().connectAsRuntime());
    repository = new TaskRepository(pool as unknown as ConstructorParameters<typeof TaskRepository>[0]);
    tasks = new TaskService(repository);
    const tips = { findSubmissionTip: (projectId: string, taskId: string) => tipBehaviour(projectId, taskId) };
    lifecycle = new TaskLifecycleService(repository, tips as unknown as TipPort);
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  interface Team { projectId: string; productManagerId: string; developerId: string; secondDeveloperId: string }

  async function team(): Promise<Team> {
    const base = await createProjectWithTeam(runtime);
    const secondDeveloperId = await createPerson(runtime);
    await addMembership(runtime, base.projectId, secondDeveloperId, MEMBERSHIP_ROLE.developer);
    return { projectId: base.projectId, productManagerId: base.productManagerId, developerId: base.developerId, secondDeveloperId };
  }

  async function newTask(t: Team, criteria: string[] = ["First criterion", "Second criterion"]) {
    return tasks.createTask(t.projectId, t.productManagerId, {
      title: "Synthetic task", description: "Synthetic description", assigneeId: t.developerId,
      dueDate: "2026-12-01", branchName: null, acceptanceCriteria: criteria,
    });
  }

  async function row(taskId: string): Promise<{ status: string; version: number; assignee_id: string }> {
    const { rows } = await runtime.query(`SELECT status, version, assignee_id FROM ${TASKS} WHERE id = $1`, [taskId]);
    return rows[0];
  }

  async function events(taskId: string) {
    const { rows } = await runtime.query(
      `SELECT actor_id, event_type, from_status, to_status, feedback, check_result_id
         FROM ${EVENTS} WHERE task_id = $1 ORDER BY created_at, id`,
      [taskId],
    );
    return rows;
  }

  async function attach(t: Team, taskId: string, commitSha: string): Promise<void> {
    await insertTaskChild(runtime, ENTITY_TABLES.attachedCommits, { taskId, projectId: t.projectId, actorId: t.developerId }, { commit_sha: commitSha });
  }

  /** Reads the stored commit set and criteria and builds the tip the real lookup would return. */
  async function tipFromStore(taskId: string, anchorSha: string): Promise<Tip> {
    const commits = await runtime.query<{ commit_sha: string }>(`SELECT commit_sha FROM ${COMMITS} WHERE task_id = $1`, [taskId]);
    const criteria = await runtime.query<{ id: string; description: string; position: number }>(
      `SELECT id::text AS id, description, position FROM ${CRITERIA} WHERE task_id = $1 ORDER BY position, id`,
      [taskId],
    );
    return {
      anchorSha,
      commitShas: [...new Set(commits.rows.map((entry) => entry.commit_sha))].sort(),
      criteria: criteria.rows,
      criteriaHash: sha256(JSON.stringify(criteria.rows.map(({ id, description }) => ({ id, description })))),
    };
  }

  async function storeCheck(t: Team, taskId: string, tip: Tip, overrides: { anchorSha?: string; criteriaHash?: string } = {}): Promise<string> {
    const stored = await insertTaskChild(runtime, ENTITY_TABLES.checkResults, { taskId, projectId: t.projectId, actorId: t.developerId }, {
      commit_set_hash: sha256(tip.commitShas.join("\n")),
      criteria_hash: overrides.criteriaHash ?? tip.criteriaHash,
      // A distinct path-rules hash per stored row, so several results for one task's commit set
      // do not collide on the reuse key (task_id, commit_set_hash, criteria_hash, path_rules_hash).
      // Matching uses only the anchor and the criteria hash, so this does not affect which row matches.
      path_rules_hash: randomBytes(32).toString("hex"),
      result: JSON.stringify({ anchorSha: overrides.anchorSha ?? tip.anchorSha, criteria: [], possibleGaps: [], omittedFiles: [] }),
    });
    return stored.id as string;
  }

  /** Resolves once `promise` settles or another backend is waiting for a lock, whichever is first. */
  async function blockedOrSettled(promise: Promise<unknown>): Promise<void> {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
      const { rows } = await db().admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database()",
      );
      if (rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function startedAndSubmittable(t: Team) {
    const task = await newTask(t);
    await lifecycle.startTask(t.projectId, task.id, t.developerId, task.version);
    return { ...task, version: task.version + 1 };
  }

  // -------------------------------------------------------------------------
  // Journey, events and versions (L1, L6, L7)
  // -------------------------------------------------------------------------

  it("runs the lifecycle with one event per transition and one version increase each, keeping earlier events on resubmission", async () => {
    const t = await team();
    tipBehaviour = async () => null;
    const task = await newTask(t);
    const started = await lifecycle.startTask(t.projectId, task.id, t.developerId, 1);
    expect(started).toMatchObject({ state: "In Progress", version: 2 });
    expect((await lifecycle.submitTask(t.projectId, task.id, t.developerId, 2)).version).toBe(3);
    const changed = await lifecycle.requestChanges(t.projectId, task.id, t.productManagerId, { version: 3, feedback: "Add the edge cases" });
    expect(changed).toMatchObject({ state: "In Progress", version: 4 });
    expect((await lifecycle.submitTask(t.projectId, task.id, t.developerId, 4)).version).toBe(5);
    const done = await lifecycle.approveTask(t.projectId, task.id, t.productManagerId, 5);
    expect(done).toMatchObject({ state: "Done", version: 6 });
    expect(await row(task.id)).toMatchObject({ status: "done", version: 6 });
    expect(await events(task.id)).toEqual([
      { actor_id: t.developerId, event_type: "state_change", from_status: "to_do", to_status: "in_progress", feedback: null, check_result_id: null },
      { actor_id: t.developerId, event_type: "submission", from_status: "in_progress", to_status: "in_review", feedback: null, check_result_id: null },
      { actor_id: t.productManagerId, event_type: "review_feedback", from_status: "in_review", to_status: "in_progress", feedback: "Add the edge cases", check_result_id: null },
      { actor_id: t.developerId, event_type: "submission", from_status: "in_progress", to_status: "in_review", feedback: null, check_result_id: null },
      { actor_id: t.productManagerId, event_type: "state_change", from_status: "in_review", to_status: "done", feedback: null, check_result_id: null },
    ]);
  });

  it("refuses every transition from Done and writes nothing", async () => {
    const t = await team();
    tipBehaviour = async () => null;
    const task = await newTask(t);
    await runtime.query(`UPDATE ${TASKS} SET status = 'done' WHERE id = $1`, [task.id]);
    const { version } = await row(task.id);
    expect(await codeOf(lifecycle.approveTask(t.projectId, task.id, t.productManagerId, version))).toBe("FORBIDDEN");
    expect(await codeOf(lifecycle.requestChanges(t.projectId, task.id, t.productManagerId, { version, feedback: "x" }))).toBe("FORBIDDEN");
    expect(await codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, version))).toBe("FORBIDDEN");
    expect(await codeOf(lifecycle.submitTask(t.projectId, task.id, t.developerId, version))).toBe("FORBIDDEN");
    expect(await row(task.id)).toMatchObject({ status: "done", version });
    expect(await events(task.id)).toEqual([]);
  });

  it("stores no event and keeps the state and version when the event insert fails (Failed change records no event)", async () => {
    const t = await team();
    const task = await newTask(t);
    const trigger = `synthetic_fail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await db().admin.query(`
      CREATE FUNCTION ${SCHEMA}.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.task_id = '${task.id}'::uuid THEN
          RAISE EXCEPTION 'synthetic forced failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON ${EVENTS} FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.${trigger}();
    `);
    try {
      await expect(lifecycle.startTask(t.projectId, task.id, t.developerId, 1)).rejects.toBeDefined();
      expect(await row(task.id)).toMatchObject({ status: "to_do", version: 1 });
      expect(await events(task.id)).toEqual([]);
    } finally {
      await db().admin.query(`DROP TRIGGER ${trigger} ON ${EVENTS}; DROP FUNCTION ${SCHEMA}.${trigger}();`);
    }
  });

  // -------------------------------------------------------------------------
  // Competing writes and the version guard (L1, T6)
  // -------------------------------------------------------------------------

  it("lets exactly one of two concurrent transitions with the same version succeed, with one state change (Competing transitions)", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const t = await team();
      const task = await newTask(t);
      const codes = await Promise.all([
        codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, 1)),
        codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, 1)),
      ]);
      expect(codes.sort()).toEqual([undefined, "VERSION_CONFLICT"].sort());
      expect(await row(task.id)).toMatchObject({ status: "in_progress", version: 2 });
      expect(await events(task.id)).toHaveLength(1);
    }
  });

  it("lets only one of a concurrent approval and request for changes win", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const t = await team();
      tipBehaviour = async () => null;
      const task = await startedAndSubmittable(t);
      await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
      const version = task.version + 1;
      const codes = await Promise.all([
        codeOf(lifecycle.approveTask(t.projectId, task.id, t.productManagerId, version)),
        codeOf(lifecycle.requestChanges(t.projectId, task.id, t.productManagerId, { version, feedback: "Concurrent" })),
      ]);
      expect(codes.filter((code) => code === undefined)).toHaveLength(1);
      expect(codes.filter((code) => code === "VERSION_CONFLICT")).toHaveLength(1);
      expect((await row(task.id)).version).toBe(version + 1);
      expect(await events(task.id)).toHaveLength(3);
    }
  });

  it("waits for a concurrent writer's row lock and then refuses the stale version with VERSION_CONFLICT", async () => {
    const t = await team();
    const task = await newTask(t);
    const other = await db().connectAsRuntime();
    await other.query("BEGIN");
    try {
      await other.query(`SELECT id FROM ${TASKS} WHERE id = $1 FOR UPDATE`, [task.id]);
      const pending = codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, 1));
      await blockedOrSettled(pending);
      await other.query(`UPDATE ${TASKS} SET title = 'Edited by another writer' WHERE id = $1`, [task.id]);
      await other.query("COMMIT");
      expect(await pending).toBe("VERSION_CONFLICT");
    } catch (error) {
      await other.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    expect(await row(task.id)).toMatchObject({ status: "to_do", version: 2 });
    expect(await events(task.id)).toEqual([]);
  });

  it("refuses a stale version on a permitted transition and writes nothing (Stale version is refused)", async () => {
    const t = await team();
    const task = await newTask(t);
    await tasks.editTask(t.projectId, task.id, t.productManagerId, { version: 1, title: "Edited first" });
    expect(await codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, 1))).toBe("VERSION_CONFLICT");
    expect(await row(task.id)).toMatchObject({ status: "to_do", version: 2 });
    expect(await events(task.id)).toEqual([]);
  });

  it("refuses the previous assignee's start after a reassignment", async () => {
    const t = await team();
    const task = await newTask(t);
    const moved = await tasks.reassignTask(t.projectId, task.id, t.productManagerId, { assigneeId: t.secondDeveloperId, version: 1 });
    expect(await codeOf(lifecycle.startTask(t.projectId, task.id, t.developerId, moved.version))).toBe("FORBIDDEN");
    expect(await row(task.id)).toMatchObject({ status: "to_do", assignee_id: t.secondDeveloperId });
  });

  // -------------------------------------------------------------------------
  // Submission and check references (L5)
  // -------------------------------------------------------------------------

  it("references the stored check whose anchor matches the unique tip and whose criteria hash matches the current criteria (Submission references a matching check)", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    const [first, tipSha] = [sha(), sha()];
    await attach(t, task.id, first);
    await attach(t, task.id, tipSha);
    const tip = await tipFromStore(task.id, tipSha);
    const matching = await storeCheck(t, task.id, tip);
    await storeCheck(t, task.id, tip, { anchorSha: first });
    await storeCheck(t, task.id, tip, { criteriaHash: sha256("synthetic other criteria") });
    tipBehaviour = async () => tip;
    const view = await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect(view.state).toBe("In Review");
    const submitted = (await events(task.id)).filter((event) => event.event_type === "submission");
    expect(submitted).toEqual([expect.objectContaining({ check_result_id: matching })]);
  });

  it.each([
    ["only the anchor matches", { criteriaHash: sha256("synthetic stale criteria") }],
    ["only the criteria hash matches", { anchorSha: "e".repeat(40) }],
  ])("stores no check reference when %s (Submission has no matching check result)", async (_case, overrides) => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    const tipSha = sha();
    await attach(t, task.id, tipSha);
    const tip = await tipFromStore(task.id, tipSha);
    await storeCheck(t, task.id, tip, overrides);
    tipBehaviour = async () => tip;
    await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect((await events(task.id)).filter((event) => event.event_type === "submission")).toEqual([
      expect.objectContaining({ check_result_id: null }),
    ]);
    const { rows } = await runtime.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${SCHEMA}.${ENTITY_TABLES.checkResults} WHERE task_id = $1`, [task.id]);
    expect(rows[0].n).toBe(1);
  });

  it("submits a task with no attached commits, with no check reference (Submission without attached commits)", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    tipBehaviour = async () => null;
    const view = await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect(view.state).toBe("In Review");
    expect((await events(task.id)).at(-1)).toMatchObject({ event_type: "submission", check_result_id: null });
  });

  it("submits with no check reference when the lookup fails (Evidence is unavailable at submission)", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    const tipSha = sha();
    await attach(t, task.id, tipSha);
    await storeCheck(t, task.id, await tipFromStore(task.id, tipSha));
    tipBehaviour = async () => { throw new Error("synthetic GitHub outage"); };
    const view = await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect(view.state).toBe("In Review");
    expect((await events(task.id)).at(-1)).toMatchObject({ event_type: "submission", check_result_id: null });
  });

  it("stores no stale reference when a commit is attached after the tip was resolved (Attached commits change during submission)", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    const tipSha = sha();
    await attach(t, task.id, tipSha);
    const tip = await tipFromStore(task.id, tipSha);
    await storeCheck(t, task.id, tip);
    tipBehaviour = async () => {
      await attach(t, task.id, sha());
      return tip;
    };
    const view = await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect(view.state).toBe("In Review");
    expect((await events(task.id)).at(-1)).toMatchObject({ event_type: "submission", check_result_id: null });
  });

  it("stores no stale reference when the criteria change after the tip was resolved", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    const tipSha = sha();
    await attach(t, task.id, tipSha);
    const tip = await tipFromStore(task.id, tipSha);
    await storeCheck(t, task.id, tip);
    tipBehaviour = async () => {
      await runtime.query(`UPDATE ${CRITERIA} SET description = 'Changed during submission' WHERE id = $1`, [tip.criteria[0].id]);
      return tip;
    };
    await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect((await events(task.id)).at(-1)).toMatchObject({ event_type: "submission", check_result_id: null });
  });

  it("holds no transaction open while the tip is looked up", async () => {
    const t = await team();
    const task = await startedAndSubmittable(t);
    let openDuringLookup = -1;
    tipBehaviour = async () => {
      // While the lookup awaits, a transaction held by the service would show as idle in transaction.
      const { rows } = await db().admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
      );
      openDuringLookup = rows[0].n;
      return null;
    };
    await lifecycle.submitTask(t.projectId, task.id, t.developerId, task.version);
    expect(openDuringLookup).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Progress updates (L4)
  // -------------------------------------------------------------------------

  it("stores a progress update in any state without changing the task", async () => {
    const t = await team();
    const task = await newTask(t);
    for (const status of ["to_do", "in_progress", "in_review", "done"]) {
      await runtime.query(`UPDATE ${TASKS} SET status = $2 WHERE id = $1`, [task.id, status]);
      const before = await row(task.id);
      const update = await lifecycle.postProgressUpdate(t.projectId, task.id, t.developerId, `Update while ${status}`);
      expect(update).toMatchObject({ author: { id: t.developerId }, body: `Update while ${status}` });
      expect(await row(task.id)).toEqual(before);
    }
    const { rows } = await runtime.query(`SELECT author_id, body FROM ${UPDATES} WHERE task_id = $1 ORDER BY created_at, id`, [task.id]);
    expect(rows.map((entry) => entry.body)).toEqual(["to_do", "in_progress", "in_review", "done"].map((status) => `Update while ${status}`));
    expect(await events(task.id)).toEqual([]);
  });

  it("refuses an update that loses a race with a reassignment and stores nothing (Update racing with reassignment)", async () => {
    const t = await team();
    const task = await newTask(t);
    const other = await db().connectAsRuntime();
    await other.query("BEGIN");
    try {
      await other.query(`SELECT id FROM ${TASKS} WHERE id = $1 FOR UPDATE`, [task.id]);
      const pending = codeOf(lifecycle.postProgressUpdate(t.projectId, task.id, t.developerId, "Racing update"));
      await blockedOrSettled(pending);
      await other.query(`UPDATE ${TASKS} SET assignee_id = $2 WHERE id = $1`, [task.id, t.secondDeveloperId]);
      await other.query("COMMIT");
      expect(await pending).toBe("FORBIDDEN");
    } catch (error) {
      await other.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const { rows } = await runtime.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${UPDATES} WHERE task_id = $1`, [task.id]);
    expect(rows[0].n).toBe(0);
  });

  it("refuses the product manager and an unassigned developer, storing nothing", async () => {
    const t = await team();
    const task = await newTask(t);
    expect(await codeOf(lifecycle.postProgressUpdate(t.projectId, task.id, t.productManagerId, "x"))).toBe("FORBIDDEN");
    expect(await codeOf(lifecycle.postProgressUpdate(t.projectId, task.id, t.secondDeveloperId, "x"))).toBe("FORBIDDEN");
    const { rows } = await runtime.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${UPDATES} WHERE task_id = $1`, [task.id]);
    expect(rows[0].n).toBe(0);
  });
});
