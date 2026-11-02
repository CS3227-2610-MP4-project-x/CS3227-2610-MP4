// Public entry point of the AI adapter module. Exports only the application interface,
// its types, and the two adapters.

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
export { SoclaasAdapter, type SoclaasAdapterOptions } from "./soclaas-adapter";
