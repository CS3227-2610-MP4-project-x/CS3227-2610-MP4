import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TaskSnapshotRepository } from "@/server/completion-assessment/snapshot-repository";
import { TaskSnapshotService } from "@/server/completion-assessment/snapshot-service";

// Approved Group 7 task snapshot read seam: a single point-in-time statement;
// assigned-developer access. Database isolation semantics need PostgreSQL coverage.
const projectId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const personId = "00000000-0000-4000-8000-000000000003";
const identity = { authUserId: "00000000-0000-4000-8000-000000000004", githubUserId: "123" };
const criteria = [{ id: "criterion-a", description: "Return valid data", position: 1 }];
const shas = ["a".repeat(40)];
const repository = { id: 100, installationId: 200, owner: "synthetic", name: "repository" };
const snapshot = { projectId, taskId, personId, role: "developer", assigneeId: personId, criteria,
  attachedCommitShas: shas, repository };

function row() {
  return { project_id: projectId, task_id: taskId, person_id: personId, role: "developer", assignee_id: personId,
    criteria: structuredClone(criteria), attached_commit_shas: [...shas],
    github_repository_id: "100", github_installation_id: "200", github_repository_owner: "synthetic",
    github_repository_name: "repository" };
}

describe("Group 7 point-in-time task snapshot", () => {
  it("loads identity, criteria, commits and binding with one parameterized read and no transaction", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 }), connect: vi.fn() };
    const result = await new TaskSnapshotRepository(database).findSnapshot(projectId, taskId, identity);
    expect(result).toEqual(snapshot);
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.connect).not.toHaveBeenCalled();
    const [sql, values] = database.query.mock.calls[0];
    for (const table of ["tasks", "acceptance_criteria", "attached_commits", "projects", "memberships", "people"]) {
      expect(sql).toContain(`app.${table}`);
    }
    expect(sql).not.toMatch(/\b(BEGIN|INSERT|UPDATE|DELETE)\b/i);
    expect(values).toEqual(expect.arrayContaining([projectId, taskId, identity.authUserId, identity.githubUserId]));
    expect(sql).not.toContain(identity.authUserId);
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(sql).toMatch(/ORDER\s+BY[\s\S]*position[\s\S]*id/i);
  });

  it("returns null when the authorized task snapshot does not exist", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    expect(await new TaskSnapshotRepository(database).findSnapshot(projectId, taskId, identity)).toBeNull();
  });

  it("allows an absent binding to be represented without inventing repository data", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{ ...row(), github_repository_id: null,
      github_installation_id: null, github_repository_owner: null, github_repository_name: null }], rowCount: 1 }) };
    expect(await new TaskSnapshotRepository(database).findSnapshot(projectId, taskId, identity))
      .toMatchObject({ repository: null });
  });

  it("passes the approved captured snapshot through the assigned-developer seam", async () => {
    const port = { findSnapshot: vi.fn().mockResolvedValue(snapshot) };
    expect(await new TaskSnapshotService(port).getAssignedSnapshot(projectId, taskId, identity)).toEqual(snapshot);
    expect(port.findSnapshot).toHaveBeenCalledExactlyOnceWith(projectId, taskId, identity);
  });

  it.each([
    ["PM", { ...snapshot, role: "product_manager" }, "FORBIDDEN", 403],
    ["other developer", { ...snapshot, assigneeId: "another-person" }, "FORBIDDEN", 403],
    ["missing/nonmember/deleted task", null, "NOT_FOUND", 404],
  ])("refuses %s", async (_label, value, code, status) => {
    const port = { findSnapshot: vi.fn().mockResolvedValue(value) };
    await expect(new TaskSnapshotService(port).getAssignedSnapshot(projectId, taskId, identity))
      .rejects.toMatchObject({ code, status });
  });

  it("does not expose database exception details", async () => {
    const port = { findSnapshot: vi.fn().mockRejectedValue(new Error("SYNTHETIC_PRIVATE_DB_DETAIL")) };
    await expect(new TaskSnapshotService(port).getAssignedSnapshot(projectId, taskId, identity))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500, message: expect.not.stringContaining("SYNTHETIC_PRIVATE_DB_DETAIL") });
  });
});
