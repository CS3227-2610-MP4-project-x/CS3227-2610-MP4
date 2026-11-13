import "server-only";

import { readSyntheticSessionClaims } from "./synthetic-session";
import type { LlmAdapter, LlmRequest, LlmResult, ProviderCapabilities } from "@/server/ai";

function section(request: LlmRequest, name: string): string | null {
  const text = request.messages.map(({ content }) => content).join("\n");
  const match = new RegExp(`<data name="${name}">\\s*([\\s\\S]*?)\\s*</data>`).exec(text);
  return match?.[1]?.replaceAll("&lt;", "<") ?? null;
}

function jsonSection(request: LlmRequest, name: string): unknown {
  const text = section(request, name);
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function usage(request: LlmRequest, text: string) {
  const chars = request.messages.reduce((sum, item) => sum + item.content.length, 0);
  return { inputTokens: Math.ceil(chars / 3), outputTokens: Math.ceil(text.length / 3) };
}

export class E2ELlmAdapter implements LlmAdapter {
  async getCapabilities(): Promise<ProviderCapabilities> {
    return { contextTokens: 262_144, requestsPerMinute: 30, sharedKeyLimit: false };
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const claims = await readSyntheticSessionClaims();
    if (!claims) return { ok: false, category: "unauthorized" };
    const instructions = request.messages[0]?.content ?? "";
    const feature = instructions.includes("Assess the supplied commit diff") ? "acceptance-check" :
      instructions.includes("progress report from the supplied project activity") ? "progress-report" : null;
    if (!feature) return { ok: false, category: "invalid_request" };
    if (claims.outcomes[feature] !== "success") return { ok: false, category: "unavailable" };

    let text: string;
    if (feature === "acceptance-check") {
      const raw = jsonSection(request, "criteria");
      const criteria = Array.isArray(raw) ? raw.filter((item): item is { id: string } =>
        typeof item === "object" && item !== null && "id" in item && typeof item.id === "string") : [];
      text = JSON.stringify({ criteria: criteria.map(({ id }) => ({ criterionId: id, status: "unclear", evidenceRefs: [] })), possibleGaps: [] });
    } else {
      const input = jsonSection(request, "report-input");
      const groups = typeof input === "object" && input !== null && "currentTaskContext" in input &&
        typeof input.currentTaskContext === "object" && input.currentTaskContext !== null && "groups" in input.currentTaskContext &&
        Array.isArray(input.currentTaskContext.groups) ? input.currentTaskContext.groups : [];
      const statements = groups.flatMap((group: unknown) => {
        if (typeof group !== "object" || group === null || !("currentAssignee" in group) || !("tasks" in group) || !Array.isArray(group.tasks)) return [];
        const assignee = group.currentAssignee;
        if (typeof assignee !== "object" || assignee === null || !("personId" in assignee) || typeof assignee.personId !== "string") return [];
        return group.tasks.flatMap((task: unknown) => typeof task === "object" && task !== null && "taskId" in task && typeof task.taskId === "string"
          ? [{ developerId: assignee.personId, category: "in_progress", text: "Synthetic progress summary.", taskIds: [task.taskId] }]
          : []);
      });
      text = JSON.stringify({ statements });
    }
    return { ok: true, text, model: "e2e-synthetic", usage: usage(request, text) };
  }
}
