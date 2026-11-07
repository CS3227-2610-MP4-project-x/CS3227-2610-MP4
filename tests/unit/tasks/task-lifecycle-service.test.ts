import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.3 (tasks-lifecycle-4-3). Service-level unit tests for the task lifecycle in the
// `@/server/tasks` public entry (design.md Q2: the lifecycle lives in src/server/tasks/).
// Requirements by name (no formal IDs): task-management "Task lifecycle", "Task state route",
// "Task completion requires product-manager approval", "Submission records attached commits and
// a matching check", "Lifecycle changes are recorded as task events" and "Developer submits task
// progress". Decisions: design.md "Task Lifecycle Decisions (4.3)" L1 to L6.
//
// Seam assumed by this file (reported in the 4.3 handoff for the implementer to match):
//   new TaskLifecycleService(repository: TaskRepository, tips: { findSubmissionTip(projectId, taskId) })
//   startTask(projectId, taskId, actorPersonId, version)          -> Promise<TaskView>
//   submitTask(projectId, taskId, actorPersonId, version)         -> Promise<TaskView>
//   approveTask(projectId, taskId, actorPersonId, version)        -> Promise<TaskView>
//   requestChanges(projectId, taskId, actorPersonId, { version, feedback }) -> Promise<TaskView>
//   postProgressUpdate(projectId, taskId, actorPersonId, body)    -> Promise<ProgressUpdateView>
// Refusals reject with TaskError codes FORBIDDEN, NOT_FOUND or VERSION_CONFLICT. One named method
// per transition, with no flag that selects the branch (L3, AGENTS.md control coupling).
//
// TaskRepository runs against the shared in-memory fake (tests/unit/support/sql-fake.ts), which
// does not model attached_commits or check_results; the tip port here resolves `null` or fails,
// and the matching-check paths are covered by tests/integration/db/task-lifecycle.test.ts.
// All values are synthetic.

vi.mock("server-only", () => ({}));

import { TaskError, TaskLifecycleService, TaskRepository } from "@/server/tasks";

import { FakeDatabase, PRIVATE_DETAIL, type TaskRow } from "../support/sql-fake";

const projectId = "33333333-3333-4333-8333-333333333333";
const people = {
  pm: { id: "22222222-2222-4222-8222-222222222201", auth_user_id: "11111111-1111-4111-8111-111111111101", github_user_id: "1001", github_username: "synthetic-pm" },
  dev: { id: "22222222-2222-4222-8222-222222222202", auth_user_id: "11111111-1111-4111-8111-111111111102", github_user_id: "1002", github_username: "Synthetic-Dev" },
  dev2: { id: "22222222-2222-4222-8222-222222222203", auth_user_id: "11111111-1111-4111-8111-111111111103", github_user_id: "1003", github_username: "Synthetic-Dev2" },
} as const;
const STORED_TIME = "2026-11-01T02:03:04.000Z";

type TipPort = ConstructorParameters<typeof TaskLifecycleService>[1];

let fake: FakeDatabase;
let service: TaskLifecycleService;
let findSubmissionTip: ReturnType<typeof vi.fn>;
let tipCallOpenTransactions: number[];

function openTransactions(): number {
  return fake.log.reduce((open, entry) =>
    entry.kind === "begin" ? open + 1 : entry.kind === "commit" || entry.kind === "rollback" ? open - 1 : open, 0);
}

beforeEach(() => {
  fake = new FakeDatabase();
  fake.state.people.push(...Object.values(people).map((entry) => ({ ...entry })));
  fake.state.projects.push({ id: projectId, key: "WEB", name: "Synthetic web project", last_task_number: 0, version: 1 });
  fake.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: people.pm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev.id, role: "developer", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev2.id, role: "developer", version: 1 },
  );
  tipCallOpenTransactions = [];
  findSubmissionTip = vi.fn(async () => {
    tipCallOpenTransactions.push(openTransactions());
    return null;
  });
  service = new TaskLifecycleService(
    new TaskRepository({ query: fake.query, connect: fake.connect } as unknown as ConstructorParameters<typeof TaskRepository>[0]),
    { findSubmissionTip } as unknown as TipPort,
  );
});

