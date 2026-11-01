import { describe, expect, it } from "vitest";

import { FakeAdapter, type LlmAdapter } from "../../../src/server/ai";

// Task 6.1 (llm-gateway-soc-adapter). Requirement referenced by name:
// "The LLM provider is behind a replaceable adapter" (scenario "Fake adapter is
// deterministic") in openspec/changes/project-task-management/specs/ai-safeguards/spec.md,
// and decision D6 in openspec/changes/project-task-management/design.md.
// Acceptance criteria AC9 and AC10 are recorded in workflow/handoffs/llm-gateway-soc-adapter.md.
// No requirement IDs exist for these, so none are used.
//
// Script entry shape used here (test-writer assumption, see report): each entry is a
// result without a model, `{ ok: true, text, usage }` with usage `{ inputTokens,
// outputTokens }` or `null`, or `{ ok: false, category }`.

type LlmRequest = Parameters<LlmAdapter["complete"]>[0];
type FakeScript = NonNullable<ConstructorParameters<typeof FakeAdapter>[0]>;

const requestA: LlmRequest = {
  messages: [
    { role: "system", content: "System instructions for the synthetic check." },
    { role: "user", content: "Synthetic task text: add a login button." },
  ],
  maxOutputTokens: 2000,
};

const requestB: LlmRequest = {
  messages: [{ role: "user", content: "A much longer synthetic request. ".repeat(20) }],
  maxOutputTokens: 500,
};

function inputCharacters(request: LlmRequest): number {
  return request.messages.reduce((total, message) => total + message.content.length, 0);
}

function expectNonNegativeInteger(value: unknown): void {
  expect(typeof value).toBe("number");
  expect(Number.isInteger(value)).toBe(true);
  expect(value as number).toBeGreaterThanOrEqual(0);
}

// The rounding direction of the 3-characters-per-token estimate is not recorded
// (handoff Q2), so only "approximately characters / 3, within 1" is asserted.
function expectApproximatelyThirds(tokens: number, characters: number): void {
  expect(Math.abs(tokens - characters / 3)).toBeLessThanOrEqual(1);
}

const script: FakeScript = [
  { ok: true, text: '{"verdict":"met"}', usage: { inputTokens: 101, outputTokens: 7 } },
  { ok: true, text: '{"verdict":"met"}', usage: null },
  { ok: true, text: "this is not valid JSON {", usage: { inputTokens: 5, outputTokens: 3 } },
  { ok: false, category: "rate_limited" },
  { ok: false, category: "unavailable" },
];

describe("FakeAdapter scripted outcomes (AC9)", () => {
  it("returns a scripted success with the given text and usage, reporting model fake", async () => {
    const fake = new FakeAdapter([script[0]]);
    const result = await fake.complete(requestA);
    expect(result).toEqual({
      ok: true,
      text: '{"verdict":"met"}',
      model: "fake",
      usage: { inputTokens: 101, outputTokens: 7 },
    });
  });

  it("returns a scripted success with no usage", async () => {
    const fake = new FakeAdapter([script[1]]);
    const result = await fake.complete(requestA);
    expect(result).toEqual({ ok: true, text: '{"verdict":"met"}', model: "fake", usage: null });
  });

  it("returns schema-invalid output as a scripted success with the invalid text verbatim", async () => {
    const fake = new FakeAdapter([script[2]]);
    const result = await fake.complete(requestA);
    expect(result).toMatchObject({ ok: true, text: "this is not valid JSON {", model: "fake" });
  });

  it.each(["invalid_request", "unauthorized", "forbidden", "rate_limited", "unavailable", "timeout", "malformed_response"])(
    "returns a scripted %s failure without rejecting",
    async (category) => {
      const fake = new FakeAdapter([{ ok: false, category } as FakeScript[number]]);
      const result = await fake.complete(requestA);
      expect(result).toMatchObject({ ok: false, category });
    },
  );

  it("returns the scripted outcomes in order, one per call", async () => {
    const fake = new FakeAdapter(script);
    const results = [];
    for (let index = 0; index < script.length; index += 1) {
      results.push(await fake.complete(requestA));
    }

    expect(results[0]).toMatchObject({ ok: true, text: '{"verdict":"met"}', usage: { inputTokens: 101, outputTokens: 7 } });
    expect(results[1]).toMatchObject({ ok: true, text: '{"verdict":"met"}', usage: null });
    expect(results[2]).toMatchObject({ ok: true, text: "this is not valid JSON {" });
    expect(results[3]).toMatchObject({ ok: false, category: "rate_limited" });
    expect(results[4]).toMatchObject({ ok: false, category: "unavailable" });
  });

  it("keeps the script cursor per instance", async () => {
    const first = new FakeAdapter(script);
    const second = new FakeAdapter(script);

    await first.complete(requestA);
    await first.complete(requestA);

    expect(await second.complete(requestA)).toMatchObject({ ok: true, usage: { inputTokens: 101, outputTokens: 7 } });
    expect(await first.complete(requestA)).toMatchObject({ ok: true, text: "this is not valid JSON {" });
  });

  it("reports model fake on every success, scripted or default", async () => {
    const fake = new FakeAdapter([script[0], script[1], script[2]]);
    for (let index = 0; index < 5; index += 1) {
      const result = await fake.complete(requestA);
      expect(result).toMatchObject({ ok: true, model: "fake" });
    }
  });
});

