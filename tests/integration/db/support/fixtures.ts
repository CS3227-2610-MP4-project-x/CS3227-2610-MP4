/**
 * ASSUMED SCHEMA NAMES for the task 2.4 integration tests.
 *
 * The approved spec and design (openspec/changes/project-task-management/specs/
 * data-persistence/spec.md, design.md D-A to D-M) name the entities but not every table
 * or column. Every name the tests rely on is listed here and nowhere else, so the
 * implementer can match them (or the reviewer can flag a mismatch) in one place.
 *
 * Schema:  app
 * Roles:   app_runtime (created by a migration, no password); anon, authenticated and
 *          service_role (Supabase baseline roles, created NOLOGIN by the harness)
 *
 * Every table: id uuid PRIMARY KEY with a default (e.g. gen_random_uuid()).
 * Mutable tables (people, projects, memberships, tasks): version integer, starting at a
 *   default, and created_at / updated_at timestamptz with defaults.
 *
 * people            (auth_user_id UNIQUE, github_user_id UNIQUE, github_username)
 * projects          (key UNIQUE + CHECK, name, last_task_number integer NOT NULL DEFAULT 0,
 *                    github_token_key_version, github_token_iv, github_token_ciphertext,
 *                    github_token_auth_tag — all nullable until a repository is linked)
 * memberships       (project_id, person_id, role IN ('product_manager','developer'))
 * tasks             (project_id, number, title, description, assignee_id -> people.id,
 *                    due_date, status IN ('to_do','in_progress','in_review','done'),
 *                    deleted_at timestamptz NULL, branch_name NULL)
 * acceptance_criteria (task_id, position integer, description)
 * task_events       (task_id, actor_id -> people.id,
 *                    event_type IN ('state_change','submission','assignment_change','review_feedback'),
 *                    feedback text NULL, other columns nullable)
 * progress_updates  (task_id, author_id -> people.id, body)
 * attached_commits  (task_id, commit_sha, attached_by -> people.id)
 * check_results     (task_id, commit_set_hash, criteria_hash, model, redacted boolean,
 *                    result jsonb, created_at timestamptz)
 * reports           (project_id, range_start, range_end, model, latest_activity_at,
 *                    statements jsonb,
 *                    github_evidence_unavailable boolean NOT NULL DEFAULT false)
 * usage_records     (feature, project_id, person_id, environment, input_tokens, output_tokens,
 *                    reserved_tokens, latency_ms, outcome, cached boolean, created_at;
 *                    input/output tokens and latency_ms nullable or defaulted while pending)
 * usage_quota_days  (person_id, sgt_date date, UNIQUE (person_id, sgt_date))
 *
 * Child tables (acceptance_criteria, task_events, progress_updates, attached_commits,
 * check_results) MAY also carry project_id. If they do, the fixtures fill it in and the
 * tests require a mismatching project_id to be rejected; if they do not, the project is
 * derived through task_id. Either mechanism is accepted.
 *
 * Mechanism assumptions (behaviour is tested, not the mechanism):
 * - Task numbers: the caller increments projects.last_task_number in the task-creation
 *   transaction (UPDATE ... RETURNING) and inserts tasks.number explicitly (D-D).
 * - Task version: a BEFORE UPDATE trigger bumps `version` by exactly 1 on every update;
 *   callers only guard with `WHERE version = $n` (stale-writer test asserts this).
 *
 * Privileges ("Task 2.4 review decisions", design.md): app_runtime has SELECT, INSERT,
 * UPDATE and DELETE on every app table except tasks (no DELETE) and task_events
 * (SELECT and INSERT only). anon, authenticated and service_role have nothing in app.
 * - Only feature 'acceptance_criteria_check' and environment 'development' are inserted.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";

import type pg from "pg";

export const SCHEMA = "app";

export const ROLES = {
  runtime: "app_runtime",
  /** Supabase baseline roles that must have no privileges on schema app (D-J, review decisions). */
  withoutAppAccess: ["anon", "authenticated", "service_role"],
} as const;

export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

const READ_WRITE: readonly TablePrivilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/**
 * Exact table privileges of app_runtime ("Task 2.4 review decisions"): history is never
 * hard-deleted (no DELETE on tasks) and task events are append-only (SELECT, INSERT).
 */
export function runtimeTablePrivileges(table: string): readonly TablePrivilege[] {
  switch (table) {
    case ENTITY_TABLES.tasks:
      return ["SELECT", "INSERT", "UPDATE"];
    case ENTITY_TABLES.taskEvents:
      return ["SELECT", "INSERT"];
    default:
      return READ_WRITE;
  }
}

/** The eleven entity tables required by "Empty database is migrated". */
export const ENTITY_TABLES = {
  people: "people",
  projects: "projects",
  memberships: "memberships",
  tasks: "tasks",
  acceptanceCriteria: "acceptance_criteria",
  taskEvents: "task_events",
  progressUpdates: "progress_updates",
  attachedCommits: "attached_commits",
  checkResults: "check_results",
  reports: "reports",
  usageRecords: "usage_records",
} as const;

