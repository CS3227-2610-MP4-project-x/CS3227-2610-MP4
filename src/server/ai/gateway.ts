import type { AiEnvironment, AiLimits } from "./limits";
import type { LlmAdapter, LlmFailureCategory, LlmMessage, LlmRequest, LlmResult, LlmUsage } from "./llm-adapter";
import { validateOutput, type OutputValidation, type OutputValidator } from "./output";
import { buildPrompt, type PromptSegment, type RedactionSummary } from "./prompt";
import type { AiFeature, UsagePort, UsageSettlement } from "./usage-port";

// LLM gateway (LLM Gateway Decisions G1-G9, Task 6.3 handoff decisions Q1-Q4). Builds the
// prompt, reserves usage, calls the adapter at most twice (one retry on invalid output),
// and settles usage. Expected failures are returned as a safe code and never thrown;
// usage port errors propagate. No prompt or response content is logged or recorded.

export type GatewayRequest<T> = Readonly<{
  feature: AiFeature;
  projectId: string;
  personId: string;
  instructions: string;
  segments: readonly PromptSegment[];
  maxOutputTokens: number;
  validate: OutputValidator<T>;
}>;

export type GatewayErrorCode = "RATE_LIMITED" | "QUOTA_EXCEEDED" | "AI_UNAVAILABLE" | "AI_ERROR" | "INVALID_OUTPUT";

export type GatewaySuccess<T> = { ok: true; value: T; model: string; redaction: RedactionSummary };

export type GatewayFailure = { ok: false; code: GatewayErrorCode; resetsAt?: string };

export type GatewayResult<T> = GatewaySuccess<T> | GatewayFailure;

export type LlmGatewayOptions = Readonly<{
  adapter: LlmAdapter;
  usage: UsagePort;
  environment: AiEnvironment;
  limits: AiLimits;
  now?: () => number;
}>;

export type CacheHitInput = Readonly<{ feature: AiFeature; projectId: string; personId: string }>;

const CHARACTERS_PER_TOKEN = 3;
const MAX_CALLS = 2;
// Segment names are code constants (G1, review decision S3).
const SEGMENT_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

// Programming errors (review decisions S3, S4): thrown before reserving. Messages never
// include segment content.
function assertValidRequest(request: GatewayRequest<unknown>): void {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw new Error("LlmGateway: maxOutputTokens must be a positive integer.");
  }
  if (!request.segments.every((segment) => SEGMENT_NAME.test(segment.name))) {
    throw new Error("LlmGateway: every segment name must match ^[a-z][a-z0-9_-]{0,63}$.");
  }
}

// One call's latency, rounded and never negative (S4).
function elapsedMs(started: number, ended: number): number {
  return Math.max(0, Math.round(ended - started));
}

function callMaximum(messages: readonly LlmMessage[], maxOutputTokens: number): number {
  const characters = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.ceil(characters / CHARACTERS_PER_TOKEN) + maxOutputTokens;
}

function providerFailureCode(category: LlmFailureCategory): GatewayErrorCode {
  switch (category) {
    case "rate_limited":
    case "unavailable":
    case "timeout":
      return "AI_UNAVAILABLE";
    default:
      return "AI_ERROR";
  }
}

function failure(code: GatewayErrorCode): GatewayFailure {
  return { ok: false, code };
}

// Token and latency totals over the calls one request makes (G2, G4, A3, A5).
type CallTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  chargedTokens: number;
  latencyMs: number;
};

// `usage` is the call's reported usage, or null when it reported none or did not respond (G2).
function addCall(totals: CallTotals, usage: LlmUsage | null, perCallMaximum: number, latencyMs: number): CallTotals {
  if (usage === null) {
    return { ...totals, chargedTokens: totals.chargedTokens + perCallMaximum, latencyMs: totals.latencyMs + latencyMs };
  }
  return {
    inputTokens: (totals.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (totals.outputTokens ?? 0) + usage.outputTokens,
    chargedTokens: totals.chargedTokens + usage.inputTokens + usage.outputTokens,
    latencyMs: totals.latencyMs + latencyMs,
  };
}

export class LlmGateway {
  readonly #adapter: LlmAdapter;
  readonly #usage: UsagePort;
  readonly #environment: AiEnvironment;
  readonly #limits: AiLimits;
  readonly #now: () => number;

  constructor(options: LlmGatewayOptions) {
    this.#adapter = options.adapter;
    this.#usage = options.usage;
    this.#environment = options.environment;
    this.#limits = options.limits;
    this.#now = options.now ?? Date.now;
  }

  async run<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
    assertValidRequest(request);
    const prompt = buildPrompt(request.instructions, request.segments);
    const llmRequest: LlmRequest = { messages: prompt.messages, maxOutputTokens: request.maxOutputTokens };
    const perCallMaximum = callMaximum(prompt.messages, request.maxOutputTokens);

    const reservation = await this.#usage.reserve({
      feature: request.feature,
      projectId: request.projectId,
      personId: request.personId,
      environment: this.#environment,
      reservedTokens: MAX_CALLS * perCallMaximum,
      limits: this.#limits,
    });
    if (!reservation.ok) {
      return reservation.reason === "rate_limited"
        ? failure("RATE_LIMITED")
        : { ok: false, code: "QUOTA_EXCEEDED", resetsAt: reservation.resetsAt };
    }

    let totals: CallTotals = { inputTokens: null, outputTokens: null, chargedTokens: 0, latencyMs: 0 };
    const settle = (outcome: UsageSettlement["outcome"]): Promise<void> =>
      this.#usage.settle({ usageRecordId: reservation.usageRecordId, outcome, ...totals });

    for (let call = 0; call < MAX_CALLS; call += 1) {
      const started = this.#now();
      let result: LlmResult;
      try {
        result = await this.#adapter.complete(llmRequest);
      } catch {
        // S1: a throwing adapter is charged the call's maximum and reported as AI_ERROR.
        totals = addCall(totals, null, perCallMaximum, elapsedMs(started, this.#now()));
        await settle("provider_error");
        return failure("AI_ERROR");
      }
      totals = addCall(totals, result.ok ? result.usage : null, perCallMaximum, elapsedMs(started, this.#now()));

      if (!result.ok) {
        await settle("provider_error");
        return failure(providerFailureCode(result.category));
      }
      let validated: OutputValidation<T>;
      try {
        validated = validateOutput(result.text, request.validate);
      } catch {
        // S1: a throwing validator ends the request without a retry.
        await settle("provider_error");
        return failure("AI_ERROR");
      }
      if (validated.ok) {
        await settle("succeeded");
        return { ok: true, value: validated.value, model: result.model, redaction: prompt.redaction };
      }
    }

    await settle("invalid_output");
    return failure("INVALID_OUTPUT");
  }

  async recordCacheHit(input: CacheHitInput): Promise<void> {
    await this.#usage.recordCacheHit({
      feature: input.feature,
      projectId: input.projectId,
      personId: input.personId,
      environment: this.#environment,
    });
  }
}
