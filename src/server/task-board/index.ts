import "server-only";

// Task board read module public entry (design.md "Board, Detail and Review Queue Decisions (4.4)" B6).
export { TaskBoardRepository } from "./repository";
export type { BoardTaskRecord, DashboardTaskRecord } from "./repository";
export { TaskBoardService } from "./service";
export { taskStateName } from "./states";
export type { BoardCard, BoardColumn, DashboardTaskCard, TaskBoardAccess, TaskBoardView } from "./service";
