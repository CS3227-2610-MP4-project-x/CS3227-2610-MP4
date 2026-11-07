import "server-only";

import type { VerifiedGitHubIdentity } from "@/server/github-repository-link";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

export type TaskSnapshotCriterion = Readonly<{ id: string; description: string; position: number }>;
export type TaskSnapshotRepositoryBinding = Readonly<{
  id: number;
  installationId: number;
  owner: string;
  name: string;
}>;
export type TaskSnapshot = Readonly<{
  projectId: string;
  taskId: string;
  personId: string;
  role: string;
  assigneeId: string;
  criteria: readonly TaskSnapshotCriterion[];
  attachedCommitShas: readonly string[];
  repository: TaskSnapshotRepositoryBinding | null;
}>;

type SnapshotRow = Record<string, unknown> & {
  project_id: string;
  task_id: string;
  person_id: string;
  role: string;
  assignee_id: string;
  criteria: unknown;
  attached_commit_shas: unknown;
  github_repository_id: string | null;
  github_installation_id: string | null;
  github_repository_owner: string | null;
  github_repository_name: string | null;
};

function parseCriteria(value: unknown): readonly TaskSnapshotCriterion[] {
  if (!Array.isArray(value)) throw new Error("Invalid task snapshot.");
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("Invalid task snapshot.");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.description !== "string" || !Number.isSafeInteger(row.position)) {
      throw new Error("Invalid task snapshot.");
    }
    return { id: row.id, description: row.description, position: Number(row.position) };
  });
}

function parseShas(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Invalid task snapshot.");
  return value as string[];
}

export class TaskSnapshotRepository {
  constructor(private readonly database: Query) {}

  async findSnapshot(projectId: string, taskId: string, identity: VerifiedGitHubIdentity): Promise<TaskSnapshot | null> {
    const result = await this.database.query<SnapshotRow>(
      `SELECT t.id::text AS task_id, t.project_id::text AS project_id,
              t.assignee_id::text AS assignee_id, p.id::text AS person_id, m.role,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ac.id::text, 'description', ac.description, 'position', ac.position
              ) ORDER BY ac.position, ac.id) FROM app.acceptance_criteria ac WHERE ac.task_id = t.id), '[]'::jsonb) AS criteria,
              COALESCE((SELECT jsonb_agg(c.commit_sha ORDER BY c.commit_sha)
                FROM app.attached_commits c WHERE c.task_id = t.id), '[]'::jsonb) AS attached_commit_shas,
              pr.github_repository_id::text AS github_repository_id,
              pr.github_installation_id::text AS github_installation_id,
              pr.github_repository_owner, pr.github_repository_name
         FROM app.tasks t
         JOIN app.projects pr ON pr.id = t.project_id
         JOIN app.memberships m ON m.project_id = t.project_id
         JOIN app.people p ON p.id = m.person_id
        WHERE t.id = $1::uuid AND t.project_id = $2::uuid AND t.deleted_at IS NULL
          AND p.auth_user_id = $3::uuid AND p.github_user_id = $4::bigint`,
      [taskId, projectId, identity.authUserId, identity.githubUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const bindingValues = [row.github_repository_id, row.github_installation_id, row.github_repository_owner, row.github_repository_name];
    const hasBinding = bindingValues.every((value) => value !== null);
    const repository = hasBinding ? {
      id: Number(row.github_repository_id),
      installationId: Number(row.github_installation_id),
      owner: String(row.github_repository_owner),
      name: String(row.github_repository_name),
    } : null;
    return {
      projectId: String(row.project_id), taskId: String(row.task_id), personId: String(row.person_id),
      role: String(row.role), assigneeId: String(row.assignee_id), criteria: parseCriteria(row.criteria),
      attachedCommitShas: parseShas(row.attached_commit_shas), repository,
    };
  }
}
