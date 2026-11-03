import "server-only";

import type { PeopleQuery } from "./people-repository";

export type StoredTaskState = "to_do" | "in_progress" | "in_review" | "done";

export type TaskAccessRecord = Readonly<{
  id: string;
  projectId: string;
  assigneeId: string;
  state: StoredTaskState;
}>;

export class TaskAccessRepository {
  constructor(private readonly database: PeopleQuery) {}

  async findTaskInProject(projectId: string, taskId: string): Promise<TaskAccessRecord | null> {
    const result = await this.database.query<{
      id: string;
      project_id: string;
      assignee_id: string;
      status: StoredTaskState;
    }>(
      `SELECT id::text AS id,
              project_id::text AS project_id,
              assignee_id::text AS assignee_id,
              status
         FROM app.tasks
        WHERE id = $1::uuid
          AND project_id = $2::uuid
          AND deleted_at IS NULL`,
      [taskId, projectId],
    );
    const task = result.rows[0];
    if (!task) return null;
    return {
      id: task.id,
      projectId: task.project_id,
      assigneeId: task.assignee_id,
      state: task.status,
    };
  }
}
