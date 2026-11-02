import "server-only";

import type { Pool, PoolClient } from "pg";
import type {
  UsageCacheHit,
  UsagePort,
  UsageReservation,
  UsageReservationResult,
  UsageSettlement,
} from "@/server/ai";

// PostgreSQL usage port (LLM Gateway Decisions G6-G8, D-G, Task 6.3 handoff decisions Q1,
// Q4). The only writer of app.usage_records and app.usage_quota_days. Reservation and
// settlement are separate transactions, so no transaction is open during an LLM call.
// All times are database time; the SGT day is (now() AT TIME ZONE 'Asia/Singapore')::date.

const SGT_DATE = "(now() AT TIME ZONE 'Asia/Singapore')::date";

const ENSURE_QUOTA_DAY = `
  INSERT INTO app.usage_quota_days (person_id, sgt_date)
  VALUES ($1::uuid, ${SGT_DATE})
  ON CONFLICT (person_id, sgt_date) DO NOTHING`;

const LOCK_QUOTA_DAY = `
  SELECT id FROM app.usage_quota_days
   WHERE person_id = $1::uuid AND sgt_date = ${SGT_DATE}
   FOR UPDATE`;

const COUNT_RECENT_REQUESTS = `
  SELECT count(*)::integer AS recent
    FROM app.usage_records
   WHERE person_id = $1::uuid
     AND cached = false
     AND created_at > now() - interval '60 seconds'`;

// Daily total: charged tokens of settled records plus reserved tokens of pending ones (Q1).
const DAILY_TOTAL = `
  WITH day AS (
    SELECT (${SGT_DATE}::timestamp AT TIME ZONE 'Asia/Singapore') AS starts_at,
           ((${SGT_DATE} + 1)::timestamp AT TIME ZONE 'Asia/Singapore') AS ends_at
  )
  SELECT COALESCE(SUM(CASE WHEN r.outcome = 'pending' THEN r.reserved_tokens
                           ELSE COALESCE(r.charged_tokens, 0) END), 0)::bigint::text AS total,
         to_char(day.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resets_at
    FROM day
    LEFT JOIN app.usage_records r
      ON r.person_id = $1::uuid
     AND r.cached = false
     AND r.created_at >= day.starts_at
     AND r.created_at < day.ends_at
   GROUP BY day.ends_at`;

const INSERT_PENDING = `
  INSERT INTO app.usage_records (feature, project_id, person_id, environment, reserved_tokens, outcome, cached)
  VALUES ($1, $2::uuid, $3::uuid, $4, $5, 'pending', false)
  RETURNING id::text AS id`;

const SETTLE = `
  UPDATE app.usage_records
     SET outcome = $2, input_tokens = $3, output_tokens = $4, charged_tokens = $5, latency_ms = $6
   WHERE id = $1::uuid AND outcome = 'pending'`;

const INSERT_CACHE_HIT = `
  INSERT INTO app.usage_records
    (feature, project_id, person_id, environment, reserved_tokens, charged_tokens, outcome, cached)
  VALUES ($1, $2::uuid, $3::uuid, $4, 0, 0, 'cached', true)`;

export class UsageRepository implements UsagePort {
  constructor(private readonly pool: Pool) {}

  async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    const client = await this.pool.connect();
    let result: UsageReservationResult;
    try {
      await client.query("BEGIN");
      result = await this.#reserveInTransaction(client, input);
      await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    } catch (error) {
      // Discard the connection when the transaction failed, whether or not ROLLBACK succeeds.
      await client.query("ROLLBACK").catch(() => undefined);
      client.release(error instanceof Error ? error : true);
      throw error;
    }
    client.release();
    return result;
  }

  async #reserveInTransaction(client: PoolClient, input: UsageReservation): Promise<UsageReservationResult> {
    await client.query(ENSURE_QUOTA_DAY, [input.personId]);
    await client.query(LOCK_QUOTA_DAY, [input.personId]);

    const recent = await client.query<{ recent: number }>(COUNT_RECENT_REQUESTS, [input.personId]);
    if ((recent.rows[0]?.recent ?? 0) >= input.limits.requestsPerMinute) {
      return { ok: false, reason: "rate_limited" };
    }

    const daily = await client.query<{ total: string; resets_at: string }>(DAILY_TOTAL, [input.personId]);
    const row = daily.rows[0];
    if (!row) {
      throw new Error("Daily usage total query returned no row.");
    }
    if (Number(row.total) + input.reservedTokens > input.limits.dailyTokenQuota) {
      return { ok: false, reason: "quota_exceeded", resetsAt: row.resets_at };
    }

    const inserted = await client.query<{ id: string }>(INSERT_PENDING, [
      input.feature,
      input.projectId,
      input.personId,
      input.environment,
      input.reservedTokens,
    ]);
    const record = inserted.rows[0];
    if (!record) {
      throw new Error("Usage reservation insert returned no row.");
    }
    return { ok: true, usageRecordId: record.id };
  }

  async settle(input: UsageSettlement): Promise<void> {
    const result = await this.pool.query(SETTLE, [
      input.usageRecordId,
      input.outcome,
      input.inputTokens,
      input.outputTokens,
      input.chargedTokens,
      input.latencyMs,
    ]);
    if (result.rowCount !== 1) {
      throw new Error("Usage record to settle was not found or was already settled.");
    }
  }

  async recordCacheHit(input: UsageCacheHit): Promise<void> {
    await this.pool.query(INSERT_CACHE_HIT, [input.feature, input.projectId, input.personId, input.environment]);
  }
}
