import "server-only";

import type { StoredCheckResult } from "@/server/completion-assessment";
import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { TaskDetailReadRepository } from "./read-repository";

export type TaskDetailAccess = Readonly<{ personId: string; role: ProjectRole }>;
export type TaskDetailView = Readonly<{
  task: Readonly<{
    id: string; projectKey: string; taskKey: string; title: string; description: string;
    status: string; version: number; assignee: Readonly<{ id: string; githubUsername: string }>;
    dueDate: string; branchName: string | null;
    acceptanceCriteria: readonly Readonly<{ id: string; position: number; description: string }>[];
  }>;
  attachedCommits: readonly Readonly<{ id: string; sha: string; sourceBranch: string | null; attachedBy: Readonly<{ id: string; githubUsername: string }>; attachedAt: string }>[];
  progressUpdates: readonly Readonly<{ id: string; author: Readonly<{ id: string; githubUsername: string }>; body: string; createdAt: string }>[];
  reviewFeedback: readonly Readonly<{ id: string; author: Readonly<{ id: string; githubUsername: string }>; feedback: string; createdAt: string }>[];
  checkHistory: readonly StoredCheckResult[];
}>;

export type TaskDetailServiceErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";
export class TaskDetailServiceError extends Error {
  constructor(readonly code: TaskDetailServiceErrorCode) {
    super(code);
    this.name = "TaskDetailServiceError";
  }
}

type HistoryReader = Readonly<{ listHistory(taskId: string): Promise<readonly StoredCheckResult[]> }>;

export class TaskDetailService {
  constructor(private readonly repository: TaskDetailReadRepository, private readonly completionAssessments: HistoryReader) {}

  async getTaskDetail(projectId: string, taskId: string, access: TaskDetailAccess): Promise<TaskDetailView> {
    let assigneeId: string | null;
    try { assigneeId = await this.repository.findTaskAssignee(projectId, taskId); }
    catch { throw new TaskDetailServiceError("INTERNAL_ERROR"); }
    if (!assigneeId) throw new TaskDetailServiceError("NOT_FOUND");
    if (access.role === "developer" && assigneeId !== access.personId) {
      throw new TaskDetailServiceError("FORBIDDEN");
    }
    let snapshot;
    try { snapshot = await this.repository.findTaskDetail(projectId, taskId); }
    catch { throw new TaskDetailServiceError("INTERNAL_ERROR"); }
    if (!snapshot) throw new TaskDetailServiceError("NOT_FOUND");
    if (access.role === "developer" && snapshot.task.assigneeId !== access.personId) {
      throw new TaskDetailServiceError("FORBIDDEN");
    }
    let checkHistory: readonly StoredCheckResult[];
    try { checkHistory = await this.completionAssessments.listHistory(taskId); }
    catch { throw new TaskDetailServiceError("INTERNAL_ERROR"); }
    const { assigneeId: _assigneeId, ...task } = snapshot.task;
    return { ...snapshot, task, checkHistory };
  }
}
