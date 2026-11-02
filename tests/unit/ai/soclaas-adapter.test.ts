import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeAdapter, SoclaasAdapter, type LlmAdapter } from "../../../src/server/ai";

// Task 6.1 (llm-gateway-soc-adapter). Requirement referenced by name:
// "The LLM provider is behind a replaceable adapter" in
// openspec/changes/project-task-management/specs/ai-safeguards/spec.md, and
// "LLM Adapter Decisions" D2-D7 in openspec/changes/project-task-management/design.md.
// Acceptance criteria AC1-AC8 are recorded in workflow/handoffs/llm-gateway-soc-adapter.md.
// No requirement IDs exist for these, so none are used.
//
// Every test injects a stub `fetch` through the constructor. No real network call is made.
// The key and provider message below are obvious synthetic placeholders.

type LlmRequest = Parameters<LlmAdapter["complete"]>[0];
type LlmResult = Awaited<ReturnType<LlmAdapter["complete"]>>;

const ENDPOINT = "https://soclaas-api.comp.nus.edu.sg/v1/chat/completions";
const TEST_KEY = "test-key";
const CONFIGURED_MODEL = "qwen3.6:35b";
const TIMEOUT_MS = 60_000;
// A distinctive synthetic provider error message, so its absence can be asserted.
const PROVIDER_MESSAGE = "SYNTHETIC PROVIDER MESSAGE do-not-leak";

const request: LlmRequest = {
  messages: [
    { role: "system", content: "You are a careful reviewer. Reply in JSON." },
    { role: "user", content: "Task text with <b>html</b> & \"quotes\" and unicode: é中" },
    { role: "user", content: "Second user message, kept in order." },
  ],
  maxOutputTokens: 2000,
};

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "chatcmpl-synthetic",
    object: "chat.completion",
    model: CONFIGURED_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Synthetic model reply." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    ...overrides,
  };
}

function stubFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => respond());
}

async function captureRequest(fetchStub: ReturnType<typeof vi.fn<typeof fetch>>): Promise<CapturedRequest> {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const [input, init] = fetchStub.mock.calls[0];
  if (input instanceof Request) {
    return {
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: JSON.parse(await input.clone().text()) as Record<string, unknown>,
      signal: input.signal,
    };
  }
  return {
    url: String(input),
    method: (init?.method ?? "GET").toUpperCase(),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    signal: init?.signal,
  };
}

function makeAdapter(fetchStub: typeof fetch): SoclaasAdapter {
  return new SoclaasAdapter({ apiKey: TEST_KEY, model: CONFIGURED_MODEL, fetch: fetchStub });
}

