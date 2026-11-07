import "server-only";

import type { VerifiedGitHubIdentity } from "@/server/github-repository-link";
import type { TaskSnapshot, TaskSnapshotRepository } from "./snapshot-repository";

export class TaskSnapshotError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR", readonly status: 403 | 404 | 500) {
    super(code === "FORBIDDEN" ? "Insufficient permissions" : code === "NOT_FOUND" ? "Resource not found" : "Internal server error");
    this.name = "TaskSnapshotError";
  }
}

export class TaskSnapshotService {
  constructor(private readonly repository: Pick<TaskSnapshotRepository, "findSnapshot">) {}

  async getAssignedSnapshot(projectId: string, taskId: string, identity: VerifiedGitHubIdentity): Promise<TaskSnapshot> {
    let snapshot: TaskSnapshot | null;
    try { snapshot = await this.repository.findSnapshot(projectId, taskId, identity); }
    catch { throw new TaskSnapshotError("INTERNAL_ERROR", 500); }
    if (!snapshot) throw new TaskSnapshotError("NOT_FOUND", 404);
    if (snapshot.role !== "developer" || snapshot.assigneeId !== snapshot.personId) {
      throw new TaskSnapshotError("FORBIDDEN", 403);
    }
    return snapshot;
  }
}
