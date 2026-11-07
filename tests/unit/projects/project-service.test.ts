import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.1 (projects-membership-4-1). Validation, error-mapping and service unit tests
// for the `@/server/projects` public entry recorded in design.md S1 to S6. Requirements by name
// (no formal IDs): task-management "Signed-in people create projects", "Project membership and
// roles", "Product manager transfers the role" and "Transfer targets are identified by GitHub
// username"; design.md D3, D5, D6, Q2, Q3, S7 and the API Error Contract.
//
// ProjectRepository runs against an in-memory fake exposing query() and connect() (S1, S6).
// The fake is the same one used in tests/unit/project-routes.test.ts: it evaluates statements
// with PostgreSQL's semantics and throws on any statement it cannot read. The service's
// PersonLookup (S4) is a synthetic stand-in. All values are synthetic.

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({
    appEnvironment: "development",
    appOrigin: "https://synthetic-app.example",
    databaseUrl: "postgresql://synthetic:synthetic@localhost/synthetic?sslmode=require",
    databaseCaCert: "synthetic-test-ca",
    supabaseUrl: "https://synthetic.supabase.co",
    supabasePublishableKey: "synthetic-publishable-key",
    githubAppClientId: "synthetic-app-client",
    githubAppClientSecret: "synthetic-app-secret",
    ai: { provider: "fake" },
  }),
}));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = vi.fn(async () => { throw new Error("The composition pool must not be used by service unit tests"); });
    connect = vi.fn(async () => { throw new Error("The composition pool must not be used by service unit tests"); });
  }
  return { Pool, default: { Pool } };
});

import {
  ProjectError,
  ProjectRepository,
  ProjectService,
  parseCreateProjectBody,
  parseGitHubUsernameBody,
  projectErrorResponse,
  type PersonLookup,
} from "@/server/projects";

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
// - UPDATE app.memberships SET <column> = <value>[, ...] WHERE <cond> AND ... [RETURNING <items>];
// - BEGIN, COMMIT and ROLLBACK.
// Conditions: <expr> = | <> <expr>, <expr> = ANY(<expr>), <expr> IS [NOT] NULL, with
// parameters, string literals, column references, casts and lower(...).
// A result row holds only the columns the statement names, as PostgreSQL returns them.
// INSERT and UPDATE return rows only with RETURNING. Constraints mirror the migration: key
// format and uniqueness, membership uniqueness, one product manager per project, valid roles
// and foreign keys. Locks are not modelled; the PostgreSQL integration tests cover them.

type Role = "product_manager" | "developer";
type Table = "people" | "projects" | "memberships" | "tasks";
type Kind = "begin" | "commit" | "rollback" | "select" | "insert" | "update" | "delete" | "other";
type Row = Record<string, unknown>;

interface PersonRow { id: string; auth_user_id: string; github_user_id: string; github_username: string }
interface ProjectRow { id: string; key: string; name: string; last_task_number: number; version: number }
interface MembershipRow { id: string; project_id: string; person_id: string; role: Role; version: number }
interface TaskRow { id: string; project_id: string; number: number; assignee_id: string; status: string; deleted_at: string | null }
interface State { people: PersonRow[]; projects: ProjectRow[]; memberships: MembershipRow[]; tasks: TaskRow[] }
/** `memberships` holds the membership rows a SELECT matched (before projection). */
interface LogEntry { sql: string; values: unknown[]; kind: Kind; tables: Table[]; rows: Row[]; memberships: Row[] }
interface Binding { alias: string; table: Table; row: Row }
type Scope = Binding[];

const ROLES: readonly Role[] = ["product_manager", "developer"];
const TABLES: readonly Table[] = ["people", "projects", "memberships", "tasks"];
const COLUMNS: Record<Table, readonly string[]> = {
  people: ["id", "auth_user_id", "github_user_id", "github_username"],
  projects: ["id", "key", "name", "last_task_number", "version"],
  memberships: ["id", "project_id", "person_id", "role", "version"],
  tasks: ["id", "project_id", "number", "assignee_id", "status", "deleted_at"],
};
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_DETAIL = "synthetic-private-database-detail";

