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

/**
 * A validated `PATCH .../tasks/{taskId}/state` body (design.md L1, L3). `feedback` is absent when
 * the body has none; otherwise it holds the result of validating the sent value, which the
 * handler applies only after the 403 matrix (the 4.3 check order).
 */
export type StateChangeInput = Readonly<{
  state: TaskState;
  version: number;
  feedback?: ParseResult<string>;
}>;

/** The product manager's request for changes (design.md L3). */
export type RequestChangesInput = Readonly<{ version: number; feedback: string }>;

/** A progress update as task detail's `progressUpdates` returns it (design.md L4). */
export type ProgressUpdateView = Readonly<{
  id: string;
  author: Readonly<{ id: string; githubUsername: string }>;
  body: string;
  createdAt: string;
}>;

/**
 * The unique tip of a task's attached commits and the inputs it was resolved from (design.md
 * L5). `commitShas` is the attached commit set and `criteria` the criteria, ordered by position
 * then ID, whose hash is `criteriaHash`.
 */
export type SubmissionTip = Readonly<{
  anchorSha: string;
  commitShas: readonly string[];
  criteria: readonly Readonly<{ id: string; description: string; position: number }>[];
  criteriaHash: string;
}>;

/** Resolves the submission tip with no database transaction open; null when there is none. */
export type SubmissionTipPort = Readonly<{
  findSubmissionTip(projectId: string, taskId: string): Promise<SubmissionTip | null>;
}>;

/** The 400 codes a body can fail with (design.md T7). */
export type BodyErrorCode = "INVALID_REQUEST" | "ACCEPTANCE_CRITERIA_REQUIRED";

export type ParseResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: BodyErrorCode }>;
