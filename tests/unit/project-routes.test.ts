import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.1 (projects-membership-4-1). No formal requirement IDs exist; cited by name:
// task-management "Signed-in people create projects", "Project membership and roles",
// "Product manager transfers the role", "Transfer targets are identified by GitHub username",
// "Projects and tasks have readable IDs" ("Project key cannot change" only); identity-and-access
// "Protected route authorization stubs" ("Project details require membership", "Project
// creation is functional") and "Protected API errors use stable safe responses".
// Decisions: design.md D1-D10, Q1-Q6, S1-S7 and the API Error Contract.
//
// The real route handlers, services and repositories run. Only external boundaries are
// replaced: Supabase Auth, server config and `pg`. The `pg` fake is a small in-memory model of
// the app tables that evaluates the statements it receives with PostgreSQL's semantics (see
// the fake's own comment) and throws on any statement it cannot read, instead of guessing.
// Tests assert recorded behaviour and the S6 seam (tables, statement kinds, transactions,
// `FOR UPDATE`, SQLSTATE 23505 with constraint names), not SQL text. All identities and rows
// are synthetic.
const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

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
  createRequestSupabaseClient: async () => ({ auth: { getUser: boundary.getUser } }),
}));
vi.mock("pg", () => {
  class Pool {
    query = boundary.query;
    connect = boundary.connect;
  }
  return { Pool, default: { Pool } };
});

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
// Synthetic team
// ---------------------------------------------------------------------------

const origin = "https://synthetic-app.example";
const projectId = "33333333-3333-4333-8333-333333333333";
const missingProjectId = "99999999-9999-4999-8999-999999999999";
const unmappedAuthId = "10101010-1010-4010-8010-101010101010";

function person(id: string, authId: string, githubUserId: string, username: string): PersonRow {
  return { id, auth_user_id: authId, github_user_id: githubUserId, github_username: username };
}

const people = {
  pm: person("22222222-2222-4222-8222-222222222201", "11111111-1111-4111-8111-111111111101", "1001", "synthetic-pm"),
  dev: person("22222222-2222-4222-8222-222222222202", "11111111-1111-4111-8111-111111111102", "1002", "Synthetic-Dev"),
  dev2: person("22222222-2222-4222-8222-222222222203", "11111111-1111-4111-8111-111111111103", "1003", "Synthetic-Dev2"),
  target: person("22222222-2222-4222-8222-222222222204", "11111111-1111-4111-8111-111111111104", "1004", "Synthetic-Target"),
  outsider: person("22222222-2222-4222-8222-222222222205", "11111111-1111-4111-8111-111111111105", "1005", "synthetic-outsider"),
  dupA: person("22222222-2222-4222-8222-222222222206", "11111111-1111-4111-8111-111111111106", "1006", "dup-user"),
  dupB: person("22222222-2222-4222-8222-222222222207", "11111111-1111-4111-8111-111111111107", "1007", "Dup-User"),
  long: person("22222222-2222-4222-8222-222222222208", "11111111-1111-4111-8111-111111111108", "1008", "a".repeat(39)),
} as const;

let fake: FakeDatabase;

function seed(): void {
  fake.state.people.push(...Object.values(people).map((entry) => ({ ...entry })));
  fake.state.projects.push({ id: projectId, key: "WEB", name: "Synthetic web project", last_task_number: 0, version: 1 });
  fake.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: people.pm.id, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev.id, role: "developer", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: people.dev2.id, role: "developer", version: 1 },
  );
}

function addTask(assigneeId: string, status: string, deletedAt: string | null = null): void {
  const project = fake.state.projects.find((entry) => entry.id === projectId)!;
  project.last_task_number += 1;
  fake.state.tasks.push({ id: randomUUID(), project_id: projectId, number: project.last_task_number, assignee_id: assigneeId, status, deleted_at: deletedAt });
}

function signInAs(authUserId: string): void {
  boundary.getUser.mockResolvedValue({
    data: { user: {
      id: authUserId,
      identities: [{ provider: "github", provider_id: "424242", identity_data: { user_name: "synthetic-session-user" } }],
    } },
    error: null,
  });
}

function signOut(): void {
  boundary.getUser.mockResolvedValue({ data: { user: null }, error: null });
}

