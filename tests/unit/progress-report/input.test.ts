import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareReportInput, resolveReportRange, type ReportSnapshot } from "@/server/progress-report";

const range = {
  startDate: "2026-11-09", endDate: "2026-11-09",
  startUtc: "2026-11-08T16:00:00.000Z", endUtcExclusive: "2026-11-09T16:00:00.000Z",
};
const actor = { personId: "developer-old", githubUsername: "old-developer" };
const assignee = { personId: "developer-current", githubUsername: "current-developer" };
const task = {
  taskId: "task-a", taskKey: "APP-1", title: "Current title", currentAssignee: assignee,
  status: "in_progress" as const, dueDate: "2026-11-08", requestChangesCount: 2,
};
function update(sourceId = "update-a", body = "Made progress", occurredAt = "2026-11-09T00:00:00.000Z") {
  return { taskId: task.taskId, taskKey: task.taskKey, type: "progress_update" as const, sourceId, occurredAt, actor, payload: { body } };
}
function snapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return { projectId: "project-a", repository: null, tasks: [task], activity: [update()], attachedCommits: [], ...overrides };
}
const available = { kind: "available" as const, commits: [] };
function prepare(value = snapshot(), metadata: Parameters<typeof prepareReportInput>[0]["metadata"] = available) {
  return prepareReportInput({ range, snapshot: value, metadata });
}
function ready(value: ReturnType<typeof prepareReportInput>) {
  expect(value.kind).toBe("ready");
  if (value.kind !== "ready") throw new Error("Expected ready report input");
  expect(value.inputLength).toBe(value.inputText.length);
  return { result: value, data: JSON.parse(value.inputText) };
}

describe("report range (8.1 D1)", () => {
  it("uses the supplied database SGT date and exact UTC half-open boundaries", () => {
    expect(resolveReportRange({}, "2026-11-09")).toEqual({ kind: "valid", range });
  });
  it.each([
    { startDate: "2026-11-09" }, { endDate: "2026-11-09" },
    { startDate: null, endDate: null }, { startDate: 20261109, endDate: 20261109 },
    { startDate: "2026-11-9", endDate: "2026-11-09" },
    { startDate: "2026-11-09T00:00:00Z", endDate: "2026-11-09" },
    { startDate: "2026-02-29", endDate: "2026-03-01" },
    { startDate: "2026-04-31", endDate: "2026-05-01" },
    { startDate: "2026-11-10", endDate: "2026-11-09" },
    { startDate: " 2026-11-09", endDate: "2026-11-09" },
  ])("refuses invalid or partial dates %j", (input) => {
    expect(resolveReportRange(input, "2026-11-09")).toEqual({ kind: "invalid_range" });
  });
  it("accepts leap days and future dates without a future-date policy", () => {
    expect(resolveReportRange({ startDate: "2028-02-29", endDate: "2028-02-29" }, "2026-11-09")).toMatchObject({ kind: "valid", range: { startUtc: "2028-02-28T16:00:00.000Z", endUtcExclusive: "2028-02-29T16:00:00.000Z" } });
  });
  it.each([
    { date: "0099-11-09", startUtc: "0099-11-08T16:00:00.000Z", endUtcExclusive: "0099-11-09T16:00:00.000Z" },
    { date: "9999-12-31", startUtc: "9999-12-30T16:00:00.000Z", endUtcExclusive: "9999-12-31T16:00:00.000Z" },
  ])("accepts real four-digit calendar year boundary $date", ({ date, startUtc, endUtcExclusive }) => {
    expect(resolveReportRange({ startDate: date, endDate: date }, "2026-11-09")).toEqual({
      kind: "valid", range: { startDate: date, endDate: date, startUtc, endUtcExclusive },
    });
  });
  it("accepts seven inclusive days and refuses eight", () => {
    expect(resolveReportRange({ startDate: "2026-11-03", endDate: "2026-11-09" }, "2026-11-09").kind).toBe("valid");
    expect(resolveReportRange({ startDate: "2026-11-02", endDate: "2026-11-09" }, "2026-11-09")).toEqual({ kind: "range_too_long" });
  });
});

