// Public entry point of the AI adapter module. Exports only the application interface,
// its types, the two adapters, and secret redaction with its result type.

export type {
  LlmAdapter,
  LlmFailure,
  LlmFailureCategory,
  LlmMessage,
  LlmRequest,
  LlmResult,
  LlmSuccess,
  LlmUsage,
} from "./llm-adapter";
export { FakeAdapter, type FakeOutcome } from "./fake-adapter";
export { redactSecrets, type RedactionResult } from "./redaction";
export { SoclaasAdapter, type SoclaasAdapterOptions } from "./soclaas-adapter";
