import { randomUUID } from "node:crypto";

// Shared in-memory PostgreSQL stand-in for unit tests (design.md T17). Moved from
// tests/unit/project-routes.test.ts and tests/unit/projects/project-service.test.ts (task 4.1),
// where it was copied byte for byte, and extended for task 4.2. It evaluates the statements it
// receives with PostgreSQL's semantics and throws on any statement it cannot read (R7).

// ---------------------------------------------------------------------------
// In-memory model of the app tables (design.md S6 database seam)
// ---------------------------------------------------------------------------
//
// The fake evaluates a small SQL subset with PostgreSQL's semantics and throws on anything
// else, rather than guessing what a statement means:
// - SELECT <items> FROM app.<t> [alias] [JOIN app.<t> [alias] ON <cond>]* [WHERE <cond> AND ...]
//   [ORDER BY ...] [LIMIT n] [FOR UPDATE | FOR SHARE]; SELECT EXISTS (<select>) [AS name];
//   and SELECT count(*) [AS name] FROM ...;
// - INSERT INTO app.<t> (<columns>) VALUES (<values>) [RETURNING <items>];
// - UPDATE app.<t> [alias] SET <column> = <value>[, ...] WHERE <cond> AND ... [RETURNING <items>];
// - DELETE FROM app.acceptance_criteria WHERE <cond> AND ...;
// - BEGIN, COMMIT and ROLLBACK.
// Conditions: <expr> = | <> <expr>, <expr> = ANY(<expr>), <expr> IS [NOT] NULL, with
// parameters, string literals, column references, casts, lower(...), now() and <expr> + <n>.
// ORDER BY sorts by column references, ascending or descending.
// A result row holds only the columns the statement names, as PostgreSQL returns them.
// INSERT and UPDATE return rows only with RETURNING. Constraints mirror the migration: key
// format, uniqueness and immutability, membership uniqueness, one product manager per project,
// valid roles, foreign keys, the task-counter, task-identity and task-assignee triggers, the
// version and updated_at trigger, and the app_runtime grants (no DELETE on tasks, no UPDATE or
// DELETE on task_events). Timestamps are ISO 8601 UTC strings and dates are `YYYY-MM-DD`
// strings. Locks are not modelled; the PostgreSQL integration tests cover them.

export type Role = "product_manager" | "developer";
export type Table = "people" | "projects" | "memberships" | "tasks" | "acceptance_criteria" | "task_events";
export type Kind = "begin" | "commit" | "rollback" | "select" | "insert" | "update" | "delete" | "other";
export type Row = Record<string, unknown>;

export interface PersonRow { id: string; auth_user_id: string; github_user_id: string; github_username: string }
export interface ProjectRow { id: string; key: string; name: string; last_task_number: number; version: number }
export interface MembershipRow { id: string; project_id: string; person_id: string; role: Role; version: number }
export interface TaskRow {
  id: string; project_id: string; number: number; assignee_id: string; status: string; deleted_at: string | null;
  title?: string; description?: string; due_date?: string; branch_name?: string | null;
  version?: number; created_at?: string; updated_at?: string;
}
export interface CriterionRow {
  id: string; task_id: string; position: number; description: string; version: number; created_at: string; updated_at: string;
}
export interface TaskEventRow {
  id: string; task_id: string; actor_id: string; event_type: string; from_status: string | null; to_status: string | null;
  previous_assignee_id: string | null; new_assignee_id: string | null; check_result_id: string | null;
  feedback: string | null; created_at: string;
}
export interface State {
  people: PersonRow[]; projects: ProjectRow[]; memberships: MembershipRow[]; tasks: TaskRow[];
  acceptance_criteria: CriterionRow[]; task_events: TaskEventRow[];
}
/** `memberships` holds the membership rows a SELECT matched (before projection). */
export interface LogEntry { sql: string; values: unknown[]; kind: Kind; tables: Table[]; rows: Row[]; memberships: Row[] }
interface Binding { alias: string; table: Table; row: Row }
type Scope = Binding[];