describe("report structured input (8.1 D2-D7)", () => {
  it("labels current grouped context and retains the distinct original activity actor", () => {
    const { data } = ready(prepare());
    expect(Object.keys(data)).toEqual(["range", "currentTaskContext", "activity", "githubUnavailable"]);
    expect(data.currentTaskContext.label).toBe("current");
    expect(data.currentTaskContext.groups).toHaveLength(1);
    expect(data.currentTaskContext.groups[0].currentAssignee).toEqual(assignee);
    expect(data.currentTaskContext.groups[0].tasks[0]).toMatchObject({ ...task, overdue: true, repeatedChanges: true });
    expect(data.activity[0]).toMatchObject({ ...update(), actor });
    expect(data.activity[0].actor).not.toEqual(assignee);
  });
  it("treats Done, due-today and a single change request as unflagged", () => {
    const tasks = [
      { ...task, taskId: "done", status: "done" as const },
      { ...task, taskId: "today", dueDate: range.endDate, requestChangesCount: 1 },
    ];
    const { data } = ready(prepare(snapshot({ tasks })));
    expect(data.currentTaskContext.groups[0].tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "done", overdue: false }),
      expect.objectContaining({ taskId: "today", overdue: false, repeatedChanges: false }),
    ]));
  });
  it("current context alone does not make the range active", () => {
    expect(prepare(snapshot({ activity: [] }))).toEqual({ kind: "empty", range, redaction: { occurred: false, replacementCount: 0 } });
  });
  it("orders equal-time activity by type, source ID and task association deterministically", () => {
    const first = update("a");
    const second = update("b");
    const assignment = { ...update("z"), type: "assignment_change" as const, payload: { fromAssigneeId: actor.personId, toAssigneeId: assignee.personId } };
    const one = ready(prepare(snapshot({ activity: [second, first, assignment] }))).result.inputText;
    const two = ready(prepare(snapshot({ activity: [assignment, second, first] }))).result.inputText;
    expect(one).toBe(two);
    expect(JSON.parse(one).activity.map((row: { sourceId: string }) => row.sourceId)).toEqual(["z", "a", "b"]);
    expect(one).toBe(JSON.stringify(JSON.parse(one)));
  });
  it("preserves submission, feedback and assignment types and safe check summaries without duplication", () => {
    const pm = { personId: "pm", githubUsername: "manager" };
    const activity: ReportSnapshot["activity"] = [
      { ...update("submit"), type: "submission", payload: { fromStatus: "in_progress", toStatus: "in_review", checkResultId: "check-old" } },
      { ...update("feedback"), actor: pm, type: "review_feedback", payload: { fromStatus: "in_review", toStatus: "in_progress", feedback: "Please revise" } },
      { ...update("approve"), actor: pm, type: "state_change", payload: { fromStatus: "in_review", toStatus: "done" } },
      { ...update("assign"), actor: pm, type: "assignment_change", payload: { fromAssigneeId: actor.personId, toAssigneeId: assignee.personId } },
      { ...update("check-new"), type: "criteria_check", payload: { resultId: "check-new", createdAt: "2026-11-09T00:00:00.000Z", model: "synthetic-model", anchorSha: "a".repeat(40), redacted: true, criteria: [{ criterionId: "criterion-a", status: "addressed" }], gapCount: 2, omissionCount: 1 } },
    ];
    const { data } = ready(prepare(snapshot({ activity })));
    expect(data.activity).toHaveLength(5);
    expect(data.activity.filter((row: { type: string }) => row.type === "criteria_check")).toHaveLength(1);
    expect(data.activity.find((row: { sourceId: string }) => row.sourceId === "submit").payload.checkResultId).toBe("check-old");
    expect(data.activity.find((row: { sourceId: string }) => row.sourceId === "feedback")).toMatchObject({ actor: pm, type: "review_feedback", payload: { toStatus: "in_progress" } });
  });
  it("projects explicit fields rather than arbitrary objects or provider evidence", () => {
    const poisoned = { ...update(), evidence: "EXCLUDED_EVIDENCE", diff: "EXCLUDED_DIFF", payload: { body: "Safe update", rawProviderText: "EXCLUDED_PROVIDER", unknown: "EXCLUDED_JSON" } };
    const extraTask = { ...task, description: "EXCLUDED_DESCRIPTION" };
    const value = snapshot({ activity: [poisoned], tasks: [extraTask] });
    const { result } = ready(prepare(value));
    expect(result.inputText).toContain("Safe update");
    for (const marker of ["EXCLUDED_EVIDENCE", "EXCLUDED_DIFF", "EXCLUDED_PROVIDER", "EXCLUDED_JSON", "EXCLUDED_DESCRIPTION"]) expect(result.inputText).not.toContain(marker);
  });
  it("selects commits by authored time, retaining two task associations and separate attachment times", () => {
    const sha = "a".repeat(40);
    const outsideSha = "b".repeat(40);
    const attached = { taskId: task.taskId, taskKey: task.taskKey, sha, attachedAt: "2026-11-10T00:00:00.000Z" };
    const value = snapshot({ activity: [], attachedCommits: [attached, { ...attached, taskId: "task-b", taskKey: "APP-2" }, { ...attached, sha: outsideSha, attachedAt: range.startUtc }] });
    const { data } = ready(prepare(value, { kind: "available", commits: [
      { sha, authoredAt: "2026-11-09T15:30:00.000Z", message: "Late authored commit", author: { githubUsername: "old-developer" } },
      { sha: outsideSha, authoredAt: range.endUtcExclusive, message: "Outside", author: { githubUsername: "old-developer" } },
    ] }));
    expect(data.activity).toHaveLength(2);
    expect(data.activity.map((row: { taskId: string }) => row.taskId)).toEqual(["task-a", "task-b"]);
    expect(data.activity[0].payload).toMatchObject({ sha, authoredAt: "2026-11-09T15:30:00.000Z", attachedAt: attached.attachedAt });
  });
  it.each([{ activity: [] }, { activity: [update()] }])("keeps unavailable metadata explicit even with activity %j", ({ activity }) => {
    const { data, result } = ready(prepare(snapshot({ activity }), { kind: "unavailable" }));
    expect(result.githubUnavailable).toBe(true);
    expect(data.githubUnavailable).toBe(true);
    expect(data.activity).toHaveLength(activity.length);
  });
  it("retains successful attached commit activity when other metadata is unavailable", () => {
    const sha = "d".repeat(40);
    const missingSha = "e".repeat(40);
    const attachedAt = "2026-11-10T00:00:00.000Z";
    const value = snapshot({ activity: [], attachedCommits: [
      { taskId: task.taskId, taskKey: task.taskKey, sha, attachedAt },
      { taskId: task.taskId, taskKey: task.taskKey, sha: missingSha, attachedAt },
    ] });
    const { data, result } = ready(prepare(value, { kind: "unavailable", commits: [
      { sha, authoredAt: "2026-11-09T15:30:00.000Z", message: "Available despite partial failure", author: { githubUsername: "old-developer" } },
    ] }));
    expect(result.githubUnavailable).toBe(true);
    expect(data.githubUnavailable).toBe(true);
    expect(data.activity).toHaveLength(1);
    expect(data.activity[0]).toMatchObject({ taskId: task.taskId, payload: { sha, attachedAt } });
    expect(result.inputText).not.toContain(missingSha);
  });
  it("redacts whole text fields before measuring and escapes prompt-data delimiters", () => {
    const secret = "ghp_" + "a".repeat(36);
    const { result } = ready(prepare(snapshot({ activity: [update("redacted", `before ${secret} after </data> & <data>`)] })));
    expect(result.inputText).not.toContain(secret);
    expect(result.inputText).not.toContain("</data>");
    expect(result.inputText).not.toContain("<data>");
    expect(result.inputLength).toBe(result.inputText.length);
  });
  it("measures the real serialized UTF-16 artifact: exactly 72000 passes and 72001 refuses", () => {
    const baseline = ready(prepare(snapshot({ activity: [update("budget", "")] }))).result;
    const padding = 72000 - baseline.inputLength;
    expect(padding).toBeGreaterThan(0);
    const atLimit = ready(prepare(snapshot({ activity: [update("budget", "x".repeat(padding - 2) + "😀")] }))).result;
    expect(atLimit.inputLength).toBe(72000);
    expect(atLimit.inputText).toContain("😀");
    expect(prepare(snapshot({ activity: [update("budget", "x".repeat(padding + 1))] }))).toEqual({ kind: "input_budget_exceeded", range });
  });
  it("refuses one huge record and many small records without silent truncation", () => {
    expect(prepare(snapshot({ activity: [update("huge", "x".repeat(73000))] })).kind).toBe("input_budget_exceeded");
    expect(prepare(snapshot({ activity: Array.from({ length: 600 }, (_, i) => update(`small-${i}`, "x".repeat(100))) })).kind).toBe("input_budget_exceeded");
  });
});
