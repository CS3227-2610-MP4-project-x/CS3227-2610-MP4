import "server-only";

import type { StoredCheckResult } from "@/server/completion-assessment";
import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { ReviewAttachedCommit, ReviewTaskRecord } from "./repository";

export type ReviewQueueAccess = Readonly<{ personId: string; role: ProjectRole }>;

export type ReviewQueueEntry = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  version: number;
  assignee: Readonly<{ id: string; githubUsername: string }>;
  dueDate: string;
  attachedCommits: readonly ReviewAttachedCommit[];
  /** Distinct check history in the existing Group 7 entry shape, newest first. */
  checkHistory: readonly StoredCheckResult[];
  /** The result referenced by the most recent submission, found in `checkHistory` (B5, A1). */
  referencedResult: StoredCheckResult | null;
}>;

export type ReviewQueueView = Readonly<{ entries: readonly ReviewQueueEntry[] }>;

export type ReviewQueueServiceErrorCode = "FORBIDDEN" | "INTERNAL_ERROR";
export class ReviewQueueServiceError extends Error {
  constructor(readonly code: ReviewQueueServiceErrorCode) {
    super(code);
    this.name = "ReviewQueueServiceError";
  }
}

type InReviewReads = Readonly<{ listInReviewTasks(projectId: string): Promise<readonly ReviewTaskRecord[]> }>;
type HistoryReader = Readonly<{ listHistory(taskId: string): Promise<readonly StoredCheckResult[]> }>;

function entry(record: ReviewTaskRecord, checkHistory: readonly StoredCheckResult[]): ReviewQueueEntry {
  const referenceId = record.submissionCheckResultId;
  return {
    id: record.id,
    taskKey: record.taskKey,
    title: record.title,
    version: record.version,
    assignee: { id: record.assignee.id, githubUsername: record.assignee.githubUsername },
    dueDate: record.dueDate,
    attachedCommits: record.attachedCommits,
    checkHistory,
    referencedResult: referenceId === null ? null : checkHistory.find((result) => result.id === referenceId) ?? null,
  };
}

/**
 * The product manager's review queue (task-management "Product manager reads the review queue",
 * design.md B2, B5, B6). Membership is checked by the page-access helper; the role is checked here.
 */
export class ReviewQueueService {
  constructor(private readonly repository: InReviewReads, private readonly completionAssessments: HistoryReader) {}

  async getReviewQueue(projectId: string, access: ReviewQueueAccess): Promise<ReviewQueueView> {
    if (access.role !== "product_manager") throw new ReviewQueueServiceError("FORBIDDEN");
    let records: readonly ReviewTaskRecord[];
    try { records = await this.repository.listInReviewTasks(projectId); }
    catch { throw new ReviewQueueServiceError("INTERNAL_ERROR"); }
    let histories: readonly (readonly StoredCheckResult[])[];
    try { histories = await Promise.all(records.map((record) => this.completionAssessments.listHistory(record.id))); }
    catch { throw new ReviewQueueServiceError("INTERNAL_ERROR"); }
    return { entries: records.map((record, index) => entry(record, histories[index])) };
  }
}