const ROLES: readonly Role[] = ["product_manager", "developer"];
const TABLES: readonly Table[] = ["people", "projects", "memberships", "tasks", "acceptance_criteria", "task_events"];
const COLUMNS: Record<Table, readonly string[]> = {
  people: ["id", "auth_user_id", "github_user_id", "github_username"],
  projects: ["id", "key", "name", "last_task_number", "version"],
  memberships: ["id", "project_id", "person_id", "role", "version"],
  tasks: [
    "id", "project_id", "number", "assignee_id", "status", "deleted_at",
    "title", "description", "due_date", "branch_name", "version", "created_at", "updated_at",
  ],
  acceptance_criteria: ["id", "task_id", "position", "description", "version", "created_at", "updated_at"],
  task_events: [
    "id", "task_id", "actor_id", "event_type", "from_status", "to_status",
    "previous_assignee_id", "new_assignee_id", "check_result_id", "feedback", "created_at",
  ],
};
/** Tables whose rows carry `version` and `updated_at`, bumped by the migration's trigger. */
const VERSIONED: readonly Table[] = ["people", "projects", "memberships", "tasks", "acceptance_criteria"];
const TASK_STATUSES = ["to_do", "in_progress", "in_review", "done"];
const EVENT_TYPES = ["state_change", "submission", "assignment_change", "review_feedback"];
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRIVATE_DETAIL = "synthetic-private-database-detail";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class UnsupportedSql extends Error {}

function emptyState(): State {
  return { people: [], projects: [], memberships: [], tasks: [], acceptance_criteria: [], task_events: [] };
}

export function clone(state: State): State {
  return structuredClone(state);
}

export function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error(PRIVATE_DETAIL), { code, constraint });
}

function kindOf(sql: string): Kind {
  const text = sql.replace(/--[^\n]*/g, "").trim().toLowerCase();
  if (/^(begin|start\s+transaction)\b/.test(text)) return "begin";
  if (/^commit\b/.test(text)) return "commit";
  if (/^rollback\b/.test(text)) return "rollback";
  if (/^insert\b/.test(text)) return "insert";
  if (/^update\b/.test(text)) return "update";
  if (/^delete\b/.test(text)) return "delete";
  if (/^select\b/.test(text)) return "select";
  return "other";
}

function tablesOf(sql: string): Table[] {
  const found = new Set<Table>();
  for (const match of sql.matchAll(/"?app"?\."?(people|projects|memberships|tasks|acceptance_criteria|task_events)\b"?/gi)) {
    found.add(match[1].toLowerCase() as Table);
  }
  return [...found];
}

/** Calls `visit` for each index outside quotes and parentheses; stops when it returns true. */
function scanTopLevel(text: string, visit: (index: number) => boolean | void): void {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && visit(index)) return;
  }
}

function keywordMatch(text: string, index: number, pattern: string): RegExpExecArray | null {
  if (index > 0 && /\w/.test(text[index - 1])) return null;
  return new RegExp(`^(?:${pattern})\\b`, "i").exec(text.slice(index));
}

function findTop(text: string, pattern: string): number {
  let found = -1;
  scanTopLevel(text, (index) => {
    if (keywordMatch(text, index, pattern)) {
      found = index;
      return true;
    }
  });
  return found;
}

