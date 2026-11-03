import "server-only";

import type {
  AccessCheck,
  GitHubRepositoryLinkRepositoryPort,
  ProjectLinkAccess,
  RepositoryBinding,
  VerifiedGitHubIdentity,
} from "@/server/github-repository-link";

type QueryResult<T extends Record<string, unknown>> = Readonly<{ rows: T[]; rowCount: number | null }>;
type Queryable = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}>;
type TransactionConnection = Queryable & Readonly<{ release(): void }>;
type TransactionalDatabase = Queryable & Readonly<{ connect(): Promise<TransactionConnection> }>;

type MembershipRow = Readonly<{
  role: string;
  auth_user_id: string;
  github_user_id: string;
  person_id?: string;
}>;

export class GitHubRepositoryLinkRepository implements GitHubRepositoryLinkRepositoryPort {
  constructor(private readonly database: TransactionalDatabase) {}

  async findProjectLinkAccess(projectId: string, authUserId: string): Promise<ProjectLinkAccess | null> {
    try {
      const result = await this.database.query<MembershipRow>(
        `SELECT m.role,
                p.auth_user_id::text AS auth_user_id,
                p.github_user_id::text AS github_user_id
           FROM app.memberships m
           JOIN app.people p ON p.id = m.person_id
          WHERE m.project_id = $1::uuid
            AND p.auth_user_id = $2::uuid`,
        [projectId, authUserId],
      );
      const access = result.rows[0];
      return access ? {
        role: access.role,
        authUserId: access.auth_user_id,
        githubUserId: access.github_user_id,
      } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async replaceBindingIfAuthorized(
    projectId: string,
    identity: VerifiedGitHubIdentity,
    binding: RepositoryBinding,
  ): Promise<AccessCheck> {
    let connection: TransactionConnection;
    try { connection = await this.database.connect(); } catch { throw new Error("Repository operation failed."); }
    let inTransaction = false;
    try {
      await connection.query("BEGIN");
      inTransaction = true;
      const access = await connection.query<MembershipRow>(
        `SELECT m.role,
                p.auth_user_id::text AS auth_user_id,
                p.github_user_id::text AS github_user_id,
                p.id::text AS person_id
           FROM app.projects pr
           JOIN app.memberships m ON m.project_id = pr.id
           JOIN app.people p ON p.id = m.person_id
          WHERE pr.id = $1::uuid
            AND p.auth_user_id = $2::uuid
          FOR SHARE OF pr, m, p`,
        [projectId, identity.authUserId],
      );
      const current = access.rows[0];
      if (!current) {
        await connection.query("ROLLBACK");
        inTransaction = false;
        return "missing";
      }
      if (current.role !== "product_manager" || current.auth_user_id !== identity.authUserId ||
          current.github_user_id !== identity.githubUserId) {
        await connection.query("ROLLBACK");
        inTransaction = false;
        return "forbidden";
      }
      const updated = await connection.query(
        `UPDATE app.projects
            SET github_installation_id = $2::bigint,
                github_repository_id = $3::bigint,
                github_repository_owner = $4,
                github_repository_name = $5,
                version = version + 1,
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING id`,
        [projectId, binding.installationId, binding.repositoryId, binding.repositoryOwner, binding.repositoryName],
      );
      if (!updated.rows[0]) {
        await connection.query("ROLLBACK");
        inTransaction = false;
        return "missing";
      }
      await connection.query("COMMIT");
      inTransaction = false;
      return "authorized";
    } catch {
      if (inTransaction) {
        try { await connection.query("ROLLBACK"); } catch { /* Preserve the safe failure. */ }
      }
      throw new Error("Repository operation failed.");
    } finally {
      connection.release();
    }
  }
}
