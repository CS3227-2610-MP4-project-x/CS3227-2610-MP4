import "server-only";

// Tasks module public entry (design.md T16; task 4.3 adds the lifecycle, design.md L1 to L7).
export { TaskError, taskErrorResponse } from "./errors";
export {
  handleProgressUpdateCreate,
  handleTaskCreate,
  handleTaskDelete,
  handleTaskEdit,
  handleTaskRead,
  handleTaskReassign,
  handleTaskStateChange,
} from "./handlers";
export { TaskLifecycleService } from "./lifecycle-service";
export { TaskRepository } from "./repository";
export { TaskService } from "./service";
export { TASK_STATE_NAMES } from "./states";
export type {
  CreateTaskInput,
  CriterionInput,
  EditTaskInput,
  ProgressUpdateView,
  ReassignTaskInput,
  RequestChangesInput,
  StateChangeInput,
  SubmissionTip,
  SubmissionTipPort,
  TaskState,
  TaskView,
} from "./types";
export {
  parseCreateTaskBody,
  parseDeleteTaskBody,
  parseEditTaskBody,
  parseProgressUpdateBody,
  parseReassignTaskBody,
  parseStateChangeBody,
} from "./validation";
