import "server-only";

import type { ProjectRole } from "@/server/repositories/project-access-repository";
import type { TaskState } from "@/server/tasks";
import type { BoardTaskRecord, DashboardTaskRecord } from "./repository";
import { taskStateName } from "./states";

export type TaskBoardAccess = Readonly<{ personId: string; role: ProjectRole }>;

/** One board card: exactly the fields the card shows plus the `id` and `version` actions need. */
export type BoardCard = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  assignee: Readonly<{ id: string; githubUsername: string }>;
  dueDate: string;
  state: TaskState;
  version: number;
}>;

export type BoardColumn = Readonly<{ state: TaskState; cards: readonly BoardCard[] }>;
export type TaskBoardView = Readonly<{ columns: readonly BoardColumn[] }>;
export type DashboardTaskCard = BoardCard & Readonly<{
  description: string;
  branchName: string | null;
  progressUpdateCount: number;
  attachedCommitCount: number;
}>;

type BoardReads = Readonly<{
  listProjectTasks(projectId: string): Promise<readonly BoardTaskRecord[]>;
  listAssignedTasks(projectId: string, assigneeId: string): Promise<readonly BoardTaskRecord[]>;
  listAssignedDashboardTasks(projectId: string, assigneeId: string): Promise<readonly DashboardTaskRecord[]>;
}>;

const COLUMN_ORDER: readonly TaskState[] = ["To Do", "In Progress", "In Review", "Done"];

function card(record: BoardTaskRecord): BoardCard {
  return {
    id: record.id,
    taskKey: record.taskKey,
    title: record.title,
    assignee: { id: record.assignee.id, githubUsername: record.assignee.githubUsername },
    dueDate: record.dueDate,
    state: taskStateName(record.status),
    version: record.version,
  };
}

function dashboardCard(record: DashboardTaskRecord): DashboardTaskCard {
  return {
    ...card(record),
    description: record.description,
    branchName: record.branchName,
    progressUpdateCount: record.progressUpdateCount,
    attachedCommitCount: record.attachedCommitCount,
  };
}

/**
 * The task board read (design.md B2, B6, B7). The caller has already checked membership with
 * the page-access helper; this service scopes the tasks by role.
 */
export class TaskBoardService {
  constructor(private readonly repository: BoardReads) {}

  async getBoard(projectId: string, access: TaskBoardAccess): Promise<TaskBoardView> {
    const records = access.role === "product_manager"
      ? await this.repository.listProjectTasks(projectId)
      : (await this.repository.listAssignedTasks(projectId, access.personId))
        // A developer never receives another developer's task, even after a concurrent reassignment.
        .filter((record) => record.assignee.id === access.personId);
    const cards = records.map(card);
    return {
      columns: COLUMN_ORDER.map((state) => ({ state, cards: cards.filter((item) => item.state === state) })),
    };
  }

  /** A developer's dashboard projection. Recheck the assignment before exposing task text. */
  async getDashboardTasks(projectId: string, access: TaskBoardAccess): Promise<readonly DashboardTaskCard[]> {
    if (access.role !== "developer") return [];
    const records = await this.repository.listAssignedDashboardTasks(projectId, access.personId);
    return records
      .filter((record) => record.assignee.id === access.personId)
      .map(dashboardCard);
  }
}