class UnsupportedSql extends Error {}

function emptyState(): State {
  return { people: [], projects: [], memberships: [], tasks: [] };
}

function clone(state: State): State {
  return structuredClone(state);
}

function pgError(code: string, constraint?: string): Error {
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
  for (const match of sql.matchAll(/"?app"?\."?(people|projects|memberships|tasks)\b"?/gi)) {
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

class FakeDatabase {
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
      default:
        throw new UnsupportedSql(`Unexpected database operation in test: ${sql}`);
    }
  }

  private resolve(scope: Scope, qualifier: string | undefined, column: string): unknown {
    const candidates = scope.filter((binding) =>
      (qualifier === undefined || binding.alias === qualifier) && COLUMNS[binding.table].includes(column));
    if (candidates.length !== 1) throw new UnsupportedSql(`Test fake cannot resolve column ${qualifier ? `${qualifier}.` : ""}${column}`);
    return candidates[0].row[column];
  }

  private evaluate(expression: string, scope: Scope, parameters: unknown[]): unknown {
    const text = stripCasts(unwrapParentheses(expression));
    let match: RegExpExecArray | null;
    if ((match = /^\$(\d+)$/.exec(text))) return parameters[Number(match[1]) - 1];
    if ((match = /^'((?:[^']|'')*)'$/.exec(text))) return match[1].replace(/''/g, "'");
    if (/^-?\d+$/.test(text)) return Number(text);
    if (/^null$/i.test(text)) return null;
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
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

  private select(sql: string, parameters: unknown[]): { rows: Row[]; scopes: Scope[] } {
    let text = sql.trim();
    if (!/^select\b/i.test(text)) throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
    text = text.replace(/^select\s+/i, "");
    for (const clause of ["for\\s+(?:update|share)", "limit", "order\\s+by"]) {
      const at = findTop(text, clause);
      if (at >= 0) text = text.slice(0, at);
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
    return { rows: scopes.map((scope) => this.project(items, scope, parameters)), scopes };
  }

  private checkMemberships(projectId: unknown): void {
    const productManagers = this.state.memberships.filter((membership) => membership.project_id === projectId && membership.role === "product_manager");
    if (productManagers.length > 1) throw pgError("23505", "memberships_one_product_manager_per_project");
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

  private update(sql: string, parameters: unknown[]): { rows: Row[]; rowCount: number } {
    const head = /^update\s+"?app"?\."?(\w+)"?(?:\s+(?!set\b)(\w+))?\s+set\s+/i.exec(sql);
    if (!head || head[1].toLowerCase() !== "memberships") throw new UnsupportedSql(`Unexpected write in test: ${sql}`);
    const alias = head[2] ?? "memberships";
    let rest = sql.slice(head[0].length);
    const returningAt = findTop(rest, "returning");
    const returning = returningAt >= 0 ? splitCommas(rest.slice(returningAt).replace(/^returning\s+/i, "")) : [];
    if (returningAt >= 0) rest = rest.slice(0, returningAt);
    const whereAt = findTop(rest, "where");
    if (whereAt < 0) throw new UnsupportedSql(`Test fake refuses an UPDATE without WHERE: ${sql}`);
    const assignments = splitCommas(rest.slice(0, whereAt)).map((assignment) => {
      const match = /^"?(\w+)"?\s*=\s*([\s\S]+)$/.exec(assignment);
      if (!match || !COLUMNS.memberships.includes(match[1])) throw new UnsupportedSql(`Test fake cannot read: ${sql}`);
      return { column: match[1], expression: match[2] };
    });
    const conditions = splitTop(rest.slice(whereAt).replace(/^where\s+/i, ""), "and");
    const targets = this.rowsOf("memberships").filter((row) =>
      conditions.every((condition) => this.condition(condition, [{ alias, table: "memberships", row }], parameters)));
    const returned: Row[] = [];
    for (const row of targets) {
      const previous = { ...row };
      const scope: Scope = [{ alias, table: "memberships", row: previous }];
      for (const { column, expression } of assignments) row[column] = this.evaluate(expression, scope, parameters);
      if (!assignments.some(({ column }) => column === "version")) row.version = Number(previous.version) + 1;
      try {
        if (!ROLES.includes(row.role as Role)) throw pgError("23514", "memberships_role_valid");
        this.checkMemberships(row.project_id);
      } catch (error) {
        Object.assign(row, previous);
        throw error;
      }
      if (returning.length) returned.push(this.project(returning, [{ alias, table: "memberships", row }], parameters));
    }
    return { rows: returned, rowCount: targets.length };
  }
}

// ---------------------------------------------------------------------------
// Synthetic data and helpers
// ---------------------------------------------------------------------------

const projectId = "33333333-3333-4333-8333-333333333333";
const people = {
  pm: { id: "22222222-2222-4222-8222-222222222201", auth_user_id: "11111111-1111-4111-8111-111111111101", github_user_id: "1001", github_username: "synthetic-pm" },
  dev: { id: "22222222-2222-4222-8222-222222222202", auth_user_id: "11111111-1111-4111-8111-111111111102", github_user_id: "1002", github_username: "Synthetic-Dev" },
  target: { id: "22222222-2222-4222-8222-222222222204", auth_user_id: "11111111-1111-4111-8111-111111111104", github_user_id: "1004", github_username: "Synthetic-Target" },
  outsider: { id: "22222222-2222-4222-8222-222222222205", auth_user_id: "11111111-1111-4111-8111-111111111105", github_user_id: "1005", github_username: "synthetic-outsider" },
} as const;

let fake: FakeDatabase;
let lookup: { findPeopleByGitHubUsername: ReturnType<typeof vi.fn> };
let service: ProjectService;

function lookupResult(username: string): { id: string; githubUsername: string }[] {
  return fake.state.people
    .filter((person) => person.github_username.toLowerCase() === username.toLowerCase())
    .map((person) => ({ id: person.id, githubUsername: person.github_username }));
}

function roleOf(personId: string): Role | undefined {
  return fake.state.memberships.find((membership) => membership.project_id === projectId && membership.person_id === personId)?.role;
}

function writes(): LogEntry[] {
  return fake.log.filter((entry) => entry.kind === "insert" || entry.kind === "update" || entry.kind === "delete");
}

/** Asserts a ProjectError and its mapped response (S1), without depending on its fields. */
async function expectProjectFailure(operation: Promise<unknown>, status: number, code: string): Promise<void> {
  const error = await operation.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProjectError);
  const response = projectErrorResponse(error);
  expect(response.status).toBe(status);
  expect((await response.json() as { error: { code: string } }).error.code).toBe(code);
}

beforeEach(() => {
  fake = new FakeDatabase();
  fake.state.people.push(...Object.values(people).map((entry) => ({ ...entry })));
  fake.state.projects.push({ id: projectId, key: "WEB", name: "Synthetic web project", last_task_number: 0, version: 1 });
  fake.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: people.pm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev.id, role: "developer", version: 1 },
  );
  lookup = { findPeopleByGitHubUsername: vi.fn(async (username: string) => lookupResult(username)) };
  const repository = new ProjectRepository({ query: fake.query, connect: fake.connect } as unknown as ConstructorParameters<typeof ProjectRepository>[0]);
  service = new ProjectService(repository, lookup as unknown as PersonLookup);
});