function roleOf(personId: string, project = projectId): Role | undefined {
  return fake.state.memberships.find((membership) => membership.project_id === project && membership.person_id === personId)?.role;
}

function productManagers(project = projectId): string[] {
  return fake.state.memberships.filter((membership) => membership.project_id === project && membership.role === "product_manager").map((membership) => membership.person_id);
}

// ---------------------------------------------------------------------------
// Requests and assertions
// ---------------------------------------------------------------------------

type Route = "create" | "read" | "members" | "transfer";

interface CallOptions {
  projectId?: string;
  body?: unknown;
  raw?: string;
  origin?: string | null;
}

async function call(route: Route, options: CallOptions = {}): Promise<Response> {
  const id = options.projectId ?? projectId;
  const path = route === "create" ? "/api/v1/projects"
    : route === "read" ? `/api/v1/projects/${id}`
      : route === "members" ? `/api/v1/projects/${id}/members`
        : `/api/v1/projects/${id}/product-manager-transfer`;
  const headers: Record<string, string> = {};
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (requestOrigin !== null) headers.origin = requestOrigin;
  const method = route === "read" ? "GET" : "POST";
  if (method === "POST") headers["content-type"] = "application/json";
  const body = method === "GET" ? undefined : options.raw ?? JSON.stringify(options.body ?? {});
  const request = new NextRequest(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
  const context = { params: Promise.resolve({ projectId: id }) };
  switch (route) {
    case "create": return (await import("../../src/app/api/v1/projects/route")).POST(request);
    case "read": return (await import("../../src/app/api/v1/projects/[projectId]/route")).GET(request, context);
    case "members": return (await import("../../src/app/api/v1/projects/[projectId]/members/route")).POST(request, context);
    case "transfer": return (await import("../../src/app/api/v1/projects/[projectId]/product-manager-transfer/route")).POST(request, context);
  }
}

const stableMessages: Record<string, string> = {
  INVALID_REQUEST: "Invalid request",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Insufficient permissions",
  NOT_FOUND: "Resource not found",
  INTERNAL_ERROR: "Internal server error",
};

/**
 * Asserts the safe error envelope. Codes with a recorded message (identity-and-access
 * "Error codes and messages are stable") are checked exactly; the new 409 codes are checked
 * only for a non-empty message that contains none of the submitted values (Q2).
 */
async function expectError(response: Response, status: number, code: string, submitted: string[] = []): Promise<string> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  expect(text).not.toContain(PRIVATE_DETAIL);
  const body = JSON.parse(text) as { error: { code: string; message: string } };
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  if (stableMessages[code]) {
    expect(body.error.message).toBe(stableMessages[code]);
  } else {
    expect(body.error.message.trim()).not.toBe("");
  }
  for (const value of submitted) {
    expect(body.error.message).not.toContain(value);
  }
  return body.error.message;
}

async function expectSuccess(response: Response, status: number): Promise<unknown> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response.json();
}

function writes(): LogEntry[] {
  return fake.log.filter((entry) => entry.kind === "insert" || entry.kind === "update" || entry.kind === "delete");
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = new FakeDatabase();
  seed();
  boundary.query.mockImplementation(fake.query);
  boundary.connect.mockImplementation(async () => ({ query: boundary.query, release: boundary.release }));
  signInAs(people.pm.auth_user_id);
});

afterEach(() => {
  expect(fake.unexpected).toEqual([]);
  // Every client taken for a transaction is released (S6).
  expect(boundary.release).toHaveBeenCalledTimes(boundary.connect.mock.calls.length);
});

// ---------------------------------------------------------------------------
// POST /api/v1/projects
// ---------------------------------------------------------------------------

