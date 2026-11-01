/**
 * Requirement "Stored results are keyed for reuse" (D-M).
 * AC11: "Same check stored twice" is rejected; at most one report per project and date
 * range; lookup fields are columns and results are jsonb.
 * Reports also carry a NOT NULL boolean `github_evidence_unavailable`, default false
 * (design.md "Task 2.4 review decisions"; daily-progress-report "Unavailable evidence is
 * shown in the report").
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  CHECK_RESULT_LOOKUP_COLUMNS,
  ENTITY_TABLES,
  REPORT_GITHUB_UNAVAILABLE_COLUMN,
  REPORT_LOOKUP_COLUMNS,
  SCHEMA,
  columnNames,
  createProjectWithTeam,
  createTask,
  insertCheckResult,
  insertReport,
  syntheticHash,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

async function columnType(client: pg.Client, table: string, column: string): Promise<string | undefined> {
  const { rows } = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [SCHEMA, table, column],
  );
  return rows[0]?.data_type;
}

dbDescribe("check results are keyed for reuse (AC11)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  async function taskContext() {
    const team = await createProjectWithTeam(runtime);
    const task = await createTask(runtime, { projectId: team.projectId, assigneeId: team.developerId });
    return { taskId: task.id, projectId: team.projectId, actorId: team.developerId };
  }

  it("keeps lookup fields as columns and the validated result as jsonb", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.checkResults);
    for (const column of CHECK_RESULT_LOOKUP_COLUMNS) {
      expect(columns, `check_results.${column}`).toContain(column);
    }
    expect(await columnType(db().admin, ENTITY_TABLES.checkResults, "result")).toBe("jsonb");
    expect(await columnType(db().admin, ENTITY_TABLES.checkResults, "redacted")).toBe("boolean");
  });

  it("Same check stored twice: rejects a second result for the same task, commit set and criteria hash", async () => {
    const context = await taskContext();
    const hashes = { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() };
    await insertCheckResult(runtime, context, hashes);
    await expectIntegrityRejection(insertCheckResult(runtime, context, hashes));
  });

  it("accepts a new result when the commit set or the criteria hash differs", async () => {
    const context = await taskContext();
    const commitSetHash = syntheticHash();
    const criteriaHash = syntheticHash();
    await insertCheckResult(runtime, context, { commitSetHash, criteriaHash });
    await insertCheckResult(runtime, context, { commitSetHash: syntheticHash(), criteriaHash });
    await insertCheckResult(runtime, context, { commitSetHash, criteriaHash: syntheticHash() });

    const { rows } = await runtime.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.${ENTITY_TABLES.checkResults} WHERE task_id = $1`,
      [context.taskId],
    );
    expect(rows[0].n).toBe(3);
  });

  it("accepts the same commit set and criteria hash on a different task", async () => {
    const first = await taskContext();
    const second = await taskContext();
    const hashes = { commitSetHash: syntheticHash(), criteriaHash: syntheticHash() };
    await insertCheckResult(runtime, first, hashes);
    const row = await insertCheckResult(runtime, second, hashes);
    expect(row.task_id).toBe(second.taskId);
  });
});

dbDescribe("reports are keyed by project and date range (AC11)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  const range = { start: "2026-10-29", end: "2026-10-30" };

  it("keeps lookup fields as columns and statements as jsonb", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.reports);
    for (const column of REPORT_LOOKUP_COLUMNS) {
      expect(columns, `reports.${column}`).toContain(column);
    }
    expect(await columnType(db().admin, ENTITY_TABLES.reports, "statements")).toBe("jsonb");
  });

  it("rejects a second report for the same project and date range", async () => {
    const team = await createProjectWithTeam(runtime);
    await insertReport(runtime, team.projectId, range);
    await expectIntegrityRejection(insertReport(runtime, team.projectId, range));
  });

  it("accepts a report for a different range or a different project", async () => {
    const team = await createProjectWithTeam(runtime);
    const otherTeam = await createProjectWithTeam(runtime);
    await insertReport(runtime, team.projectId, range);
    await insertReport(runtime, team.projectId, { start: "2026-10-30", end: "2026-10-31" });
    await insertReport(runtime, otherTeam.projectId, range);

    const { rows } = await runtime.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.${ENTITY_TABLES.reports} WHERE project_id = ANY($1)`,
      [[team.projectId, otherTeam.projectId]],
    );
    expect(rows[0].n).toBe(3);
  });

  it("rejects a report for a project that does not exist", async () => {
    await expectIntegrityRejection(insertReport(runtime, "00000000-0000-4000-8000-0000000000bb", range));
  });
});

dbDescribe("reports record whether GitHub evidence was unavailable", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  const REPORTS = `${SCHEMA}.${ENTITY_TABLES.reports}`;
  const COLUMN = REPORT_GITHUB_UNAVAILABLE_COLUMN;

  it("has a NOT NULL boolean github_evidence_unavailable column defaulting to false", async () => {
    const { rows } = await db().admin.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [SCHEMA, ENTITY_TABLES.reports, COLUMN],
    );
    expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "false" }]);
  });

  it("stores false when a report is inserted without the flag", async () => {
    const team = await createProjectWithTeam(runtime);
    const report = await insertReport(runtime, team.projectId, { start: "2026-10-28", end: "2026-10-29" });
    expect(report[COLUMN]).toBe(false);
  });

  it("stores true when a report is generated without GitHub evidence", async () => {
    const team = await createProjectWithTeam(runtime);
    const report = await insertReport(
      runtime,
      team.projectId,
      { start: "2026-10-28", end: "2026-10-29" },
      { [COLUMN]: true },
    );
    expect(report[COLUMN]).toBe(true);
  });

  it("can be set to true when a stored report is replaced", async () => {
    const team = await createProjectWithTeam(runtime);
    const report = await insertReport(runtime, team.projectId, { start: "2026-10-28", end: "2026-10-29" });
    const { rows } = await runtime.query(`UPDATE ${REPORTS} SET "${COLUMN}" = true WHERE id = $1 RETURNING "${COLUMN}"`, [
      report.id,
    ]);
    expect(rows).toEqual([{ [COLUMN]: true }]);
  });

  it("rejects a NULL value", async () => {
    const team = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(
      insertReport(runtime, team.projectId, { start: "2026-10-28", end: "2026-10-29" }, { [COLUMN]: null }),
    );
  });
});
