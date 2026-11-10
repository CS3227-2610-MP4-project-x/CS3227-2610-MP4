import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AI_LIMITS, FakeAdapter, LlmGateway, type FakeOutcome } from "@/server/ai";
import { createProgressReportGenerationService, type ReportAssemblyResult } from "@/server/progress-report";
import { ids, range, ready, statement, stored } from "./generation-fixtures";

const request = { projectId: ids.project, personId: ids.pm, startDate: range.startDate, endDate: range.endDate };
const success: FakeOutcome = { ok: true, text: JSON.stringify({ statements: [statement] }), usage: { inputTokens: 20, outputTokens: 10 } };

function setup(script: readonly FakeOutcome[] = [success]) {
  const adapter = new FakeAdapter(script);
  const complete = vi.spyOn(adapter, "complete");
  const usage = {
    reserve: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, usageRecordId: "synthetic-usage" })),
    settle: vi.fn(async (..._args: unknown[]) => {}),
    recordCacheHit: vi.fn(async (..._args: unknown[]) => {}),
  };
  const gateway = new LlmGateway({ adapter, usage, environment: "development", limits: AI_LIMITS.development });
  const run = vi.spyOn(gateway, "run");
  const assembly = { assemble: vi.fn(async (..._args: unknown[]): Promise<ReportAssemblyResult> => ready()) };
  const repository = {
    read: vi.fn(async (..._args: unknown[]): Promise<ReturnType<typeof stored> | null> => null),
    publish: vi.fn(async (..._args: unknown[]) => ({ kind: "stored" as const, report: stored() })),
  };
  const service = createProgressReportGenerationService({ assembly, repository, gateway, providerModel: "fake:fake" });
  return { service, assembly, repository, complete, usage, run };
}