/** Per-person, per-SGT-day quota lock-row table (D-G). */
export const QUOTA_TABLE = "usage_quota_days";

export const MUTABLE_TABLES = [
  ENTITY_TABLES.people,
  ENTITY_TABLES.projects,
  ENTITY_TABLES.memberships,
  ENTITY_TABLES.tasks,
] as const;

/** Tables whose rows belong to exactly one task. */
export const TASK_CHILD_TABLES = [
  ENTITY_TABLES.acceptanceCriteria,
  ENTITY_TABLES.progressUpdates,
  ENTITY_TABLES.taskEvents,
  ENTITY_TABLES.attachedCommits,
  ENTITY_TABLES.checkResults,
] as const;
export type TaskChildTable = (typeof TASK_CHILD_TABLES)[number];

export const MEMBERSHIP_ROLE = {
  productManager: "product_manager",
  developer: "developer",
} as const;

export const TASK_STATUSES = ["to_do", "in_progress", "in_review", "done"] as const;

export const TASK_EVENT_TYPES = ["state_change", "submission", "assignment_change", "review_feedback"] as const;

export const USAGE_OUTCOMES = ["pending", "succeeded", "invalid_output", "provider_error", "cached"] as const;

export const ENCRYPTED_TOKEN_COLUMNS = [
  "github_token_key_version",
  "github_token_iv",
  "github_token_ciphertext",
  "github_token_auth_tag",
] as const;

export const USAGE_RECORD_COLUMNS = [
  "feature",
  "project_id",
  "person_id",
  "environment",
  "input_tokens",
  "output_tokens",
  "latency_ms",
  "outcome",
  "cached",
] as const;

export const CHECK_RESULT_LOOKUP_COLUMNS = [
  "task_id",
  "commit_set_hash",
  "criteria_hash",
  "model",
  "redacted",
  "created_at",
] as const;

export const REPORT_LOOKUP_COLUMNS = ["project_id", "range_start", "range_end", "model", "latest_activity_at"] as const;

/** Reports' "GitHub evidence unavailable" note (review decisions; daily-progress-report). */
export const REPORT_GITHUB_UNAVAILABLE_COLUMN = "github_evidence_unavailable";

export const SYNTHETIC_FEATURE = "acceptance_criteria_check";
export const SYNTHETIC_ENVIRONMENT = "development";
export const SYNTHETIC_MODEL = "synthetic-model";

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function qualified(table: string): string {
  return `"${SCHEMA}"."${table}"`;
}

/** Parameterized INSERT ... RETURNING *. Table and column names come from constants above. */
export async function insertRow(client: pg.Client, table: string, values: Row): Promise<Row> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const sql = `INSERT INTO ${qualified(table)} (${columns.map((c) => `"${c}"`).join(", ")})
               VALUES (${placeholders.join(", ")}) RETURNING *`;
  const result = await client.query(sql, columns.map((c) => values[c]));
  return result.rows[0] as Row;
}

export async function columnNames(client: pg.Client, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [SCHEMA, table],
  );
  return result.rows.map((row) => row.column_name);
}

export async function hasProjectColumn(client: pg.Client, table: string): Promise<boolean> {
  return (await columnNames(client, table)).includes("project_id");
}

function syntheticGithubUserId(): string {
  return String(randomInt(1, 2_000_000_000));
}

function syntheticProjectKey(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "T";
  for (let i = 0; i < 7; i += 1) {
    key += alphabet[randomInt(alphabet.length)];
  }
  return key;
}