function addTask(status = "to_do", options: { version?: number; deleted?: boolean; assigneeId?: string } = {}): TaskRow {
  const project = fake.state.projects[0];
  project.last_task_number += 1;
  const task: TaskRow = {
    id: randomUUID(), project_id: projectId, number: project.last_task_number, title: "Stored task", description: "Stored description",
    assignee_id: options.assigneeId ?? people.dev.id, due_date: "2026-11-30", status, branch_name: null,
    deleted_at: options.deleted ? STORED_TIME : null, version: options.version ?? 1, created_at: STORED_TIME, updated_at: STORED_TIME,
  };
  fake.state.tasks.push(task);
  fake.state.acceptance_criteria.push({
    id: randomUUID(), task_id: task.id, position: 1, description: "Stored criterion", version: 1, created_at: STORED_TIME, updated_at: STORED_TIME,
  });
  return task;
}

function stored(id: string): TaskRow {
  return fake.state.tasks.find((task) => task.id === id)!;
}

function eventsOf(taskId: string) {
  return fake.state.task_events.filter((event) => event.task_id === taskId);
}

async function codeOf(operation: Promise<unknown>): Promise<string | undefined> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(TaskError);
  return (error as TaskError).code;
}

describe("TaskLifecycleService named transitions (L3, L6, L7)", () => {
  it("startTask moves To Do to In Progress, returns the task view and records one state_change event", async () => {
    const task = addTask();
    const view = await service.startTask(projectId, task.id, people.dev.id, 1);
    expect(view).toMatchObject({ id: task.id, taskKey: "WEB-1", state: "In Progress", version: 2, assignee: { personId: people.dev.id } });
    expect(stored(task.id)).toMatchObject({ status: "in_progress", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      actor_id: people.dev.id, event_type: "state_change", from_status: "to_do", to_status: "in_progress", feedback: null, check_result_id: null,
    })]);
    expect(fake.connected).toBe(fake.released);
  });

  it("submitTask moves In Progress to In Review and records one submission event without a check reference", async () => {
    const task = addTask("in_progress");
    const view = await service.submitTask(projectId, task.id, people.dev.id, 1);
    expect(view).toMatchObject({ state: "In Review", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      actor_id: people.dev.id, event_type: "submission", from_status: "in_progress", to_status: "in_review", check_result_id: null,
    })]);
  });

  it("approveTask moves In Review to Done and records one state_change event by the product manager", async () => {
    const task = addTask("in_review");
    const view = await service.approveTask(projectId, task.id, people.pm.id, 1);
    expect(view).toMatchObject({ state: "Done", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      actor_id: people.pm.id, event_type: "state_change", from_status: "in_review", to_status: "done",
    })]);
  });

  it("requestChanges moves In Review to In Progress and records one review_feedback event with the feedback", async () => {
    const task = addTask("in_review");
    const view = await service.requestChanges(projectId, task.id, people.pm.id, { version: 1, feedback: "Add the missing tests" });
    expect(view).toMatchObject({ state: "In Progress", version: 2 });
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({
      actor_id: people.pm.id, event_type: "review_feedback", from_status: "in_review", to_status: "in_progress", feedback: "Add the missing tests",
    })]);
  });
});

