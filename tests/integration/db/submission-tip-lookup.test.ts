/**
 * OpenSpec task 4.3 (tasks-lifecycle-4-3), fix round 1 (reviewer findings F3 and F5): PostgreSQL
 * integration tests for the read-only submission tip lookup in completion-assessment, written
 * with Developer A's agreement (design.md L5; handoff Q3). completion-assessment "Submission can
 * look up the committed tip"; task-management "Submission records attached commits and a
 * matching check".
 *
 * - F3: the real SubmissionSnapshotRepository runs as `app_runtime` against stored rows, with the
 *   real SubmissionTipLookup. Only the GitHub evidence port (loadPathRules, isAncestor) is
 *   synthetic. The lookup turns every failure into "no tip", so a SQL or column error would only
 *   show up as missing check references; these tests assert the snapshot and tip shapes directly.
 * - F5: the real CompletionAssessmentService and CompletionAssessmentRepository store a check for
 *   the same rows, and the stored `criteria_hash` and `result.anchorSha` must equal the lookup's
 *   tip, without the test computing either.
 *
 * Needs TEST_DATABASE_URL (a disposable PostgreSQL superuser URL); skipped otherwise. All
 * people, projects, tasks, commits and repositories are synthetic.
 */
import { randomBytes, randomInt } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeAdapter, LlmGateway, type UsagePort } from "@/server/ai";
import {
  CompletionAssessmentRepository,
  CompletionAssessmentService,
  SubmissionSnapshotRepository,
  SubmissionTipLookup,
} from "@/server/completion-assessment";

