import "server-only";

import type { Pool } from "pg";
import type { ProviderCallPermitPort } from "@/server/ai";

/** Serializes provider-key permit acquisition with database time, not process time. */
export class ProviderCallRepository implements ProviderCallPermitPort {
  constructor(private readonly pool: Pool) {}

  async acquire(fingerprint: string, limit: number): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("Invalid provider call permit input.");
    }
    const client = await this.pool.connect();
    let releaseError: Error | boolean | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [fingerprint]);
      const recent = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM app.provider_call_permits
          WHERE key_fingerprint = $1
            AND acquired_at > clock_timestamp() - interval '60 seconds'`,
        [fingerprint],
      );
      if (Number(recent.rows[0]?.count ?? "0") >= limit) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "INSERT INTO app.provider_call_permits (key_fingerprint) VALUES ($1)",
        [fingerprint],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      releaseError = error instanceof Error ? error : true;
      throw error;
    } finally {
      client.release(releaseError);
    }
  }
}
