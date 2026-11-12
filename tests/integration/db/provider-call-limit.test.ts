import { createHash, randomUUID } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ProviderCallRepository } from "@/server/repositories/provider-call-repository";
import { runtimePool, ROLES } from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

// Approved distributed provider-call limits. This harness creates an isolated local
// synthetic database; no hosted migration or real provider key is used.
const table = "app.provider_call_permits";
function key() { return createHash("sha256").update(randomUUID()).digest("hex"); }
dbDescribe("distributed rolling provider-key permit limits", () => {
  const db = useMigratedDatabase(); let repository: ProviderCallRepository;
  beforeAll(() => { repository = new ProviderCallRepository(runtimePool(() => db().connectAsRuntime())); });
  async function count(fingerprint: string) {
    const result = await db().admin.query(`SELECT count(*)::int AS count FROM ${table} WHERE key_fingerprint = $1`, [fingerprint]);
    return result.rows[0].count;
  }
  it("allows the exact key limit and inserts no row for refusal", async () => {
    const fingerprint = key(); expect(await repository.acquire(fingerprint, 2)).toBe(true);
    expect(await repository.acquire(fingerprint, 2)).toBe(true); expect(await repository.acquire(fingerprint, 2)).toBe(false);
    expect(await count(fingerprint)).toBe(2);
  });
  it("shares one key across independent instances and admits only one competing final permit", async () => {
    const fingerprint = key(); await repository.acquire(fingerprint, 2);
    const other = new ProviderCallRepository(runtimePool(() => db().connectAsRuntime()));
    const results = await Promise.all([repository.acquire(fingerprint, 2), other.acquire(fingerprint, 2), repository.acquire(fingerprint, 2)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(await count(fingerprint)).toBe(2);
  });
  it("does not share capacity between distinct key fingerprints", async () => {
    const one = key(), two = key(); await repository.acquire(one, 1);
    expect(await repository.acquire(one, 1)).toBe(false); expect(await repository.acquire(two, 1)).toBe(true);
  });
  it("ignores expired rows independently of cleanup but counts recent attempts", async () => {
    const expired = key(), recent = key();
    await db().admin.query(`INSERT INTO ${table}(key_fingerprint, acquired_at) VALUES ($1,clock_timestamp()-interval '60 seconds'),($2,clock_timestamp()-interval '55 seconds')`, [expired, recent]);
    expect(await repository.acquire(expired, 1)).toBe(true); expect(await count(expired)).toBe(2);
    expect(await repository.acquire(recent, 1)).toBe(false); expect(await count(recent)).toBe(1);
  });
  it("rejects invalid fingerprint storage at the database boundary", async () => {
    const runtime = await db().connectAsRuntime();
    await expectIntegrityRejection(runtime.query(`INSERT INTO ${table}(key_fingerprint) VALUES ($1)`, ["synthetic-unhashed-key"]));
  });
  it("stores only fingerprint/time/opaque ID and grants runtime SELECT/INSERT only", async () => {
    const columns = await db().admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='provider_call_permits' ORDER BY ordinal_position");
    expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "key_fingerprint", "acquired_at"]);
    const result = await db().admin.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='app' AND table_name='provider_call_permits' AND grantee='app_runtime' ORDER BY privilege_type`);
    expect(result.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });
  it.each(ROLES.withoutAppAccess)("denies direct Data API role %s all table privileges", async (role) => {
    const result = await db().admin.query("SELECT has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS allowed", [role, table]);
    expect(result.rows[0].allowed).toBe(false);
  });
});
