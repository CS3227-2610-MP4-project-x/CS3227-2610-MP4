import "server-only";

import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { StoredTaskState } from "@/server/repositories/task-access-repository";

export type { ProjectRole, StoredTaskState };

/** Task state names used by the API (design.md T3; the state route's vocabulary). */
export type TaskState = "To Do" | "In Progress" | "In Review" | "Done";

export type CriterionView = Readonly<{ id: string; position: number; description: string }>;

/** A task as every project member reads it (design.md T3). */
export type TaskView = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  description: string;
  assignee: Readonly<{ personId: string; githubUsername: string }>;
  dueDate: string;
  branchName: string | null;
  state: TaskState;
  acceptanceCriteria: readonly CriterionView[];
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

/** A validated `POST .../tasks` body (design.md T2, T5). */
export type CreateTaskInput = Readonly<{
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  branchName: string | null;
  acceptanceCriteria: readonly string[];
}>;

/** One item of an edited criteria list; `id` keeps an existing criterion (design.md T4). */
export type CriterionInput = Readonly<{ id?: string; description: string }>;

/** A validated `PATCH .../tasks/{taskId}` body; absent fields stay unchanged (design.md T4). */
export type EditTaskInput = Readonly<{
  version: number;
  title?: string;
  description?: string;
  dueDate?: string;
  branchName?: string | null;
  acceptanceCriteria?: readonly CriterionInput[];
}>;

/** A validated `PUT .../tasks/{taskId}/assignee` body (design.md T9). */
export type ReassignTaskInput = Readonly<{ assigneeId: string; version: number }>;

/** A validated `DELETE .../tasks/{taskId}` body (design.md T6). */
export type DeleteTaskInput = Readonly<{ version: number }>;

/** The 400 codes a body can fail with (design.md T7). */
export type BodyErrorCode = "INVALID_REQUEST" | "ACCEPTANCE_CRITERIA_REQUIRED";

export type ParseResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: BodyErrorCode }>;