describe("TaskLifecycleService permissions under the transaction (L2, R4 pattern)", () => {
  it.each([
    ["an unassigned developer starting", () => service.startTask(projectId, addTask().id, people.dev2.id, 1)],
    ["the product manager starting", () => service.startTask(projectId, addTask().id, people.pm.id, 1)],
    ["the assigned developer starting a task in review", () => service.startTask(projectId, addTask("in_review").id, people.dev.id, 1)],
    ["an unassigned developer submitting", () => service.submitTask(projectId, addTask("in_progress").id, people.dev2.id, 1)],
    ["the product manager submitting", () => service.submitTask(projectId, addTask("in_progress").id, people.pm.id, 1)],
    ["the assigned developer submitting a To Do task", () => service.submitTask(projectId, addTask().id, people.dev.id, 1)],
    ["the assigned developer approving", () => service.approveTask(projectId, addTask("in_review").id, people.dev.id, 1)],
    ["the product manager approving a task in progress", () => service.approveTask(projectId, addTask("in_progress").id, people.pm.id, 1)],
    ["the product manager approving a Done task", () => service.approveTask(projectId, addTask("done").id, people.pm.id, 1)],
    ["the assigned developer requesting changes", () => service.requestChanges(projectId, addTask("in_review").id, people.dev.id, { version: 1, feedback: "x" })],
    ["the product manager requesting changes on a Done task", () => service.requestChanges(projectId, addTask("done").id, people.pm.id, { version: 1, feedback: "x" })],
  ])("refuses %s with FORBIDDEN and writes nothing", async (_case, operation) => {
    const result = operation();
    const before = JSON.stringify(fake.state.task_events);
    expect(await codeOf(result)).toBe("FORBIDDEN");
    expect(JSON.stringify(fake.state.task_events)).toBe(before);
    expect(fake.state.tasks.every((task) => task.version === 1)).toBe(true);
    expect(fake.connected).toBe(fake.released);
  });

  it.each([
    ["a deleted task", () => addTask("to_do", { deleted: true }).id],
    ["a missing task", () => "99999999-9999-4999-8999-999999999999"],
  ])("conceals %s with NOT_FOUND", async (_case, taskId) => {
    expect(await codeOf(service.startTask(projectId, taskId(), people.dev.id, 1))).toBe("NOT_FOUND");
    expect(fake.state.task_events).toEqual([]);
  });
});

describe("TaskLifecycleService version guard (L1)", () => {
  it("refuses a stale version on a permitted transition with VERSION_CONFLICT and writes nothing", async () => {
    const task = addTask("in_review", { version: 3 });
    expect(await codeOf(service.approveTask(projectId, task.id, people.pm.id, 2))).toBe("VERSION_CONFLICT");
    expect(stored(task.id)).toMatchObject({ status: "in_review", version: 3 });
    expect(fake.state.task_events).toEqual([]);
  });

  it("refuses a transition whose task changed after it was read: another transition committed first (Competing transitions)", async () => {
    const task = addTask();
    fake.beforeStatement = ({ sql, kind, tables }) => {
      const lock = kind === "select" && tables.includes("tasks") && /\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+share\b/i.test(sql);
      if (lock || (kind === "update" && tables.includes("tasks"))) {
        fake.beforeStatement = undefined;
        fake.applyCommitted((state) => {
          const row = state.tasks.find((entry) => entry.id === task.id)!;
          row.status = "in_progress";
          row.version = 2;
        });
      }
    };
    expect(await codeOf(service.startTask(projectId, task.id, people.dev.id, 1))).toBe("VERSION_CONFLICT");
    expect(stored(task.id)).toMatchObject({ status: "in_progress", version: 2 });
    expect(fake.state.task_events).toEqual([]);
  });

  it("rolls back the task update when the event insert fails (one transaction)", async () => {
    const task = addTask();
    fake.failWhen = ({ kind, tables }) => kind === "insert" && tables.includes("task_events") ? new Error(PRIVATE_DETAIL) : undefined;
    await expect(service.startTask(projectId, task.id, people.dev.id, 1)).rejects.toBeDefined();
    expect(stored(task.id)).toMatchObject({ status: "to_do", version: 1 });
    expect(fake.state.task_events).toEqual([]);
    expect(fake.connected).toBe(fake.released);
  });
});

