import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ProjectDashboardRepository } from "@/server/project-dashboard";

// Task 4.7 D3/D6 runtime regressions. This fake validates a single-connection
// protocol and the existing task_events schema contract; it does NOT execute SQL.
// Real PostgreSQL coverage remains in integration/db/project-dashboard-reads.test.ts.
const projectId = "47000000-0000-4000-8000-000000000001";
const personId = "47000000-0000-4000-8000-000000000003";
type Operation = "begin" | "counts" | "memberCount" | "members" | "completed" | "commit" | "rollback";
function operation(sql: string): Operation {
  if (/^BEGIN\b/i.test(sql)) return "begin";
  if (/^COMMIT\b/i.test(sql)) return "commit";
  if (/^ROLLBACK\b/i.test(sql)) return "rollback";
  if (/\bcompleted_today\b/i.test(sql)) return "completed";
  if (/\bmember_count\b/i.test(sql)) return "memberCount";
  if (/\bgithub_username\b/i.test(sql)) return "members";
  if (/\bFROM\s+app\.tasks\b/i.test(sql)) return "counts";
  throw new Error("Unexpected dashboard query in test boundary");
}
function database(options: { singleFlight?: boolean; schemaAware?: boolean; failAt?: Operation; failRollback?: boolean } = {}) {
  const starts: Operation[] = []; const finished: Operation[] = [];
  const statements: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  const failure = new Error("synthetic database read failure");
  const overlap = new Error("synthetic single-flight connection refuses concurrent queries");
  let active = 0;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    const op = operation(sql); starts.push(op); statements.push({ sql, values });
    if (options.singleFlight && active !== 0) throw overlap;
    active++;
    try {
      // Keep each query pending across an async boundary so Promise.all on one
      // connection reproduces pg's unsupported concurrent-query usage.
      await Promise.resolve(); await Promise.resolve();
      if (op === options.failAt) throw failure;
      if (op === "rollback" && options.failRollback) throw new Error("synthetic rollback failure");
      if (options.schemaAware && op === "completed") {
        // Existing migrated app.task_events has task_id but NO project_id;
        // project ownership is obtained through app.tasks, not the event row.
        if (/\be\.project_id\b/i.test(sql)) throw Object.assign(new Error("column e.project_id does not exist"), { code: "42703" });
      }
      let rows: Record<string, unknown>[] = [];
      if (op === "counts") rows = [{ to_do: "2", in_progress: "1", in_review: "0", done: "1" }];
      if (op === "memberCount") rows = [{ member_count: "2" }];
      if (op === "members") rows = [{ person_id: personId, github_username: "synthetic-developer", role: "developer", to_do: "2", in_progress: "1", in_review: "0", done: "1" }];
      if (op === "completed") rows = [{ completed_today: "1" }];
      finished.push(op);
      return { rows, rowCount: rows.length };
    } finally { active--; }
  });
  const connection = { query, release };
  const pool = { connect: vi.fn(async () => connection), query: vi.fn(async () => { throw new Error("Dashboard reads must use the checked-out snapshot connection"); }) };
  const repository = new ProjectDashboardRepository(pool as unknown as ConstructorParameters<typeof ProjectDashboardRepository>[0]);
  return { repository, starts, finished, statements, release, pool, failure, overlap };
}
describe("Project dashboard repository runtime protocol (4.7 D3/D6)", () => {
  it("reads consistent aggregates on one single-flight connection, commits, and releases", async () => {
    const f = database({ singleFlight: true });
    await expect(f.repository.readSnapshot(projectId)).resolves.toEqual({
      stateCounts: { to_do: 2, in_progress: 1, in_review: 0, done: 1 }, memberCount: 2, completedToday: 1,
      members: [{ personId, githubUsername: "synthetic-developer", role: "developer", stateCounts: { to_do: 2, in_progress: 1, in_review: 0, done: 1 } }],
    });
    expect(f.pool.connect).toHaveBeenCalledOnce(); expect(f.pool.query).not.toHaveBeenCalled();
    expect(f.statements[0].sql).toMatch(/BEGIN.*REPEATABLE READ.*READ ONLY/i);
    expect(f.starts.at(-1)).toBe("commit"); expect(f.finished).toEqual(f.starts);
    expect(f.starts).not.toContain("rollback"); expect(f.release).toHaveBeenCalledOnce();
    for (const statement of f.statements.filter(s => !/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(s.sql))) {
      expect(statement.values).toEqual([projectId]); expect(statement.sql).not.toContain(projectId);
    }
  });
  it("scopes approval events through their task's project instead of an undefined event column", async () => {
    // Disable single-flight checking here so the independent schema defect is
    // observable even before the scheduling regression has been fixed.
    const f = database({ schemaAware: true });
    await expect(f.repository.readSnapshot(projectId)).resolves.toMatchObject({ completedToday: 1 });
    const sql = f.statements.find(s => operation(s.sql) === "completed")!.sql;
    expect(sql).toMatch(/JOIN\s+app\.tasks\s+t\s+ON\s+t\.id\s*=\s*e\.task_id/i);
    expect(sql).toMatch(/\bt\.project_id\s*=\s*\$1(?:::uuid)?/i);
    expect(sql).not.toMatch(/\be\.project_id\b/i);
    expect(sql).toMatch(/count\s*\(\s*DISTINCT\s+e\.task_id\s*\)/i);
    expect(sql).toMatch(/t\.deleted_at\s+IS\s+NULL/i);
    expect(sql).toContain("Asia/Singapore");
  });
  it.each(["counts", "memberCount", "members", "completed"] as const)("rolls back and releases after %s fails, without starting later reads", async failAt => {
    const f = database({ failAt });
    await expect(f.repository.readSnapshot(projectId)).rejects.toBe(f.failure);
    expect(f.starts).not.toContain("commit"); expect(f.starts.at(-1)).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
    const afterFailedRead = f.starts.slice(f.starts.indexOf(failAt) + 1);
    expect(afterFailedRead).toEqual(["rollback"]);
  });
  it("releases the connection if beginning the snapshot fails", async () => {
    const f = database({ failAt: "begin" });
    await expect(f.repository.readSnapshot(projectId)).rejects.toBe(f.failure);
    expect(f.starts).toEqual(["begin"]); expect(f.release).toHaveBeenCalledOnce();
  });
  it("rolls back and releases if commit fails", async () => {
    const f = database({ failAt: "commit" });
    await expect(f.repository.readSnapshot(projectId)).rejects.toBe(f.failure);
    expect(f.starts.slice(-2)).toEqual(["commit", "rollback"]); expect(f.release).toHaveBeenCalledOnce();
  });
  it("preserves the original read error and releases even when rollback also fails", async () => {
    const f = database({ failAt: "completed", failRollback: true });
    await expect(f.repository.readSnapshot(projectId)).rejects.toBe(f.failure);
    expect(f.starts.at(-1)).toBe("rollback"); expect(f.release).toHaveBeenCalledOnce();
  });
});
