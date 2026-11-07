import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OpenSpec task 4.1 (projects-membership-4-1). Validation, error-mapping and service unit tests
// for the `@/server/projects` public entry recorded in design.md S1 to S6. Requirements by name
// (no formal IDs): task-management "Signed-in people create projects", "Project membership and
// roles", "Product manager transfers the role" and "Transfer targets are identified by GitHub
// username"; design.md D3, D5, D6, Q2, Q3, S7 and the API Error Contract.
//
// ProjectRepository runs against an in-memory fake exposing query() and connect() (S1, S6).
// The fake (tests/unit/support/sql-fake.ts, shared since task 4.2) evaluates statements
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

// The in-memory PostgreSQL stand-in is shared with the other unit tests (design.md T17).
import { clone, FakeDatabase, pgError, PRIVATE_DETAIL, UUID_PATTERN, type LogEntry, type Role, type State } from "../support/sql-fake";

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
