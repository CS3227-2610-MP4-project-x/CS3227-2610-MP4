import "server-only";

// Task board read module public entry (design.md "Board, Detail and Review Queue Decisions (4.4)" B6).
export { TaskBoardRepository } from "./repository";
export type { BoardTaskRecord } from "./repository";
export { TaskBoardService } from "./service";
export { taskStateName } from "./states";
export type { BoardCard, BoardColumn, TaskBoardAccess, TaskBoardView } from "./service";