// AC6: a failure holds only a category and an optional status, and leaks nothing.
function expectSafeFailure(result: LlmResult, category: string, status: number | undefined): void {
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ ok: false, category });
  if (status === undefined) {
    expect((result as { status?: unknown }).status).toBeUndefined();
  } else {
    expect((result as { status?: unknown }).status).toBe(status);
  }
  for (const key of Object.keys(result)) {
    expect(["ok", "category", "status"]).toContain(key);
  }
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(PROVIDER_MESSAGE);
  expect(serialized).not.toContain("do-not-leak");
  expect(serialized).not.toContain(TEST_KEY);
  expect(serialized).not.toContain("Bearer");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("public entry point (AC1, AC13)", () => {
  it("exports only the two adapter classes and redactSecrets at runtime", async () => {
    const entry = await import("../../../src/server/ai");
    expect(Object.keys(entry).sort()).toEqual(["FakeAdapter", "SoclaasAdapter", "redactSecrets"]);
  });

  it("lets both adapters be used through the one application interface", async () => {
    // Type-level check (AC1): `npx tsc --noEmit` fails if either adapter does not
    // implement LlmAdapter.
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    const adapters: LlmAdapter[] = [makeAdapter(fetchStub), new FakeAdapter()];

    for (const adapter of adapters) {
      expect(typeof adapter.complete).toBe("function");
      const result = await adapter.complete(request);
      expect(result.ok).toBe(true);
    }
  });

  it("constructs ready to use without a fetch argument and makes no call on construction", () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    const adapter = new SoclaasAdapter({ apiKey: TEST_KEY, model: CONFIGURED_MODEL });
    expect(typeof adapter.complete).toBe("function");
    makeAdapter(fetchStub);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("SoC request shape (AC2, scenario 'Pinned model is used')", () => {
  it("sends one POST to the chat-completions endpoint with a bearer key", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    await makeAdapter(fetchStub).complete(request);

    const captured = await captureRequest(fetchStub);
    expect(captured.url).toBe(ENDPOINT);
    expect(captured.method).toBe("POST");
    expect(captured.headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
  });

  it("sends the configured model, the messages unchanged and in order, max_tokens, and reasoning_effort none", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    await makeAdapter(fetchStub).complete(request);

    const { body } = await captureRequest(fetchStub);
    expect(body.model).toBe(CONFIGURED_MODEL);
    expect(body.model).not.toBe("default");
    expect(body.messages).toEqual(request.messages);
    expect(body.max_tokens).toBe(request.maxOutputTokens);
    expect(body.reasoning_effort).toBe("none");
  });

  it("does not stream and does not request a response format", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    await makeAdapter(fetchStub).complete(request);

    const { body } = await captureRequest(fetchStub);
    expect(body.stream === undefined || body.stream === false).toBe(true);
    expect(body).not.toHaveProperty("response_format");
  });

  it("passes the request's own maximum output tokens", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    await makeAdapter(fetchStub).complete({ ...request, maxOutputTokens: 17 });

    const { body } = await captureRequest(fetchStub);
    expect(body.max_tokens).toBe(17);
  });

  it("sends a different configured model unchanged", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody({ model: "qwen3.5:9b" })));
    await new SoclaasAdapter({ apiKey: TEST_KEY, model: "qwen3.5:9b", fetch: fetchStub }).complete(request);

    const { body } = await captureRequest(fetchStub);
    expect(body.model).toBe("qwen3.5:9b");
  });

  it("passes an abort signal to fetch", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    await makeAdapter(fetchStub).complete(request);

    const { signal } = await captureRequest(fetchStub);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("success results (AC3, AC4)", () => {
  it("returns the first choice's text, the model name, and provider usage", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse(
        successBody({
          choices: [
            { index: 0, message: { role: "assistant", content: "First choice." }, finish_reason: "stop" },
            { index: 1, message: { role: "assistant", content: "Second choice." }, finish_reason: "stop" },
          ],
        }),
      ),
    );
    const result = await makeAdapter(fetchStub).complete(request);

    expect(result).toEqual({
      ok: true,
      text: "First choice.",
      model: CONFIGURED_MODEL,
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  it("returns the provider's model name when it equals the configured model", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody({ model: CONFIGURED_MODEL })));
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, model: CONFIGURED_MODEL });
  });

  // Decision D2 and scenario "Pinned model is used": the result's model is the provider
  // response's model name when present, otherwise the configured model. The request
  // always sends the configured model.
  it("returns the provider's model name when it differs from the configured model", async () => {
    const providerModel = "qwen3.6:35b-2026-10";
    const fetchStub = stubFetch(() => jsonResponse(successBody({ model: providerModel })));
    const result = await makeAdapter(fetchStub).complete(request);

    expect(result).toMatchObject({ ok: true, model: providerModel });
    expect((result as { model?: unknown }).model).not.toBe(CONFIGURED_MODEL);
    const { body } = await captureRequest(fetchStub);
    expect(body.model).toBe(CONFIGURED_MODEL);
  });

  it("returns the configured model name when the response has no model", async () => {
    const body = successBody();
    delete body.model;
    const fetchStub = stubFetch(() => jsonResponse(body));
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, model: CONFIGURED_MODEL });
    const captured = await captureRequest(fetchStub);
    expect(captured.body.model).toBe(CONFIGURED_MODEL);
  });

  const unusableModels: Array<[string, unknown]> = [
    ["an empty string", ""],
    ["a number", 42],
    ["null", null],
    ["a boolean", true],
    ["an object", { name: "qwen3.6:35b-2026-10" }],
    ["an array", ["qwen3.6:35b-2026-10"]],
  ];

  it.each(unusableModels)("returns the configured model name when the response model is %s", async (_label, model) => {
    const fetchStub = stubFetch(() => jsonResponse(successBody({ model })));
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, text: "Synthetic model reply.", model: CONFIGURED_MODEL });
    const { body } = await captureRequest(fetchStub);
    expect(body.model).toBe(CONFIGURED_MODEL);
  });

  it("accepts zero token counts as valid usage", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse(successBody({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })),
    );
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it("returns null usage when the provider omits usage", async () => {
    const body = successBody();
    delete body.usage;
    const fetchStub = stubFetch(() => jsonResponse(body));
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, text: "Synthetic model reply.", usage: null });
  });

  const invalidUsages: Array<[string, unknown]> = [
    ["null usage", null],
    ["negative input tokens", { prompt_tokens: -1, completion_tokens: 34 }],
    ["negative output tokens", { prompt_tokens: 12, completion_tokens: -5 }],
    ["fractional input tokens", { prompt_tokens: 12.5, completion_tokens: 34 }],
    ["fractional output tokens", { prompt_tokens: 12, completion_tokens: 0.1 }],
    ["string input tokens", { prompt_tokens: "12", completion_tokens: 34 }],
    ["string output tokens", { prompt_tokens: 12, completion_tokens: "34" }],
    ["missing input tokens", { completion_tokens: 34 }],
    ["missing output tokens", { prompt_tokens: 12 }],
    ["null input tokens", { prompt_tokens: null, completion_tokens: 34 }],
    ["usage is not an object", "lots"],
  ];

  it.each(invalidUsages)("returns null usage for %s", async (_label, usage) => {
    const fetchStub = stubFetch(() => jsonResponse(successBody({ usage })));
    const result = await makeAdapter(fetchStub).complete(request);
    expect(result).toMatchObject({ ok: true, text: "Synthetic model reply.", usage: null });
  });
});

