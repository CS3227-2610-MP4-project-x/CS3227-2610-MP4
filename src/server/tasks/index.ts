import "server-only";

// Tasks module public entry (design.md T16).
export { TaskError, taskErrorResponse } from "./errors";
export { handleTaskCreate, handleTaskDelete, handleTaskEdit, handleTaskRead, handleTaskReassign } from "./handlers";
export { TaskRepository } from "./repository";
export { TaskService } from "./service";
export type { CreateTaskInput, CriterionInput, EditTaskInput, ReassignTaskInput, TaskState, TaskView } from "./types";
export { parseCreateTaskBody, parseDeleteTaskBody, parseEditTaskBody, parseReassignTaskBody } from "./validation";