describe("TaskLifecycleService submission tip lookup (L5)", () => {
  it("calls the tip port once with the project and task before any transaction is open", async () => {
    const task = addTask("in_progress");
    await service.submitTask(projectId, task.id, people.dev.id, 1);
    expect(findSubmissionTip).toHaveBeenCalledTimes(1);
    expect(findSubmissionTip.mock.calls[0].slice(0, 2)).toEqual([projectId, task.id]);
    expect(tipCallOpenTransactions).toEqual([0]);
  });

  it("stores the submission without a check reference when the tip port fails", async () => {
    const task = addTask("in_progress");
    findSubmissionTip.mockRejectedValue(new Error(PRIVATE_DETAIL));
    const view = await service.submitTask(projectId, task.id, people.dev.id, 1);
    expect(view.state).toBe("In Review");
    expect(eventsOf(task.id)).toEqual([expect.objectContaining({ event_type: "submission", check_result_id: null })]);
  });

  it("does not call the tip port for start, approve or request changes", async () => {
    await service.startTask(projectId, addTask().id, people.dev.id, 1);
    await service.approveTask(projectId, addTask("in_review").id, people.pm.id, 1);
    await service.requestChanges(projectId, addTask("in_review").id, people.pm.id, { version: 1, feedback: "x" });
    expect(findSubmissionTip).not.toHaveBeenCalled();
  });
});

describe("TaskLifecycleService.postProgressUpdate (L4)", () => {
  it("stores the update and returns it in the task-detail progressUpdates shape, leaving the task unchanged", async () => {
    const task = addTask("in_review", { version: 5 });
    const view = await service.postProgressUpdate(projectId, task.id, people.dev.id, "Synthetic progress");
    expect(view).toEqual({
      id: expect.any(String),
      author: { id: people.dev.id, githubUsername: "Synthetic-Dev" },
      body: "Synthetic progress",
      createdAt: expect.stringMatching(/Z$/),
    });
    expect(fake.state.progress_updates).toEqual([expect.objectContaining({ id: view.id, task_id: task.id, author_id: people.dev.id, body: "Synthetic progress" })]);
    expect(stored(task.id)).toMatchObject({ status: "in_review", version: 5 });
    expect(fake.state.task_events).toEqual([]);
  });

  it.each([
    ["the product manager", people.pm.id],
    ["an unassigned developer", people.dev2.id],
  ])("refuses %s with FORBIDDEN and stores nothing", async (_case, actor) => {
    const task = addTask();
    expect(await codeOf(service.postProgressUpdate(projectId, task.id, actor, "x"))).toBe("FORBIDDEN");
    expect(fake.state.progress_updates).toEqual([]);
  });

  it("refuses with FORBIDDEN when a reassignment commits before the task row is locked (Update racing with reassignment)", async () => {
    const task = addTask();
    fake.beforeStatement = ({ sql, kind, tables }) => {
      const lock = kind === "select" && tables.includes("tasks") && /\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+share\b/i.test(sql);
      if (lock || (kind === "insert" && tables.includes("progress_updates"))) {
        fake.beforeStatement = undefined;
        fake.applyCommitted((state) => {
          const row = state.tasks.find((entry) => entry.id === task.id)!;
          row.assignee_id = people.dev2.id;
          row.version = 2;
        });
      }
    };
    expect(await codeOf(service.postProgressUpdate(projectId, task.id, people.dev.id, "x"))).toBe("FORBIDDEN");
    expect(fake.state.progress_updates).toEqual([]);
    expect(fake.connected).toBe(fake.released);
  });

  it("conceals a deleted task with NOT_FOUND", async () => {
    const task = addTask("to_do", { deleted: true });
    expect(await codeOf(service.postProgressUpdate(projectId, task.id, people.dev.id, "x"))).toBe("NOT_FOUND");
    expect(fake.state.progress_updates).toEqual([]);
  });
});
