import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validateReportStatements } from "@/server/progress-report";
import { ids, inputText, statement } from "./generation-fixtures";

describe("8.2 D2-D3 strict report statement and citation contract", () => {
  it.each(["completed", "submitted", "in_progress", "overdue", "repeated_changes"])("accepts category %s with current-assignee task citations", (category) => {
    const value = { statements: [{ ...statement, category }] };
    expect(validateReportStatements(value, inputText())).toEqual({ ok: true, value: value.statements });
  });

  it.each([
    ["missing envelope", [statement]],
    ["unknown root field", { statements: [statement], overview: "Uncited summary" }],
    ["missing citations", { statements: [{ developerId: ids.developer, category: "completed", text: "Done" }] }],
    ["empty citations", { statements: [{ ...statement, taskIds: [] }] }],
    ["duplicate citations", { statements: [{ ...statement, taskIds: [ids.task, ids.task] }] }],
    ["absent, foreign or deleted task", { statements: [{ ...statement, taskIds: [ids.absentTask] }] }],
    ["task assigned to another developer", { statements: [{ ...statement, taskIds: [ids.otherTask] }] }],
    ["unknown developer", { statements: [{ ...statement, developerId: ids.pm }] }],
    ["blank prose", { statements: [{ ...statement, text: " \n " }] }],
    ["unsupported category", { statements: [{ ...statement, category: "approved" }] }],
    ["model-owned metadata", { statements: [{ ...statement, githubUnavailable: false }] }],
    ["non-string prose", { statements: [{ ...statement, text: 42 }] }],
  ])("rejects the entire response: %s", (_name, value) => {
    expect(validateReportStatements(value, inputText())).toEqual({ ok: false });
  });

  it("rejects a response containing both valid and invalid statements rather than dropping one", () => {
    expect(validateReportStatements({ statements: [statement, { ...statement, taskIds: [ids.absentTask] }] }, inputText())).toEqual({ ok: false });
  });
});
