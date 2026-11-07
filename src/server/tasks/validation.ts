import "server-only";

import type {
  BodyErrorCode,
  CreateTaskInput,
  CriterionInput,
  DeleteTaskInput,
  EditTaskInput,
  ParseResult,
  ReassignTaskInput,
} from "./types";

// design.md T2, T4, T5, T6 and T7. Text is trimmed and counted in Unicode code points (R1).
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5_000;
const CRITERIA_MAX = 20;
const CRITERION_MAX = 500;
const BRANCH_NAME_MAX = 255;
// The largest value of the integer `version` column.
const VERSION_MAX = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BRANCH_CHARACTERS = /^[A-Za-z0-9._/-]+$/;
const LINE_BREAK = /[\r\n]/;

const CREATE_FIELDS: ReadonlySet<string> = new Set([
  "title", "description", "assigneeId", "dueDate", "acceptanceCriteria", "branchName",
]);
const EDIT_FIELDS: ReadonlySet<string> = new Set([
  "version", "title", "description", "dueDate", "branchName", "acceptanceCriteria",
]);
const CRITERION_FIELDS: ReadonlySet<string> = new Set(["id", "description"]);

/** Thrown inside this module only, and turned into a ParseResult at each entry point. */
class BodyError extends Error {
  constructor(readonly code: BodyErrorCode) {
    super(code);
  }
}

function invalid(): never {
  throw new BodyError("INVALID_REQUEST");
}

/** Returns the body's own fields with `undefined` values dropped (JSON cannot send them). */
function objectFields(body: unknown, allowed: ReadonlySet<string>): Map<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) invalid();
  const fields = new Map(Object.entries(body).filter(([, value]) => value !== undefined));
  for (const key of fields.keys()) if (!allowed.has(key)) invalid();
  return fields;
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

function trimmedText(value: unknown, max: number): string {
  if (typeof value !== "string") invalid();
  const text = value.trim();
  const length = codePoints(text);
  if (length < 1 || length > max) invalid();
  return text;
}

function title(value: unknown): string {
  const text = trimmedText(value, TITLE_MAX);
  if (LINE_BREAK.test(text)) invalid();
  return text;
}

function description(value: unknown): string {
  return trimmedText(value, DESCRIPTION_MAX);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A real calendar date written as `YYYY-MM-DD` (T5). */
function dueDate(value: unknown): string {
  if (typeof value !== "string") invalid();
  const match = DATE_PATTERN.exec(value);
  if (!match) invalid();
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) invalid();
  return value;
}

/** `null` clears the branch; a string must be a safe Git branch name after trimming (T5). */
function branchName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid();
  const name = value.trim();
  if (name.length < 1 || name.length > BRANCH_NAME_MAX || !BRANCH_CHARACTERS.test(name)) invalid();
  if (name.includes("..") || name.includes("//") || name.startsWith("/") || name.startsWith("-")) invalid();
  if (name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) invalid();
  return name;
}

/** A UUID in canonical lowercase, so IDs compare equal to those PostgreSQL returns. */
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > VERSION_MAX) invalid();
  return value;
}

/** Validates the list shape; an empty list is reported after every other check (T7). */
function criteriaList<T>(value: unknown, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > CRITERIA_MAX) invalid();
  return value.map(item);
}

function criterionText(value: unknown): string {
  return trimmedText(value, CRITERION_MAX);
}

function criterionInput(value: unknown): CriterionInput {
  const fields = objectFields(value, CRITERION_FIELDS);
  if (!fields.has("description")) invalid();
  const text = criterionText(fields.get("description"));
  return fields.has("id") ? { id: uuid(fields.get("id")), description: text } : { description: text };
}

function required(fields: Map<string, unknown>, name: string): unknown {
  if (!fields.has(name)) invalid();
  return fields.get(name);
}

function parse<T>(read: () => T): ParseResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof BodyError) return { ok: false, code: error.code };
    throw error;
  }
}

/** `POST .../tasks`: exactly the T2 fields; missing or empty criteria come last (T7). */
export function parseCreateTaskBody(body: unknown): ParseResult<CreateTaskInput> {
  return parse(() => {
    const fields = objectFields(body, CREATE_FIELDS);
    const criteria = fields.has("acceptanceCriteria") ? criteriaList(fields.get("acceptanceCriteria"), criterionText) : [];
    const input: CreateTaskInput = {
      title: title(required(fields, "title")),
      description: description(required(fields, "description")),
      assigneeId: uuid(required(fields, "assigneeId")),
      dueDate: dueDate(required(fields, "dueDate")),
      branchName: fields.has("branchName") ? branchName(fields.get("branchName")) : null,
      acceptanceCriteria: criteria,
    };
    if (criteria.length === 0) throw new BodyError("ACCEPTANCE_CRITERIA_REQUIRED");
    return input;
  });
}

/** `PATCH .../tasks/{taskId}`: `version` and at least one editable field (T4). */
export function parseEditTaskBody(body: unknown): ParseResult<EditTaskInput> {
  return parse(() => {
    const fields = objectFields(body, EDIT_FIELDS);
    const input: { -readonly [K in keyof EditTaskInput]: EditTaskInput[K] } = { version: version(required(fields, "version")) };
    if (fields.size < 2) invalid();
    if (fields.has("title")) input.title = title(fields.get("title"));
    if (fields.has("description")) input.description = description(fields.get("description"));
    if (fields.has("dueDate")) input.dueDate = dueDate(fields.get("dueDate"));
    if (fields.has("branchName")) input.branchName = branchName(fields.get("branchName"));
    if (fields.has("acceptanceCriteria")) {
      const criteria = criteriaList(fields.get("acceptanceCriteria"), criterionInput);
      const ids = criteria.flatMap((criterion) => criterion.id === undefined ? [] : [criterion.id]);
      if (new Set(ids).size !== ids.length) invalid();
      if (criteria.length === 0) throw new BodyError("ACCEPTANCE_CRITERIA_REQUIRED");
      input.acceptanceCriteria = criteria;
    }
    return input;
  });
}

/** `PUT .../tasks/{taskId}/assignee`: exactly `{assigneeId, version}` (T9). */
export function parseReassignTaskBody(body: unknown): ParseResult<ReassignTaskInput> {
  return parse(() => {
    const fields = objectFields(body, new Set(["assigneeId", "version"]));
    return { assigneeId: uuid(required(fields, "assigneeId")), version: version(required(fields, "version")) };
  });
}

/** `DELETE .../tasks/{taskId}`: exactly `{version}` (T6). */
export function parseDeleteTaskBody(body: unknown): ParseResult<DeleteTaskInput> {
  return parse(() => {
    const fields = objectFields(body, new Set(["version"]));
    return { version: version(required(fields, "version")) };
  });
}

/** Checks a project or task path ID with the same UUID rule as the existing routes. */
export function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_PATTERN.test(value);
}
