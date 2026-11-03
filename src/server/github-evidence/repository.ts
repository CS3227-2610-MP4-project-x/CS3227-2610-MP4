import "server-only";
import type { EvidenceTaskContext } from "./types";
import type { VerifiedGitHubIdentity } from "@/server/github-repository-link";

type Query = Readonly<{ query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }> }>;
type Connection = Query & Readonly<{ release(): void }>;
type Database = Query & Readonly<{ connect(): Promise<Connection> }>;

export class GitHubEvidenceRepository {
  constructor(private readonly database: Database) {}

  async findTaskContext(projectId: string, taskId: string, identity: VerifiedGitHubIdentity): Promise<EvidenceTaskContext | null> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT t.id::text AS task_id, t.project_id::text AS project_id, t.assignee_id::text AS assignee_id,
              t.title,
              t.branch_name AS branch, t.number AS task_number, pr.key AS project_key, m.role,
              p.id::text AS person_id, p.github_user_id::text AS github_user_id, p.github_username,
              pr.github_repository_id::text AS github_repository_id, pr.github_installation_id::text AS github_installation_id,
              pr.github_repository_owner, pr.github_repository_name
         FROM app.tasks t JOIN app.projects pr ON pr.id = t.project_id
         JOIN app.memberships m ON m.project_id = pr.id
         JOIN app.people p ON p.id = m.person_id
        WHERE t.id = $1::uuid AND t.project_id = $2::uuid AND t.deleted_at IS NULL
          AND p.auth_user_id = $3::uuid AND p.github_user_id = $4::bigint`,
      [taskId, projectId, identity.authUserId, identity.githubUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      taskId: String(row.task_id), projectId: String(row.project_id), personId: String(row.person_id),
      role: String(row.role), assigneeId: String(row.assignee_id), title: String(row.title), taskBranch: typeof row.branch === "string" ? row.branch : null,
      taskKey: `${String(row.project_key)}-${String(row.task_number)}`, githubUserId: Number(row.github_user_id),
      githubUsername: String(row.github_username), repositoryId: row.github_repository_id == null ? null : Number(row.github_repository_id),
      installationId: row.github_installation_id == null ? null : Number(row.github_installation_id),
      repositoryOwner: typeof row.github_repository_owner === "string" ? row.github_repository_owner : null,
      repositoryName: typeof row.github_repository_name === "string" ? row.github_repository_name : null,
    };
  }

  async saveAttachedCommits(projectId: string, taskId: string, identity: VerifiedGitHubIdentity, shas: readonly string[]): Promise<boolean> {
    let connection: Connection;
    try { connection = await this.database.connect(); } catch { throw new Error("Repository operation failed."); }
    let active = false;
    try {
      await connection.query("BEGIN"); active = true;
      const access = await connection.query<{ id: string }>(
        `SELECT t.id::text AS id FROM app.tasks t
         JOIN app.memberships m ON m.project_id = t.project_id AND m.role = 'developer'
         JOIN app.people p ON p.id = m.person_id AND p.id = t.assignee_id
        WHERE t.id = $1::uuid AND t.project_id = $2::uuid AND t.deleted_at IS NULL
          AND p.auth_user_id = $3::uuid AND p.github_user_id = $4::bigint
        FOR SHARE OF t, m, p`,
        [taskId, projectId, identity.authUserId, identity.githubUserId],
      );
      if (!access.rows[0]) { await connection.query("ROLLBACK"); active = false; return false; }
      for (const sha of shas) await connection.query(
        `INSERT INTO app.attached_commits (task_id, commit_sha, attached_by)
         SELECT $1::uuid, $2, p.id FROM app.people p WHERE p.auth_user_id = $3::uuid
         ON CONFLICT (task_id, commit_sha) DO NOTHING`,
        [taskId, sha, identity.authUserId],
      );
      await connection.query("COMMIT"); active = false; return true;
    } catch { if (active) { try { await connection.query("ROLLBACK"); } catch { /* preserve safe failure */ } }
      throw new Error("Repository operation failed.");
    } finally { connection.release(); }
  }
}
