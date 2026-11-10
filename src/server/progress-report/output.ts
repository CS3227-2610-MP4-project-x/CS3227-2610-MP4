import "server-only";

import type { OutputValidation } from "@/server/ai";

export type ReportStatement = Readonly<{
  developerId: string;
  category: "completed" | "submitted" | "in_progress" | "overdue" | "repeated_changes";
  text: string;
  taskIds: readonly string[];
}>;

type InputProjection = Readonly<{
  currentTaskContext?: Readonly<{
    groups?: readonly Readonly<{
      currentAssignee?: Readonly<{ personId?: unknown }>;
      tasks?: readonly Readonly<{ taskId?: unknown }> [];
    }> [];
  }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(["completed", "submitted", "in_progress", "overdue", "repeated_changes"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assigneeTasks(inputText: string): Map<string, Set<string>> | null {
  try {
    const input: unknown = JSON.parse(inputText);
    if (!isRecord(input) || !isRecord(input.currentTaskContext) || !Array.isArray(input.currentTaskContext.groups)) return null;
    const result = new Map<string, Set<string>>();
    for (const group of input.currentTaskContext.groups) {
      if (!isRecord(group) || !isRecord(group.currentAssignee) || typeof group.currentAssignee.personId !== "string" || !UUID.test(group.currentAssignee.personId) || !Array.isArray(group.tasks)) return null;
      const tasks = result.get(group.currentAssignee.personId) ?? new Set<string>();
      for (const task of group.tasks) {
        if (!isRecord(task) || typeof task.taskId !== "string" || !UUID.test(task.taskId)) return null;
        tasks.add(task.taskId);
      }
      result.set(group.currentAssignee.personId, tasks);
    }
    return result;
  } catch {
    return null;
  }
}

/** Strictly validates every statement against the assembled current-assignee/task projection. */
export function validateReportStatements(value: unknown, inputText: string): OutputValidation<readonly ReportStatement[]> {
  if (!isRecord(value) || !exactKeys(value, ["statements"]) || !Array.isArray(value.statements)) return { ok: false };
  const allowed = assigneeTasks(inputText);
  if (!allowed) return { ok: false };
  const statements: ReportStatement[] = [];
  for (const candidate of value.statements) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["category", "developerId", "taskIds", "text"])) return { ok: false };
    if (typeof candidate.developerId !== "string" || !UUID.test(candidate.developerId) || !allowed.has(candidate.developerId)) return { ok: false };
    if (typeof candidate.category !== "string" || !CATEGORIES.has(candidate.category)) return { ok: false };
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) return { ok: false };
    if (!Array.isArray(candidate.taskIds) || candidate.taskIds.length === 0) return { ok: false };
    const tasks = allowed.get(candidate.developerId)!;
    const taskIds: string[] = [];
    const seen = new Set<string>();
    for (const taskId of candidate.taskIds) {
      if (typeof taskId !== "string" || !UUID.test(taskId) || !tasks.has(taskId) || seen.has(taskId)) return { ok: false };
      seen.add(taskId);
      taskIds.push(taskId);
    }
    statements.push({ developerId: candidate.developerId, category: candidate.category as ReportStatement["category"], text: candidate.text, taskIds });
  }
  return { ok: true, value: statements };
}
