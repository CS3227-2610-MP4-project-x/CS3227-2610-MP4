import { describe, expect, it } from "vitest";

import { AI_LIMITS } from "../../../src/server/ai";

// Task 6.3 (llm-gateway-core), AC21 in workflow/handoffs/llm-gateway-core.md.
// Spec "AI usage is limited per person", scenario "Limits per environment";
// design.md "Environment Decisions" E4 and "SoC LLM and Quota Decisions".

describe("AI_LIMITS (AC21, E4)", () => {
  it("allows 5 requests per minute and 1,000,000 tokens per day in development", () => {
    expect(AI_LIMITS.development).toEqual({ requestsPerMinute: 5, dailyTokenQuota: 1_000_000 });
  });

  it("allows 5 requests per minute and 400,000 tokens per day in production", () => {
    expect(AI_LIMITS.production).toEqual({ requestsPerMinute: 5, dailyTokenQuota: 400_000 });
  });

  it("holds exactly the two environments", () => {
    expect(Object.keys(AI_LIMITS).sort()).toEqual(["development", "production"]);
  });

  it("is frozen, including each environment's limits", () => {
    expect(Object.isFrozen(AI_LIMITS)).toBe(true);
    expect(Object.isFrozen(AI_LIMITS.development)).toBe(true);
    expect(Object.isFrozen(AI_LIMITS.production)).toBe(true);
  });
});
