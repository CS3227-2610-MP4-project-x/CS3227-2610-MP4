import "server-only";

import { TaskError } from "./errors";
import type { LockedTask, TaskRepository, TaskTransaction } from "./repository";
import { permittedTransition, TRANSITIONS, type Transition } from "./states";
import type { ProgressUpdateView, RequestChangesInput, SubmissionTip, SubmissionTipPort, TaskView } from "./types";
import { readWrittenTask } from "./view";

/** Writes the event of a transition that has just been applied, in the same transaction (L6). */
type RecordEvent = (transaction: TaskTransaction, task: LockedTask) => Promise<void>;

/**
 * Locks the actor's membership, then the live task (design.md U3 lock order), and checks, in
 * order: membership and task (404), version (409), then the 403 matrix on the locked state
 * (design.md L1, L2). A request that raced another write therefore gets 409.
 */
async function lockForTransition(
  transaction: TaskTransaction,
  projectId: string,
  taskId: string,
  actorPersonId: string,
  expectedVersion: number,
  transition: Transition,
): Promise<LockedTask> {
  const roles = await transaction.lockRoles(projectId, [actorPersonId]);
  const role = roles.get(actorPersonId);
  if (!role) throw new TaskError("NOT_FOUND");
  const task = await transaction.lockTask(projectId, taskId);
  if (!task) throw new TaskError("NOT_FOUND");
  if (task.version !== expectedVersion) throw new TaskError("VERSION_CONFLICT");
  const target = TRANSITIONS[transition].to;
  if (permittedTransition({ personId: actorPersonId, role }, task, target) !== transition) throw new TaskError("FORBIDDEN");
  return task;
}

/** True when the task's attached commits and criteria are those the tip was resolved from (L5). */
async function submissionInputsUnchanged(transaction: TaskTransaction, taskId: string, tip: SubmissionTip): Promise<boolean> {
  const commits = new Set(await transaction.listAttachedCommitShas(taskId));
  const tipCommits = new Set(tip.commitShas);
  if (commits.size !== tipCommits.size || [...tipCommits].some((sha) => !commits.has(sha))) return false;
  const criteria = await transaction.listCriteria(taskId);
  if (criteria.length !== tip.criteria.length) return false;
  const current = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  return tip.criteria.every((criterion) => {
    const stored = current.get(criterion.id);
    return stored !== undefined && stored.description === criterion.description && stored.position === criterion.position;
  });
}

/** The stored check the submission references, or null (task-management "Submission rechecks its inputs"). */
async function matchingCheck(transaction: TaskTransaction, taskId: string, tip: SubmissionTip | null): Promise<string | null> {
  if (!tip || !await submissionInputsUnchanged(transaction, taskId, tip)) return null;
  return transaction.findMatchingCheck(taskId, tip.anchorSha, tip.criteriaHash);
}

/**
 * The task lifecycle and progress updates (task-management "Task lifecycle", "Task completion
 * requires product-manager approval", "Developer submits task progress"; design.md L1 to L6).
 * Each transition has its own method; none takes a flag that selects the branch (L3).
 */
export class TaskLifecycleService {
  constructor(private readonly tasks: TaskRepository, private readonly tips: SubmissionTipPort) {}

  /** The assigned developer moves To Do to In Progress. */
  async startTask(projectId: string, taskId: string, actorPersonId: string, version: number): Promise<TaskView> {
    return this.apply(projectId, taskId, actorPersonId, version, "start", (transaction, task) =>
      transaction.insertStateChange(taskId, actorPersonId, task.status, TRANSITIONS.start.to));
  }

  /**
   * The assigned developer moves In Progress to In Review. The commit tip is looked up first,
   * with no transaction open (L5); any failure there submits without a check reference.
   */
  async submitTask(projectId: string, taskId: string, actorPersonId: string, version: number): Promise<TaskView> {
    const tip = await this.lookUpTip(projectId, taskId);
    return this.apply(projectId, taskId, actorPersonId, version, "submit", async (transaction, task) =>
      transaction.insertSubmission(taskId, actorPersonId, task.status, TRANSITIONS.submit.to, await matchingCheck(transaction, taskId, tip)));
  }

  /** The product manager moves In Review to Done. */
  async approveTask(projectId: string, taskId: string, actorPersonId: string, version: number): Promise<TaskView> {
    return this.apply(projectId, taskId, actorPersonId, version, "approve", (transaction, task) =>
      transaction.insertStateChange(taskId, actorPersonId, task.status, TRANSITIONS.approve.to));
  }

  /** The product manager returns In Review to In Progress with trimmed feedback (L3). */
  async requestChanges(projectId: string, taskId: string, actorPersonId: string, input: RequestChangesInput): Promise<TaskView> {
    return this.apply(projectId, taskId, actorPersonId, input.version, "requestChanges", (transaction, task) =>
      transaction.insertReviewFeedback(taskId, actorPersonId, task.status, TRANSITIONS.requestChanges.to, input.feedback));
  }

  /**
   * The assigned developer posts a progress update (L4). The task row is locked so that a
   * concurrent reassignment cannot be overtaken, and the assignee is checked under that lock.
   * The task itself is not changed.
   */
  async postProgressUpdate(projectId: string, taskId: string, actorPersonId: string, body: string): Promise<ProgressUpdateView> {
    return this.tasks.transaction(async (transaction) => {
      const roles = await transaction.lockRoles(projectId, [actorPersonId]);
      const role = roles.get(actorPersonId);
      if (!role) throw new TaskError("NOT_FOUND");
      const task = await transaction.lockTask(projectId, taskId);
      if (!task) throw new TaskError("NOT_FOUND");
      if (role !== "developer" || task.assigneeId !== actorPersonId) throw new TaskError("FORBIDDEN");
      return transaction.insertProgressUpdate(taskId, actorPersonId, body);
    });
  }

  /** Evidence that is unavailable for any reason means no tip (task-management "Evidence is unavailable at submission"). */
  private async lookUpTip(projectId: string, taskId: string): Promise<SubmissionTip | null> {
    try {
      return await this.tips.findSubmissionTip(projectId, taskId);
    } catch {
      return null;
    }
  }

  /** Applies one transition: the guarded task update and its one event, in one transaction (L1, L6). */
  private async apply(
    projectId: string,
    taskId: string,
    actorPersonId: string,
    version: number,
    transition: Transition,
    recordEvent: RecordEvent,
  ): Promise<TaskView> {
    return this.tasks.transaction(async (transaction) => {
      const task = await lockForTransition(transaction, projectId, taskId, actorPersonId, version, transition);
      if (!await transaction.updateStatus(taskId, version, TRANSITIONS[transition].to)) throw new TaskError("VERSION_CONFLICT");
      await recordEvent(transaction, task);
      return readWrittenTask(transaction, projectId, taskId);
    });
  }
}
