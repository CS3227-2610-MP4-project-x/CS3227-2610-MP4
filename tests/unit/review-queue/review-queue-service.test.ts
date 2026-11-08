import { describe, expect, it, vi } from "vitest";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Product manager reads the review queue" and "Review
// queue actions and access"; design.md "Board, Detail and Review Queue Decisions (4.4)" B2, B5,
// B6, B7 and handoff assumption A1 (the referenced result is found in the public
// completion-assessment history, which already returns every result for the task).
//
// Seam chosen by the test-writer (reported in the 4.4 handoff):
//   src/server/review-queue/index.ts exports ReviewQueueService, ReviewQueueServiceError,
//   ReviewQueueRepository and the types ReviewQueueView, ReviewQueueEntry, ReviewTaskRecord.
//   new ReviewQueueService(repository, completionAssessments) where
//     repository.listInReviewTasks(projectId): Promise<readonly ReviewTaskRecord[]>
//       non-deleted In Review tasks ordered by task number then id, each with
//       { id, taskKey, title, version, assignee, dueDate, attachedCommits,
//         submissionCheckResultId: string | null }  (the check_result_id of the task's most
//         recent `submission` event; SQL covered by the PostgreSQL integration test)
//     completionAssessments.listHistory(taskId): Promise<readonly StoredCheckResult[]>
//   getReviewQueue(projectId, { personId, role }): Promise<ReviewQueueView>
//   ReviewQueueView = { entries: ReviewQueueEntry[] }, each entry
//     { id, taskKey, title, version, assignee, dueDate, attachedCommits, checkHistory,
//       referencedResult: StoredCheckResult | null }
//   ReviewQueueServiceError has `code`: "FORBIDDEN" | "INTERNAL_ERROR" (as TaskDetailServiceError).

vi.mock("server-only", () => ({}));

import { ReviewQueueService, ReviewQueueServiceError } from "@/server/review-queue";

type Repository = ConstructorParameters<typeof ReviewQueueService>[0];
type History = ConstructorParameters<typeof ReviewQueueService>[1];