describe("provider failures are categorized safely (AC5, AC6, AC7, scenario 'Provider error is mapped safely')", () => {
  const statusCases: Array<[number, string]> = [
    [400, "invalid_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
    [599, "unavailable"],
    [404, "malformed_response"],
    [409, "malformed_response"],
    [422, "malformed_response"],
    [301, "malformed_response"],
  ];

  it.each(statusCases)("maps HTTP %i to %s with the status and no provider message", async (status, category) => {
    const fetchStub = stubFetch(() => jsonResponse({ error: PROVIDER_MESSAGE }, status));
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, category, status);
  });

  it("maps an error status with a non-JSON body without leaking the body", async () => {
    const fetchStub = stubFetch(
      () => new Response(`<html>${PROVIDER_MESSAGE}</html>`, { status: 502, headers: { "Content-Type": "text/html" } }),
    );
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, "unavailable", 502);
  });

  it("maps a network failure to unavailable with no status, resolving instead of rejecting", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed: ${PROVIDER_MESSAGE} ${TEST_KEY}`);
    });
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, "unavailable", undefined);
  });

  it("maps a 2xx response whose body is not JSON to malformed_response", async () => {
    const fetchStub = stubFetch(
      () => new Response(`not json ${PROVIDER_MESSAGE}`, { status: 200, headers: { "Content-Type": "text/plain" } }),
    );
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, "malformed_response", 200);
  });

  const noTextBodies: Array<[string, Record<string, unknown>]> = [
    ["no choices field", { model: CONFIGURED_MODEL, error: PROVIDER_MESSAGE }],
    ["an empty choices array", successBody({ choices: [] })],
    ["a choice without a message", successBody({ choices: [{ index: 0, finish_reason: "stop" }] })],
    [
      "null content",
      successBody({ choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "stop" }] }),
    ],
    [
      "missing content",
      successBody({ choices: [{ index: 0, message: { role: "assistant" }, finish_reason: "stop" }] }),
    ],
    [
      "non-string content",
      successBody({ choices: [{ index: 0, message: { role: "assistant", content: 42 }, finish_reason: "stop" }] }),
    ],
  ];

  it.each(noTextBodies)("maps a 2xx response with %s to malformed_response", async (_label, body) => {
    const fetchStub = stubFetch(() => jsonResponse(body, 200));
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, "malformed_response", 200);
  });

  it("maps a 2xx JSON body that is not an object to malformed_response", async () => {
    const fetchStub = stubFetch(() => jsonResponse([PROVIDER_MESSAGE], 200));
    const result = await makeAdapter(fetchStub).complete(request);
    expectSafeFailure(result, "malformed_response", 200);
  });
});

describe("one attempt with a 60-second timeout (AC7, AC8)", () => {
  // Builds a fetch stub that never responds and rejects with the signal's reason when
  // the signal aborts, as the built-in fetch does.
  function hangingFetch() {
    return vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener("abort", abort, { once: true });
        }),
    );
  }

  function useControllableTimers(): void {
    vi.useFakeTimers();
    // AbortSignal.timeout uses Node's internal timers, which fake timers do not control.
    // Route it through the faked setTimeout so either implementation style is deterministic.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
      return controller.signal;
    });
  }

  it("returns timeout with no status after 60 seconds, and not before", async () => {
    useControllableTimers();
    const fetchStub = hangingFetch();

    let settled = false;
    const pending = makeAdapter(fetchStub)
      .complete(request)
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(settled).toBe(true);
    expectSafeFailure(result, "timeout", undefined);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a timeout", async () => {
    useControllableTimers();
    const fetchStub = hangingFetch();

    const pending = makeAdapter(fetchStub).complete(request);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await pending;
    // Give any retry the chance to start.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 3);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])("makes exactly one fetch call for HTTP %i", async (status) => {
    useControllableTimers();
    const fetchStub = stubFetch(() => jsonResponse({ error: PROVIDER_MESSAGE }, status));

    const result = await makeAdapter(fetchStub).complete(request);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 3);
    expect(result.ok).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one fetch call for a network failure", async () => {
    useControllableTimers();
    const fetchStub = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await makeAdapter(fetchStub).complete(request);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 3);
    expect(result.ok).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one fetch call per complete on success", async () => {
    const fetchStub = stubFetch(() => jsonResponse(successBody()));
    const adapter = makeAdapter(fetchStub);
    await adapter.complete(request);
    await adapter.complete(request);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("does not time out a call that responds just before 60 seconds", async () => {
    useControllableTimers();
    const fetchStub = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse(successBody())), TIMEOUT_MS - 1);
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(init.signal?.reason);
            },
            { once: true },
          );
        }),
    );

    const pending = makeAdapter(fetchStub).complete(request);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, text: "Synthetic model reply." });
  });
});
