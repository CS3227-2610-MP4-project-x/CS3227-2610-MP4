import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createProgressReportService, type ReportMetadataResult, type ReportRepository, type ReportSnapshot } from "@/server/progress-report";

const binding = { repositoryId: 41, installationId: 9, owner: "synthetic", name: "repo" };
const base: ReportSnapshot = { projectId: "project", repository: binding, tasks: [], activity: [], attachedCommits: [] };
function harness(access: "product_manager" | "developer" | "not_found" = "product_manager", snapshot = base) {
  const trace: string[] = [];
  const readAccess = vi.fn(async () => { trace.push("access"); return access; });
  const readCurrentSgtDate = vi.fn(async () => { trace.push("clock"); return "2026-11-09"; });
  const readInputs = vi.fn(async () => { trace.push("inputs"); return snapshot; });
  const repository: ReportRepository = {
    async withReadSnapshot(read) {
      trace.push("open");
      try { return await read({ readAccess, readCurrentSgtDate, readInputs }); }
      finally { trace.push("closed"); }
    },
  };
  const readBySha = vi.fn(async (): Promise<ReportMetadataResult> => { trace.push("github"); return { kind: "available", commits: [] }; });
  const service = createProgressReportService({ repository, githubMetadata: { readBySha } });
  return { service, trace, readAccess, readInputs, readCurrentSgtDate, readBySha };
}
const request = { projectId: "project", personId: "pm" };

describe("authorized read-only report service (8.1 D1/D4/D7/D8)", () => {
  it.each([["developer", "FORBIDDEN"], ["not_found", "NOT_FOUND"]] as const)("refuses %s before evidence reads", async (role, code) => {
    const h = harness(role);
    await expect(h.service.assemble(request)).rejects.toMatchObject({ code, message: expect.any(String) });
    expect(h.readAccess).toHaveBeenCalledWith(request);
    expect(h.readInputs).not.toHaveBeenCalled();
    expect(h.readBySha).not.toHaveBeenCalled();
    expect(h.trace.at(-1)).toBe("closed");
  });
  it("uses database SGT date for omission and no GitHub call without attached SHAs", async () => {
    const h = harness();
    expect(await h.service.assemble(request)).toMatchObject({ kind: "empty", range: { startDate: "2026-11-09", startUtc: "2026-11-08T16:00:00.000Z" } });
    expect(h.readCurrentSgtDate).toHaveBeenCalledOnce();
    expect(h.readInputs).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", range: expect.objectContaining({ endUtcExclusive: "2026-11-09T16:00:00.000Z" }) }));
    expect(h.trace.indexOf("access")).toBeLessThan(h.trace.indexOf("inputs"));
    expect(h.readBySha).not.toHaveBeenCalled();
  });
  it.each([
    [{ startDate: "2026-11-09" }, "invalid_range"],
    [{ startDate: "2026-11-02", endDate: "2026-11-09" }, "range_too_long"],
  ] as const)("refuses invalid input before evidence reads: %j", async (dates, kind) => {
    const h = harness();
    expect(await h.service.assemble({ ...request, ...dates })).toEqual({ kind });
    expect(h.readInputs).not.toHaveBeenCalled();
    expect(h.readBySha).not.toHaveBeenCalled();
  });
  it("closes one consistent database snapshot before metadata and fetches each SHA once", async () => {
    const sha = "a".repeat(40);
    const h = harness("product_manager", { ...base, attachedCommits: [
      { taskId: "a", taskKey: "APP-1", sha, attachedAt: "2026-11-09T00:00:00.000Z" },
      { taskId: "b", taskKey: "APP-2", sha, attachedAt: "2026-11-09T00:00:00.000Z" },
    ] });
    await h.service.assemble(request);
    expect(h.trace.filter((item) => item === "open")).toHaveLength(1);
    expect(h.trace.indexOf("closed")).toBeLessThan(h.trace.indexOf("github"));
    expect(h.readBySha).toHaveBeenCalledExactlyOnceWith({ repository: binding, shas: [sha] });
  });
  it("returns ready with an unavailable marker when metadata fails without other activity", async () => {
    const h = harness("product_manager", { ...base, attachedCommits: [{ taskId: "a", taskKey: "APP-1", sha: "a".repeat(40), attachedAt: "2026-11-09T00:00:00.000Z" }] });
    h.readBySha.mockResolvedValueOnce({ kind: "unavailable" });
    expect(await h.service.assemble(request)).toMatchObject({ kind: "ready", githubUnavailable: true });
  });
  it("does not turn a database failure into empty or reveal its raw details", async () => {
    const h = harness();
    h.readInputs.mockRejectedValueOnce(new Error("SELECT private_table; synthetic-provider-secret"));
    let error: unknown;
    try { await h.service.assemble(request); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: expect.stringMatching(/^[A-Z_]+$/), message: expect.any(String) });
    expect((error as Error).message).not.toMatch(/SELECT|private_table|synthetic-provider-secret/);
    expect(h.readBySha).not.toHaveBeenCalled();
    expect(h.trace.at(-1)).toBe("closed");
  });
});
