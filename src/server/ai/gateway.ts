import type { AiEnvironment, AiLimits } from "./limits";
import type { LlmAdapter, LlmFailureCategory, LlmMessage, LlmRequest, LlmResult, LlmUsage, ProviderCapabilities } from "./llm-adapter";
import { validateOutput, type OutputCorrectionIssue, type OutputValidation, type OutputValidator } from "./output";
import { buildPrompt, type PromptSegment, type RedactionSummary } from "./prompt";
import type { AiFeature, ProviderCallPermitPort, UsagePort, UsageSettlement } from "./usage-port";

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
  maxSerializedCharacters?: number;
  correctionFeedbackLimit?: number;
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
  providerCallPermits?: ProviderCallPermitPort;
  providerKeyFingerprint?: string;
}>;

export type CacheHitInput = Readonly<{ feature: AiFeature; projectId: string; personId: string }>;

const CHARACTERS_PER_TOKEN = 3;
const MAX_CALLS = 2;
const CONTEXT_FRAMING_ALLOWANCE = 1_024;
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

function callMaximum(characters: number, maxOutputTokens: number): number {
  return Math.ceil(characters / CHARACTERS_PER_TOKEN) + maxOutputTokens;
}

function promptCharacters(messages: readonly LlmMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validCapabilities(value: unknown): value is ProviderCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isPositiveSafeInteger(record.contextTokens) && isPositiveSafeInteger(record.requestsPerMinute) &&
    typeof record.sharedKeyLimit === "boolean";
}

function correctionText(issues: readonly OutputCorrectionIssue[], limit: number): string {
  const valid = issues.filter((issue) =>
    (issue.criterionId === undefined || /^[A-Za-z0-9_-]{1,128}$/.test(issue.criterionId)) &&
    ["unknown_reference", "missing_evidence", "schema_invalid"].includes(issue.reasonCode),
  );
  const safeIssues = valid.length > 0 ? valid : [{ reasonCode: "schema_invalid" as const }];
  const textFor = (items: readonly OutputCorrectionIssue[]) => items
    .map((issue) => `${issue.criterionId ? `criterionId=${issue.criterionId} ` : ""}reasonCode=${issue.reasonCode}`)
    .join("\n");
  let text = textFor(safeIssues);
  while (text.length > limit && safeIssues.length > 1) {
    safeIssues.pop();
    text = textFor(safeIssues);
  }
  return text.length <= limit ? text : "reasonCode=schema_invalid";
}

function contextFits(messages: readonly LlmMessage[], maxOutputTokens: number, capabilities: ProviderCapabilities): boolean {
  const bytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0);
  return bytes + maxOutputTokens + CONTEXT_FRAMING_ALLOWANCE <= capabilities.contextTokens;
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
  readonly #providerCallPermits: ProviderCallPermitPort | undefined;
  readonly #providerKeyFingerprint: string | undefined;

  constructor(options: LlmGatewayOptions) {
    this.#adapter = options.adapter;
    this.#usage = options.usage;
    this.#environment = options.environment;
    this.#limits = options.limits;
    this.#now = options.now ?? Date.now;
    this.#providerCallPermits = options.providerCallPermits;
    this.#providerKeyFingerprint = options.providerKeyFingerprint;
  }

  async run<T>(request: GatewayRequest<T>): Promise<GatewayResult<T>> {
    assertValidRequest(request);
    let correction: string | undefined;
    let prompt = buildPrompt(request.instructions, request.segments);
    const feedbackLimit = request.correctionFeedbackLimit ?? 0;
    const serializedCharacterLimit = request.maxSerializedCharacters;
    if (serializedCharacterLimit !== undefined &&
        promptCharacters(prompt.messages) + feedbackLimit > serializedCharacterLimit) {
      return failure("AI_UNAVAILABLE");
    }
    const baseCharacters = promptCharacters(prompt.messages);
    const baseMaximum = callMaximum(baseCharacters, request.maxOutputTokens);
    const retryMaximum = callMaximum(baseCharacters + feedbackLimit, request.maxOutputTokens);

    const reservation = await this.#usage.reserve({
      feature: request.feature,
      projectId: request.projectId,
      personId: request.personId,
      environment: this.#environment,
      reservedTokens: baseMaximum + retryMaximum,
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
      if (correction !== undefined) {
        prompt = buildPrompt(request.instructions, [...request.segments, { name: "correction-feedback", content: correction }]);
      }
      if (serializedCharacterLimit !== undefined && promptCharacters(prompt.messages) > serializedCharacterLimit) {
        await settle("provider_error");
        return failure("AI_UNAVAILABLE");
      }
      let capabilities: ProviderCapabilities;
      try {
        capabilities = await this.#adapter.getCapabilities();
      } catch {
        await settle("provider_error");
        return failure("AI_UNAVAILABLE");
      }
      if (!validCapabilities(capabilities) || !contextFits(prompt.messages, request.maxOutputTokens, capabilities)) {
        await settle("provider_error");
        return failure("AI_UNAVAILABLE");
      }
      if (capabilities.sharedKeyLimit) {
        if (!this.#providerCallPermits || !this.#providerKeyFingerprint ||
            !/^[a-f0-9]{64}$/.test(this.#providerKeyFingerprint)) {
          await settle("provider_error");
          return failure("AI_UNAVAILABLE");
        }
        let permitted: boolean;
        try {
          permitted = await this.#providerCallPermits.acquire(this.#providerKeyFingerprint, capabilities.requestsPerMinute);
        } catch {
          await settle("provider_error");
          return failure("AI_UNAVAILABLE");
        }
        if (!permitted) {
          await settle("provider_error");
          return failure("AI_UNAVAILABLE");
        }
      }
      const llmRequest: LlmRequest = { messages: prompt.messages, maxOutputTokens: request.maxOutputTokens };
      const perCallMaximum = call === 0 ? baseMaximum : retryMaximum;
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
      if (call === MAX_CALLS - 1 && validated.fallback !== undefined) {
        await settle("succeeded");
        return { ok: true, value: validated.fallback, model: result.model, redaction: prompt.redaction };
      }
      if (call === 0 && validated.correction) {
        const emptyCorrectionPrompt = buildPrompt(request.instructions, [
          ...request.segments, { name: "correction-feedback", content: "" },
        ]);
        const envelopeCharacters = promptCharacters(emptyCorrectionPrompt.messages) - baseCharacters;
        const text = correctionText(validated.correction, Math.max(0, feedbackLimit - envelopeCharacters));
        if (text.length <= 0 || text.length > feedbackLimit) {
          await settle("provider_error");
          return failure("AI_ERROR");
        }
        correction = text;
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