function splitTop(text: string, pattern: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let skipUntil = 0;
  scanTopLevel(text, (index) => {
    if (index < skipUntil) return;
    const match = keywordMatch(text, index, pattern);
    if (match) {
      parts.push(text.slice(start, index));
      start = index + match[0].length;
      skipUntil = start;
    }
  });
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

function splitCommas(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  scanTopLevel(text, (index) => {
    if (text[index] === ",") {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  });
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function stripCasts(expression: string): string {
  let text = expression.trim();
  const cast = /::\s*"?\w+"?(?:\[\])?\s*$/;
  while (cast.test(text)) text = text.replace(cast, "").trim();
  return text;
}

function unwrapParentheses(expression: string): string {
  let text = expression.trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "(") depth += 1;
      if (text[index] === ")") depth -= 1;
      if (depth === 0 && index < text.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function splitAlias(item: string): { expression: string; name?: string } {
  let at = -1;
  scanTopLevel(item, (index) => {
    if (keywordMatch(item, index, "as") && /^as\s+"?\w+"?\s*$/i.test(item.slice(index))) {
      at = index;
      return true;
    }
  });
  if (at < 0) return { expression: item.trim() };
  return { expression: item.slice(0, at).trim(), name: /^as\s+"?(\w+)"?/i.exec(item.slice(at))![1] };
}

function defaultName(expression: string): string {
  const text = stripCasts(expression);
  const reference = /^(?:"?\w+"?\.)?"?(\w+)"?$/.exec(text);
  if (reference) return reference[1];
  const call = /^(\w+)\s*\(/.exec(text);
  return call ? call[1].toLowerCase() : "?column?";
}

function sameValue(left: unknown, right: unknown): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}


function compareValues(left: unknown, right: unknown): number {
  const leftNull = left === null || left === undefined;
  const rightNull = right === null || right === undefined;
  // PostgreSQL sorts NULL last in ascending order.
  if (leftNull || rightNull) return leftNull === rightNull ? 0 : leftNull ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export class FakeDatabase {
  state: State = emptyState();
  log: LogEntry[] = [];
  unexpected: string[] = [];
  connected = 0;
  released = 0;
  /** Runs before a statement is answered; may simulate other committed transactions. */
  beforeStatement?: (entry: { sql: string; kind: Kind; tables: Table[] }) => void;
  /** Returns an error to throw instead of answering the statement. */
  failWhen?: (entry: { sql: string; kind: Kind; tables: Table[] }) => Error | undefined;
  private snapshot: State | null = null;

  /** Applies a change committed by another transaction (visible after any rollback). */
  applyCommitted(change: (state: State) => void): void {
    change(this.state);
    if (this.snapshot) change(this.snapshot);
  }

  query = async (statement: string | { text: string; values?: readonly unknown[] }, values?: readonly unknown[]) => {
    const sql = (typeof statement === "string" ? statement : statement.text).replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "");
    const parameters = [...(values ?? (typeof statement === "string" ? [] : statement.values ?? []))];
    const kind = kindOf(sql);
    const tables = tablesOf(sql);
    this.beforeStatement?.({ sql, kind, tables });
    const failure = this.failWhen?.({ sql, kind, tables });
    const entry: LogEntry = { sql, values: parameters, kind, tables, rows: [], memberships: [] };
    this.log.push(entry);
    if (failure) throw failure;
    try {
      const result = this.answer(sql, kind, parameters, entry);
      entry.rows = result.rows;
      return { rows: result.rows, rowCount: result.rowCount, command: kind.toUpperCase() };
    } catch (error) {
      if (error instanceof UnsupportedSql) this.unexpected.push(sql);
      throw error;
    }
  };

  connect = async () => {
    this.connected += 1;
    return { query: this.query, release: () => { this.released += 1; } };
  };

  private rowsOf(table: Table): Row[] {
    return this.state[table] as unknown as Row[];
  }

  private answer(sql: string, kind: Kind, parameters: unknown[], entry: LogEntry): { rows: Row[]; rowCount: number } {
    switch (kind) {
      case "begin":
        this.snapshot = clone(this.state);
        return { rows: [], rowCount: 0 };
      case "commit":
        this.snapshot = null;
        return { rows: [], rowCount: 0 };
      case "rollback":
        if (this.snapshot) this.state = this.snapshot;
        this.snapshot = null;
        return { rows: [], rowCount: 0 };
      case "select": {
        const result = this.select(sql, parameters);
        entry.memberships = result.scopes.flatMap((scope) => scope.filter((binding) => binding.table === "memberships").map((binding) => binding.row));
        return { rows: result.rows, rowCount: result.rows.length };
      }
      case "insert":
        return this.insert(sql, parameters);
      case "update":
        return this.update(sql, parameters);
      case "delete":
        return this.delete(sql, parameters);
      default:
        throw new UnsupportedSql(`Unexpected database operation in test: ${sql}`);
    }
  }

  private resolve(scope: Scope, qualifier: string | undefined, column: string): unknown {
    const candidates = scope.filter((binding) =>
      (qualifier === undefined || binding.alias === qualifier) && COLUMNS[binding.table].includes(column));
    if (candidates.length !== 1) throw new UnsupportedSql(`Test fake cannot resolve column ${qualifier ? `${qualifier}.` : ""}${column}`);
    return candidates[0].row[column] ?? null;
  }

  private evaluate(expression: string, scope: Scope, parameters: unknown[]): unknown {
    const text = stripCasts(unwrapParentheses(expression));
    let match: RegExpExecArray | null;
    let plusAt = -1;
    scanTopLevel(text, (index) => {
      if (text[index] === "+") {
        plusAt = index;
        return true;
      }
    });
    if (plusAt > 0) {
      const left = this.evaluate(text.slice(0, plusAt), scope, parameters);
      const right = this.evaluate(text.slice(plusAt + 1), scope, parameters);
      if (left === null || left === undefined || right === null || right === undefined) return null;
      if (typeof left !== "number" || typeof right !== "number") throw new UnsupportedSql(`Test fake adds numbers only: ${expression}`);
      return left + right;
    }
    if ((match = /^\$(\d+)$/.exec(text))) return parameters[Number(match[1]) - 1];
    if ((match = /^'((?:[^']|'')*)'$/.exec(text))) return match[1].replace(/''/g, "'");
    if (/^-?\d+$/.test(text)) return Number(text);
    if (/^null$/i.test(text)) return null;
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
    if (/^(?:now\s*\(\s*\)|current_timestamp)$/i.test(text)) return new Date().toISOString();
    if ((match = /^lower\s*\(([\s\S]*)\)$/i.exec(text))) {
      const value = this.evaluate(match[1], scope, parameters);
      return value === null || value === undefined ? null : String(value).toLowerCase();
    }
    if ((match = /^exists\s*\(([\s\S]*)\)$/i.exec(text))) return this.select(match[1], parameters).rows.length > 0;
    if ((match = /^(?:"?(\w+)"?\.)?"?(\w+)"?$/.exec(text))) return this.resolve(scope, match[1], match[2]);
    throw new UnsupportedSql(`Test fake cannot evaluate: ${expression}`);
  }

  private condition(text: string, scope: Scope, parameters: unknown[]): boolean {
    const condition = unwrapParentheses(text);
    let match: RegExpExecArray | null;
    if ((match = /^([\s\S]+?)\s+is\s+(not\s+)?null$/i.exec(condition))) {
      const value = this.evaluate(match[1], scope, parameters);
      return (value === null || value === undefined) !== Boolean(match[2]);
    }
    if ((match = /^([\s\S]+?)\s*=\s*any\s*\(([\s\S]+)\)$/i.exec(condition))) {
      const list = this.evaluate(match[2], scope, parameters);
      if (!Array.isArray(list)) throw new UnsupportedSql(`Test fake expects an array for ANY: ${condition}`);
      const value = this.evaluate(match[1], scope, parameters);
      return list.some((candidate) => sameValue(candidate, value));
    }
    let operatorAt = -1;
    let operator = "";
    scanTopLevel(condition, (index) => {
      const two = condition.slice(index, index + 2);
      if (two === "<>" || two === "!=") {
        operatorAt = index;
        operator = two;
        return true;
      }
      if (condition[index] === "=" && !"<>!".includes(condition[index - 1] ?? "")) {
        operatorAt = index;
        operator = "=";
        return true;
      }
    });
    if (operatorAt < 0) throw new UnsupportedSql(`Test fake cannot evaluate condition: ${condition}`);
    const left = this.evaluate(condition.slice(0, operatorAt), scope, parameters);
    const right = this.evaluate(condition.slice(operatorAt + operator.length), scope, parameters);
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return operator === "=" ? sameValue(left, right) : !sameValue(left, right);
  }

  private source(text: string): { alias: string; table: Table } {
    const match = /^"?app"?\."?(\w+)"?(?:\s+(?:as\s+)?"?(\w+)"?)?$/i.exec(text.trim());
    const table = match?.[1].toLowerCase() as Table | undefined;
    if (!match || !table || !TABLES.includes(table)) throw new UnsupportedSql(`Test fake cannot read the table in: ${text}`);
    return { alias: match[2] ?? table, table };
  }

  private project(items: string[], scope: Scope, parameters: unknown[]): Row {
    const row: Row = {};
    for (const item of items) {
      const star = /^(?:"?(\w+)"?\.)?\*$/.exec(item.trim());
      if (star) {
        for (const binding of scope) {
          if (star[1] === undefined || binding.alias === star[1]) Object.assign(row, binding.row);
        }
        continue;
      }
      const { expression, name } = splitAlias(item);
      row[name ?? defaultName(expression)] = this.evaluate(expression, scope, parameters);
    }
    return row;
  }

  private sort(scopes: Scope[], orderBy: string, parameters: unknown[]): Scope[] {
    const keys = splitCommas(orderBy).map((item) => {
      const match = /^([\s\S]+?)(?:\s+(asc|desc))?$/i.exec(item.trim());
      if (!match) throw new UnsupportedSql(`Test fake cannot read ORDER BY: ${orderBy}`);
      return { expression: match[1], descending: match[2]?.toLowerCase() === "desc" };
    });
    return [...scopes].sort((left, right) => {
      for (const key of keys) {
        const order = compareValues(this.evaluate(key.expression, left, parameters), this.evaluate(key.expression, right, parameters));
        if (order !== 0) return key.descending ? -order : order;
      }
      return 0;
    });
  }

  private select(sql: string, parameters: unknown[]): { rows: Row[]; scopes: Scope[] } {
    let text = sql.trim();
    if (!/^select\b/i.test(text)) throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
    text = text.replace(/^select\s+/i, "");
    const lockAt = findTop(text, "for\\s+(?:update|share)");
    if (lockAt >= 0) text = text.slice(0, lockAt);
    let limit: number | undefined;
    const limitAt = findTop(text, "limit");
    if (limitAt >= 0) {
      limit = Number(this.evaluate(text.slice(limitAt).replace(/^limit\s+/i, ""), [], parameters));
      text = text.slice(0, limitAt);
    }
    let orderBy: string | undefined;
    const orderAt = findTop(text, "order\\s+by");
    if (orderAt >= 0) {
      orderBy = text.slice(orderAt).replace(/^order\s+by\s+/i, "");
      text = text.slice(0, orderAt);
    }
    const fromAt = findTop(text, "from");
    if (fromAt < 0) return { rows: [this.project(splitCommas(text), [], parameters)], scopes: [] };
    const items = splitCommas(text.slice(0, fromAt));
    let rest = text.slice(fromAt).replace(/^from\s+/i, "");
    const whereAt = findTop(rest, "where");
    const where = whereAt >= 0 ? rest.slice(whereAt).replace(/^where\s+/i, "") : undefined;
    if (whereAt >= 0) rest = rest.slice(0, whereAt);
    const [first, ...joins] = splitTop(rest, "(?:inner\\s+)?join");
    const base = this.source(first);
    let scopes: Scope[] = this.rowsOf(base.table).map((row) => [{ ...base, row }]);
    for (const join of joins) {
      const onAt = findTop(join, "on");
      if (onAt < 0) throw new UnsupportedSql(`Test fake needs JOIN ... ON: ${sql}`);
      const joined = this.source(join.slice(0, onAt));
      const on = join.slice(onAt).replace(/^on\s+/i, "");
      scopes = scopes
        .flatMap((scope) => this.rowsOf(joined.table).map((row) => [...scope, { ...joined, row }]))
        .filter((scope) => this.condition(on, scope, parameters));
    }
    const conditions = where === undefined ? [] : splitTop(where, "and");
    scopes = scopes.filter((scope) => conditions.every((condition) => this.condition(condition, scope, parameters)));
    if (items.length === 1) {
      const { expression, name } = splitAlias(items[0]);
      if (/^count\s*\(\s*\*\s*\)$/i.test(stripCasts(expression))) {
        const value = /::\s*int/i.test(expression) ? scopes.length : String(scopes.length);
        return { rows: [{ [name ?? "count"]: value }], scopes };
      }
    }
    if (orderBy !== undefined) scopes = this.sort(scopes, orderBy, parameters);
    if (limit !== undefined) scopes = scopes.slice(0, limit);
    return { rows: scopes.map((scope) => this.project(items, scope, parameters)), scopes };
  }

  private checkMemberships(projectId: unknown): void {
    const productManagers = this.state.memberships.filter((membership) => membership.project_id === projectId && membership.role === "product_manager");
    if (productManagers.length > 1) throw pgError("23505", "memberships_one_product_manager_per_project");
  }

  /** The migration's tasks_assignee_is_project_developer trigger. */
  private checkAssignee(row: Row): void {
    const isDeveloper = this.state.memberships.some((membership) =>
      membership.project_id === row.project_id && membership.person_id === row.assignee_id && membership.role === "developer");
    if (!isDeveloper) throw pgError("23503", "tasks_assignee_is_project_developer");
  }

  private checkTask(row: Row): void {
    if (typeof row.title !== "string" || typeof row.description !== "string" || typeof row.due_date !== "string") throw pgError("23502");
    if (!DATE_PATTERN.test(row.due_date) || Number.isNaN(Date.parse(`${row.due_date}T00:00:00Z`))) throw pgError("22007");
    if (!Number.isInteger(row.number) || Number(row.number) < 1) throw pgError("23514", "tasks_number_positive");
    if (!TASK_STATUSES.includes(String(row.status))) throw pgError("23514", "tasks_status_valid");
  }

  private insert(sql: string, parameters: unknown[]): { rows: Row[]; rowCount: number } {
    const head = /^insert\s+into\s+"?app"?\."?(\w+)"?\s*\(([^)]*)\)\s*values\s*/i.exec(sql);
    if (!head) throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
    const table = head[1].toLowerCase() as Table;
    let tail = sql.slice(head[0].length);
    const returningAt = findTop(tail, "returning");
    const returning = returningAt >= 0 ? splitCommas(tail.slice(returningAt).replace(/^returning\s+/i, "")) : [];
    if (returningAt >= 0) tail = tail.slice(0, returningAt);
    tail = tail.trim();
    if (!tail.startsWith("(") || !tail.endsWith(")") || unwrapParentheses(tail) === tail) throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
    const columns = head[2].split(",").map((column) => column.trim().replace(/"/g, ""));
    const valueList = splitCommas(tail.slice(1, -1)).map((value) => this.evaluate(value, [], parameters));
    if (columns.length !== valueList.length || columns.some((column) => !COLUMNS[table]?.includes(column))) {
      throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
    }
    const assigned: Row = Object.fromEntries(columns.map((column, index) => [column, valueList[index]]));
    const now = new Date().toISOString();
    let row: Row;
    if (table === "projects") {
      const key = assigned.key;
      if (typeof key !== "string" || typeof assigned.name !== "string") throw pgError("23502");
      if (!KEY_PATTERN.test(key)) throw pgError("23514", "projects_key_format");
      if (this.state.projects.some((project) => project.key === key)) throw pgError("23505", "projects_key_key");
      row = { id: randomUUID(), last_task_number: 0, version: 1, ...assigned };
    } else if (table === "memberships") {
      if (!this.state.projects.some((project) => project.id === assigned.project_id)) throw pgError("23503", "memberships_project_id_fkey");
      if (!this.state.people.some((person) => person.id === assigned.person_id)) throw pgError("23503", "memberships_person_id_fkey");
      if (!ROLES.includes(assigned.role as Role)) throw pgError("23514", "memberships_role_valid");
      if (this.state.memberships.some((membership) => membership.project_id === assigned.project_id && membership.person_id === assigned.person_id)) {
        throw pgError("23505", "memberships_project_person_key");
      }
      row = { id: randomUUID(), version: 1, ...assigned };
    } else if (table === "tasks") {
      row = {
        id: randomUUID(), status: "to_do", branch_name: null, deleted_at: null, version: 1,
        created_at: now, updated_at: now, ...assigned,
      };
      this.checkAssignee(row);
      this.checkTask(row);
      if (!this.state.projects.some((project) => project.id === row.project_id)) throw pgError("23503", "tasks_project_id_fkey");
      if (this.state.tasks.some((task) => task.project_id === row.project_id && task.number === row.number)) {
        throw pgError("23505", "tasks_project_number_key");
      }
    } else if (table === "acceptance_criteria") {
      if (!this.state.tasks.some((task) => task.id === assigned.task_id)) throw pgError("23503", "acceptance_criteria_task_id_fkey");
      if (typeof assigned.description !== "string") throw pgError("23502");
      if (!Number.isInteger(assigned.position) || Number(assigned.position) < 1) throw pgError("23514", "acceptance_criteria_position_positive");
      row = { id: randomUUID(), version: 1, created_at: now, updated_at: now, ...assigned };
    } else if (table === "task_events") {
      row = {
        id: randomUUID(), from_status: null, to_status: null, previous_assignee_id: null, new_assignee_id: null,
        check_result_id: null, feedback: null, created_at: now, ...assigned,
      };
      if (!this.state.tasks.some((task) => task.id === row.task_id)) throw pgError("23503", "task_events_task_id_fkey");
      if (!this.state.people.some((person) => person.id === row.actor_id)) throw pgError("23503", "task_events_actor_id_fkey");
      for (const column of ["previous_assignee_id", "new_assignee_id"]) {
        if (row[column] !== null && !this.state.people.some((person) => person.id === row[column])) throw pgError("23503", `task_events_${column}_fkey`);
      }
      if (!EVENT_TYPES.includes(String(row.event_type))) throw pgError("23514", "task_events_event_type_valid");
      if ((row.event_type === "review_feedback") !== (row.feedback !== null)) throw pgError("23514", "task_events_feedback_only_on_review_feedback");
    } else {
      throw new UnsupportedSql(`Unexpected write in test: ${sql}`);
    }
    this.rowsOf(table).push(row);
    if (table === "memberships") {
      try {
        this.checkMemberships(row.project_id);
      } catch (error) {
        this.rowsOf(table).pop();
        throw error;
      }
    }
    const scope: Scope = [{ alias: table, table, row }];
    return { rows: returning.length ? [this.project(returning, scope, parameters)] : [], rowCount: 1 };
  }

  /** The migration's BEFORE UPDATE triggers and constraints for one changed row. */
  private checkUpdate(table: Table, previous: Row, row: Row): void {
    if (table === "memberships") {
      if (!ROLES.includes(row.role as Role)) throw pgError("23514", "memberships_role_valid");
      this.checkMemberships(row.project_id);
    } else if (table === "projects") {
      if (row.key !== previous.key) throw pgError("23514", "projects_key_is_fixed");
      if (Number(row.last_task_number) < Number(previous.last_task_number)) throw pgError("23514", "projects_task_counter_never_decreases");
    } else if (table === "tasks") {
      if (row.project_id !== previous.project_id || row.number !== previous.number) throw pgError("23514", "tasks_identity_is_fixed");
      if (row.assignee_id !== previous.assignee_id) this.checkAssignee(row);
      this.checkTask(row);
    } else if (table === "acceptance_criteria") {
      if (typeof row.description !== "string") throw pgError("23502");
      if (!Number.isInteger(row.position) || Number(row.position) < 1) throw pgError("23514", "acceptance_criteria_position_positive");
    }
  }

  private update(sql: string, parameters: unknown[]): { rows: Row[]; rowCount: number } {
    const head = /^update\s+"?app"?\."?(\w+)"?(?:\s+(?!set\b)(\w+))?\s+set\s+/i.exec(sql);
    const table = head?.[1].toLowerCase() as Table | undefined;
    if (!head || !table || !TABLES.includes(table)) throw new UnsupportedSql(`Unexpected write in test: ${sql}`);
    // app_runtime has only SELECT and INSERT on task_events (Task 2.4 review decisions).
    if (table === "task_events") throw pgError("42501");
    if (table === "people") throw new UnsupportedSql(`Unexpected write in test: ${sql}`);
    const alias = head[2] ?? table;
    let rest = sql.slice(head[0].length);
    const returningAt = findTop(rest, "returning");
    const returning = returningAt >= 0 ? splitCommas(rest.slice(returningAt).replace(/^returning\s+/i, "")) : [];
    if (returningAt >= 0) rest = rest.slice(0, returningAt);
    const whereAt = findTop(rest, "where");
    if (whereAt < 0) throw new UnsupportedSql(`Test fake refuses an UPDATE without WHERE: ${sql}`);
    const assignments = splitCommas(rest.slice(0, whereAt)).map((assignment) => {
      const match = /^"?(\w+)"?\s*=\s*([\s\S]+)$/.exec(assignment);
      if (!match || !COLUMNS[table].includes(match[1]) || match[1] === "id") throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
      return { column: match[1], expression: match[2] };
    });
    const conditions = splitTop(rest.slice(whereAt).replace(/^where\s+/i, ""), "and");
    const targets = this.rowsOf(table).filter((row) =>
      conditions.every((condition) => this.condition(condition, [{ alias, table, row }], parameters)));
    const returned: Row[] = [];
    for (const row of targets) {
      const previous = { ...row };
      const scope: Scope = [{ alias, table, row: previous }];
      for (const { column, expression } of assignments) row[column] = this.evaluate(expression, scope, parameters);
      if (VERSIONED.includes(table)) {
        // bump_version: NEW.version := OLD.version + 1 and NEW.updated_at := now().
        row.version = Number(previous.version ?? 1) + 1;
        if (COLUMNS[table].includes("updated_at")) row.updated_at = new Date().toISOString();
      }
      try {
        this.checkUpdate(table, previous, row);
      } catch (error) {
        Object.assign(row, previous);
        throw error;
      }
      if (returning.length) returned.push(this.project(returning, [{ alias, table, row }], parameters));
    }
    return { rows: returned, rowCount: targets.length };
  }

  private delete(sql: string, parameters: unknown[]): { rows: Row[]; rowCount: number } {
    const head = /^delete\s+from\s+"?app"?\."?(\w+)"?(?:\s+(?!where\b)(\w+))?\s+where\s+/i.exec(sql);
    const table = head?.[1].toLowerCase() as Table | undefined;
    // app_runtime has no DELETE on tasks or task_events (Task 2.4 review decisions).
    if (table === "tasks" || table === "task_events") throw pgError("42501");
    if (!head || table !== "acceptance_criteria") throw new UnsupportedSql(`Unexpected write in test: ${sql}`);
    const alias = head[2] ?? table;
    const conditions = splitTop(sql.slice(head[0].length), "and");
    const rows = this.rowsOf(table);
    const targets = rows.filter((row) =>
      conditions.every((condition) => this.condition(condition, [{ alias, table, row }], parameters)));
    this.state.acceptance_criteria = this.state.acceptance_criteria.filter((row) => !targets.includes(row as unknown as Row));
    return { rows: [], rowCount: targets.length };
  }
}