import {
  ENTITY_TABLES,
  SCHEMA,
  createProject,
  createProjectWithTeam,
  createTask,
  insertTaskChild,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;
const TASKS = `${SCHEMA}.${ENTITY_TABLES.tasks}`;
const RESULTS = `${SCHEMA}.${ENTITY_TABLES.checkResults}`;

const rules = { version: 1, domainLogic: ["core/"], apiHandlers: ["api/"], tests: ["tests/"], ui: ["ui/"],
  lockfileNames: ["package-lock.json"], generatedPathPrefixes: ["generated/"] };

function sha(): string {
  return randomBytes(20).toString("hex");
}

dbDescribe("submission tip lookup against stored rows (task 4.3, F3 and F5)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let pool: pg.Pool;
  let snapshots: SubmissionSnapshotRepository;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    pool = runtimePool(() => db().connectAsRuntime());
    snapshots = new SubmissionSnapshotRepository(pool as unknown as ConstructorParameters<typeof SubmissionSnapshotRepository>[0]);
  });

  interface Linked {
    projectId: string; developerId: string; taskId: string;
    repository: { id: number; installationId: number; owner: string; name: string };
  }

  async function linkedTask(options: { link?: boolean } = {}): Promise<Linked> {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const repository = { id: randomInt(1, 2_000_000_000), installationId: randomInt(1, 2_000_000_000),
      owner: "synthetic-owner", name: `synthetic-repository-${randomInt(1, 1_000_000)}` };
    if (options.link !== false) {
      await runtime.query(
        `UPDATE ${PROJECTS} SET github_repository_id = $2, github_installation_id = $3,
                github_repository_owner = $4, github_repository_name = $5 WHERE id = $1`,
        [team.projectId, repository.id, repository.installationId, repository.owner, repository.name],
      );
    }
    return { projectId: team.projectId, developerId: team.developerId, taskId: task.id, repository };
  }

  async function addCriterion(linked: Linked, position: number, description: string): Promise<string> {
    const row = await insertTaskChild(runtime, ENTITY_TABLES.acceptanceCriteria,
      { taskId: linked.taskId, projectId: linked.projectId, actorId: linked.developerId }, { position, description });
    return row.id as string;
  }

  async function attach(linked: Linked, commitSha: string): Promise<void> {
    await insertTaskChild(runtime, ENTITY_TABLES.attachedCommits,
      { taskId: linked.taskId, projectId: linked.projectId, actorId: linked.developerId }, { commit_sha: commitSha });
  }

  /** Synthetic GitHub evidence: ancestry from "ancestor>descendant" pairs. */
  function evidence(history: string[]) {
    const edges = new Set(history);
    return {
      loadPathRules: vi.fn(async () => JSON.stringify(rules)),
      isAncestor: vi.fn(async (_repository: unknown, ancestor: string, descendant: string) =>
        ancestor === descendant || edges.has(`${ancestor}>${descendant}`)),
      fetchDiff: vi.fn(async () => ""),
    };
  }

  function lookup(ports: ReturnType<typeof evidence>) {
    return new SubmissionTipLookup({ snapshots, evidence: ports } as unknown as ConstructorParameters<typeof SubmissionTipLookup>[0]);
  }

  // -------------------------------------------------------------------------
  // F3: the real snapshot read
  // -------------------------------------------------------------------------

  it("reads the attached commits, the criteria in position-then-ID order and the linked repository", async () => {
    const linked = await linkedTask();
    const second = await addCriterion(linked, 2, "Second \"quoted\"\ncriterion");
    const firstB = await addCriterion(linked, 1, "First criterion, Prüfung");
    const firstA = await addCriterion(linked, 1, "Also first");
    const [a, b] = [sha(), sha()];
    await attach(linked, b);
    await attach(linked, a);

    const snapshot = await snapshots.getSubmissionSnapshot(linked.projectId, linked.taskId);
    expect(snapshot).not.toBeNull();
    expect([...snapshot!.attachedCommitShas].sort()).toEqual([a, b].sort());
    // Position ascending, then criterion ID ascending for equal positions.
    const firsts = [
      { id: firstA, description: "Also first", position: 1 },
      { id: firstB, description: "First criterion, Prüfung", position: 1 },
    ].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(snapshot!.criteria.map(({ id, description, position }) => ({ id, description, position }))).toEqual([
      ...firsts,
      { id: second, description: "Second \"quoted\"\ncriterion", position: 2 },
    ]);
    expect(snapshot!.repository).toEqual(linked.repository);
  });

  it("returns the unique tip with its commit set, ordered criteria and a criteria hash", async () => {
    const linked = await linkedTask();
    const second = await addCriterion(linked, 2, "Return data");
    const first = await addCriterion(linked, 1, "Validate input");
    const [base, middle, tip] = [sha(), sha(), sha()];
    for (const commit of [middle, tip, base]) await attach(linked, commit);
    const ports = evidence([`${base}>${middle}`, `${base}>${tip}`, `${middle}>${tip}`]);

    const result = await lookup(ports).findSubmissionTip(linked.projectId, linked.taskId);
    expect(result).not.toBeNull();
    expect(result!.anchorSha).toBe(tip);
    expect(result!.commitShas).toEqual([base, middle, tip].sort());
    expect(result!.criteria.map(({ id, description, position }) => ({ id, description, position }))).toEqual([
      { id: first, description: "Validate input", position: 1 },
      { id: second, description: "Return data", position: 2 },
    ]);
    expect(result!.criteriaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ports.loadPathRules).toHaveBeenCalledWith(linked.repository);
    expect(ports.fetchDiff).not.toHaveBeenCalled();
  });

  it("reads an empty commit set and returns no tip when nothing is attached", async () => {
    const linked = await linkedTask();
    await addCriterion(linked, 1, "Only criterion");
    const snapshot = await snapshots.getSubmissionSnapshot(linked.projectId, linked.taskId);
    expect(snapshot).toMatchObject({ attachedCommitShas: [], repository: linked.repository });
    const ports = evidence([]);
    expect(await lookup(ports).findSubmissionTip(linked.projectId, linked.taskId)).toBeNull();
    expect(ports.isAncestor).not.toHaveBeenCalled();
  });

  it("reads no repository, and returns no tip without calling GitHub, when the project has no linked repository", async () => {
    const linked = await linkedTask({ link: false });
    await addCriterion(linked, 1, "Only criterion");
    await attach(linked, sha());
    const snapshot = await snapshots.getSubmissionSnapshot(linked.projectId, linked.taskId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.repository).toBeNull();
    const ports = evidence([]);
    expect(await lookup(ports).findSubmissionTip(linked.projectId, linked.taskId)).toBeNull();
    expect(ports.loadPathRules).not.toHaveBeenCalled();
  });

  it("reads nothing for a deleted task or a task outside the path's project", async () => {
    const linked = await linkedTask();
    await attach(linked, sha());
    const other = await createProject(runtime);
    expect(await snapshots.getSubmissionSnapshot(other.id, linked.taskId)).toBeNull();
    await runtime.query(`UPDATE ${TASKS} SET deleted_at = now() WHERE id = $1`, [linked.taskId]);
    expect(await snapshots.getSubmissionSnapshot(linked.projectId, linked.taskId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // F5: the stored check key equals the lookup's tip (real save path)
  // -------------------------------------------------------------------------

  it("matches the criteria_hash and anchorSha the real check service stores for the same rows", async () => {
    const linked = await linkedTask();
    await addCriterion(linked, 2, "Return data");
    await addCriterion(linked, 1, "Validate input, Prüfung");
    await addCriterion(linked, 1, "Also first");
    const [base, tip] = [sha(), sha()];
    await attach(linked, base);
    await attach(linked, tip);
    const ports = evidence([`${base}>${tip}`]);
    const read = await snapshots.getSubmissionSnapshot(linked.projectId, linked.taskId);
    expect(read).not.toBeNull();

    // The check service reads its assigned snapshot from the same stored rows.
    const assigned = {
      getAssignedSnapshot: vi.fn(async () => ({
        projectId: linked.projectId, taskId: linked.taskId, personId: linked.developerId, role: "developer",
        assigneeId: linked.developerId, criteria: read!.criteria, attachedCommitShas: read!.attachedCommitShas, repository: read!.repository,
      })),
    };
    const ordered = [...read!.criteria].sort((x, y) => x.position - y.position || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const answer = { anchorSha: tip, criteria: ordered.map((criterion) => ({
      criterionId: criterion.id, criterion: criterion.description, status: "unclear", evidence: [],
    })), possibleGaps: [], omittedFiles: [] };
    const usage: UsagePort = {
      reserve: vi.fn(async () => ({ ok: true as const, usageRecordId: "synthetic-usage" })),
      settle: vi.fn(async () => {}), recordCacheHit: vi.fn(async () => {}),
    };
    const gateway = new LlmGateway({
      adapter: new FakeAdapter([{ ok: true, text: JSON.stringify(answer), usage: { inputTokens: 10, outputTokens: 10 } }]),
      usage, environment: "development", limits: { requestsPerMinute: 100, dailyTokenQuota: 10_000_000 },
    });
    const results = new CompletionAssessmentRepository(pool as unknown as ConstructorParameters<typeof CompletionAssessmentRepository>[0]);
    const service = new CompletionAssessmentService(
      { snapshots: assigned, evidence: ports, repository: results, gateway } as unknown as ConstructorParameters<typeof CompletionAssessmentService>[0],
    );
    await service.runCheck(linked.projectId, linked.taskId, { authUserId: "00000000-0000-4000-8000-000000000004", githubUserId: "123" });

    const stored = await runtime.query<{ criteria_hash: string; anchor: string }>(
      `SELECT criteria_hash, result->>'anchorSha' AS anchor FROM ${RESULTS} WHERE task_id = $1`, [linked.taskId],
    );
    expect(stored.rows).toHaveLength(1);
    const found = await lookup(ports).findSubmissionTip(linked.projectId, linked.taskId);
    expect(found).not.toBeNull();
    expect(found!.criteriaHash).toBe(stored.rows[0].criteria_hash);
    expect(found!.anchorSha).toBe(stored.rows[0].anchor);
  });
});