describe("POST /api/v1/projects (Signed-in people create projects)", () => {
  it("creates the project and makes the creator its only product manager", async () => {
    signInAs(people.outsider.auth_user_id);
    const body = await expectSuccess(await call("create", { body: { key: "NEWP", name: "Synthetic new project" } }), 201) as Record<string, unknown>;
    expect(body).toEqual({ id: expect.stringMatching(UUID_PATTERN), key: "NEWP", name: "Synthetic new project", role: "product_manager" });
    const project = fake.state.projects.find((entry) => entry.key === "NEWP");
    expect(project).toMatchObject({ id: body.id, name: "Synthetic new project" });
    expect(fake.state.memberships.filter((membership) => membership.project_id === body.id)).toEqual([
      expect.objectContaining({ person_id: people.outsider.id, role: "product_manager" }),
    ]);
  });

  it("creates the project and its product manager membership in one transaction", async () => {
    await expectSuccess(await call("create", { body: { key: "TXN", name: "Synthetic transaction project" } }), 201);
    const begin = fake.log.findIndex((entry) => entry.kind === "begin");
    const commit = fake.log.findIndex((entry) => entry.kind === "commit");
    const projectInsert = fake.log.findIndex((entry) => entry.kind === "insert" && entry.tables.includes("projects"));
    const membershipInsert = fake.log.findIndex((entry) => entry.kind === "insert" && entry.tables.includes("memberships"));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(projectInsert);
    expect(projectInsert).toBeLessThan(commit);
    expect(begin).toBeLessThan(membershipInsert);
    expect(membershipInsert).toBeLessThan(commit);
  });

  it("trims the name before storing and returning it", async () => {
    const body = await expectSuccess(await call("create", { body: { key: "TRIM", name: "   Synthetic trimmed   " } }), 201);
    expect(body).toMatchObject({ key: "TRIM", name: "Synthetic trimmed" });
    expect(fake.state.projects.find((entry) => entry.key === "TRIM")?.name).toBe("Synthetic trimmed");
  });

  it.each([
    ["two characters", "AB"],
    ["ten characters", "A123456789"],
  ])("accepts a key with %s", async (_label, key) => {
    const body = await expectSuccess(await call("create", { body: { key, name: "Synthetic boundary" } }), 201);
    expect(body).toMatchObject({ key });
  });

  it("accepts a name of exactly 100 characters after trimming", async () => {
    const name = "N".repeat(100);
    const body = await expectSuccess(await call("create", { body: { key: "LONG", name: `  ${name}  ` } }), 201);
    expect(body).toMatchObject({ name });
  });

  it("lets a developer in another project create a project and keep the developer role", async () => {
    signInAs(people.dev.auth_user_id);
    const body = await expectSuccess(await call("create", { body: { key: "SIDE", name: "Synthetic side project" } }), 201) as { id: string };
    expect(roleOf(people.dev.id)).toBe("developer");
    expect(roleOf(people.dev.id, body.id)).toBe("product_manager");
  });

  it("returns 401 without a session and creates nothing", async () => {
    signOut();
    const before = clone(fake.state);
    await expectError(await call("create", { body: { key: "ANON", name: "Synthetic" } }), 401, "UNAUTHENTICATED");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("returns 401 UNAUTHENTICATED for a valid session with no registered person (Q6)", async () => {
    signInAs(unmappedAuthId);
    const before = clone(fake.state);
    await expectError(await call("create", { body: { key: "NOPE", name: "Synthetic" } }), 401, "UNAUTHENTICATED");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["lowercase", "web"],
    ["mixed case", "Web"],
    ["one character", "W"],
    ["eleven characters", "A1234567890"],
    ["a leading digit", "1WEB"],
    ["a hyphen", "WE-B"],
    ["surrounding spaces", " WEB "],
    ["an empty string", ""],
    ["a non-ASCII letter", "ÄBC"],
  ])("rejects a key with %s and does not normalize it", async (_label, key) => {
    const before = clone(fake.state);
    await expectError(await call("create", { body: { key, name: "Synthetic" } }), 400, "INVALID_REQUEST");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["a non-string key", { key: 42, name: "Synthetic" }],
    ["a missing key", { name: "Synthetic" }],
    ["a blank name", { key: "BLNK", name: "" }],
    ["a whitespace-only name", { key: "BLNK", name: "    " }],
    ["a 101-character name", { key: "BLNK", name: "N".repeat(101) }],
    ["a non-string name", { key: "BLNK", name: 7 }],
    ["a missing name", { key: "BLNK" }],
    ["an extra field", { key: "BLNK", name: "Synthetic", role: "developer" }],
    ["a null body", null],
    ["an array body", [{ key: "BLNK", name: "Synthetic" }]],
  ])("rejects %s with 400 and creates nothing", async (_label, body) => {
    const before = clone(fake.state);
    await expectError(await call("create", { raw: JSON.stringify(body) }), 400, "INVALID_REQUEST");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("rejects malformed JSON with 400", async () => {
    await expectError(await call("create", { raw: "{broken" }), 400, "INVALID_REQUEST");
    expect(writes()).toEqual([]);
  });

  it("checks the body before the session (Q4): a bad body without a session is 400", async () => {
    signOut();
    await expectError(await call("create", { body: { key: "web", name: "Synthetic" } }), 400, "INVALID_REQUEST");
  });

  it("checks the body before the person lookup (Q4, Q6): a bad body with no registered person is 400", async () => {
    signInAs(unmappedAuthId);
    await expectError(await call("create", { body: { key: "WEB", name: "" } }), 400, "INVALID_REQUEST");
  });

  it("returns 409 PROJECT_KEY_TAKEN for a duplicate key and leaves the existing project unchanged", async () => {
    fake.state.projects.push({ id: missingProjectId, key: "ZQX9", name: "Synthetic existing", last_task_number: 0, version: 1 });
    const before = clone(fake.state);
    signInAs(people.outsider.auth_user_id);
    await expectError(await call("create", { body: { key: "ZQX9", name: "Synthetic duplicate name" } }), 409, "PROJECT_KEY_TAKEN", ["ZQX9", "Synthetic duplicate name"]);
    expect(fake.state).toEqual(before);
  });

  it("leaves no project when creating the product manager membership fails (atomic creation)", async () => {
    fake.failWhen = ({ kind, tables }) => (kind === "insert" && tables.includes("memberships") ? new Error(PRIVATE_DETAIL) : undefined);
    const before = clone(fake.state);
    await expectError(await call("create", { body: { key: "ATOM", name: "Synthetic atomic" } }), 500, "INTERNAL_ERROR");
    expect(fake.state).toEqual(before);
    expect(fake.log.some((entry) => entry.kind === "rollback")).toBe(true);
    expect(fake.log.some((entry) => entry.kind === "commit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{projectId}
// ---------------------------------------------------------------------------

describe("GET /api/v1/projects/{projectId} (Project details require membership)", () => {
  it.each([
    ["product manager", people.pm, "product_manager"],
    ["developer", people.dev, "developer"],
  ] as const)("returns the project and the %s's role", async (_label, member, role) => {
    signInAs(member.auth_user_id);
    expect(await expectSuccess(await call("read"), 200)).toEqual({ id: projectId, key: "WEB", name: "Synthetic web project", role });
    expect(writes()).toEqual([]);
  });

  it("returns 404 to a signed-in non-member without project contents", async () => {
    signInAs(people.outsider.auth_user_id);
    const message = await expectError(await call("read"), 404, "NOT_FOUND");
    expect(message).not.toContain("WEB");
  });

  it("returns 404 for a project that does not exist", async () => {
    await expectError(await call("read", { projectId: missingProjectId }), 404, "NOT_FOUND");
  });

  it("returns 404 to a valid session with no registered person (project-scoped routes keep 404, Q6)", async () => {
    signInAs(unmappedAuthId);
    await expectError(await call("read"), 404, "NOT_FOUND");
  });

  it("returns 401 without a session", async () => {
    signOut();
    await expectError(await call("read"), 401, "UNAUTHENTICATED");
  });

  it("returns 400 for a malformed project UUID", async () => {
    await expectError(await call("read", { projectId: "not-a-uuid" }), 400, "INVALID_REQUEST");
  });

  it.each([
    ["no Origin header", null],
    ["a foreign Origin", "https://evil.example"],
  ])("has no Origin check (Q4): a member with %s still gets 200", async (_label, requestOrigin) => {
    expect((await call("read", { origin: requestOrigin })).status).toBe(200);
  });

  it("checks the path ID first (Q4): a bad UUID without a session or Origin is 400", async () => {
    signOut();
    await expectError(await call("read", { projectId: "not-a-uuid", origin: null }), 400, "INVALID_REQUEST");
  });

  it("returns a safe 500 when a lookup fails operationally", async () => {
    fake.failWhen = ({ kind }) => (kind === "select" ? new Error(PRIVATE_DETAIL) : undefined);
    await expectError(await call("read"), 500, "INTERNAL_ERROR");
  });

  it("exports no handler that could change the project key (Project key cannot change, A-2)", async () => {
    const projectRoute = await import("../../src/app/api/v1/projects/[projectId]/route") as Record<string, unknown>;
    expect(projectRoute.PATCH).toBeUndefined();
    expect(projectRoute.PUT).toBeUndefined();
    expect(projectRoute.DELETE).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectId}/members
// ---------------------------------------------------------------------------

describe("POST /api/v1/projects/{projectId}/members (Project membership and roles)", () => {
  it("adds a registered person as a developer and returns 201 with the stored username (Q1)", async () => {
    const body = await expectSuccess(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 201);
    expect(body).toEqual({ personId: people.target.id, githubUsername: "Synthetic-Target", role: "developer" });
    expect(roleOf(people.target.id)).toBe("developer");
  });

  it("matches the username case-insensitively and returns the stored casing", async () => {
    const body = await expectSuccess(await call("members", { body: { githubUsername: "sYNTHETIC-tARGET" } }), 201);
    expect(body).toEqual({ personId: people.target.id, githubUsername: "Synthetic-Target", role: "developer" });
  });

  it("trims leading and trailing spaces before matching (Q3)", async () => {
    const body = await expectSuccess(await call("members", { body: { githubUsername: "   Synthetic-Target  " } }), 201);
    expect(body).toMatchObject({ personId: people.target.id });
  });

  it("accepts a 39-character username", async () => {
    const body = await expectSuccess(await call("members", { body: { githubUsername: people.long.github_username } }), 201);
    expect(body).toMatchObject({ personId: people.long.id, githubUsername: people.long.github_username });
  });

  it("lets the new developer see the project", async () => {
    await expectSuccess(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 201);
    signInAs(people.target.auth_user_id);
    expect(await expectSuccess(await call("read"), 200)).toEqual({ id: projectId, key: "WEB", name: "Synthetic web project", role: "developer" });
  });

  it("keeps a person's role in another project when they are added to a second one", async () => {
    const otherProjectId = "44444444-4444-4444-8444-444444444444";
    fake.state.projects.push({ id: otherProjectId, key: "OTHER", name: "Synthetic other", last_task_number: 0, version: 1 });
    fake.state.memberships.push({ id: randomUUID(), project_id: otherProjectId, person_id: people.target.id, role: "product_manager", version: 1 });
    await expectSuccess(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 201);
    expect(roleOf(people.target.id)).toBe("developer");
    expect(roleOf(people.target.id, otherProjectId)).toBe("product_manager");
  });

  it("returns 404 NOT_FOUND with the generic message for an unregistered username", async () => {
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "nobody-registered" } }), 404, "NOT_FOUND", ["nobody-registered"]);
    expect(fake.state).toEqual(before);
  });

  it("returns 409 GITHUB_USERNAME_AMBIGUOUS when the username matches more than one person", async () => {
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "DUP-user" } }), 409, "GITHUB_USERNAME_AMBIGUOUS", ["DUP-user", "dup-user", "Dup-User"]);
    expect(fake.state).toEqual(before);
  });

  it.each([
    ["a developer", "Synthetic-Dev"],
    ["the product manager themselves", "synthetic-pm"],
  ])("returns 409 ALREADY_MEMBER when adding %s, leaving the role unchanged", async (_label, username) => {
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: username } }), 409, "ALREADY_MEMBER", [username]);
    expect(fake.state).toEqual(before);
  });

  it("maps a unique violation on the membership insert to 409 ALREADY_MEMBER (S6)", async () => {
    fake.failWhen = ({ kind, tables }) => (kind === "insert" && tables.includes("memberships")
      ? pgError("23505", "memberships_project_person_key") : undefined);
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 409, "ALREADY_MEMBER", ["Synthetic-Target"]);
    expect(fake.state).toEqual(before);
  });

  it("refuses a developer with 403 and changes nothing", async () => {
    signInAs(people.dev.auth_user_id);
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 403, "FORBIDDEN");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("returns 404 to a non-member and changes nothing", async () => {
    signInAs(people.outsider.auth_user_id);
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 404, "NOT_FOUND");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("returns 404 for a project that does not exist", async () => {
    await expectError(await call("members", { projectId: missingProjectId, body: { githubUsername: "Synthetic-Target" } }), 404, "NOT_FOUND");
    expect(writes()).toEqual([]);
  });

  it("returns 404 to a valid session with no registered person", async () => {
    signInAs(unmappedAuthId);
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 404, "NOT_FOUND");
    expect(writes()).toEqual([]);
  });

  it("returns 401 without a session", async () => {
    signOut();
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 401, "UNAUTHENTICATED");
    expect(writes()).toEqual([]);
  });

  it.each([
    ["an extra field", { githubUsername: "Synthetic-Target", role: "developer" }],
    ["a missing field", {}],
    ["a number", { githubUsername: 1004 }],
    ["null", { githubUsername: null }],
    ["an array", { githubUsername: ["Synthetic-Target"] }],
    ["an object", { githubUsername: { name: "Synthetic-Target" } }],
    ["an empty string", { githubUsername: "" }],
    ["spaces only", { githubUsername: "    " }],
    ["40 characters", { githubUsername: "a".repeat(40) }],
    ["40 characters after trimming", { githubUsername: ` ${"a".repeat(40)} ` }],
    ["an underscore", { githubUsername: "bad_name" }],
    ["a dot", { githubUsername: "bad.name" }],
    ["an inner space", { githubUsername: "bad name" }],
    ["a non-ASCII letter", { githubUsername: "naïve" }],
    ["a null body", null],
    ["an array body", ["Synthetic-Target"]],
    ["a string body", "Synthetic-Target"],
  ])("rejects a body with %s with 400 and changes nothing (Q3)", async (_label, body) => {
    const before = clone(fake.state);
    await expectError(await call("members", { raw: JSON.stringify(body) }), 400, "INVALID_REQUEST");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("rejects malformed JSON with 400", async () => {
    await expectError(await call("members", { raw: "{broken" }), 400, "INVALID_REQUEST");
  });

  it("rejects a malformed project UUID with 400", async () => {
    await expectError(await call("members", { projectId: "not-a-uuid", body: { githubUsername: "Synthetic-Target" } }), 400, "INVALID_REQUEST");
  });

  describe("check order (Q4)", () => {
    it("checks the body before the session: a bad body without a session is 400, not 401", async () => {
      signOut();
      await expectError(await call("members", { body: { githubUsername: "bad_name" } }), 400, "INVALID_REQUEST");
    });

    it("checks the path ID before the session: a bad UUID without a session is 400, not 401", async () => {
      signOut();
      await expectError(await call("members", { projectId: "not-a-uuid", body: { githubUsername: "Synthetic-Target" } }), 400, "INVALID_REQUEST");
    });

    it("checks the session before membership: no session on a project the caller cannot see is 401", async () => {
      signOut();
      await expectError(await call("members", { projectId: missingProjectId, body: { githubUsername: "Synthetic-Target" } }), 401, "UNAUTHENTICATED");
    });

    it("checks membership before role: a non-member on this PM-only route is 404, not 403", async () => {
      signInAs(people.outsider.auth_user_id);
      await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 404, "NOT_FOUND");
    });

    it.each([
      ["an unregistered username", "nobody-registered"],
      ["an ambiguous username", "dup-user"],
      ["an existing member", "Synthetic-Dev2"],
    ])("checks role before domain errors: a developer submitting %s gets 403", async (_label, username) => {
      signInAs(people.dev.auth_user_id);
      await expectError(await call("members", { body: { githubUsername: username } }), 403, "FORBIDDEN");
    });
  });

  it("returns a safe 500 when the database fails operationally", async () => {
    fake.failWhen = ({ kind, tables }) => (kind === "insert" && tables.includes("memberships") ? new Error(PRIVATE_DETAIL) : undefined);
    const before = clone(fake.state);
    await expectError(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 500, "INTERNAL_ERROR");
    expect(fake.state).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectId}/product-manager-transfer
// ---------------------------------------------------------------------------

describe("POST /api/v1/projects/{projectId}/product-manager-transfer (Product manager transfers the role)", () => {
  it("swaps the roles and returns 200 with the caller's new developer role (Q1)", async () => {
    const body = await expectSuccess(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 200);
    expect(body).toEqual({ id: projectId, key: "WEB", name: "Synthetic web project", role: "developer" });
    expect(roleOf(people.dev.id)).toBe("product_manager");
    expect(roleOf(people.pm.id)).toBe("developer");
    expect(productManagers()).toEqual([people.dev.id]);
  });

  it("finds the target in any letter case", async () => {
    await expectSuccess(await call("transfer", { body: { githubUsername: "SYNTHETIC-dev" } }), 200);
    expect(productManagers()).toEqual([people.dev.id]);
  });

  it("locks the membership rows FOR UPDATE inside the transaction before the open-task check (D6, S6)", async () => {
    await expectSuccess(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 200);
    const begin = fake.log.findIndex((entry) => entry.kind === "begin");
    const commit = fake.log.findIndex((entry) => entry.kind === "commit");
    const locks = fake.log
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.kind === "select" && entry.tables.includes("memberships") && /\bfor\s+update\b/i.test(entry.sql));
    expect(locks.length).toBeGreaterThan(0);
    const lockedPeople = new Set(locks.flatMap(({ entry }) => entry.memberships.map((row) => row.person_id)));
    expect([...lockedPeople]).toEqual(expect.arrayContaining([people.pm.id, people.dev.id]));
    const taskCheck = fake.log.findIndex((entry) => entry.kind === "select" && entry.tables.includes("tasks"));
    for (const { index } of locks) {
      expect(index).toBeGreaterThan(begin);
      expect(index).toBeLessThan(taskCheck);
    }
    expect(taskCheck).toBeLessThan(commit);
    const roleWrites = writes().map((entry) => fake.log.indexOf(entry));
    expect(roleWrites.length).toBeGreaterThan(0);
    for (const index of roleWrites) {
      expect(index).toBeGreaterThan(taskCheck);
      expect(index).toBeLessThan(commit);
    }
  });

  it.each(["to_do", "in_progress", "in_review"])("refuses with 409 TRANSFER_BLOCKED_OPEN_TASKS while the target has a %s task", async (status) => {
    addTask(people.dev.id, status);
    const before = clone(fake.state);
    const message = await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 409, "TRANSFER_BLOCKED_OPEN_TASKS", ["Synthetic-Dev"]);
    expect(message).toMatch(/reassign/i);
    expect(fake.state).toEqual(before);
  });

  it("is not blocked by the target's deleted tasks that are not Done", async () => {
    addTask(people.dev.id, "in_progress", "2026-11-01T00:00:00.000Z");
    addTask(people.dev.id, "to_do", "2026-11-01T00:00:00.000Z");
    await expectSuccess(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 200);
    expect(productManagers()).toEqual([people.dev.id]);
  });

  it("is not blocked by the target's Done tasks or by other developers' open tasks", async () => {
    addTask(people.dev.id, "done");
    addTask(people.dev2.id, "in_progress");
    await expectSuccess(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 200);
    expect(productManagers()).toEqual([people.dev.id]);
  });

  it.each([
    ["a registered person who is not a member", "Synthetic-Target"],
    ["the product manager themselves", "synthetic-pm"],
  ])("returns 409 TRANSFER_TARGET_NOT_DEVELOPER for %s, leaving roles unchanged", async (_label, username) => {
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: username } }), 409, "TRANSFER_TARGET_NOT_DEVELOPER", [username]);
    expect(fake.state).toEqual(before);
  });

  it("returns 404 NOT_FOUND with the generic message for an unregistered username", async () => {
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: "nobody-registered" } }), 404, "NOT_FOUND", ["nobody-registered"]);
    expect(fake.state).toEqual(before);
  });

  it("returns 409 GITHUB_USERNAME_AMBIGUOUS when the username matches more than one person", async () => {
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: "dup-USER" } }), 409, "GITHUB_USERNAME_AMBIGUOUS", ["dup-USER"]);
    expect(fake.state).toEqual(before);
  });

  it("refuses a developer trying to take the role with 403 and changes nothing", async () => {
    signInAs(people.dev.auth_user_id);
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 403, "FORBIDDEN");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("returns 404 to a non-member and changes nothing", async () => {
    signInAs(people.outsider.auth_user_id);
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 404, "NOT_FOUND");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("returns 401 without a session", async () => {
    signOut();
    await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 401, "UNAUTHENTICATED");
    expect(writes()).toEqual([]);
  });

  it.each([
    ["an extra field", { githubUsername: "Synthetic-Dev", force: true }],
    ["a non-string value", { githubUsername: 1002 }],
    ["an empty value after trimming", { githubUsername: "   " }],
    ["40 characters", { githubUsername: "d".repeat(40) }],
    ["a disallowed character", { githubUsername: "Synthetic_Dev" }],
    ["a missing field", {}],
  ])("rejects a body with %s with 400, leaving roles unchanged (Q3)", async (_label, body) => {
    const before = clone(fake.state);
    await expectError(await call("transfer", { body }), 400, "INVALID_REQUEST");
    expect(fake.state).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it("trims the username before matching (Q3)", async () => {
    await expectSuccess(await call("transfer", { body: { githubUsername: "  Synthetic-Dev " } }), 200);
    expect(productManagers()).toEqual([people.dev.id]);
  });

  describe("check order (Q4)", () => {
    it("checks the body before the session: a bad body without a session is 400, not 401", async () => {
      signOut();
      await expectError(await call("transfer", { body: { githubUsername: "" } }), 400, "INVALID_REQUEST");
    });

    it("checks membership before role: a non-member is 404, not 403", async () => {
      signInAs(people.outsider.auth_user_id);
      await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 404, "NOT_FOUND");
    });

    it.each([
      ["an unregistered username", "nobody-registered"],
      ["a target with open tasks", "Synthetic-Dev2"],
    ])("checks role before domain errors: a developer submitting %s gets 403", async (_label, username) => {
      addTask(people.dev2.id, "to_do");
      signInAs(people.dev.auth_user_id);
      await expectError(await call("transfer", { body: { githubUsername: username } }), 403, "FORBIDDEN");
    });
  });

  describe("competing writes", () => {
    it("returns 403 FORBIDDEN and changes nothing when a competing transfer wins while it waits on the locks (S7)", async () => {
      // The handler's earlier check sees the caller as product manager. While the transfer
      // waits on the membership locks, another transfer to dev2 commits.
      const competingTransfer = (state: State) => {
        for (const membership of state.memberships) {
          if (membership.project_id !== projectId) continue;
          if (membership.person_id === people.pm.id) membership.role = "developer";
          if (membership.person_id === people.dev2.id) membership.role = "product_manager";
        }
      };
      const afterRace = clone(fake.state);
      competingTransfer(afterRace);
      let raced = false;
      fake.beforeStatement = ({ sql, kind, tables }) => {
        if (!raced && kind === "select" && tables.includes("memberships") && /\bfor\s+update\b/i.test(sql)) {
          raced = true;
          fake.applyCommitted(competingTransfer);
        }
      };
      const response = await call("transfer", { body: { githubUsername: "Synthetic-Dev" } });
      expect(raced).toBe(true);
      await expectError(response, 403, "FORBIDDEN");
      expect(productManagers()).toEqual([people.dev2.id]);
      expect(roleOf(people.dev.id)).toBe("developer");
      expect(fake.state).toEqual(afterRace);
      expect(writes()).toEqual([]);
    });

    it("never completes while an assignment to the target commits during the lock wait (D6)", async () => {
      let raced = false;
      fake.beforeStatement = ({ sql, kind, tables }) => {
        if (!raced && kind === "select" && tables.includes("memberships") && /\bfor\s+update\b/i.test(sql)) {
          raced = true;
          fake.applyCommitted((state) => {
            const project = state.projects.find((entry) => entry.id === projectId)!;
            project.last_task_number += 1;
            state.tasks.push({ id: randomUUID(), project_id: projectId, number: project.last_task_number, assignee_id: people.dev.id, status: "to_do", deleted_at: null });
          });
        }
      };
      await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 409, "TRANSFER_BLOCKED_OPEN_TASKS");
      expect(raced).toBe(true);
      expect(productManagers()).toEqual([people.pm.id]);
      expect(roleOf(people.dev.id)).toBe("developer");
    });
  });

  it("returns a safe 500 and keeps the roles when a role update fails operationally", async () => {
    fake.failWhen = ({ kind }) => (kind === "update" ? new Error(PRIVATE_DETAIL) : undefined);
    const before = clone(fake.state);
    await expectError(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 500, "INTERNAL_ERROR");
    expect(fake.state).toEqual(before);
  });

  it("does not change the project key (Project key cannot change, A-2)", async () => {
    await expectSuccess(await call("members", { body: { githubUsername: "Synthetic-Target" } }), 201);
    await expectSuccess(await call("transfer", { body: { githubUsername: "Synthetic-Dev" } }), 200);
    expect(fake.state.projects.find((entry) => entry.id === projectId)?.key).toBe("WEB");
    expect(fake.log.some((entry) => entry.kind === "update" && entry.tables.includes("projects"))).toBe(false);
  });
});