afterEach(() => {
  // The fake saw only statements it models.
  expect(fake.unexpected).toEqual([]);
});

// ---------------------------------------------------------------------------
// Validation (S1, D3, Q3)
// ---------------------------------------------------------------------------

describe("parseCreateProjectBody (D3)", () => {
  it("returns exactly the key and the trimmed name", () => {
    expect(parseCreateProjectBody({ key: "WEB", name: "  Synthetic project  " })).toEqual({ key: "WEB", name: "Synthetic project" });
  });

  it.each([
    ["two-character key", { key: "AB", name: "N" }, { key: "AB", name: "N" }],
    ["ten-character key", { key: "A123456789", name: "N" }, { key: "A123456789", name: "N" }],
    ["100-character name", { key: "WEB", name: "N".repeat(100) }, { key: "WEB", name: "N".repeat(100) }],
    ["100-character name after trimming", { key: "WEB", name: ` ${"N".repeat(100)} ` }, { key: "WEB", name: "N".repeat(100) }],
  ])("accepts a %s", (_label, body, expected) => {
    expect(parseCreateProjectBody(body)).toEqual(expected);
  });

  it.each([
    ["a lowercase key (not normalized)", { key: "web", name: "N" }],
    ["a mixed-case key", { key: "wEB", name: "N" }],
    ["a one-character key", { key: "W", name: "N" }],
    ["an eleven-character key", { key: "A1234567890", name: "N" }],
    ["a key starting with a digit", { key: "9WEB", name: "N" }],
    ["a key with a hyphen", { key: "WE-B", name: "N" }],
    ["a key with surrounding spaces", { key: " WEB", name: "N" }],
    ["an empty key", { key: "", name: "N" }],
    ["a numeric key", { key: 12, name: "N" }],
    ["a missing key", { name: "N" }],
    ["an empty name", { key: "WEB", name: "" }],
    ["a whitespace-only name", { key: "WEB", name: " \t " }],
    ["a 101-character name", { key: "WEB", name: "N".repeat(101) }],
    ["a non-string name", { key: "WEB", name: ["N"] }],
    ["a missing name", { key: "WEB" }],
    ["an extra field", { key: "WEB", name: "N", id: "33333333-3333-4333-8333-333333333333" }],
    ["null", null],
    ["an array", [{ key: "WEB", name: "N" }]],
    ["a string", "WEB"],
    ["undefined", undefined],
  ])("rejects %s with null", (_label, body) => {
    expect(parseCreateProjectBody(body)).toBeNull();
  });
});

