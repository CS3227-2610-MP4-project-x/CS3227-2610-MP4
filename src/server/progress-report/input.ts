import "server-only";
import { createHash } from "node:crypto";
import { redactSecrets, sanitizePromptData } from "@/server/ai";
import type { ReportActivity, ReportAssemblyResult, ReportMetadataResult, ReportRange, ReportSnapshot } from "./types";

const LIMIT = 72_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function calendarDayUtc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result.getTime();
}
export function resolveReportRange(input: { startDate?: unknown; endDate?: unknown }, currentSgtDate: string): { kind: "valid"; range: ReportRange } | { kind: "invalid_range" } | { kind: "range_too_long" } {
  let start = input.startDate, end = input.endDate;
  if (start === undefined && end === undefined) start = end = currentSgtDate;
  if (!validDate(start) || !validDate(end) || start > end) return { kind: "invalid_range" };
  const startTime = calendarDayUtc(start), endTime = calendarDayUtc(end);
  const days = Math.floor((endTime - startTime) / 86_400_000) + 1;
  if (days > 7) return { kind: "range_too_long" };
  const startUtc = new Date(startTime - 8 * 60 * 60 * 1000).toISOString();
  const endUtcExclusive = new Date(endTime + 86_400_000 - 8 * 60 * 60 * 1000).toISOString();
  return { kind: "valid", range: { startDate: start, endDate: end, startUtc, endUtcExclusive } };
}

function safeTextWithCount(text: string, countReplacement: (count: number) => void): string {
  const redacted = redactSecrets(text);
  countReplacement(redacted.redactionCount);
  return sanitizePromptData(redacted.text);
}
function safeActor(actor: ReportActivity["actor"], safeText: (text: string) => string): ReportActivity["actor"] {
  return actor ? { personId: actor.personId, githubUsername: safeText(actor.githubUsername) } : null;
}
function safeActivity(row: ReportActivity, safeText: (text: string) => string): Record<string, unknown> {
  let payload: Record<string, unknown>;
  switch (row.type) {
    case "progress_update": payload = { body: safeText(String(row.payload.body ?? "")) }; break;
    case "state_change": payload = { fromStatus: row.payload.fromStatus, toStatus: row.payload.toStatus }; break;
    case "submission": payload = { fromStatus: row.payload.fromStatus, toStatus: row.payload.toStatus, ...(row.payload.checkResultId ? { checkResultId: row.payload.checkResultId } : {}) }; break;
    case "review_feedback": payload = { fromStatus: row.payload.fromStatus, toStatus: row.payload.toStatus, feedback: safeText(String(row.payload.feedback ?? "")) }; break;
    case "assignment_change": payload = { fromAssigneeId: row.payload.fromAssigneeId, toAssigneeId: row.payload.toAssigneeId }; break;
    case "criteria_check": {
      payload = { resultId: row.payload.resultId, createdAt: row.payload.createdAt, model: safeText(String(row.payload.model ?? "")), anchorSha: row.payload.anchorSha, redacted: row.payload.redacted,
        criteria: row.payload.criteria.map((item) => ({ criterionId: item.criterionId, status: item.status })), gapCount: row.payload.gapCount, omissionCount: row.payload.omissionCount };
      break;
    }
  }
  return { taskId: row.taskId, taskKey: row.taskKey, type: row.type, sourceId: row.sourceId, occurredAt: row.occurredAt, actor: safeActor(row.actor, safeText), payload };
}

export function prepareReportInput(input: { range: ReportRange; snapshot: ReportSnapshot; metadata: ReportMetadataResult; deletionMarkers?: readonly { taskId: string; deletedAt: string }[]; databaseFingerprint?: string }): ReportAssemblyResult {
  const { range, snapshot, metadata } = input;
  const githubUnavailable = metadata.kind === "unavailable";
  let replacementCount = 0;
  const safe = (text: string): string => safeTextWithCount(text, (count) => { replacementCount += count; });
  const activities: Record<string, unknown>[] = snapshot.activity.map((activity) => safeActivity(activity, safe));
  if (metadata.commits?.length) {
    const commits = new Map(metadata.commits.map((commit) => [commit.sha.toLowerCase(), commit]));
    for (const attached of snapshot.attachedCommits) {
      const commit = commits.get(attached.sha.toLowerCase());
      if (!commit || commit.authoredAt < range.startUtc || commit.authoredAt >= range.endUtcExclusive) continue;
      activities.push({ taskId: attached.taskId, taskKey: attached.taskKey, type: "attached_commit", sourceId: attached.sha, occurredAt: commit.authoredAt, actor: commit.author.githubUsername ? { githubUsername: safe(commit.author.githubUsername) } : null,
        payload: { sha: commit.sha, authoredAt: commit.authoredAt, message: safe(commit.message), attachedAt: attached.attachedAt } });
    }
  }
  if (!activities.length && !githubUnavailable) return { kind: "empty", range, redaction: { occurred: false, replacementCount: 0 } };
  const taskGroups = new Map<string, { currentAssignee: ReportSnapshot["tasks"][number]["currentAssignee"]; tasks: Record<string, unknown>[] }>();
  for (const task of snapshot.tasks) {
    const assignee = { personId: task.currentAssignee.personId, githubUsername: safe(task.currentAssignee.githubUsername) };
    const group = taskGroups.get(assignee.personId) ?? { currentAssignee: assignee, tasks: [] };
    // The group and each task both serialize the current assignee. Count each appearance,
    // even though the first task's sanitized assignee object is shared in memory.
    if (group.tasks.length === 0) replacementCount += redactSecrets(task.currentAssignee.githubUsername).redactionCount;
    group.tasks.push({ taskId: task.taskId, taskKey: task.taskKey, title: safe(task.title), currentAssignee: assignee, status: task.status, dueDate: task.dueDate,
      requestChangesCount: task.requestChangesCount, overdue: task.status !== "done" && task.dueDate < range.endDate, repeatedChanges: task.requestChangesCount > 1 });
    taskGroups.set(assignee.personId, group);
  }
  const currentTaskContext = { label: "current", groups: [...taskGroups.values()].sort((a, b) => a.currentAssignee.githubUsername.toLowerCase().localeCompare(b.currentAssignee.githubUsername.toLowerCase()) || a.currentAssignee.personId.localeCompare(b.currentAssignee.personId)) };
  for (const group of currentTaskContext.groups) group.tasks.sort((a, b) => String(a.taskKey).localeCompare(String(b.taskKey)) || String(a.taskId).localeCompare(String(b.taskId)));
  activities.sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.type).localeCompare(String(b.type)) || String(a.sourceId).localeCompare(String(b.sourceId)) || String(a.taskId).localeCompare(String(b.taskId)));
  const data = { range: { startDate: range.startDate, endDate: range.endDate }, currentTaskContext, activity: activities, githubUnavailable };
  const inputText = JSON.stringify(data);
  return inputText.length > LIMIT ? { kind: "input_budget_exceeded", range } : {
    kind: "ready", range, inputText, inputLength: inputText.length,
    inputFingerprint: createHash("sha256").update(JSON.stringify({ inputText, deletionMarkers: input.deletionMarkers ?? [], redactionReplacementCount: replacementCount }), "utf8").digest("hex"),
    ...(input.databaseFingerprint ? { databaseFingerprint: input.databaseFingerprint } : {}),
    githubUnavailable,
    redaction: { occurred: replacementCount > 0, replacementCount },
  };
}
