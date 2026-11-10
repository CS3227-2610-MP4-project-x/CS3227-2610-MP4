/** Group 7: data-persistence "Stored results are keyed for reuse" and legacy upgrade. */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  type ChildContext,
  ENTITY_TABLES,
  SCHEMA,
  createProjectWithTeam,
  createTask,
  insertCheckResult,
  insertTaskChild,
  syntheticHash,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const RESULTS = `${SCHEMA}.${ENTITY_TABLES.checkResults}`;

dbDescribe("check-result path-rules identity and legacy history (Group 7)", () => {
  const legacyRows: Record<string, unknown>[] = [];
  const legacyContexts: ChildContext[] = [];
  const db = useMigratedDatabase({
    async afterMigration(file, admin) {
      if (file !== "20261030144500_create_app_schema.sql") return;

      // Insert through the shipped schema, before path_rules_hash exists, to test
      // an actual upgrade rather than merely inserting NULL into the new schema.
      const team = await createProjectWithTeam(admin);
      const task = await createTask(admin, { projectId: team.projectId, assigneeId: team.developerId });
      const context = { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
      legacyContexts.push(context);
      legacyRows.push(await insertCheckResult(
        admin,
        context,
        { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() },
      ));
    },
  });
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  async function taskContext() {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    return { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
  }

  it("preserves every field of a pre-migration result and leaves its path-rules hash null", async () => {
    expect(legacyRows).toHaveLength(1);
    const legacy = legacyRows[0];
    const { rows } = await runtime.query(`SELECT * FROM ${RESULTS} WHERE id = $1`, [legacy.id]);
    expect(rows).toEqual([{ ...legacy, path_rules_hash: null }]);
  });

  it("allows a current check alongside legacy history with the same task, commits and criteria", async () => {
    const legacy = legacyRows[0];
    const row = await insertTaskChild(runtime, ENTITY_TABLES.checkResults, legacyContexts[0], {
      commit_set_hash: legacy.commit_set_hash,
      criteria_hash: legacy.criteria_hash,
      path_rules_hash: "a".repeat(64),
    });
    expect(row.path_rules_hash).toBe("a".repeat(64));
    const count = await runtime.query(`SELECT count(*)::int AS n FROM ${RESULTS} WHERE task_id = $1`, [legacy.task_id]);
    expect(count.rows[0].n).toBe(2);
  });

  it("keeps the path-rules hash nullable for legacy records without fabricating a default", async () => {
    const { rows } = await db().admin.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'path_rules_hash'`,
      [SCHEMA, ENTITY_TABLES.checkResults],
    );
    expect(rows).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    const row = await insertTaskChild(runtime, ENTITY_TABLES.checkResults, await taskContext());
    expect(row.path_rules_hash).toBeNull();
  });

  it("accepts a lowercase 64-character hexadecimal path-rules hash", async () => {
    const hash = "0123456789abcdef".repeat(4);
    const row = await insertTaskChild(runtime, ENTITY_TABLES.checkResults, await taskContext(), { path_rules_hash: hash });
    expect(row.path_rules_hash).toBe(hash);
  });

  it.each([
    ["empty", ""],
    ["short", "a".repeat(63)],
    ["long", "a".repeat(65)],
    ["uppercase", "A".repeat(64)],
    ["non-hexadecimal", "g".repeat(64)],
    ["surrounding whitespace", ` ${"a".repeat(64)} `],
  ])("rejects a %s path-rules hash", async (_label, hash) => {
    const code = await expectIntegrityRejection(
      insertTaskChild(runtime, ENTITY_TABLES.checkResults, await taskContext(), { path_rules_hash: hash }),
    );
    expect(code).toBe("23514");
  });

  it("rejects a duplicate task, commit-set, criteria and path-rules identity", async () => {
    const context = await taskContext();
    const identity = {
      commit_set_hash: syntheticHash(), criteria_hash: syntheticHash(), path_rules_hash: syntheticHash(),
    };
    await insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, identity);
    const code = await expectIntegrityRejection(insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, identity));
    expect(code).toBe("23505");
  });

  it("retains separate results when only the path-rules hash differs", async () => {
    const context = await taskContext();
    const identity = { commit_set_hash: syntheticHash(), criteria_hash: syntheticHash() };
    const firstHash = "1".repeat(64);
    const secondHash = "2".repeat(64);
    await insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, { ...identity, path_rules_hash: firstHash });
    await insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, { ...identity, path_rules_hash: secondHash });
    const { rows } = await runtime.query(
      `SELECT path_rules_hash FROM ${RESULTS} WHERE task_id = $1 ORDER BY path_rules_hash`, [context.taskId],
    );
    expect(rows).toEqual([{ path_rules_hash: firstHash }, { path_rules_hash: secondHash }]);
  });

  it("rejects duplicate legacy identities whether the null hash is omitted or explicit", async () => {
    const context = await taskContext();
    const identity = { commit_set_hash: syntheticHash(), criteria_hash: syntheticHash() };
    await insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, identity);
    const code = await expectIntegrityRejection(
      insertTaskChild(runtime, ENTITY_TABLES.checkResults, context, { ...identity, path_rules_hash: null }),
    );
    expect(code).toBe("23505");
  });

  it("allows the same hashes on separate tasks", async () => {
    const identity = {
      commit_set_hash: syntheticHash(), criteria_hash: syntheticHash(), path_rules_hash: syntheticHash(),
    };
    const first = await taskContext();
    const second = await taskContext();
    await insertTaskChild(runtime, ENTITY_TABLES.checkResults, first, identity);
    const row = await insertTaskChild(runtime, ENTITY_TABLES.checkResults, second, identity);
    expect(row.task_id).toBe(second.taskId);
  });
});
