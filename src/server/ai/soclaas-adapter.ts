import type { LlmAdapter, LlmFailure, LlmFailureCategory, LlmRequest, LlmResult, LlmUsage, ProviderCapabilities } from "./llm-adapter";

// SoC LLM (SoCLaaS) adapter (decisions D2, D4, D7). One call is one POST to the
// OpenAI-compatible chat-completions endpoint with a 60-second timeout and no retry.
// Provider shapes and messages stay inside this module; failures carry only a
// category and, where one exists, the HTTP status.

export type SoclaasAdapterOptions = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  now?: () => number;
};

const CHAT_COMPLETIONS_URL = "https://soclaas-api.comp.nus.edu.sg/v1/chat/completions";
const MODELS_URL = "https://soclaas-api.comp.nus.edu.sg/v1/models";
const BUDGET_URL = "https://soclaas-portal.comp.nus.edu.sg/api-key/budget";
const TIMEOUT_MS = 60_000;
const CAPABILITY_CACHE_MS = 60_000;
const CAPABILITY_TIMEOUT_MS = 10_000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function failure(category: LlmFailureCategory, status?: number): LlmFailure {
  return status === undefined ? { ok: false, category } : { ok: false, category, status };
}

function categoryForStatus(status: number): LlmFailureCategory {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 && status <= 599 ? "unavailable" : "malformed_response";
  }
}

function firstChoiceText(body: JsonObject): string | null {
  const choices = body.choices;
  if (!Array.isArray(choices)) {
    return null;
  }
  const first: unknown = choices[0];
  if (!isObject(first) || !isObject(first.message)) {
    return null;
  }
  const content = first.message.content;
  return typeof content === "string" ? content : null;
}

function parseUsage(value: unknown): LlmUsage | null {
  if (!isObject(value) || !isTokenCount(value.prompt_tokens) || !isTokenCount(value.completion_tokens)) {
    return null;
  }
  return { inputTokens: value.prompt_tokens, outputTokens: value.completion_tokens };
}

export class SoclaasAdapter implements LlmAdapter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #cachedCapabilities: Readonly<{ value: ProviderCapabilities; expiresAt: number }> | undefined;

  constructor(options: SoclaasAdapterOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    if (this.#cachedCapabilities && this.#cachedCapabilities.expiresAt > this.#now()) {
      return this.#cachedCapabilities.value;
    }
    const signal = AbortSignal.timeout(CAPABILITY_TIMEOUT_MS);
    const headers = { Authorization: `Bearer ${this.#apiKey}` };
    let modelsResponse: Response;
    let budgetResponse: Response;
    try {
      [modelsResponse, budgetResponse] = await Promise.all([
        this.#fetch(MODELS_URL, { method: "GET", headers, signal }),
        this.#fetch(BUDGET_URL, { method: "GET", headers, signal }),
      ]);
    } catch {
      throw new Error("Provider capabilities are unavailable.");
    }
    if (!modelsResponse.ok || !budgetResponse.ok) throw new Error("Provider capabilities are unavailable.");

    let modelsBody: unknown;
    let budgetBody: unknown;
    try {
      [modelsBody, budgetBody] = await Promise.all([modelsResponse.json(), budgetResponse.json()]);
    } catch {
      throw new Error("Provider capabilities are unavailable.");
    }
    const models = isObject(modelsBody) && Array.isArray(modelsBody.data) ? modelsBody.data : null;
    const model = models?.find((item) => isObject(item) && item.id === this.#model);
    const contextTokens = isObject(model) ? model.context_length : undefined;
    const policy = isObject(budgetBody) && isObject(budgetBody.policy) ? budgetBody.policy : undefined;
    const requestsPerMinute = policy?.requests_per_minute_limit;
    if (!isTokenCount(contextTokens) || contextTokens === 0 || !isTokenCount(requestsPerMinute) || requestsPerMinute === 0) {
      throw new Error("Provider capabilities are unavailable.");
    }
    const value: ProviderCapabilities = { contextTokens, requestsPerMinute, sharedKeyLimit: true };
    this.#cachedCapabilities = { value, expiresAt: this.#now() + CAPABILITY_CACHE_MS };
    return value;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.#fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          messages: request.messages,
          max_tokens: request.maxOutputTokens,
          reasoning_effort: "none",
        }),
        signal,
      });
    } catch {
      // The error is discarded because it may echo request or provider details.
      return signal.aborted ? failure("timeout") : failure("unavailable");
    }

    if (response.status < 200 || response.status > 299) {
      // The error body is never read, so no provider message can reach the result.
      return failure(categoryForStatus(response.status), response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return signal.aborted ? failure("timeout") : failure("malformed_response", response.status);
    }

    if (!isObject(body)) {
      return failure("malformed_response", response.status);
    }
    const text = firstChoiceText(body);
    if (text === null) {
      return failure("malformed_response", response.status);
    }

    return {
      ok: true,
      text,
      model: typeof body.model === "string" && body.model.length > 0 ? body.model : this.#model,
      usage: parseUsage(body.usage),
    };
  }
}
