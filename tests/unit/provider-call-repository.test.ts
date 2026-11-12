import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ProviderCallRepository } from "@/server/repositories/provider-call-repository";

// Provider capability and shared-key limits: transaction completion is independent
// of the inference network request. No raw credentials enter persistence.
const fingerprint = "a".repeat(64);
function harness(recent = "0") {
  const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => ({ rows: sql.includes("count(*)") ? [{ count: recent }] : [], rowCount: 1 }));
  const release = vi.fn(), connect = vi.fn(async () => ({ query, release }));
  const repository = new ProviderCallRepository({ connect } as unknown as Pool);
  return { repository, query, release, connect };
}
describe("provider-call permit repository", () => {
  it.each([["raw-secret", 30], ["A".repeat(64), 30], [fingerprint, 0], [fingerprint, 1.5], [fingerprint, Infinity]])("rejects invalid key fingerprint/limit before a connection", async (key, limit) => {
    const h = harness(); await expect(h.repository.acquire(String(key), Number(limit))).rejects.toThrow(); expect(h.connect).not.toHaveBeenCalled();
  });
  it("commits and releases an allowed permit with parameterized fingerprint values", async () => {
    const h = harness(); expect(await h.repository.acquire(fingerprint, 30)).toBe(true);
    expect(h.query).toHaveBeenCalledWith("COMMIT"); expect(h.release).toHaveBeenCalledOnce();
    const statements = h.query.mock.calls.map(([sql]) => sql).join(" ");
    expect(statements).not.toContain(fingerprint);
    expect(h.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO"))).toEqual([[expect.any(String), [fingerprint]]]);
  });
  it("denies at the boundary without inserting and releases the transaction", async () => {
    const h = harness("30"); expect(await h.repository.acquire(fingerprint, 30)).toBe(false);
    expect(h.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    expect(h.query).toHaveBeenCalledWith("ROLLBACK"); expect(h.release).toHaveBeenCalledOnce();
  });
  it("rolls back and releases when persistence fails", async () => {
    const h = harness(); h.query.mockRejectedValueOnce(new Error("synthetic transaction failure"));
    await expect(h.repository.acquire(fingerprint, 30)).rejects.toThrow("synthetic transaction failure");
    expect(h.query).toHaveBeenCalledWith("ROLLBACK"); expect(h.release).toHaveBeenCalledOnce();
  });
});
