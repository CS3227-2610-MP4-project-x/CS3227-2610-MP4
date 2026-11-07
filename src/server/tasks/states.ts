import "server-only";

import type { ProjectRole, StoredTaskState, TaskState } from "./types";

/**
 * The one mapping between stored task statuses and the API state names (design.md T3; the
 * "Duplicate state-name map" resolution in "Task Lifecycle Decisions (4.3)").
 */
export const TASK_STATE_NAMES: Readonly<Record<StoredTaskState, TaskState>> = Object.freeze({
  to_do: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
});

const STORED_STATES: ReadonlyMap<string, StoredTaskState> = new Map(
  (Object.entries(TASK_STATE_NAMES) as [StoredTaskState, TaskState][]).map(([stored, name]) => [name, stored]),
);

/** True for exactly the four API state names; inherited object keys are not state names. */
export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && STORED_STATES.has(value);
}

export function storedStateOf(state: TaskState): StoredTaskState {
  const stored = STORED_STATES.get(state);
  if (!stored) throw new Error("Unknown task state.");
  return stored;
}

/** The four lifecycle transitions; each has its own service method (design.md L3). */
export type Transition = "start" | "submit" | "approve" | "requestChanges";

type TransitionRule = Readonly<{ from: StoredTaskState; to: StoredTaskState; by: "assignee" | "product_manager" }>;

// task-management "Task lifecycle": the only allowed transitions, and who may make each one.
// Every other combination of role, assignment and current state is refused with 403 (L2).
export const TRANSITIONS: Readonly<Record<Transition, TransitionRule>> = Object.freeze({
  start: { from: "to_do", to: "in_progress", by: "assignee" },
  submit: { from: "in_progress", to: "in_review", by: "assignee" },
  approve: { from: "in_review", to: "done", by: "product_manager" },
  requestChanges: { from: "in_review", to: "in_progress", by: "product_manager" },
});

export type TransitionActor = Readonly<{ personId: string; role: ProjectRole }>;
export type TransitionSubject = Readonly<{ assigneeId: string; status: StoredTaskState }>;

function mayAct(rule: TransitionRule, actor: TransitionActor, task: TransitionSubject): boolean {
  return rule.by === "assignee"
    ? actor.role === "developer" && actor.personId === task.assigneeId
    : actor.role === "product_manager";
}

/** The transition this actor may make from the task's current state to `target`, or null (L2). */
export function permittedTransition(actor: TransitionActor, task: TransitionSubject, target: StoredTaskState): Transition | null {
  for (const [name, rule] of Object.entries(TRANSITIONS) as [Transition, TransitionRule][]) {
    if (rule.from === task.status && rule.to === target && mayAct(rule, actor, task)) return name;
  }
  return null;
}
