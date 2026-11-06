/**
 * Task 6.3 (llm-gateway-core): PostgreSQL integration tests for UsageRepository, the
 * UsagePort implementation, and the task 6.3 migration. Acceptance criteria AC10-AC14,
 * AC16-AC18, AC20, AC26-AC28 in workflow/handoffs/llm-gateway-core.md; spec
 * "AI usage is limited per person" and "AI usage is recorded"; design.md D-G, G6, G7,
 * E6 and "Task 6.3 handoff decisions" Q1, Q4, Q5, Q6.
 *
 * Rate-window and day-boundary rows are inserted by the superuser with created_at relative
 * to database time, because the repository uses database time (G6). Each test uses its own
 * synthetic person so rows do not interfere. Limits are passed per reservation, so small
 * synthetic quotas are used.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type pg from "pg";
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AiLimits, UsageReservation } from "@/server/ai";
import { UsageRepository } from "@/server/repositories/usage-repository";

import {
  ENTITY_TABLES,
  QUOTA_TABLE,
  SCHEMA,
  SYNTHETIC_ENVIRONMENT,
  SYNTHETIC_FEATURE,
  createProjectWithTeam,
  insertPendingUsageRecord,
  runtimePool,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, listMigrationFiles, readMigration, useMigratedDatabase } from "./support/harness";

const USAGE = `${SCHEMA}.${ENTITY_TABLES.usageRecords}`;
const QUOTA = `${SCHEMA}.${QUOTA_TABLE}`;
const SHIPPED_MIGRATION = "20261030144500_create_app_schema.sql";

// Start of the current SGT day as a timestamptz, in database time.
const SGT_DAY_START = "(date_trunc('day', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')";

type Team = { projectId: string; personId: string };

type UsageRow = {
  id: string;
  feature: string;
  project_id: string;
  person_id: string;
  environment: string;
  reserved_tokens: number;
  charged_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  outcome: string;
  cached: boolean;
};

function limits(requestsPerMinute: number, dailyTokenQuota: number): AiLimits {
  return Object.freeze({ requestsPerMinute, dailyTokenQuota });
}

function reservation(team: Team, reservedTokens: number, quota: AiLimits): UsageReservation {
  return {
    feature: "acceptance_check",
    projectId: team.projectId,
    personId: team.personId,
    environment: "development",
    reservedTokens,
    limits: quota,
  };
}

dbDescribe("UsageRepository and the task 6.3 usage migration", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;
  let repository: UsageRepository;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
    repository = new UsageRepository(runtimePool(() => db().connectAsRuntime()));
  });

  async function newTeam(): Promise<Team> {
    const team = await createProjectWithTeam(runtime);
    return { projectId: team.projectId, personId: team.developerId };
  }

  /** Inserts a usage record directly, with created_at = <createdAtSql> in database time. */
  async function insertUsage(
    team: Team,
    input: {
      createdAtSql: string;
      outcome?: string;
      reserved?: number;
      charged?: number | null;
      cached?: boolean;
    },
  ): Promise<void> {
    const outcome = input.outcome ?? "succeeded";
    await db().admin.query(
      `INSERT INTO ${USAGE}
         (feature, project_id, person_id, environment, reserved_tokens, charged_tokens, outcome, cached, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${input.createdAtSql})`,
      [
        SYNTHETIC_FEATURE,
        team.projectId,
        team.personId,
        SYNTHETIC_ENVIRONMENT,
        input.reserved ?? 0,
        input.charged === undefined ? (outcome === "pending" ? null : 0) : input.charged,
        outcome,
        input.cached ?? false,
      ],
    );
  }

  async function usageRows(personId: string): Promise<UsageRow[]> {
    const { rows } = await db().admin.query<UsageRow>(
      `SELECT id::text AS id, feature, project_id::text AS project_id, person_id::text AS person_id, environment,
              reserved_tokens, charged_tokens, input_tokens, output_tokens, latency_ms, outcome, cached
         FROM ${USAGE} WHERE person_id = $1 ORDER BY created_at, id`,
      [personId],
    );
    return rows;
  }

  async function nextSgtMidnight(): Promise<number> {
    const { rows } = await db().admin.query<{ next: Date }>(
      `SELECT (((now() AT TIME ZONE 'Asia/Singapore')::date + 1)::timestamp AT TIME ZONE 'Asia/Singapore') AS next`,
    );
    return rows[0].next.getTime();
  }

  // -------------------------------------------------------------------------
  // Reservation and settlement (AC14, AC16, AC17)
  // -------------------------------------------------------------------------

  it("reserves by inserting one pending record and the person's SGT-day row (AC16, G6)", async () => {
    const team = await newTeam();
    const result = await repository.reserve(reservation(team, 1200, limits(5, 10_000)));
    expect(result.ok).toBe(true);
    const rows = await usageRows(team.personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.ok ? result.usageRecordId : "",
      feature: "acceptance_check",
      project_id: team.projectId,
      person_id: team.personId,
      environment: "development",
      reserved_tokens: 1200,
      outcome: "pending",
      cached: false,
    });
    const quotaDays = await db().admin.query(
      `SELECT 1 FROM ${QUOTA} WHERE person_id = $1 AND sgt_date = (now() AT TIME ZONE 'Asia/Singapore')::date`,
      [team.personId],
    );
    expect(quotaDays.rowCount).toBe(1);
  });

  it("settles the record with outcome, provider tokens, charged tokens and latency (AC14, AC16, Q1)", async () => {
    const team = await newTeam();
    const result = await repository.reserve(reservation(team, 1200, limits(5, 10_000)));
    if (!result.ok) {
      throw new Error("reservation was refused");
    }
    await repository.settle({
      usageRecordId: result.usageRecordId,
      outcome: "succeeded",
      inputTokens: 210,
      outputTokens: 30,
      chargedTokens: 240,
      latencyMs: 500,
    });
    expect(await usageRows(team.personId)).toEqual([
      expect.objectContaining({
        outcome: "succeeded",
        reserved_tokens: 1200,
        input_tokens: 210,
        output_tokens: 30,
        charged_tokens: 240,
        latency_ms: 500,
        cached: false,
      }),
    ]);
  });

  it.each(["invalid_output", "provider_error"] as const)("settles outcome %s with null provider tokens", async (outcome) => {
    const team = await newTeam();
    const result = await repository.reserve(reservation(team, 1000, limits(5, 10_000)));
    if (!result.ok) {
      throw new Error("reservation was refused");
    }
    await repository.settle({
      usageRecordId: result.usageRecordId,
      outcome,
      inputTokens: null,
      outputTokens: null,
      chargedTokens: 500,
      latencyMs: 60_000,
    });
    expect((await usageRows(team.personId))[0]).toMatchObject({
      outcome,
      input_tokens: null,
      output_tokens: null,
      charged_tokens: 500,
      latency_ms: 60_000,
    });
  });

  it("counts settled records by charged tokens, so an unused reservation is available again (AC14, Q1)", async () => {
    const team = await newTeam();
    const quota = limits(100, 1000);
    const first = await repository.reserve(reservation(team, 900, quota));
    if (!first.ok) {
      throw new Error("reservation was refused");
    }
    // While pending, the full reservation counts.
    expect((await repository.reserve(reservation(team, 900, quota))).ok).toBe(false);

    await repository.settle({
      usageRecordId: first.usageRecordId,
      outcome: "succeeded",
      inputTokens: 80,
      outputTokens: 20,
      chargedTokens: 100,
      latencyMs: 10,
    });
    expect((await repository.reserve(reservation(team, 900, quota))).ok).toBe(true);
  });

  it("keeps a pending record's full reservation in the daily total (AC17, D-G)", async () => {
    const team = await newTeam();
    await insertUsage(team, { createdAtSql: "now()", outcome: "pending", reserved: 800, charged: null });
    const result = await repository.reserve(reservation(team, 300, limits(100, 1000)));
    expect(result).toMatchObject({ ok: false, reason: "quota_exceeded" });
    const rows = await usageRows(team.personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "pending", reserved_tokens: 800 });
  });

  // -------------------------------------------------------------------------
  // Quota (AC11, AC13)
  // -------------------------------------------------------------------------

  it("refuses with quota_exceeded and the next 00:00 SGT, inserting nothing (AC11, G3, G5)", async () => {
    const team = await newTeam();
    await insertUsage(team, { createdAtSql: "now()", charged: 600 });
    const before = await usageRows(team.personId);

    const result = await repository.reserve(reservation(team, 500, limits(100, 1000)));

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "quota_exceeded") {
      throw new Error(`expected quota_exceeded, got ${JSON.stringify(result)}`);
    }
    expect(result.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(result.resetsAt).getTime()).toBe(await nextSgtMidnight());
    expect(await usageRows(team.personId)).toEqual(before);
  });

  it("allows a reservation that brings the daily total exactly to the quota (G5)", async () => {
    const team = await newTeam();
    await insertUsage(team, { createdAtSql: "now()", charged: 600 });
    expect((await repository.reserve(reservation(team, 400, limits(100, 1000)))).ok).toBe(true);
  });

  it("does not count another person's usage", async () => {
    const team = await newTeam();
    const other = await newTeam();
    await insertUsage(other, { createdAtSql: "now()", charged: 1000 });
    for (let index = 0; index < 5; index += 1) {
      await insertUsage(other, { createdAtSql: "now() - interval '5 seconds'" });
    }
    expect((await repository.reserve(reservation(team, 1000, limits(5, 1000)))).ok).toBe(true);
  });

  it("does not count a record from 23:59:59 SGT yesterday against today (AC13, G6)", async () => {
    const team = await newTeam();
    await insertUsage(team, { createdAtSql: `${SGT_DAY_START} - interval '1 second'`, charged: 1000 });
    expect((await repository.reserve(reservation(team, 1000, limits(100, 1000)))).ok).toBe(true);
  });

  it("counts a record from 00:00:00 SGT today against today (AC13, G6)", async () => {
    const team = await newTeam();
    await insertUsage(team, { createdAtSql: SGT_DAY_START, charged: 1 });
    expect(await repository.reserve(reservation(team, 1000, limits(100, 1000)))).toMatchObject({
      ok: false,
      reason: "quota_exceeded",
    });
  });

  it("assigns 23:59:59 and 00:00:00 SGT to different SGT dates (AC13)", async () => {
    const { rows } = await db().admin.query<{ before: string; after: string }>(
      `SELECT ((${SGT_DAY_START} - interval '1 second') AT TIME ZONE 'Asia/Singapore')::date::text AS before,
              (${SGT_DAY_START} AT TIME ZONE 'Asia/Singapore')::date::text AS after`,
    );
    expect(rows[0].before).not.toBe(rows[0].after);
  });

  // -------------------------------------------------------------------------
  // Rate limit (AC10, AC26)
  // -------------------------------------------------------------------------

  it("refuses with rate_limited after 5 non-cached records in the last 60 s, in any outcome (AC10, G6)", async () => {
    const team = await newTeam();
    for (const outcome of ["pending", "succeeded", "invalid_output", "provider_error", "succeeded"]) {
      await insertUsage(team, { createdAtSql: "now() - interval '10 seconds'", outcome, reserved: 1, charged: outcome === "pending" ? null : 1 });
    }
    const before = await usageRows(team.personId);
    const result = await repository.reserve(reservation(team, 10, limits(5, 1_000_000)));
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(await usageRows(team.personId)).toEqual(before);
  });

  it("does not count a record 60 s old or older (AC10, G6)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 4; index += 1) {
      await insertUsage(team, { createdAtSql: "now() - interval '10 seconds'" });
    }
    await insertUsage(team, { createdAtSql: "now() - interval '60 seconds'" });
    expect((await repository.reserve(reservation(team, 10, limits(5, 1_000_000)))).ok).toBe(true);
  });

  it("counts a record 55 s old (AC10, G6)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 4; index += 1) {
      await insertUsage(team, { createdAtSql: "now() - interval '10 seconds'" });
    }
    await insertUsage(team, { createdAtSql: "now() - interval '55 seconds'" });
    expect(await repository.reserve(reservation(team, 10, limits(5, 1_000_000)))).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("does not count cached records toward the rate limit (AC18, G6)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 5; index += 1) {
      await insertUsage(team, { createdAtSql: "now() - interval '5 seconds'", outcome: "cached", cached: true });
    }
    expect((await repository.reserve(reservation(team, 10, limits(5, 1_000_000)))).ok).toBe(true);
  });

  it("returns rate_limited, not quota_exceeded, when both would refuse (AC26, Q4)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 5; index += 1) {
      await insertUsage(team, { createdAtSql: "now() - interval '5 seconds'", charged: 1000 });
    }
    const before = await usageRows(team.personId);
    expect(await repository.reserve(reservation(team, 1000, limits(5, 1000)))).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(await usageRows(team.personId)).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Concurrency (AC12)
  // -------------------------------------------------------------------------

  it("lets only one of two concurrent reservations through when the quota covers one (AC12, D-G)", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const team = await newTeam();
      const quota = limits(100, 1000);
      const results = await Promise.all([
        repository.reserve(reservation(team, 600, quota)),
        repository.reserve(reservation(team, 600, quota)),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ ok: false, reason: "quota_exceeded" }),
      ]);
      expect(await usageRows(team.personId)).toHaveLength(1);
    }
  });

  // -------------------------------------------------------------------------
  // Cache hits (AC18)
  // -------------------------------------------------------------------------

  it("records a cache hit with zero tokens and no limit check, even at both limits (AC18, G7, Q1)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 5; index += 1) {
      await insertUsage(team, { createdAtSql: "now() - interval '5 seconds'", charged: 1000 });
    }
    await repository.recordCacheHit({
      feature: "progress_report",
      projectId: team.projectId,
      personId: team.personId,
      environment: "production",
    });
    const cached = (await usageRows(team.personId)).filter((row) => row.cached);
    expect(cached).toEqual([
      expect.objectContaining({
        feature: "progress_report",
        project_id: team.projectId,
        person_id: team.personId,
        environment: "production",
        outcome: "cached",
        cached: true,
        reserved_tokens: 0,
        charged_tokens: 0,
      }),
    ]);
  });

  it("does not count cache hits toward the quota (AC18)", async () => {
    const team = await newTeam();
    for (let index = 0; index < 3; index += 1) {
      await repository.recordCacheHit({
        feature: "acceptance_check",
        projectId: team.projectId,
        personId: team.personId,
        environment: "development",
      });
    }
    expect((await repository.reserve(reservation(team, 1000, limits(5, 1000)))).ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Task 6.3 migration constraints (AC20, AC27, AC28)
  // -------------------------------------------------------------------------

  it("rejects an environment other than development or production (AC20, E6)", async () => {
    const team = await newTeam();
    await expectIntegrityRejection(
      runtime.query(
        `INSERT INTO ${USAGE} (feature, project_id, person_id, environment, reserved_tokens) VALUES ($1, $2, $3, $4, 0)`,
        [SYNTHETIC_FEATURE, team.projectId, team.personId, "staging"],
      ),
    );
  });

  it.each(["development", "production"])("accepts environment %s (AC20)", async (environment) => {
    const team = await newTeam();
    const { rowCount } = await runtime.query(
      `INSERT INTO ${USAGE} (feature, project_id, person_id, environment, reserved_tokens) VALUES ($1, $2, $3, $4, 0)`,
      [SYNTHETIC_FEATURE, team.projectId, team.personId, environment],
    );
    expect(rowCount).toBe(1);
  });

  it.each(["acceptance_criteria_check", "other_feature", ""])("rejects feature %j (AC27, Q5)", async (feature) => {
    const team = await newTeam();
    await expectIntegrityRejection(
      runtime.query(
        `INSERT INTO ${USAGE} (feature, project_id, person_id, environment, reserved_tokens) VALUES ($1, $2, $3, $4, 0)`,
        [feature, team.projectId, team.personId, SYNTHETIC_ENVIRONMENT],
      ),
    );
  });

  it.each(["acceptance_check", "progress_report"])("accepts feature %s (AC27, Q5)", async (feature) => {
    const team = await newTeam();
    const { rowCount } = await runtime.query(
      `INSERT INTO ${USAGE} (feature, project_id, person_id, environment, reserved_tokens) VALUES ($1, $2, $3, $4, 0)`,
      [feature, team.projectId, team.personId, SYNTHETIC_ENVIRONMENT],
    );
    expect(rowCount).toBe(1);
  });

  it("has a nullable integer charged_tokens column (AC28, Q1)", async () => {
    const { rows } = await db().admin.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = 'charged_tokens'`,
      [SCHEMA, ENTITY_TABLES.usageRecords],
    );
    expect(rows).toEqual([{ data_type: "integer", is_nullable: "YES" }]);
    const team = await newTeam();
    const pending = await insertPendingUsageRecord(runtime, { projectId: team.projectId, personId: team.personId });
    expect(pending.charged_tokens).toBeNull();
  });

  it("rejects a negative charged_tokens and accepts zero (AC28, Q1)", async () => {
    const team = await newTeam();
    const pending = await insertPendingUsageRecord(runtime, { projectId: team.projectId, personId: team.personId });
    await expectIntegrityRejection(
      runtime.query(`UPDATE ${USAGE} SET charged_tokens = -1 WHERE id = $1`, [pending.id]),
    );
    const zero = await runtime.query(`UPDATE ${USAGE} SET charged_tokens = 0 WHERE id = $1`, [pending.id]);
    expect(zero.rowCount).toBe(1);
  });

  it("validates the new constraints (no NOT VALID constraint on usage_records) (AC28, Q6)", async () => {
    const { rows } = await db().admin.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'app.usage_records'::regclass AND contype = 'c' AND NOT convalidated`,
    );
    expect(rows).toEqual([]);
  });

  it("adds the constraints in one new migration after the shipped one, without NOT VALID (AC20, AC27, AC28)", () => {
    const files = listMigrationFiles();
    const shippedIndex = files.indexOf(SHIPPED_MIGRATION);
    expect(shippedIndex).toBeGreaterThanOrEqual(0);
    const later = files.slice(shippedIndex + 1);
    const usageMigrations = later.filter((name) => /charged_tokens/.test(readMigration(name)));
    expect(usageMigrations).toHaveLength(1);
    const text = readMigration(usageMigrations[0]);
    expect(text).toMatch(/\benvironment\b/);
    expect(text).toMatch(/\bfeature\b/);
    expect(text).toMatch(/ADD\s+CONSTRAINT/i);
    expect(text).not.toMatch(/NOT\s+VALID/i);
  });

  it("leaves the shipped migration unchanged (AC20, AC28)", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", `supabase/migrations/${SHIPPED_MIGRATION}`], {
      cwd: repositoryRoot,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
