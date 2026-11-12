// Public entry point of the AI module. Exports the adapter interface and adapters, secret
// redaction, the prompt builder, the limits table, the usage port, and the gateway.

export type {
  LlmAdapter,
  LlmFailure,
  LlmFailureCategory,
  LlmMessage,
  LlmRequest,
  LlmResult,
  LlmSuccess,
  LlmUsage,
  ProviderCapabilities,
} from "./llm-adapter";
export { FakeAdapter, type FakeOutcome } from "./fake-adapter";
export { redactSecrets, type RedactionResult } from "./redaction";
export { SoclaasAdapter, type SoclaasAdapterOptions } from "./soclaas-adapter";
export { AI_LIMITS, type AiEnvironment, type AiLimits } from "./limits";
export { buildPrompt, sanitizePromptData, type PromptSegment, type RedactionSummary } from "./prompt";
export type { OutputCorrectionIssue, OutputValidation, OutputValidator } from "./output";
export type {
  AiFeature,
  UsageCacheHit,
  UsagePort,
  UsageReservation,
  UsageReservationResult,
  UsageSettlement,
  ProviderCallPermitPort,
} from "./usage-port";
export {
  LlmGateway,
  type CacheHitInput,
  type GatewayErrorCode,
  type GatewayFailure,
  type GatewayRequest,
  type GatewayResult,
  type GatewaySuccess,
  type LlmGatewayOptions,
} from "./gateway";
