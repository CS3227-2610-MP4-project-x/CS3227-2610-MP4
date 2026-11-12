import { describe, expect, it, vi } from "vitest";
import { FakeAdapter, LlmGateway, buildPrompt, type GatewayRequest, type LlmAdapter, type LlmRequest,
  type ProviderCapabilities, type UsagePort, type UsageReservation, type UsageSettlement } from "@/server/ai";

// Approved ai-safeguards: complete prompt budgets, conservative context preflight,
// shared-key call permits and a single retry. Operational synthetic tests only.
const fingerprint = "a".repeat(64);
const capability: ProviderCapabilities = { contextTokens: 262144, requestsPerMinute: 30, sharedKeyLimit: true };
const request: GatewayRequest<string> = { feature: "acceptance_check", projectId: "synthetic-project", personId: "synthetic-person",
  instructions: "Return required JSON", segments: [{ name: "criteria", content: "中😀" }], maxOutputTokens: 2000,
  validate: () => ({ ok: true, value: "valid" }) };
function harness(caps: ProviderCapabilities = capability) {
  const events: string[] = [], reservations: UsageReservation[] = [], settlements: UsageSettlement[] = [], requests: LlmRequest[] = [];
  const getCapabilities = vi.fn(async () => { events.push("metadata"); return caps; });
  const complete = vi.fn(async (sent: LlmRequest) => { events.push("inference"); requests.push(sent); return new FakeAdapter([{ ok: true, text: "{}", usage: { inputTokens: 100, outputTokens: 20 } }]).complete(sent); });
  const acquire = vi.fn(async (_key: string, _limit: number) => { events.push("permit"); return true; });
  const usage: UsagePort = { reserve: vi.fn(async (input) => { reservations.push(input); return { ok: true as const, usageRecordId: "synthetic" }; }),
    settle: vi.fn(async (input) => { settlements.push(input); }), recordCacheHit: vi.fn(async () => {}) };
  const adapter: LlmAdapter = { complete, getCapabilities };
  const gateway = (configured = true) => new LlmGateway({ adapter, usage, environment: "development", limits: { requestsPerMinute: 5, dailyTokenQuota: 1000000 },
    ...(configured ? { providerCallPermits: { acquire }, providerKeyFingerprint: fingerprint } : {}) });
  return { gateway, adapter, usage, acquire, getCapabilities, complete, events, reservations, settlements, requests };
}
function size(messages: readonly { content: string }[]) { return messages.reduce((n, m) => n + m.content.length, 0); }
function maxCall(messages: readonly { content: string }[]) { return Math.ceil(size(messages) / 3) + request.maxOutputTokens; }
function evidenceFailure() { return { ok: false as const, correction: [{ criterionId: "00000000-0000-4000-8000-000000000001", reasonCode: "unknown_reference" as const }], fallback: "downgraded" }; }

describe("provider context and shared-key preflight", () => {
  it("checks metadata then obtains one permit immediately before every actual inference including retry", async () => {
    const h = harness(); let calls = 0;
    await h.gateway().run({ ...request, validate: () => ++calls === 1 ? { ok: false } : { ok: true, value: "fixed" } });
    expect(h.events).toEqual(["metadata", "permit", "inference", "metadata", "permit", "inference"]);
    expect(h.acquire).toHaveBeenNthCalledWith(1, fingerprint, 30); expect(h.acquire).toHaveBeenNthCalledWith(2, fingerprint, 30);
  });
  it("refuses the retry permit and settles only the completed first call", async () => {
    const h = harness(); h.acquire.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await h.gateway().run({ ...request, validate: () => ({ ok: false }) })).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(h.complete).toHaveBeenCalledOnce(); expect(h.settlements[0].chargedTokens).toBe(120);
  });
  it("refuses a first permit with zero charged calls", async () => {
    const h = harness(); h.acquire.mockResolvedValue(false);
    expect(await h.gateway().run(request)).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(h.complete).not.toHaveBeenCalled(); expect(h.settlements[0].chargedTokens).toBe(0);
  });
  it("fails closed when a real shared-key adapter has no limiter wiring", async () => {
    const h = harness(); expect(await h.gateway(false).run(request)).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(h.complete).not.toHaveBeenCalled();
  });
  it.each(["throw", "zero context", "invalid rate"])("fails closed for metadata %s", async (kind) => {
    const h = harness();
    if (kind === "throw") h.getCapabilities.mockRejectedValue(new Error("private metadata"));
    else h.getCapabilities.mockResolvedValue({ ...capability, ...(kind === "zero context" ? { contextTokens: 0 } : { requestsPerMinute: 0 }) });
    expect(await h.gateway().run(request)).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(h.complete).not.toHaveBeenCalled(); expect(h.acquire).not.toHaveBeenCalled();
  });
  it("accepts exact UTF-8 context equality and rejects one byte over, including multibyte input", async () => {
    const prompt = buildPrompt(request.instructions, request.segments);
    const bound = prompt.messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0) + 2000 + 1024;
    expect(bound).toBeGreaterThan(size(prompt.messages) + 2000 + 1024);
    const exact = harness({ ...capability, contextTokens: bound });
    expect((await exact.gateway().run(request)).ok).toBe(true);
    const over = harness({ ...capability, contextTokens: bound - 1 });
    expect(await over.gateway().run(request)).toEqual({ ok: false, code: "AI_UNAVAILABLE" }); expect(over.complete).not.toHaveBeenCalled();
  });
  it("permits deterministic fake capabilities without a shared-key database call", async () => {
    const h = harness({ ...capability, sharedKeyLimit: false }); expect((await h.gateway(false).run(request)).ok).toBe(true);
    expect(h.acquire).not.toHaveBeenCalled();
  });
});