describe("parseGitHubUsernameBody (Q3)", () => {
  it.each([
    ["a plain username", "synthetic-user", "synthetic-user"],
    ["mixed case, unchanged", "Synthetic-User", "Synthetic-User"],
    ["leading and trailing spaces, trimmed", "  synthetic-user  ", "synthetic-user"],
    ["one character", "a", "a"],
    ["39 characters", "a".repeat(39), "a".repeat(39)],
    ["digits and hyphens without GitHub's stricter hyphen rules", "-a--1-", "-a--1-"],
  ])("accepts %s", (_label, value, expected) => {
    expect(parseGitHubUsernameBody({ githubUsername: value })).toBe(expected);
  });

  it.each([
    ["an extra field", { githubUsername: "synthetic-user", role: "developer" }],
    ["a missing field", {}],
    ["a number", { githubUsername: 1 }],
    ["null", { githubUsername: null }],
    ["a boolean", { githubUsername: true }],
    ["an array", { githubUsername: ["synthetic-user"] }],
    ["an empty string", { githubUsername: "" }],
    ["spaces only", { githubUsername: "   " }],
    ["40 characters", { githubUsername: "a".repeat(40) }],
    ["an underscore", { githubUsername: "synthetic_user" }],
    ["a dot", { githubUsername: "synthetic.user" }],
    ["an inner space", { githubUsername: "synthetic user" }],
    ["a slash", { githubUsername: "synthetic/user" }],
    ["a non-ASCII letter", { githubUsername: "synthétic" }],
    ["a null body", null],
    ["an array body", ["synthetic-user"]],
    ["a string body", "synthetic-user"],
  ])("rejects %s with null", (_label, body) => {
    expect(parseGitHubUsernameBody(body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error mapping (S1, API Error Contract, Q2)
// ---------------------------------------------------------------------------

describe("projectErrorResponse (API Error Contract)", () => {
  it.each([
    ["PROJECT_KEY_TAKEN", 409],
    ["GITHUB_USERNAME_AMBIGUOUS", 409],
    ["ALREADY_MEMBER", 409],
    ["TRANSFER_TARGET_NOT_DEVELOPER", 409],
    ["TRANSFER_BLOCKED_OPEN_TASKS", 409],
  ])("maps %s to %i with a fixed, non-empty message and no-store", async (code, status) => {
    const response = projectErrorResponse(new ProjectError(code as ConstructorParameters<typeof ProjectError>[0]));
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message.trim()).not.toBe("");
  });

  it("asks for the open tasks to be reassigned first for TRANSFER_BLOCKED_OPEN_TASKS", async () => {
    const response = projectErrorResponse(new ProjectError("TRANSFER_BLOCKED_OPEN_TASKS" as ConstructorParameters<typeof ProjectError>[0]));
    expect((await response.json() as { error: { message: string } }).error.message).toMatch(/reassign/i);
  });

  it.each([
    ["NOT_FOUND", 404, "Resource not found"],
    ["FORBIDDEN", 403, "Insufficient permissions"],
  ])("maps %s to %i with the stable message", async (code, status, message) => {
    const response = projectErrorResponse(new ProjectError(code as ConstructorParameters<typeof ProjectError>[0]));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: { code, message } });
  });

  it.each([
    ["an unexpected Error", new Error(PRIVATE_DETAIL)],
    ["a database error", pgError("23503", "memberships_person_id_fkey")],
    ["a non-Error value", PRIVATE_DETAIL],
  ])("maps %s to a generic 500 without internal details", async (_label, error) => {
    const response = projectErrorResponse(error);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(PRIVATE_DETAIL);
    expect(text).not.toContain("memberships_person_id_fkey");
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});

// ---------------------------------------------------------------------------
// ProjectService (S2)
// ---------------------------------------------------------------------------

describe("ProjectService.createProject (D2, D3, D10)", () => {
  it("creates the project with the creator as its only product manager, in one transaction", async () => {
    const view = await service.createProject(people.outsider.id, { key: "NEWP", name: "Synthetic new" });
    expect(view).toEqual({ id: expect.stringMatching(UUID_PATTERN), key: "NEWP", name: "Synthetic new", role: "product_manager" });
    expect(fake.state.memberships.filter((membership) => membership.project_id === view.id)).toEqual([
      expect.objectContaining({ person_id: people.outsider.id, role: "product_manager" }),
    ]);
    const kinds = fake.log.map((entry) => entry.kind);
    expect(kinds[0]).toBe("begin");
    expect(kinds.at(-1)).toBe("commit");
    expect(writes().map((entry) => entry.tables)).toEqual([["projects"], ["memberships"]]);
    expect(fake.released).toBe(fake.connected);
  });

  it("maps the projects_key_key unique violation to PROJECT_KEY_TAKEN and rolls back", async () => {
    const before = clone(fake.state);
    await expectProjectFailure(service.createProject(people.outsider.id, { key: "WEB", name: "Synthetic duplicate" }), 409, "PROJECT_KEY_TAKEN");
    expect(fake.state).toEqual(before);
    expect(fake.log.some((entry) => entry.kind === "rollback")).toBe(true);
    expect(fake.released).toBe(fake.connected);
  });

  it("rolls back the project when the membership insert fails (atomic creation)", async () => {
    fake.failWhen = ({ kind, tables }) => (kind === "insert" && tables.includes("memberships") ? new Error(PRIVATE_DETAIL) : undefined);
    const before = clone(fake.state);
    const error = await service.createProject(people.outsider.id, { key: "ATOM", name: "Synthetic atomic" }).then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeDefined();
    expect(projectErrorResponse(error).status).toBe(500);
    expect(fake.state).toEqual(before);
    expect(fake.log.some((entry) => entry.kind === "rollback")).toBe(true);
    expect(fake.log.some((entry) => entry.kind === "commit")).toBe(false);
    expect(fake.released).toBe(fake.connected);
  });
});

describe("ProjectService.getProject", () => {
  it.each([
    ["product manager", people.pm.id, "product_manager"],
    ["developer", people.dev.id, "developer"],
  ])("returns the project and the %s's role", async (_label, personId, role) => {
    expect(await service.getProject(projectId, personId)).toEqual({ id: projectId, key: "WEB", name: "Synthetic web project", role });
    expect(writes()).toEqual([]);
  });

  it("conceals the project from a non-member with NOT_FOUND", async () => {
    await expectProjectFailure(service.getProject(projectId, people.outsider.id), 404, "NOT_FOUND");
  });
});

describe("ProjectService.addMember (D5)", () => {
  it("adds the person as a developer and returns the stored username", async () => {
    const view = await service.addMember(projectId, people.pm.id, "synthetic-TARGET");
    expect(view).toEqual({ personId: people.target.id, githubUsername: "Synthetic-Target", role: "developer" });
    expect(lookup.findPeopleByGitHubUsername).toHaveBeenCalledWith("synthetic-TARGET");
    expect(roleOf(people.target.id)).toBe("developer");
    expect(fake.released).toBe(fake.connected);
  });

  it("fails with NOT_FOUND when no person matches, adding nothing", async () => {
    await expectProjectFailure(service.addMember(projectId, people.pm.id, "nobody-registered"), 404, "NOT_FOUND");
    expect(writes()).toEqual([]);
  });

  it("fails with GITHUB_USERNAME_AMBIGUOUS when more than one person matches, adding nothing", async () => {
    lookup.findPeopleByGitHubUsername.mockResolvedValue([
      { id: people.target.id, githubUsername: "dup-user" },
      { id: people.outsider.id, githubUsername: "Dup-User" },
    ]);
    await expectProjectFailure(service.addMember(projectId, people.pm.id, "dup-user"), 409, "GITHUB_USERNAME_AMBIGUOUS");
    expect(writes()).toEqual([]);
  });

  it.each([
    ["an existing developer", "Synthetic-Dev"],
    ["the product manager", "synthetic-pm"],
  ])("fails with ALREADY_MEMBER for %s, leaving the role unchanged", async (_label, username) => {
    const before = clone(fake.state);
    await expectProjectFailure(service.addMember(projectId, people.pm.id, username), 409, "ALREADY_MEMBER");
    expect(fake.state).toEqual(before);
    expect(fake.released).toBe(fake.connected);
  });

  it("maps the memberships_project_person_key unique violation to ALREADY_MEMBER (S6)", async () => {
    fake.failWhen = ({ kind, tables }) => (kind === "insert" && tables.includes("memberships")
      ? pgError("23505", "memberships_project_person_key") : undefined);
    await expectProjectFailure(service.addMember(projectId, people.pm.id, "Synthetic-Target"), 409, "ALREADY_MEMBER");
    expect(fake.released).toBe(fake.connected);
  });

  it("checks the actor's product manager role itself: a developer actor gets FORBIDDEN and nothing is added (S2)", async () => {
    await expectProjectFailure(service.addMember(projectId, people.dev.id, "Synthetic-Target"), 403, "FORBIDDEN");
    expect(writes()).toEqual([]);
    expect(fake.released).toBe(fake.connected);
  });
});

describe("ProjectService.transferProductManager (D-C, D6, S7)", () => {
  it("swaps the roles in one transaction and returns the caller's new developer view", async () => {
    const view = await service.transferProductManager(projectId, people.pm.id, "synthetic-dev");
    expect(view).toEqual({ id: projectId, key: "WEB", name: "Synthetic web project", role: "developer" });
    expect(roleOf(people.pm.id)).toBe("developer");
    expect(roleOf(people.dev.id)).toBe("product_manager");
    expect(fake.state.memberships.filter((membership) => membership.project_id === projectId && membership.role === "product_manager")).toHaveLength(1);
    const begin = fake.log.findIndex((entry) => entry.kind === "begin");
    const commit = fake.log.findIndex((entry) => entry.kind === "commit");
    const lock = fake.log.findIndex((entry) => entry.kind === "select" && entry.tables.includes("memberships") && /\bfor\s+update\b/i.test(entry.sql));
    const taskCheck = fake.log.findIndex((entry) => entry.kind === "select" && entry.tables.includes("tasks"));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(begin);
    expect(taskCheck).toBeGreaterThan(lock);
    expect(commit).toBeGreaterThan(taskCheck);
    expect(fake.released).toBe(fake.connected);
  });

  it("fails with TRANSFER_BLOCKED_OPEN_TASKS while the target has an open task", async () => {
    fake.state.tasks.push({ id: randomUUID(), project_id: projectId, number: 1, assignee_id: people.dev.id, status: "in_review", deleted_at: null });
    const before = clone(fake.state);
    await expectProjectFailure(service.transferProductManager(projectId, people.pm.id, "Synthetic-Dev"), 409, "TRANSFER_BLOCKED_OPEN_TASKS");
    expect(fake.state).toEqual(before);
    expect(fake.released).toBe(fake.connected);
  });

  it("ignores deleted and Done tasks", async () => {
    fake.state.tasks.push(
      { id: randomUUID(), project_id: projectId, number: 1, assignee_id: people.dev.id, status: "to_do", deleted_at: "2026-11-01T00:00:00.000Z" },
      { id: randomUUID(), project_id: projectId, number: 2, assignee_id: people.dev.id, status: "done", deleted_at: null },
    );
    await service.transferProductManager(projectId, people.pm.id, "Synthetic-Dev");
    expect(roleOf(people.dev.id)).toBe("product_manager");
  });

  it.each([
    ["a registered non-member", "Synthetic-Target"],
    ["the product manager themselves", "synthetic-pm"],
  ])("fails with TRANSFER_TARGET_NOT_DEVELOPER for %s", async (_label, username) => {
    const before = clone(fake.state);
    await expectProjectFailure(service.transferProductManager(projectId, people.pm.id, username), 409, "TRANSFER_TARGET_NOT_DEVELOPER");
    expect(fake.state).toEqual(before);
  });

  it("fails with NOT_FOUND for an unregistered username", async () => {
    await expectProjectFailure(service.transferProductManager(projectId, people.pm.id, "nobody-registered"), 404, "NOT_FOUND");
    expect(writes()).toEqual([]);
  });

  it("fails with GITHUB_USERNAME_AMBIGUOUS when more than one person matches", async () => {
    lookup.findPeopleByGitHubUsername.mockResolvedValue([
      { id: people.dev.id, githubUsername: "Synthetic-Dev" },
      { id: people.outsider.id, githubUsername: "synthetic-dev" },
    ]);
    await expectProjectFailure(service.transferProductManager(projectId, people.pm.id, "synthetic-dev"), 409, "GITHUB_USERNAME_AMBIGUOUS");
    expect(writes()).toEqual([]);
  });

  it("fails with FORBIDDEN for a developer actor and changes nothing", async () => {
    const before = clone(fake.state);
    await expectProjectFailure(service.transferProductManager(projectId, people.dev.id, "Synthetic-Dev"), 403, "FORBIDDEN");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("fails with FORBIDDEN and changes nothing when the caller lost the role while waiting on the locks (S7)", async () => {
    const competingTransfer = (state: State) => {
      for (const membership of state.memberships) {
        if (membership.project_id !== projectId) continue;
        if (membership.person_id === people.pm.id) membership.role = "developer";
        if (membership.person_id === people.dev.id) membership.role = "product_manager";
      }
    };
    fake.state.people.push({ id: "22222222-2222-4222-8222-222222222209", auth_user_id: randomUUID(), github_user_id: "1009", github_username: "synthetic-dev3" });
    fake.state.memberships.push({ id: randomUUID(), project_id: projectId, person_id: "22222222-2222-4222-8222-222222222209", role: "developer", version: 1 });
    const expected = clone(fake.state);
    competingTransfer(expected);
    let raced = false;
    fake.beforeStatement = ({ sql, kind, tables }) => {
      if (!raced && kind === "select" && tables.includes("memberships") && /\bfor\s+update\b/i.test(sql)) {
        raced = true;
        fake.applyCommitted(competingTransfer);
      }
    };
    await expectProjectFailure(service.transferProductManager(projectId, people.pm.id, "synthetic-dev3"), 403, "FORBIDDEN");
    expect(raced).toBe(true);
    expect(fake.state).toEqual(expected);
    expect(writes()).toEqual([]);
    expect(fake.released).toBe(fake.connected);
  });
});
