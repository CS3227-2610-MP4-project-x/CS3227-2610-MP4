import "server-only";

import type { TaskRecord, TaskTransaction } from "./repository";
import { TASK_STATE_NAMES } from "./states";
import type { TaskView } from "./types";

/** The task view every project member reads (design.md T3). */
export function toView(record: TaskRecord): TaskView {
  return {
    id: record.id,
    taskKey: `${record.projectKey}-${record.number}`,
    title: record.title,
    description: record.description,
    assignee: { personId: record.assigneeId, githubUsername: record.assigneeGitHubUsername },
    dueDate: record.dueDate,
    branchName: record.branchName,
    state: TASK_STATE_NAMES[record.status],
    acceptanceCriteria: record.criteria,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Reads the view of a task the transaction has just written; it must still exist. */
export async function readWrittenTask(transaction: TaskTransaction, projectId: string, taskId: string): Promise<TaskView> {
  const record = await transaction.findTask(projectId, taskId);
  if (!record) throw new Error("Task disappeared during its own transaction.");
  return toView(record);
}