describe("FakeAdapter default success (AC10)", () => {
  it("returns a fixed success with constant text when no script is given", async () => {
    const fake = new FakeAdapter();
    const first = await fake.complete(requestA);
    const second = await fake.complete(requestB);

    expect(first).toMatchObject({ ok: true, model: "fake" });
    expect(second).toMatchObject({ ok: true, model: "fake" });
    if (!first.ok || !second.ok) {
      throw new Error("expected default successes");
    }
    expect(typeof first.text).toBe("string");
    expect(first.text.length).toBeGreaterThan(0);
    expect(second.text).toBe(first.text);
  });

  it("estimates default usage at about 3 characters per token from the request and the text", async () => {
    for (const request of [requestA, requestB]) {
      const result = await new FakeAdapter().complete(request);
      if (!result.ok) {
        throw new Error("expected a default success");
      }
      expect(result.usage).not.toBeNull();
      const usage = result.usage as { inputTokens: number; outputTokens: number };
      expectNonNegativeInteger(usage.inputTokens);
      expectNonNegativeInteger(usage.outputTokens);
      expectApproximatelyThirds(usage.inputTokens, inputCharacters(request));
      expectApproximatelyThirds(usage.outputTokens, result.text.length);
    }
  });

  it("estimates more input tokens for a longer request", async () => {
    const fake = new FakeAdapter();
    const short = await fake.complete(requestA);
    const long = await fake.complete(requestB);
    if (!short.ok || !long.ok || !short.usage || !long.usage) {
      throw new Error("expected default successes with usage");
    }
    expect(long.usage.inputTokens).toBeGreaterThan(short.usage.inputTokens);
  });

  it("returns the identical default result for the same request on repeated calls", async () => {
    const fake = new FakeAdapter();
    const first = await fake.complete(requestA);
    const second = await fake.complete(requestA);
    expect(second).toEqual(first);
  });

  it("falls back to the default success once the script is used up", async () => {
    const fake = new FakeAdapter([{ ok: false, category: "rate_limited" }]);
    expect(await fake.complete(requestA)).toMatchObject({ ok: false, category: "rate_limited" });

    const unscripted = await new FakeAdapter().complete(requestA);
    expect(await fake.complete(requestA)).toEqual(unscripted);
    expect(await fake.complete(requestA)).toEqual(unscripted);
  });

  it("treats an empty script like no script", async () => {
    const unscripted = await new FakeAdapter().complete(requestA);
    expect(await new FakeAdapter([]).complete(requestA)).toEqual(unscripted);
  });
});

describe("FakeAdapter determinism (AC10, scenario 'Fake adapter is deterministic')", () => {
  it("gives equal results call by call for two fresh fakes with the same script", async () => {
    const left = new FakeAdapter(script);
    const right = new FakeAdapter(script);
    const requests = [requestA, requestB, requestA, requestB, requestA, requestB, requestA];

    for (const request of requests) {
      expect(await right.complete(request)).toEqual(await left.complete(request));
    }
  });

  it("gives equal results call by call for two fresh unscripted fakes", async () => {
    const left = new FakeAdapter();
    const right = new FakeAdapter();
    for (const request of [requestA, requestB, requestA]) {
      expect(await right.complete(request)).toEqual(await left.complete(request));
    }
  });
});