export function syntheticHash(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Entity fixtures (synthetic data only)
// ---------------------------------------------------------------------------

export async function createPerson(client: pg.Client, overrides: Row = {}): Promise<string> {
  const githubUserId = (overrides.github_user_id as string | undefined) ?? syntheticGithubUserId();
  const row = await insertRow(client, ENTITY_TABLES.people, {
    auth_user_id: randomUUID(),
    github_user_id: githubUserId,
    github_username: `synthetic-user-${githubUserId}`,
    ...overrides,
  });
  return row.id as string;
}

export async function createProject(client: pg.Client, overrides: Row = {}): Promise<{ id: string; key: string }> {
  const row = await insertRow(client, ENTITY_TABLES.projects, {
    key: syntheticProjectKey(),
    name: "Synthetic project",
    ...overrides,
  });
  return { id: row.id as string, key: row.key as string };
}

export async function addMembership(
  client: pg.Client,
  projectId: string,
  personId: string,
  role: (typeof MEMBERSHIP_ROLE)[keyof typeof MEMBERSHIP_ROLE],
): Promise<string> {
  const row = await insertRow(client, ENTITY_TABLES.memberships, {
    project_id: projectId,
    person_id: personId,
    role,
  });
  return row.id as string;
}

/** Increments the per-project counter (D-D); call inside the task-creation transaction. */
export async function allocateTaskNumber(client: pg.Client, projectId: string): Promise<number> {
  const result = await client.query<{ last_task_number: number }>(
    `UPDATE ${qualified(ENTITY_TABLES.projects)}
        SET last_task_number = last_task_number + 1
      WHERE id = $1
      RETURNING last_task_number`,
    [projectId],
  );
  if (result.rowCount !== 1) {
    throw new Error("project not found while allocating a task number");
  }
  return Number(result.rows[0].last_task_number);
}

export interface TaskInput {
  projectId: string;
  assigneeId: string;
  number?: number;
  status?: (typeof TASK_STATUSES)[number];
}

export async function createTask(client: pg.Client, input: TaskInput): Promise<{ id: string; number: number }> {
  const number = input.number ?? (await allocateTaskNumber(client, input.projectId));
  const row = await insertRow(client, ENTITY_TABLES.tasks, {
    project_id: input.projectId,
    number,
    title: "Synthetic task",
    description: "Synthetic description",
    assignee_id: input.assigneeId,
    due_date: "2026-11-30",
    status: input.status ?? "to_do",
  });
  return { id: row.id as string, number: Number(row.number) };
}

export interface ProjectWithTeam {
  projectId: string;
  projectKey: string;
  productManagerId: string;
  developerId: string;
}

export async function createProjectWithTeam(client: pg.Client): Promise<ProjectWithTeam> {
  const project = await createProject(client);
  const productManagerId = await createPerson(client);
  const developerId = await createPerson(client);
  await addMembership(client, project.id, productManagerId, MEMBERSHIP_ROLE.productManager);
  await addMembership(client, project.id, developerId, MEMBERSHIP_ROLE.developer);
  return { projectId: project.id, projectKey: project.key, productManagerId, developerId };
}

export interface ChildContext {
  taskId: string;
  /** Project written to the child's project_id column, if the table has one. */
  projectId: string;
  /** A person who is a member of the task's project. */
  actorId: string;
}

function childValues(table: TaskChildTable, context: ChildContext): Row {
  switch (table) {
    case ENTITY_TABLES.acceptanceCriteria:
      return { task_id: context.taskId, position: 1, description: "Synthetic criterion" };
    case ENTITY_TABLES.progressUpdates:
      return { task_id: context.taskId, author_id: context.actorId, body: "Synthetic progress update" };
    case ENTITY_TABLES.taskEvents:
      return { task_id: context.taskId, actor_id: context.actorId, event_type: "state_change" };
    case ENTITY_TABLES.attachedCommits:
      return { task_id: context.taskId, commit_sha: randomBytes(20).toString("hex"), attached_by: context.actorId };
    case ENTITY_TABLES.checkResults:
      return {
        task_id: context.taskId,
        commit_set_hash: syntheticHash(),
        criteria_hash: syntheticHash(),
        model: SYNTHETIC_MODEL,
        redacted: false,
        result: JSON.stringify({ criteria: [], gaps: [], skipped_files: [] }),
      };
  }
}

/** Inserts one synthetic record into a task child table, adding project_id when the table has it. */
export async function insertTaskChild(
  client: pg.Client,
  table: TaskChildTable,
  context: ChildContext,
  overrides: Row = {},
): Promise<Row> {
  const values = childValues(table, context);
  if (await hasProjectColumn(client, table)) {
    values.project_id = context.projectId;
  }
  return insertRow(client, table, { ...values, ...overrides });
}

export async function insertCheckResult(
  client: pg.Client,
  context: ChildContext,
  hashes: { commitSetHash: string; criteriaHash: string },
): Promise<Row> {
  return insertTaskChild(client, ENTITY_TABLES.checkResults, context, {
    commit_set_hash: hashes.commitSetHash,
    criteria_hash: hashes.criteriaHash,
  });
}

export async function insertReport(
  client: pg.Client,
  projectId: string,
  range: { start: string; end: string },
  overrides: Row = {},
): Promise<Row> {
  return insertRow(client, ENTITY_TABLES.reports, {
    project_id: projectId,
    range_start: range.start,
    range_end: range.end,
    model: SYNTHETIC_MODEL,
    latest_activity_at: "2026-10-30T10:00:00Z",
    statements: JSON.stringify([{ text: "Synthetic statement", task_ids: [] }]),
    ...overrides,
  });
}

export async function insertPendingUsageRecord(
  client: pg.Client,
  input: { projectId: string; personId: string; outcome?: (typeof USAGE_OUTCOMES)[number] },
): Promise<Row> {
  return insertRow(client, ENTITY_TABLES.usageRecords, {
    feature: SYNTHETIC_FEATURE,
    project_id: input.projectId,
    person_id: input.personId,
    environment: SYNTHETIC_ENVIRONMENT,
    reserved_tokens: 4000,
    outcome: input.outcome ?? "pending",
    cached: false,
  });
}
