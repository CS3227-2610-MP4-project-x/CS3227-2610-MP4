import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Task 4.5 D3/D4: exercise the public service/repository, not private repository methods.
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/supabase-auth", () => ({ createRequestSupabaseClient: vi.fn() }));
import { ProjectError, ProjectRepository, ProjectService, projectErrorResponse } from "@/server/projects";
import { FakeDatabase, clone } from "../support/sql-fake";

const projectId = "52000000-0000-4000-8000-000000000001";
const pm = "52000000-0000-4000-8000-000000000002";
const dev = "52000000-0000-4000-8000-000000000003";
const outsider = "52000000-0000-4000-8000-000000000004";
let db: FakeDatabase;
let service: ProjectService;

beforeEach(() => {
  db = new FakeDatabase();
  db.state.projects.push({ id: projectId, key: "WEB", name: "Synthetic project", last_task_number: 0, version: 1 });
  for (const [id, username] of [[pm, "Alpha-PM"], [dev, "zeta-dev"], [outsider, "outsider"]]) {
    db.state.people.push({ id, auth_user_id: randomUUID(), github_user_id: id, github_username: username });
  }
  db.state.memberships.push(
    { id: randomUUID(), project_id: projectId, person_id: pm, role: "product_manager", version: 1 },
    { id: randomUUID(), project_id: projectId, person_id: dev, role: "developer", version: 1 },
  );
  const repository = new ProjectRepository({ query: db.query, connect: db.connect } as unknown as ConstructorParameters<typeof ProjectRepository>[0]);
  service = new ProjectService(repository, { findPeopleByGitHubUsername: vi.fn(async () => []) });
});

async function refused(project: string, actor: string, code: string) {
  const before = clone(db.state);
  const error = await service.listMembers(project, actor).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProjectError);
  expect((await projectErrorResponse(error).json()).error.code).toBe(code);
  expect(db.state).toEqual(before);
  expect(db.log.filter((entry) => ["insert", "update", "delete"].includes(entry.kind))).toEqual([]);
}

describe("Product manager reads project members (4.5 D3/D4)", () => {
  it("includes the PM and developers and returns only the public projection without writes", async () => {
    const before = clone(db.state);
    expect(await service.listMembers(projectId, pm)).toEqual([
      { personId: pm, githubUsername: "Alpha-PM", role: "product_manager" },
      { personId: dev, githubUsername: "zeta-dev", role: "developer" },
    ]);
    expect(db.state).toEqual(before);
    expect(db.log.filter((entry) => ["insert", "update", "delete"].includes(entry.kind))).toEqual([]);
    for (const entry of db.log.filter((entry) => entry.kind === "select")) {
      expect(entry.sql).not.toContain(projectId);
      expect(entry.sql).not.toContain(pm);
    }
  });

  it("refuses a developer even when invoked directly", async () => { await refused(projectId, dev, "FORBIDDEN"); });
  it("conceals the list from a nonmember", async () => { await refused(projectId, outsider, "NOT_FOUND"); });
  it("conceals a missing project", async () => { await refused(randomUUID(), pm, "NOT_FOUND"); });

  it("rechecks the current role on every call after PM transfer", async () => {
    await service.listMembers(projectId, pm);
    db.state.memberships.find((member) => member.person_id === pm)!.role = "developer";
    db.state.memberships.find((member) => member.person_id === dev)!.role = "product_manager";
    await refused(projectId, pm, "FORBIDDEN");
    const members = await service.listMembers(projectId, dev);
    expect(members.find((member) => member.personId === dev)?.role).toBe("product_manager");
    expect(members.find((member) => member.personId === pm)?.role).toBe("developer");
  });

  it("does not reuse an old list when membership changes", async () => {
    await service.listMembers(projectId, pm);
    db.state.memberships.push({ id: randomUUID(), project_id: projectId, person_id: outsider, role: "developer", version: 1 });
    expect(await service.listMembers(projectId, pm)).toContainEqual({ personId: outsider, githubUsername: "outsider", role: "developer" });
  });
});
