import "server-only";

import { TASK_STATE_NAMES, type TaskState } from "@/server/tasks";

/**
 * The state name for a stored task status, through the tasks module's one mapping (design.md
 * "Duplicate state-name map"). Stored statuses are database-constrained, so an unknown value is a
 * programming error, not user input.
 */
export function taskStateName(status: string): TaskState {
  if (!Object.hasOwn(TASK_STATE_NAMES, status)) throw new Error("Unknown task status.");
  return TASK_STATE_NAMES[status as keyof typeof TASK_STATE_NAMES];
}
