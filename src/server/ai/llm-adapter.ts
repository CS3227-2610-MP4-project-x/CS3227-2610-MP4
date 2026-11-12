// Application-defined LLM adapter contract (decision D2 in
// openspec/changes/project-task-management/design.md). Callers depend only on these
// types; provider request and response shapes stay inside each adapter.

export type LlmMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmRequest = {
  messages: readonly LlmMessage[];
  maxOutputTokens: number;
};

export type ProviderCapabilities = Readonly<{
  contextTokens: number;
  requestsPerMinute: number;
  sharedKeyLimit: boolean;
}>;

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmSuccess = {
  ok: true;
  text: string;
  model: string;
  usage: LlmUsage | null;
};

export type LlmFailureCategory =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "malformed_response";

// A failure holds only a category and, where one exists, the HTTP status. It never
// holds a provider message, a response body, or a credential.
export type LlmFailure = {
  ok: false;
  category: LlmFailureCategory;
  status?: number;
};

export type LlmResult = LlmSuccess | LlmFailure;

export interface LlmAdapter {
  // Provider limits are fetched from official metadata endpoints. Implementations may
  // cache valid metadata for at most 60 seconds per instance.
  getCapabilities(): Promise<ProviderCapabilities>;
  // Resolves to a success or a failure; does not reject for provider failures.
  complete(request: LlmRequest): Promise<LlmResult>;
}
