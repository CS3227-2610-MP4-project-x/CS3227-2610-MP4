import { beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { createProjectWithTeam, createTask, ENTITY_TABLES, insertTaskChild, runtimePool } from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

vi.mock("server-only", () => ({}));
import { GitHubEvidenceRepository } from "@/server/github-evidence";

// Task 11.1: github-evidence source branch provenance; all rows are synthetic.
dbDescribe("attached commit source branch storage", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  beforeAll(async () => { runtime = await db().connectAsRuntime(); });

  it("keeps add-only legacy inserts nullable and persists explicitly recorded branch names", async () => {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    const context = { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
    const legacy = await insertTaskChild(runtime, ENTITY_TABLES.attachedCommits, context);
    const recorded = await insertTaskChild(runtime, ENTITY_TABLES.attachedCommits, context, { source_branch: "feat/synthetic-evidence" });
    const { rows } = await runtime.query("SELECT id::text, source_branch FROM app.attached_commits WHERE task_id = $1 ORDER BY id", [task.id]);
    expect(rows).toEqual(expect.arrayContaining([{ id: legacy.id, source_branch: null }, { id: recorded.id, source_branch: "feat/synthetic-evidence" }]));
    expect(rows).toHaveLength(2);
  });
});


dbDescribe("attached commit replacement transaction integrity", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let repository: GitHubEvidenceRepository;
  const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    repository = new GitHubEvidenceRepository(runtimePool(() => db().connectAsRuntime()));
  });
  async function fixture() {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId, status: "in_progress" });
    const { rows } = await runtime.query("SELECT auth_user_id::text, github_user_id::text FROM app.people WHERE id = $1", [team.developerId]);
    const identity = { authUserId: rows[0].auth_user_id as string, githubUserId: rows[0].github_user_id as string };
    const original = await insertTaskChild(runtime, ENTITY_TABLES.attachedCommits,
      { taskId: task.id, projectId: team.projectId, actorId: team.developerId }, { commit_sha: shaA, source_branch: "feat/original" });
    return { team, task, identity, original, expected: [{ sha: shaA, sourceBranch: "feat/original" }] };
  }
  async function rows(taskId: string) {
    return (await runtime.query("SELECT id::text, commit_sha, source_branch, attached_by::text, created_at FROM app.attached_commits WHERE task_id = $1 ORDER BY commit_sha", [taskId])).rows;
  }
  it("rolls back an earlier insertion when a later insertion fails and preserves original attachment rows", async () => {
    const f = await fixture();
    const before = await rows(f.task.id);
    // A disposable-database trigger injects a persistence error after the first
    // new row has been inserted. No production database or migration is changed.
    await db().admin.query(`CREATE FUNCTION app.synthetic_replacement_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.commit_sha = repeat('c', 40) THEN
          RAISE EXCEPTION 'synthetic replacement persistence failure';
        END IF;
        RETURN NEW;
      END $$`);
    await db().admin.query(`CREATE TRIGGER synthetic_replacement_failure BEFORE INSERT ON app.attached_commits
      FOR EACH ROW EXECUTE FUNCTION app.synthetic_replacement_failure()`);
    try {
      await expect(repository.replaceAttachedCommits(f.team.projectId, f.task.id, f.identity, f.expected,
        [{ sha: shaB, sourceBranch: "feat/first-new" }, { sha: shaC, sourceBranch: "feat/failing-new" }]))
        .rejects.toThrow("Repository operation failed.");
      expect(await rows(f.task.id)).toEqual(before);
    } finally {
      await db().admin.query("DROP TRIGGER synthetic_replacement_failure ON app.attached_commits");
      await db().admin.query("DROP FUNCTION app.synthetic_replacement_failure()");
    }
  });
  it("allows one competing replacement and refuses the stale snapshot without changing the winner's rows", async () => {
    const f = await fixture();
    const desired = [
      [...f.expected, { sha: shaB, sourceBranch: "feat/one" }],
      [...f.expected, { sha: shaC, sourceBranch: "feat/two" }],
    ];
    const results = await Promise.all(desired.map((attachments) => repository.replaceAttachedCommits(
      f.team.projectId, f.task.id, f.identity, f.expected, attachments)));
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    const winner = results.find((result) => result !== null)!;
    const persisted = await rows(f.task.id);
    expect(persisted.map((row) => ({ sha: row.commit_sha, sourceBranch: row.source_branch })))
      .toEqual([...winner].sort((left, right) => left.sha.localeCompare(right.sha)));
    expect(persisted.find((row) => row.commit_sha === shaA)?.id).toBe(f.original.id);
    const after = await rows(f.task.id);
    expect(await repository.replaceAttachedCommits(f.team.projectId, f.task.id, f.identity, f.expected, desired[0])).toBeNull();
    expect(await rows(f.task.id)).toEqual(after);
  });
});
