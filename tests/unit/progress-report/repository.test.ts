import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createProgressReportRepository } from "@/server/progress-report";

function harness() {
  const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    statements.push({ text, values });
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const repository = createProgressReportRepository({ connect: async () => ({ query, release }) });
  return { repository, statements, query, release };
}
describe("report repository snapshot lifecycle (8.1 D8)", () => {
  it("starts a repeatable-read read-only transaction, commits and releases before resolving", async () => {
    const h = harness();
    expect(await h.repository.withReadSnapshot(async () => "snapshot-value")).toBe("snapshot-value");
    const sql = h.statements.map((item) => item.text).join(" ");
    expect(sql).toMatch(/repeatable\s+read/i);
    expect(sql).toMatch(/read\s+only/i);
    expect(sql).toMatch(/commit/i);
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(h.release).toHaveBeenCalledOnce();
  });
  it("rolls back and releases after a failed read", async () => {
    const h = harness();
    await expect(h.repository.withReadSnapshot(async () => { throw new Error("synthetic read failure"); })).rejects.toThrow();
    expect(h.statements.map((item) => item.text).join(" ")).toMatch(/rollback/i);
    expect(h.release).toHaveBeenCalledOnce();
  });
  it("binds access inputs as SQL values rather than interpolating them", async () => {
    const h = harness();
    const projectId = "project-synthetic-parameter";
    const personId = "person-synthetic-parameter";
    await h.repository.withReadSnapshot((session) => session.readAccess({ projectId, personId }));
    const reads = h.statements.filter((item) => item.values?.includes(projectId));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some((item) => item.values?.includes(personId))).toBe(true);
    expect(h.statements.some((item) => item.text.includes(projectId) || item.text.includes(personId))).toBe(false);
  });
});