describe("8.2 generation through the real gateway and scripted fake", () => {
  it("generates, validates, persists UUID citations and projects server-owned keys", async () => {
    const f = setup();
    const result = await f.service.generate(request);
    expect(result).toMatchObject({ reused: false, report: { kind: "generated", id: ids.report, range, model: "fake", githubUnavailable: false, statements: [{ ...statement, tasks: [{ taskId: ids.task, taskKey: "SYN-1" }] }] } });
    if (result.report.kind !== "generated") throw new Error("Expected generated report");
    expect(result.report.statements[0].tasks).toEqual([{ taskId: ids.task, taskKey: "SYN-1" }]);
    expect(f.repository.publish).toHaveBeenCalledOnce();
    expect(f.repository.publish).toHaveBeenCalledWith(expect.objectContaining({ personId: ids.pm, expectedVersion: null, statements: [statement], key: expect.objectContaining({ projectId: ids.project, inputFingerprint: "a".repeat(64), generationContractVersion: "progress-report-v1", providerModel: "fake:fake" }) }));
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ feature: "progress_report", projectId: ids.project, personId: ids.pm, maxOutputTokens: 2000 }));
    expect(f.assembly.assemble).toHaveBeenCalledTimes(2);
    expect(f.usage.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", chargedTokens: 30 }));
  });

  it("retries an invalid citation once and stores only the valid retry", async () => {
    const f = setup([{ ...success, text: JSON.stringify({ statements: [{ ...statement, taskIds: [ids.absentTask] }] }) }, success]);
    await f.service.generate(request);
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.repository.publish).toHaveBeenCalledWith(expect.objectContaining({ statements: [statement] }));
    expect(f.usage.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", chargedTokens: 60 }));
  });

  it("two invalid outputs fail safely and persist no report", async () => {
    const bad = { ...success, text: JSON.stringify({ statements: [{ ...statement, taskIds: [] }] }) };
    const f = setup([bad, bad]);
    await expect(f.service.generate(request)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(f.usage.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "invalid_output", chargedTokens: 60 }));
  });

  it("provider failure is not retried and stores no report", async () => {
    const f = setup([{ ok: false, category: "unavailable" }]);
    await expect(f.service.generate(request)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(f.usage.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "provider_error" }));
  });

  it("missing provider usage charges the call maximum rather than zero", async () => {
    const f = setup([{ ...success, usage: null }]);
    await f.service.generate(request);
    expect(f.usage.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", inputTokens: null, outputTokens: null, chargedTokens: expect.any(Number) }));
    const settlement = f.usage.settle.mock.calls[0][0] as { chargedTokens: number };
    expect(settlement.chargedTokens).toBeGreaterThan(2000);
  });

  it("unchanged complete input returns cache and records a zero-token hit without reservations", async () => {
    const f = setup();
    f.repository.read.mockResolvedValue(stored());
    const result = await f.service.generate(request);
    expect(result.reused).toBe(true);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.usage.recordCacheHit).toHaveBeenCalledExactlyOnceWith({ feature: "progress_report", projectId: ids.project, personId: ids.pm, environment: "development" });
    expect(f.repository.publish).not.toHaveBeenCalled();
  });

  it.each([
    ["changed input", { inputFingerprint: "b".repeat(64) }],
    ["legacy fingerprint", { inputFingerprint: null }],
    ["legacy contract", { generationContractVersion: null }],
    ["old contract", { generationContractVersion: "old" }],
    ["different provider/model", { providerModel: "another:model" }],
    ["legacy provider identity", { providerModel: null }],
    ["partial stored evidence", { githubUnavailable: true }],
  ])("regenerates a non-reusable cache: %s", async (_name, changes) => {
    const f = setup();
    f.repository.read.mockResolvedValue(stored(changes));
    await f.service.generate(request);
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.usage.recordCacheHit).not.toHaveBeenCalled();
    expect(f.repository.publish).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }));
  });

  it("partial current metadata bypasses an otherwise matching cache and returns the warning", async () => {
    const f = setup();
    f.assembly.assemble.mockResolvedValue(ready("a".repeat(64), true));
    f.repository.read.mockResolvedValue(stored());
    f.repository.publish.mockResolvedValue({ kind: "stored", report: stored({ githubUnavailable: true }) });
    const result = await f.service.generate(request);
    expect(result.report.githubUnavailable).toBe(true);
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.usage.recordCacheHit).not.toHaveBeenCalled();
  });

  it("changed input after the LLM refuses publication", async () => {
    const f = setup();
    f.assembly.assemble.mockResolvedValueOnce(ready()).mockResolvedValueOnce(ready("b".repeat(64)));
    await expect(f.service.generate(request)).rejects.toMatchObject({ code: "REPORT_INPUT_CHANGED" });
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(f.usage.settle).toHaveBeenCalledOnce();
  });

  it("empty input is deterministic and has no cache, usage or provider effects", async () => {
    const f = setup();
    f.assembly.assemble.mockResolvedValue({ kind: "empty", range });
    expect(await f.service.generate(request)).toEqual({ report: { kind: "empty", range, statements: [], githubUnavailable: false }, reused: false });
    expect(f.repository.read).not.toHaveBeenCalled();
    expect(f.repository.publish).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.usage.recordCacheHit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "invalid_range" as const }, "INVALID_REQUEST"],
    [{ kind: "range_too_long" as const }, "REPORT_RANGE_TOO_LONG"],
    [{ kind: "input_budget_exceeded" as const, range }, "REPORT_INPUT_BUDGET_EXCEEDED"],
  ])("maps assembly refusal %j without a provider call", async (outcome, code) => {
    const f = setup();
    f.assembly.assemble.mockResolvedValue(outcome);
    await expect(f.service.generate(request)).rejects.toMatchObject({ code });
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.repository.publish).not.toHaveBeenCalled();
  });

  it("revoked PM access on the final assembly refuses publication", async () => {
    const f = setup();
    f.assembly.assemble.mockResolvedValueOnce(ready()).mockRejectedValueOnce(Object.assign(new Error("Access refused"), { code: "FORBIDDEN" }));
    await expect(f.service.generate(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.repository.publish).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_FOUND"])("direct-service %s precedes cache, provider and usage", async (code) => {
    const f = setup();
    f.assembly.assemble.mockRejectedValue(Object.assign(new Error("Access refused"), { code }));
    await expect(f.service.generate(request)).rejects.toMatchObject({ code });
    expect(f.repository.read).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.repository.publish).not.toHaveBeenCalled();
  });
});
