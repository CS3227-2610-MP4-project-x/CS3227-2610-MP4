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
  person_id: string;
}>;

export class GitHubRepositoryLinkRepository implements GitHubRepositoryLinkRepositoryPort {
  constructor(private readonly database: TransactionalDatabase) {}

  async findProjectLinkAccess(projectId: string, authUserId: string): Promise<ProjectLinkAccess | null> {
    try {
      const result = await this.database.query<MembershipRow>(
        `SELECT m.role,
                p.auth_user_id::text AS auth_user_id,
                p.github_user_id::text AS github_user_id,
                p.id::text AS person_id
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
        personId: access.person_id,
      } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async createSetupAttempt(projectId: string, identity: VerifiedGitHubIdentity, stateHash: Buffer) {
    const access = await this.findProjectLinkAccess(projectId, identity.authUserId);
    if (!access || access.role !== "product_manager" || access.githubUserId !== identity.githubUserId) return null;
    try {
      const result = await this.database.query<{
        id: string; project_id: string; person_id: string; github_user_id: string;
      }>(
        `INSERT INTO app.github_repository_setup_attempts
           (project_id, person_id, expected_github_user_id, state_hash, status, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::bigint, $4, 'setup_pending', now() + interval '10 minutes')
         RETURNING id::text AS id, project_id::text AS project_id, person_id::text AS person_id,
                   expected_github_user_id::text AS github_user_id`,
        [projectId, access.personId, identity.githubUserId, stateHash],
      );
      const attempt = result.rows[0];
      return attempt ? { attemptId: attempt.id, projectId: attempt.project_id, personId: attempt.person_id,
        githubUserId: attempt.github_user_id, installationId: null } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async consumeSetupState(stateHash: Buffer, oauthStateHash: Buffer, installationId: string, identity: VerifiedGitHubIdentity) {
    try {
      const result = await this.database.query<{
        id: string; project_id: string; person_id: string; expected_github_user_id: string;
      }>(
        `UPDATE app.github_repository_setup_attempts a
            SET state_hash = $2, installation_id = $3::bigint, status = 'oauth_pending'
           FROM app.memberships m JOIN app.people p ON p.id = m.person_id
          WHERE a.state_hash = $1
            AND a.status = 'setup_pending'
            AND a.expires_at > now()
            AND m.project_id = a.project_id AND m.person_id = a.person_id
            AND m.role = 'product_manager'
            AND p.auth_user_id = $4::uuid
            AND p.github_user_id = a.expected_github_user_id
            AND p.github_user_id = $5::bigint
         RETURNING a.id::text AS id, a.project_id::text AS project_id,
                   a.person_id::text AS person_id, a.expected_github_user_id::text AS expected_github_user_id`,
        [stateHash, oauthStateHash, installationId, identity.authUserId, identity.githubUserId],
      );
      const row = result.rows[0];
      return row ? { attemptId: row.id, projectId: row.project_id, personId: row.person_id,
        githubUserId: row.expected_github_user_id, installationId } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async consumeOAuthState(stateHash: Buffer, identity: VerifiedGitHubIdentity) {
    try {
      const result = await this.database.query<{
        id: string; project_id: string; person_id: string; expected_github_user_id: string; installation_id: string;
      }>(
        `UPDATE app.github_repository_setup_attempts a
            SET status = 'verified'
           FROM app.memberships m JOIN app.people p ON p.id = m.person_id
          WHERE a.state_hash = $1 AND a.status = 'oauth_pending' AND a.expires_at > now()
            AND m.project_id = a.project_id AND m.person_id = a.person_id AND m.role = 'product_manager'
            AND p.auth_user_id = $2::uuid AND p.github_user_id = a.expected_github_user_id
            AND p.github_user_id = $3::bigint
         RETURNING a.id::text AS id, a.project_id::text AS project_id,
                   a.person_id::text AS person_id, a.expected_github_user_id::text AS expected_github_user_id,
                   a.installation_id::text AS installation_id`,
        [stateHash, identity.authUserId, identity.githubUserId],
      );
      const row = result.rows[0];
      return row ? { attemptId: row.id, projectId: row.project_id, personId: row.person_id,
        githubUserId: row.expected_github_user_id, installationId: row.installation_id } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async saveRepositorySnapshot(attempt: Parameters<GitHubRepositoryLinkRepositoryPort["saveRepositorySnapshot"]>[0], repositories: Parameters<GitHubRepositoryLinkRepositoryPort["saveRepositorySnapshot"]>[1]): Promise<string> {
    let connection: TransactionConnection;
    try { connection = await this.database.connect(); } catch { throw new Error("Repository operation failed."); }
    try {
      await connection.query("BEGIN");
      const inserted = await connection.query<{ id: string }>(
        `INSERT INTO app.github_repository_snapshots
           (attempt_id, project_id, person_id, installation_id, expires_at)
         SELECT a.id, a.project_id, a.person_id, a.installation_id, now() + interval '10 minutes'
           FROM app.github_repository_setup_attempts a
           JOIN app.memberships m ON m.project_id = a.project_id AND m.person_id = a.person_id AND m.role = 'product_manager'
           JOIN app.people p ON p.id = a.person_id AND p.github_user_id = a.expected_github_user_id
          WHERE a.id = $1::uuid AND a.project_id = $2::uuid AND a.person_id = $3::uuid
            AND a.status = 'verified' AND a.expires_at > now()
         RETURNING id::text AS id`,
        [attempt.attemptId, attempt.projectId, attempt.personId],
      );
      const snapshotId = inserted.rows[0]?.id;
      if (!snapshotId) throw new Error("Attempt expired.");
      for (const [position, repository] of repositories.entries()) {
        await connection.query(
          `INSERT INTO app.github_repository_snapshot_repositories
             (snapshot_id, repository_id, owner, name, is_private, default_branch, position)
           VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7)`,
          [snapshotId, repository.repositoryId, repository.owner, repository.name,
            repository.isPrivate, repository.defaultBranch, position],
        );
      }
      await connection.query("COMMIT");
      return snapshotId;
    } catch {
      try { await connection.query("ROLLBACK"); } catch { /* Preserve safe failure. */ }
      throw new Error("Repository operation failed.");
    } finally { connection.release(); }
  }

  async listSnapshotRepositories(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity) {
    try {
      const result = await this.database.query<{
        snapshot_id: string; repository_id: string | null; owner: string | null; name: string | null; is_private: boolean | null; default_branch: string | null;
      }>(
        `SELECT s.id::text AS snapshot_id, r.repository_id::text AS repository_id, r.owner, r.name, r.is_private, r.default_branch
           FROM app.github_repository_snapshots s
           LEFT JOIN app.github_repository_snapshot_repositories r ON r.snapshot_id = s.id
           JOIN app.memberships m ON m.project_id = s.project_id AND m.person_id = s.person_id AND m.role = 'product_manager'
           JOIN app.people p ON p.id = s.person_id
          WHERE s.id = $1::uuid AND s.project_id = $2::uuid AND p.auth_user_id = $3::uuid
            AND p.github_user_id = $4::bigint AND s.expires_at > now()
          ORDER BY r.position ASC NULLS LAST`,
        [snapshotId, projectId, identity.authUserId, identity.githubUserId],
      );
      return result.rows.length ? result.rows.flatMap((row) => row.repository_id && row.owner && row.name !== null && row.is_private !== null
        ? [{ repositoryId: Number(row.repository_id), owner: row.owner, name: row.name,
          isPrivate: row.is_private, defaultBranch: row.default_branch ?? "" }]
        : []) : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async findSnapshotRepository(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity, repositoryId: string) {
    try {
      const result = await this.database.query<{
        attempt_id: string; installation_id: string; person_id: string; github_user_id: string;
        repository_id: string; owner: string; name: string; is_private: boolean; default_branch: string | null;
      }>(
        `SELECT s.attempt_id::text AS attempt_id, s.installation_id::text AS installation_id,
                s.person_id::text AS person_id, p.github_user_id::text AS github_user_id,
                r.repository_id::text AS repository_id, r.owner, r.name, r.is_private, r.default_branch
           FROM app.github_repository_snapshots s
           JOIN app.github_repository_snapshot_repositories r ON r.snapshot_id = s.id
           JOIN app.memberships m ON m.project_id = s.project_id AND m.person_id = s.person_id AND m.role = 'product_manager'
           JOIN app.people p ON p.id = s.person_id
          WHERE s.id = $1::uuid AND s.project_id = $2::uuid AND r.repository_id = $3::bigint
            AND p.auth_user_id = $4::uuid AND p.github_user_id = $5::bigint AND s.expires_at > now()`,
        [snapshotId, projectId, repositoryId, identity.authUserId, identity.githubUserId],
      );
      const row = result.rows[0];
      return row ? { attemptId: row.attempt_id, projectId, personId: row.person_id, githubUserId: row.github_user_id,
        installationId: row.installation_id, repositoryId: Number(row.repository_id), owner: row.owner,
        name: row.name, isPrivate: row.is_private, defaultBranch: row.default_branch ?? "" } : null;
    } catch { throw new Error("Repository operation failed."); }
  }

  async replaceSnapshotBinding(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity, repositoryId: string): Promise<AccessCheck> {
    let connection: TransactionConnection;
    try { connection = await this.database.connect(); } catch { throw new Error("Repository operation failed."); }
    let active = false;
    try {
      await connection.query("BEGIN"); active = true;
      const selected = await connection.query<{
        installation_id: string; repository_id: string; owner: string; name: string;
      }>(
        `SELECT s.installation_id::text AS installation_id, r.repository_id::text AS repository_id,
                r.owner, r.name
           FROM app.github_repository_snapshots s
           JOIN app.github_repository_snapshot_repositories r ON r.snapshot_id = s.id
           JOIN app.projects pr ON pr.id = s.project_id
           JOIN app.memberships m ON m.project_id = pr.id AND m.person_id = s.person_id AND m.role = 'product_manager'
           JOIN app.people p ON p.id = s.person_id
          WHERE s.id = $1::uuid AND s.project_id = $2::uuid AND r.repository_id = $3::bigint
            AND p.auth_user_id = $4::uuid AND p.github_user_id = $5::bigint AND s.expires_at > now()
          FOR SHARE OF s, r, pr, m, p`,
        [snapshotId, projectId, repositoryId, identity.authUserId, identity.githubUserId],
      );
      const binding = selected.rows[0];
      if (!binding) { await connection.query("ROLLBACK"); active = false; return "missing"; }
      const updated = await connection.query(
        `UPDATE app.projects
            SET github_installation_id = $2::bigint, github_repository_id = $3::bigint,
                github_repository_owner = $4, github_repository_name = $5,
                version = version + 1, updated_at = now()
          WHERE id = $1::uuid RETURNING id`,
        [projectId, binding.installation_id, binding.repository_id, binding.owner, binding.name],
      );
      if (!updated.rows[0]) { await connection.query("ROLLBACK"); active = false; return "missing"; }
      await connection.query("COMMIT"); active = false; return "authorized";
    } catch { if (active) { try { await connection.query("ROLLBACK"); } catch { /* Preserve safe failure. */ } }
      throw new Error("Repository operation failed.");
    } finally { connection.release(); }
  }

  async findProjectRepositoryBinding(projectId: string, identity: VerifiedGitHubIdentity) {
    try {
      const result = await this.database.query<{ github_installation_id: string; github_repository_id: string; github_repository_owner: string; github_repository_name: string }>(
        `SELECT pr.github_installation_id::text AS github_installation_id,
                pr.github_repository_id::text AS github_repository_id,
                pr.github_repository_owner, pr.github_repository_name
           FROM app.projects pr
           JOIN app.memberships m ON m.project_id = pr.id AND m.role = 'product_manager'
           JOIN app.people p ON p.id = m.person_id
          WHERE pr.id = $1::uuid AND p.auth_user_id = $2::uuid AND p.github_user_id = $3::bigint`,
        [projectId, identity.authUserId, identity.githubUserId],
      );
      const row = result.rows[0];
      return row?.github_installation_id && row.github_repository_id && row.github_repository_owner && row.github_repository_name
        ? { installationId: row.github_installation_id, repositoryId: row.github_repository_id,
          owner: row.github_repository_owner, name: row.github_repository_name } : null;
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
