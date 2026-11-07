import "server-only";

import { TaskError } from "./errors";
import type { LockedTask, TaskRecord, TaskRepository, TaskTransaction } from "./repository";
import type {
  CreateTaskInput,
  CriterionInput,
  CriterionView,
  EditTaskInput,
  ProjectRole,
  ReassignTaskInput,
  StoredTaskState,
  TaskState,
  TaskView,
} from "./types";

const STATE_NAMES: Readonly<Record<StoredTaskState, TaskState>> = {
  to_do: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

function toView(record: TaskRecord): TaskView {
  return {
    id: record.id,
    taskKey: `${record.projectKey}-${record.number}`,
    title: record.title,
    description: record.description,
    assignee: { personId: record.assigneeId, githubUsername: record.assigneeGitHubUsername },
    dueDate: record.dueDate,
    branchName: record.branchName,
    state: STATE_NAMES[record.status],
    acceptanceCriteria: record.criteria,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Missing membership conceals the project (R4); a developer is refused (design.md T8). */
function requireProductManager(role: ProjectRole | undefined): void {
  if (!role) throw new TaskError("NOT_FOUND");
  if (role !== "product_manager") throw new TaskError("FORBIDDEN");
}

/** A task must keep at least one acceptance criterion (task-management, design.md T7). */
function requireCriteria(count: number): void {
  if (count === 0) throw new TaskError("ACCEPTANCE_CRITERIA_REQUIRED");
}

/**
 * Share-locks the actor's and the other people's memberships in one statement, in person-ID
 * order (U3), then requires the actor to be the project's product manager (R4, R5). Returns
 * the locked roles. Every task write starts here, so the lock order and the role rule live in
 * one place.
 */
async function lockRolesAsManager(
  transaction: TaskTransaction,
  projectId: string,
  actorPersonId: string,
  otherPersonIds: readonly string[],
): Promise<ReadonlyMap<string, ProjectRole>> {
  const roles = await transaction.lockRoles(projectId, [...new Set([actorPersonId, ...otherPersonIds])]);
  requireProductManager(roles.get(actorPersonId));
  return roles;
}

/** Locks the actor's membership and the live task, then checks role, existence and version. */
async function lockForWrite(
  transaction: TaskTransaction,
  projectId: string,
  taskId: string,
  actorPersonId: string,
  expectedVersion: number,
  otherPersonIds: readonly string[] = [],
): Promise<{ task: LockedTask; roles: ReadonlyMap<string, ProjectRole> }> {
  const roles = await lockRolesAsManager(transaction, projectId, actorPersonId, otherPersonIds);
  const task = await transaction.lockTask(projectId, taskId);
  if (!task) throw new TaskError("NOT_FOUND");
  if (task.version !== expectedVersion) throw new TaskError("VERSION_CONFLICT");
  return { task, roles };
}

/**
 * Applies an edited criteria list (design.md T4): items with a current `id` keep it, items
 * without one are inserted, current criteria left out are deleted. Positions follow the order.
 */
async function replaceCriteria(
  transaction: TaskTransaction,
  taskId: string,
  current: readonly CriterionView[],
  next: readonly CriterionInput[],
): Promise<void> {
  const kept = new Set(next.flatMap((criterion) => criterion.id === undefined ? [] : [criterion.id]));
  for (const criterion of current) {
    if (!kept.has(criterion.id)) await transaction.deleteCriterion(taskId, criterion.id);
  }
  const byId = new Map(current.map((criterion) => [criterion.id, criterion]));
  for (const [index, criterion] of next.entries()) {
    const position = index + 1;
    const existing = criterion.id === undefined ? undefined : byId.get(criterion.id);
    if (!existing) await transaction.insertCriterion(taskId, position, criterion.description);
    else if (existing.position !== position || existing.description !== criterion.description) {
      await transaction.updateCriterion(taskId, { id: existing.id, position, description: criterion.description });
    }
  }
}

/** Task create, read, edit, reassign and soft delete (task-management "Product manager manages tasks"). */
export class TaskService {
  constructor(private readonly tasks: TaskRepository) {}

  /**
   * Creates a To Do task with the project's next task number, its criteria, in one transaction
   * (design.md T13). The number is allocated only after every check passes.
   */
  async createTask(projectId: string, actorPersonId: string, input: CreateTaskInput): Promise<TaskView> {
    requireCriteria(input.acceptanceCriteria.length);
    return this.tasks.transaction(async (transaction) => {
      const roles = await lockRolesAsManager(transaction, projectId, actorPersonId, [input.assigneeId]);
      if (roles.get(input.assigneeId) !== "developer") throw new TaskError("ASSIGNEE_NOT_DEVELOPER");
      const number = await transaction.allocateTaskNumber(projectId);
      const taskId = await transaction.insertTask(projectId, number, input);
      for (const [index, description] of input.acceptanceCriteria.entries()) {
        await transaction.insertCriterion(taskId, index + 1, description);
      }
      return toView(await requireRecord(transaction, projectId, taskId));
    });
  }

  /** Any member reads a live task of the project; the handler has checked membership. */
  async getTask(projectId: string, taskId: string): Promise<TaskView> {
    const record = await this.tasks.findTask(projectId, taskId);
    if (!record) throw new TaskError("NOT_FOUND");
    return toView(record);
  }

  /** Edits the sent fields and criteria under the version guard (design.md T4, T6). */
  async editTask(projectId: string, taskId: string, actorPersonId: string, input: EditTaskInput): Promise<TaskView> {
    if (input.acceptanceCriteria) requireCriteria(input.acceptanceCriteria.length);
    return this.tasks.transaction(async (transaction) => {
      await lockForWrite(transaction, projectId, taskId, actorPersonId, input.version);
      const current = input.acceptanceCriteria ? await transaction.listCriteria(taskId) : [];
      if (input.acceptanceCriteria) {
        const currentIds = new Set(current.map((criterion) => criterion.id));
        if (input.acceptanceCriteria.some((criterion) => criterion.id !== undefined && !currentIds.has(criterion.id))) {
          throw new TaskError("INVALID_REQUEST");
        }
      }
      if (!await transaction.updateTaskFields(taskId, input.version, input)) throw new TaskError("VERSION_CONFLICT");
      if (input.acceptanceCriteria) await replaceCriteria(transaction, taskId, current, input.acceptanceCriteria);
      return toView(await requireRecord(transaction, projectId, taskId));
    });
  }

  /**
   * Moves the task to another developer, keeps its state, and records one assignment change
   * (design.md T9). The current assignee is a no-op without a write.
   */
  async reassignTask(projectId: string, taskId: string, actorPersonId: string, input: ReassignTaskInput): Promise<TaskView> {
    return this.tasks.transaction(async (transaction) => {
      const { task, roles } = await lockForWrite(transaction, projectId, taskId, actorPersonId, input.version, [input.assigneeId]);
      if (task.assigneeId !== input.assigneeId) {
        if (roles.get(input.assigneeId) !== "developer") throw new TaskError("ASSIGNEE_NOT_DEVELOPER");
        if (!await transaction.updateAssignee(taskId, input.version, input.assigneeId)) throw new TaskError("VERSION_CONFLICT");
        await transaction.insertAssignmentChange(taskId, actorPersonId, task.assigneeId, input.assigneeId);
      }
      return toView(await requireRecord(transaction, projectId, taskId));
    });
  }

  /** Soft-deletes the task under the version guard (design.md D-E, T6, T12). */
  async deleteTask(projectId: string, taskId: string, actorPersonId: string, expectedVersion: number): Promise<void> {
    await this.tasks.transaction(async (transaction) => {
      await lockForWrite(transaction, projectId, taskId, actorPersonId, expectedVersion);
      if (!await transaction.markDeleted(taskId, expectedVersion)) throw new TaskError("VERSION_CONFLICT");
    });
  }
}

async function requireRecord(transaction: TaskTransaction, projectId: string, taskId: string): Promise<TaskRecord> {
  const record = await transaction.findTask(projectId, taskId);
  if (!record) throw new Error("Task disappeared during its own transaction.");
  return record;
}
