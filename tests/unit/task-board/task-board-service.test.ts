import { describe, expect, it, vi } from "vitest";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Project members read the task board" and "Board cards
// and board reads"; design.md "Board, Detail and Review Queue Decisions (4.4)" B2, B6, B7.
//
// Seam chosen by the test-writer (reported in the 4.4 handoff):
//   src/server/task-board/index.ts exports TaskBoardService, TaskBoardRepository and the types
//   TaskBoardView, BoardCard, BoardTaskRecord.
//   new TaskBoardService(repository) where repository has two named reads (no role flag):
//     listProjectTasks(projectId): Promise<readonly BoardTaskRecord[]>
//     listAssignedTasks(projectId, assigneeId): Promise<readonly BoardTaskRecord[]>
//   Both return non-deleted tasks already ordered by task number, then id (the SQL is covered by
//   tests/integration/db/board-and-review-reads.test.ts).
//   getBoard(projectId, { personId, role }): Promise<TaskBoardView>
//   TaskBoardView = { columns: [{ state, cards }] } with exactly the four columns in the order
//   To Do, In Progress, In Review, Done; each card is
//   { id, taskKey, title, assignee: { id, githubUsername }, dueDate, state, version }.
// The access argument comes from the page-access helper, which has already checked membership.

vi.mock("server-only", () => ({}));

import { TaskBoardService } from "@/server/task-board";

type Port = ConstructorParameters<typeof TaskBoardService>[0];
type Stored = "to_do" | "in_progress" | "in_review" | "done";

const projectId = "30000000-0000-4000-8000-000000000001";
const pm = { id: "30000000-0000-4000-8000-000000000002", githubUsername: "synthetic-pm" };
const devA = { id: "30000000-0000-4000-8000-000000000003", githubUsername: "synthetic-dev-alpha" };
const devB = { id: "30000000-0000-4000-8000-000000000004", githubUsername: "synthetic-dev-beta" };
const taskId = (n: number) => `30000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
const NAMES: Record<Stored, string> = { to_do: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done" };

function record(n: number, status: Stored, assignee: { id: string; githubUsername: string }) {
  return {
    id: taskId(n),
    taskKey: `WEB-${n}`,
    title: `Synthetic board task ${n}`,
    status,
    version: n + 10,
    assignee: { ...assignee },
    dueDate: "2026-11-30",
    // Synthetic private fields a careless mapper could spread into the card.
    projectId,
    deletedAt: null,
    authUserId: "synthetic-private-auth-id",
  };
}

function card(n: number, status: Stored, assignee: { id: string; githubUsername: string }) {
  return {
    id: taskId(n),
    taskKey: `WEB-${n}`,
    title: `Synthetic board task ${n}`,
    assignee: { ...assignee },
    dueDate: "2026-11-30",
    state: NAMES[status],
    version: n + 10,
  };
}

function port(records: ReturnType<typeof record>[]) {
  return {
    listProjectTasks: vi.fn(async () => records),
    listAssignedTasks: vi.fn(async () => records),
  };
}

function service(repository: ReturnType<typeof port>) {
  return new TaskBoardService(repository as unknown as Port);
}

describe("Project members read the task board", () => {
  it("gives the product manager every task, grouped into the four columns in order", async () => {
    const repository = port([
      record(1, "to_do", devA), record(2, "in_progress", devB), record(3, "to_do", devB),
      record(4, "in_review", devA), record(5, "done", devB),
    ]);

    const board = await service(repository).getBoard(projectId, { personId: pm.id, role: "product_manager" });

    expect(repository.listProjectTasks).toHaveBeenCalledWith(projectId);
    expect(repository.listAssignedTasks).not.toHaveBeenCalled();
    expect(board).toEqual({
      columns: [
        { state: "To Do", cards: [card(1, "to_do", devA), card(3, "to_do", devB)] },
        { state: "In Progress", cards: [card(2, "in_progress", devB)] },
        { state: "In Review", cards: [card(4, "in_review", devA)] },
        { state: "Done", cards: [card(5, "done", devB)] },
      ],
    });
  });

  it("reads only the developer's own tasks for a developer", async () => {
    const repository = port([record(1, "to_do", devA), record(4, "in_review", devA)]);

    const board = await service(repository).getBoard(projectId, { personId: devA.id, role: "developer" });

    expect(repository.listAssignedTasks).toHaveBeenCalledWith(projectId, devA.id);
    expect(repository.listProjectTasks).not.toHaveBeenCalled();
    expect(board.columns.flatMap((column) => column.cards).map((item) => item.taskKey)).toEqual(["WEB-1", "WEB-4"]);
  });

  it("sends a developer no other developer's task key, title or assignee", async () => {
    // A row assigned to someone else (for example after a concurrent reassignment) is dropped.
    const repository = port([record(1, "to_do", devA), record(2, "in_progress", devB)]);

    const board = await service(repository).getBoard(projectId, { personId: devA.id, role: "developer" });

    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain("WEB-2");
    expect(serialized).not.toContain("Synthetic board task 2");
    expect(serialized).not.toContain(devB.githubUsername);
    expect(serialized).not.toContain(devB.id);
  });

  it("keeps the repository's task-number order inside each column", async () => {
    const repository = port([record(2, "to_do", devA), record(7, "to_do", devB), record(11, "to_do", devA)]);

    const board = await service(repository).getBoard(projectId, { personId: pm.id, role: "product_manager" });

    expect(board.columns[0].cards.map((item) => item.taskKey)).toEqual(["WEB-2", "WEB-7", "WEB-11"]);
  });

  it("returns the four columns, empty, when there are no tasks", async () => {
    const board = await service(port([])).getBoard(projectId, { personId: pm.id, role: "product_manager" });

    expect(board).toEqual({
      columns: [
        { state: "To Do", cards: [] },
        { state: "In Progress", cards: [] },
        { state: "In Review", cards: [] },
        { state: "Done", cards: [] },
      ],
    });
  });
});

describe("Board cards and board reads", () => {
  it("places stored status in_review in the In Review column, labelled In Review", async () => {
    const board = await service(port([record(9, "in_review", devA)])).getBoard(projectId, { personId: pm.id, role: "product_manager" });

    const column = board.columns.find((item) => item.state === "In Review");
    expect(column?.cards).toHaveLength(1);
    expect(column?.cards[0].state).toBe("In Review");
    expect(JSON.stringify(board)).not.toContain("in_review");
  });

  it("carries each task's id and current version and no private field", async () => {
    const board = await service(port([record(3, "in_progress", devA)])).getBoard(projectId, { personId: devA.id, role: "developer" });

    const only = board.columns[1].cards[0];
    expect(only.id).toBe(taskId(3));
    expect(only.version).toBe(13);
    expect(Object.keys(only).sort()).toEqual(["assignee", "dueDate", "id", "state", "taskKey", "title", "version"]);
    expect(JSON.stringify(board)).not.toContain("synthetic-private-auth-id");
  });
});