describe("complete serialized budget and correction reservation", () => {
  it("includes all serialized correction headroom in the reserved second-call maximum", async () => {
    const h = harness(); let count = 0;
    await h.gateway().run({ ...request, correctionFeedbackLimit: 1024, maxSerializedCharacters: 48000,
      validate: () => ++count === 1 ? evidenceFailure() : { ok: true, value: "corrected" } });
    expect(h.requests).toHaveLength(2);
    const reserve = h.reservations[0].reservedTokens;
    const base = maxCall(h.requests[0].messages);
    // 1,024 is the complete serialized headroom, including its data-section wrapper.
    expect(reserve).toBe(base + Math.ceil((size(h.requests[0].messages) + 1024) / 3) + 2000);
    expect(size(h.requests[1].messages) - size(h.requests[0].messages)).toBeLessThanOrEqual(1024);
    expect(reserve).toBeGreaterThanOrEqual(maxCall(h.requests[0].messages) + maxCall(h.requests[1].messages));
    const retry = h.requests[1].messages.map((m) => m.content).join("");
    expect(retry).toContain("unknown_reference"); expect(retry.length).toBeLessThanOrEqual(48000);
  });
  it("accepts exactly the complete reserved headroom and refuses one character less", async () => {
    const base = size(buildPrompt(request.instructions, request.segments).messages);
    const h = harness(); let call = 0;
    expect((await h.gateway().run({ ...request, correctionFeedbackLimit: 1024, maxSerializedCharacters: base + 1024,
      validate: () => ++call === 1 ? evidenceFailure() : { ok: true, value: "fixed" } })).ok).toBe(true);
    expect(size(h.requests[1].messages)).toBeLessThanOrEqual(base + 1024);
    const tooSmall = harness();
    expect(await tooSmall.gateway().run({ ...request, correctionFeedbackLimit: 1024, maxSerializedCharacters: base + 1023 })).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(tooSmall.complete).not.toHaveBeenCalled(); expect(tooSmall.usage.reserve).not.toHaveBeenCalled();
  });
  it("larger data increases reservations and quota refusal makes no provider call", async () => {
    const short = harness(); await short.gateway().run(request);
    const longer = harness(); await longer.gateway().run({ ...request, segments: [{ name: "criteria", content: "x".repeat(3000) + "中😀" }] });
    expect(longer.reservations[0].reservedTokens - short.reservations[0].reservedTokens).toBe(2000);
    const refused = harness(); vi.mocked(refused.usage.reserve).mockResolvedValue({ ok: false, reason: "quota_exceeded", resetsAt: "2026-11-13T16:00:00.000Z" });
    expect(await refused.gateway().run(request)).toMatchObject({ ok: false, code: "QUOTA_EXCEEDED" }); expect(refused.complete).not.toHaveBeenCalled();
  });
  it("uses fallback only on the second structurally valid response and never makes a third call", async () => {
    const h = harness(); expect(await h.gateway().run({ ...request, correctionFeedbackLimit: 1024, validate: evidenceFailure })).toMatchObject({ ok: true, value: "downgraded" });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
  it("does not reuse an earlier fallback when the second response is structurally invalid", async () => {
    const h = harness(); let call = 0;
    expect(await h.gateway().run({ ...request, correctionFeedbackLimit: 1024,
      validate: () => ++call === 1 ? evidenceFailure() : { ok: false } })).toEqual({ ok: false, code: "INVALID_OUTPUT" });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
});
