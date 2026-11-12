import type { LlmAdapter, LlmFailure, LlmRequest, LlmResult, LlmSuccess, ProviderCapabilities } from "./llm-adapter";

// Deterministic fake adapter (decision D6). Each call returns the next scripted
// outcome; once the script is used up, or when none is given, each call returns a fixed
// success with usage estimated at 3 characters per token. Results report model "fake".

export type FakeOutcome = Omit<LlmSuccess, "model"> | LlmFailure;

const FAKE_MODEL = "fake";
const DEFAULT_TEXT = "Fake adapter response.";
const CHARACTERS_PER_TOKEN = 3;

function estimateTokens(characters: number): number {
  return Math.ceil(characters / CHARACTERS_PER_TOKEN);
}

function toResult(outcome: FakeOutcome): LlmResult {
  if (!outcome.ok) {
    return outcome.status === undefined
      ? { ok: false, category: outcome.category }
      : { ok: false, category: outcome.category, status: outcome.status };
  }
  return {
    ok: true,
    text: outcome.text,
    model: FAKE_MODEL,
    usage: outcome.usage === null ? null : { ...outcome.usage },
  };
}

function defaultResult(request: LlmRequest): LlmSuccess {
  const inputCharacters = request.messages.reduce((total, message) => total + message.content.length, 0);
  return {
    ok: true,
    text: DEFAULT_TEXT,
    model: FAKE_MODEL,
    usage: {
      inputTokens: estimateTokens(inputCharacters),
      outputTokens: estimateTokens(DEFAULT_TEXT.length),
    },
  };
}

export class FakeAdapter implements LlmAdapter {
  readonly #script: readonly FakeOutcome[];
  #nextIndex = 0;

  constructor(script: readonly FakeOutcome[] = []) {
    this.#script = [...script];
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return { contextTokens: 262_144, requestsPerMinute: 30, sharedKeyLimit: false };
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const outcome = this.#script[this.#nextIndex];
    if (outcome === undefined) {
      return defaultResult(request);
    }
    this.#nextIndex += 1;
    return toResult(outcome);
  }
}