const PRIVATE = "synthetic-private-db-detail";
const projectId = "40000000-0000-4000-8000-000000000001";
const pm = { personId: "40000000-0000-4000-8000-000000000002", role: "product_manager" as const };
const developer = { personId: "40000000-0000-4000-8000-000000000003", role: "developer" as const };
const assignee = { id: developer.personId, githubUsername: "synthetic-dev-alpha" };
const taskId = (n: number) => `40000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
const checkId = (n: number) => `40000000-0000-4000-8000-${String(500 + n).padStart(12, "0")}`;

function commit(n: number) {
  return { id: `40000000-0000-4000-8000-${String(300 + n).padStart(12, "0")}`, sha: String(n % 10).repeat(40), attachedBy: assignee, attachedAt: "2026-11-06T02:00:00.000Z" };
}

function check(n: number, anchorChar: string) {
  const anchorSha = anchorChar.repeat(40);
  return {
    id: checkId(n), anchorSha, createdAt: `2026-11-0${n}T03:00:00.000Z`, redacted: false,
    payload: { anchorSha, criteria: [{ criterionId: "c1", criterion: "Synthetic criterion", status: "addressed" as const, evidence: [] }], possibleGaps: [], omittedFiles: [] },
  };
}

function record(n: number, submissionCheckResultId: string | null) {
  return {
    id: taskId(n), taskKey: `WEB-${n}`, title: `Synthetic review task ${n}`, version: n + 20,
    assignee, dueDate: "2026-11-30", attachedCommits: [commit(n)], submissionCheckResultId,
  };
}

function entry(n: number, checkHistory: ReturnType<typeof check>[], referencedResult: ReturnType<typeof check> | null) {
  return {
    id: taskId(n), taskKey: `WEB-${n}`, title: `Synthetic review task ${n}`, version: n + 20,
    assignee, dueDate: "2026-11-30", attachedCommits: [commit(n)], checkHistory, referencedResult,
  };
}

function setup(records: ReturnType<typeof record>[], histories: Record<string, ReturnType<typeof check>[]>) {
  const repository = { listInReviewTasks: vi.fn(async () => records) };
  const history = { listHistory: vi.fn(async (id: string) => histories[id] ?? []) };
  const service = new ReviewQueueService(repository as unknown as Repository, history as unknown as History);
  return { repository, history, service };
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ReviewQueueServiceError);
  expect(String((error as Error).message)).not.toContain(PRIVATE);
  return (error as ReviewQueueServiceError).code;
}

describe("Product manager reads the review queue", () => {
  it("returns each In Review task with its commits, check history and the referenced result", async () => {
    const older = check(1, "a");
    const newer = check(2, "b");
    const { repository, history, service } = setup(
      [record(3, older.id), record(8, null)],
      { [taskId(3)]: [newer, older], [taskId(8)]: [check(3, "c")] },
    );

    const view = await service.getReviewQueue(projectId, pm);

    expect(repository.listInReviewTasks).toHaveBeenCalledWith(projectId);
    expect(history.listHistory).toHaveBeenCalledWith(taskId(3));
    expect(history.listHistory).toHaveBeenCalledWith(taskId(8));
    expect(view).toEqual({
      entries: [
        entry(3, [newer, older], older),
        entry(8, [check(3, "c")], null),
      ],
    });
  });

  it("presents the result the most recent submission references, not merely the newest check", async () => {
    // The repository already resolved the most recent submission event's reference (older).
    const older = check(1, "a");
    const newer = check(2, "b");
    const { service } = setup([record(4, older.id)], { [taskId(4)]: [newer, older] });

    const view = await service.getReviewQueue(projectId, pm);

    expect(view.entries[0].referencedResult).toEqual(older);
    expect(view.entries[0].checkHistory).toEqual([newer, older]);
  });

  it("states no referenced result when the latest submission has no check reference", async () => {
    const { service } = setup([record(5, null)], { [taskId(5)]: [check(1, "a")] });

    const view = await service.getReviewQueue(projectId, pm);

    expect(view.entries[0].referencedResult).toBeNull();
    expect(view.entries[0].checkHistory).toEqual([check(1, "a")]);
    expect(view.entries[0].attachedCommits).toEqual([commit(5)]);
  });

  it("does not invent a referenced result that is absent from the task's history", async () => {
    const { service } = setup([record(6, checkId(99))], { [taskId(6)]: [check(1, "a")] });

    const view = await service.getReviewQueue(projectId, pm);

    expect(view.entries[0].referencedResult).toBeNull();
  });

  it("keeps the repository's task-number order", async () => {
    const { service } = setup([record(2, null), record(10, null), record(31, null)], {});

    const view = await service.getReviewQueue(projectId, pm);

    expect(view.entries.map((item) => item.taskKey)).toEqual(["WEB-2", "WEB-10", "WEB-31"]);
  });

  it("returns an empty queue without reading any history", async () => {
    const { history, service } = setup([], {});

    expect(await service.getReviewQueue(projectId, pm)).toEqual({ entries: [] });
    expect(history.listHistory).not.toHaveBeenCalled();
  });
});

describe("Review queue actions and access", () => {
  it("gives a developer no queue data", async () => {
    const { repository, history, service } = setup([record(3, null)], {});

    expect(await codeOf(service.getReviewQueue(projectId, developer))).toBe("FORBIDDEN");
    expect(repository.listInReviewTasks).not.toHaveBeenCalled();
    expect(history.listHistory).not.toHaveBeenCalled();
  });

  it("maps a repository failure to a safe internal error", async () => {
    const { repository, service } = setup([], {});
    repository.listInReviewTasks.mockRejectedValue(new Error(PRIVATE));

    expect(await codeOf(service.getReviewQueue(projectId, pm))).toBe("INTERNAL_ERROR");
  });

  it("maps a history failure to a safe internal error", async () => {
    const { history, service } = setup([record(3, null)], {});
    history.listHistory.mockRejectedValue(new Error(PRIVATE));

    expect(await codeOf(service.getReviewQueue(projectId, pm))).toBe("INTERNAL_ERROR");
  });
});
