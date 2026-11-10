import type { TaskState } from "@/server/tasks";

// design.md B8: the assigned developer's own board moves, the single source for both the board
// page (which cards get a menu) and BoardStatusMenu (what the menu offers). Every other state has
// no developer move; the server still decides every transition (L2).
export type DeveloperBoardMove = Readonly<{
  state: "In Progress" | "In Review";
  label: string;
  announcement: (taskKey: string) => string;
}>;

const DEVELOPER_BOARD_MOVES: Readonly<Partial<Record<TaskState, DeveloperBoardMove>>> = {
  "To Do": { state: "In Progress", label: "Move to In Progress", announcement: (taskKey) => `Moved ${taskKey} to In Progress` },
  "In Progress": { state: "In Review", label: "Submit for review", announcement: (taskKey) => `Submitted ${taskKey} for review` },
};

/** The developer's permitted move from `state`, or undefined when there is none. */
export function developerBoardMove(state: TaskState): DeveloperBoardMove | undefined {
  return Object.hasOwn(DEVELOPER_BOARD_MOVES, state) ? DEVELOPER_BOARD_MOVES[state] : undefined;
}
