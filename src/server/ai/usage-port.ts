import type { AiEnvironment, AiLimits } from "./limits";

// Usage port (LLM Gateway Decisions G8): the interface the gateway depends on for
// reserving, settling and recording cache hits. The PostgreSQL implementation lives
// outside the AI module. No prompt or response content ever crosses this port.

export type AiFeature = "acceptance_check" | "progress_report";

export type UsageReservation = {
  feature: AiFeature;
  projectId: string;
  personId: string;
  environment: AiEnvironment;
  reservedTokens: number;
  limits: AiLimits;
};

export type UsageReservationResult =
  | { ok: true; usageRecordId: string }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "quota_exceeded"; resetsAt: string };

export type UsageSettlement = {
  usageRecordId: string;
  outcome: "succeeded" | "invalid_output" | "provider_error";
  inputTokens: number | null;
  outputTokens: number | null;
  chargedTokens: number;
  latencyMs: number;
};

export type UsageCacheHit = {
  feature: AiFeature;
  projectId: string;
  personId: string;
  environment: AiEnvironment;
};

export interface UsagePort {
  // Checks the rate limit, then the quota, and inserts a pending record; refusals insert nothing.
  reserve(input: UsageReservation): Promise<UsageReservationResult>;
  settle(input: UsageSettlement): Promise<void>;
  // Records a cached result with zero tokens and no limit check (G7).
  recordCacheHit(input: UsageCacheHit): Promise<void>;
}

export interface ProviderCallPermitPort {
  acquire(fingerprint: string, limit: number): Promise<boolean>;
}
