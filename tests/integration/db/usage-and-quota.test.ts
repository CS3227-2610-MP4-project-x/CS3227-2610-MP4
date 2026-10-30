/**
 * Requirement "Stored records exclude secrets and AI content" (usage part) and design D-G.
 * AC14: usage records hold the listed fields; outcome is CHECKed to the five D-M values and
 * `pending` is insertable; a per-person, per-SGT-day row exists and app_runtime can lock it
 * with SELECT ... FOR UPDATE so concurrent reservations serialize.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  QUOTA_TABLE,
  SCHEMA,
  USAGE_OUTCOMES,
  USAGE_RECORD_COLUMNS,
  columnNames,
  createProjectWithTeam,
  insertPendingUsageRecord,
  insertRow,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, sqlStateOf, useMigratedDatabase } from "./support/harness";

const USAGE = `${SCHEMA}.${ENTITY_TABLES.usageRecords}`;
const QUOTA = `${SCHEMA}.${QUOTA_TABLE}`;

dbDescribe("usage records (AC14)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("has feature, project, person, environment, tokens, latency, outcome and cached columns", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.usageRecords);
    for (const column of USAGE_RECORD_COLUMNS) {
      expect(columns, `usage_records.${column}`).toContain(column);
    }
  });

  it("records the start time as timestamptz so the 60-second rate window can be counted", async () => {
    const { rows } = await db().admin.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = 'created_at'`,
      [SCHEMA, ENTITY_TABLES.usageRecords],
    );
    expect(rows).toEqual([{ data_type: "timestamp with time zone" }]);
  });

  it("inserts a pending reservation as app_runtime and settles it in a second write", async () => {
    const team = await createProjectWithTeam(runtime);
    const record = await insertPendingUsageRecord(runtime, { projectId: team.projectId, personId: team.developerId });
    expect(record.outcome).toBe("pending");

    const settled = await runtime.query(
      `UPDATE ${USAGE} SET outcome = 'succeeded', input_tokens = 1200, output_tokens = 300, latency_ms = 850
        WHERE id = $1 AND outcome = 'pending'`,
      [record.id],
    );
    expect(settled.rowCount).toBe(1);
  });

  it.each(USAGE_OUTCOMES.filter((outcome) => outcome !== "pending").map((outcome) => [outcome]))(
    "accepts settling a reservation with outcome %s",
    async (outcome) => {
      const team = await createProjectWithTeam(runtime);
      const record = await insertPendingUsageRecord(runtime, { projectId: team.projectId, personId: team.developerId });
      const cached = outcome === "cached";
      const settled = await runtime.query<{ outcome: string }>(
        `UPDATE ${USAGE} SET outcome = $2, cached = $3, input_tokens = $4, output_tokens = $5, latency_ms = $6
          WHERE id = $1 RETURNING outcome`,
        [record.id, outcome, cached, cached ? 0 : 1000, cached ? 0 : 200, cached ? 5 : 900],
      );
      expect(settled.rows).toEqual([{ outcome }]);
    },
  );

  it("rejects an outcome outside the five recorded values", async () => {
    const team = await createProjectWithTeam(runtime);
    await expectIntegrityRejection(
      insertPendingUsageRecord(runtime, {
        projectId: team.projectId,
        personId: team.developerId,
        outcome: "timeout" as (typeof USAGE_OUTCOMES)[number],
      }),
    );
  });
});

dbDescribe("per-person, per-SGT-day quota lock row (AC14, D-G)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("accepts one row per person and SGT day and rejects a duplicate", async () => {
    const team = await createProjectWithTeam(runtime);
    await insertRow(runtime, QUOTA_TABLE, { person_id: team.developerId, sgt_date: "2026-10-30" });
    await insertRow(runtime, QUOTA_TABLE, { person_id: team.developerId, sgt_date: "2026-10-31" });
    await insertRow(runtime, QUOTA_TABLE, { person_id: team.productManagerId, sgt_date: "2026-10-30" });
    await expectIntegrityRejection(
      insertRow(runtime, QUOTA_TABLE, { person_id: team.developerId, sgt_date: "2026-10-30" }),
    );
  });

  it("rejects a quota row for a person who does not exist", async () => {
    await expectIntegrityRejection(
      insertRow(runtime, QUOTA_TABLE, { person_id: "00000000-0000-4000-8000-0000000000cc", sgt_date: "2026-10-30" }),
    );
  });

  it("lets app_runtime lock the row with SELECT ... FOR UPDATE, serializing a second reserver", async () => {
    const team = await createProjectWithTeam(runtime);
    await insertRow(runtime, QUOTA_TABLE, { person_id: team.developerId, sgt_date: "2026-11-01" });
    const lockSql = `SELECT person_id FROM ${QUOTA} WHERE person_id = $1 AND sgt_date = $2 FOR UPDATE`;
    const params = [team.developerId, "2026-11-01"];

    const first = await db().connectAsRuntime();
    const second = await db().connectAsRuntime();

    await first.query("BEGIN");
    const locked = await first.query(lockSql, params);
    expect(locked.rowCount).toBe(1);

    await second.query("BEGIN");
    // While the first reserver holds the lock, the second cannot take it (lock_not_available).
    expect(await sqlStateOf(second.query(`${lockSql} NOWAIT`, params))).toBe("55P03");
    await second.query("ROLLBACK");

    await first.query("COMMIT");

    await second.query("BEGIN");
    const relocked = await second.query(lockSql, params);
    expect(relocked.rowCount).toBe(1);
    await second.query("COMMIT");
  });
});
