export const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  pm: "20000000-0000-4000-8000-000000000001",
  developer: "20000000-0000-4000-8000-000000000002",
  otherDeveloper: "20000000-0000-4000-8000-000000000003",
  task: "30000000-0000-4000-8000-000000000001",
  otherTask: "30000000-0000-4000-8000-000000000002",
  absentTask: "30000000-0000-4000-8000-000000000003",
  report: "40000000-0000-4000-8000-000000000001",
} as const;
export const range = { startDate: "2026-11-09", endDate: "2026-11-09", startUtc: "2026-11-08T16:00:00.000Z", endUtcExclusive: "2026-11-09T16:00:00.000Z" };
export const statement = { developerId: ids.developer, category: "in_progress" as const, text: "Made progress on the task.", taskIds: [ids.task] };
export function inputText(githubUnavailable = false) {
  return JSON.stringify({ range: { startDate: range.startDate, endDate: range.endDate }, currentTaskContext: { label: "current", groups: [
    { currentAssignee: { personId: ids.developer, githubUsername: "synthetic-dev" }, tasks: [{ taskId: ids.task, taskKey: "SYN-1", title: "Synthetic task", currentAssignee: { personId: ids.developer, githubUsername: "synthetic-dev" }, status: "in_progress", dueDate: "2026-11-30", requestChangesCount: 0, overdue: false, repeatedChanges: false }] },
    { currentAssignee: { personId: ids.otherDeveloper, githubUsername: "synthetic-other" }, tasks: [{ taskId: ids.otherTask, taskKey: "SYN-2", title: "Other task", currentAssignee: { personId: ids.otherDeveloper, githubUsername: "synthetic-other" }, status: "to_do", dueDate: "2026-11-30", requestChangesCount: 0, overdue: false, repeatedChanges: false }] },
  ] }, activity: [{ taskId: ids.task, taskKey: "SYN-1", type: "progress_update", sourceId: "50000000-0000-4000-8000-000000000001", occurredAt: "2026-11-09T01:00:00.000Z", actor: { personId: ids.developer, githubUsername: "synthetic-dev" }, payload: { body: "Made progress" } }], githubUnavailable });
}
export function ready(fingerprint = "a".repeat(64), githubUnavailable = false) {
  const text = inputText(githubUnavailable);
  return { kind: "ready" as const, range, inputText: text, inputLength: text.length, inputFingerprint: fingerprint, githubUnavailable, redaction: { occurred: false, replacementCount: 0 } };
}
type Stored = { id: string; projectId: string; rangeStart: string; rangeEnd: string; statements: typeof statement[]; model: string; createdAt: string; githubUnavailable: boolean; version: number; inputFingerprint: string | null; generationContractVersion: string | null; providerModel: string | null; redactionReplacementCount: number | null };
export function stored(overrides: Partial<Stored> = {}): Stored {
  return { id: ids.report, projectId: ids.project, rangeStart: range.startDate, rangeEnd: range.endDate, statements: [statement], model: "fake", createdAt: "2026-11-09T02:00:00.000Z", githubUnavailable: false, version: 1, inputFingerprint: "a".repeat(64), generationContractVersion: "progress-report-v2", providerModel: "fake:fake", redactionReplacementCount: 0, ...overrides };
}
