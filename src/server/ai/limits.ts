// Per-person AI limits by environment (Environment Decisions E4, LLM Gateway Decisions G9).
// The table is a code constant selected by APP_ENV in the composition root.

export type AiEnvironment = "development" | "production";

export type AiLimits = Readonly<{
  requestsPerMinute: number;
  dailyTokenQuota: number;
}>;

export const AI_LIMITS: Readonly<Record<AiEnvironment, AiLimits>> = Object.freeze({
  development: Object.freeze({ requestsPerMinute: 5, dailyTokenQuota: 1_000_000 }),
  production: Object.freeze({ requestsPerMinute: 5, dailyTokenQuota: 400_000 }),
});
