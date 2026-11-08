import { describe, expect, it, vi } from "vitest";

// Task 4.4 (OpenSpec change project-task-management), design.md "Board, Detail and Review Queue
// Decisions (4.4)" B3: a minimal "my projects" list on `/` (name, key and the person's role)
// through one new read in src/server/projects/. No requirement IDs exist.
//
// Seam chosen by the test-writer (reported in the 4.4 handoff):
//   ProjectRepository.listProjectsForMember(personId):
//     Promise<readonly { id, key, name, role }[]>   (SQL covered by the PostgreSQL integration
//     test tests/integration/db/board-and-review-reads.test.ts)
//   ProjectService.listProjectsForPerson(personId): Promise<readonly ProjectView[]>
// The list order is not recorded in the spec, so these tests assert none (reported as a gap).

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: vi.fn() } }),
}));

import { ProjectService, type ProjectRepository, type PersonLookup } from "@/server/projects";

const personId = "50000000-0000-4000-8000-000000000001";

function setup(rows: Record<string, unknown>[]) {
  const repository = { listProjectsForMember: vi.fn(async () => rows) };
  const people: PersonLookup = { findPeopleByGitHubUsername: vi.fn(async () => []) };
  return { repository, service: new ProjectService(repository as unknown as ProjectRepository, people) };
}

describe("my projects read (B3)", () => {
  it("lists the person's projects with name, key and role only", async () => {
    const { repository, service } = setup([
      { id: "50000000-0000-4000-8000-000000000011", key: "WEB", name: "Synthetic web", role: "product_manager", version: 3, lastTaskNumber: 9 },
      { id: "50000000-0000-4000-8000-000000000012", key: "API", name: "Synthetic api", role: "developer", version: 1, lastTaskNumber: 2 },
    ]);

    const projects = await service.listProjectsForPerson(personId);

    expect(repository.listProjectsForMember).toHaveBeenCalledWith(personId);
    expect(projects).toEqual([
      { id: "50000000-0000-4000-8000-000000000011", key: "WEB", name: "Synthetic web", role: "product_manager" },
      { id: "50000000-0000-4000-8000-000000000012", key: "API", name: "Synthetic api", role: "developer" },
    ]);
  });

  it("returns an empty list for a person with no memberships", async () => {
    const { service } = setup([]);

    expect(await service.listProjectsForPerson(personId)).toEqual([]);
  });
});
