import "server-only";

export type PeopleQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type VerifiedGitHubIdentity = Readonly<{
  authUserId: string;
  githubUserId: string;
  githubUsername: string;
}>;

export class PeopleRepository {
  constructor(private readonly database: PeopleQuery) {}

  async findPersonIdByAuthUserId(authUserId: string): Promise<string | null> {
    const result = await this.database.query<{ id: string }>(
      `SELECT id::text AS id
         FROM app.people
        WHERE auth_user_id = $1::uuid`,
      [authUserId],
    );
    return result.rows[0]?.id ?? null;
  }

  /** Every registered person whose GitHub username matches exactly, ignoring case (design.md D5, S4). */
  async findPeopleByGitHubUsername(githubUsername: string): Promise<{ id: string; githubUsername: string }[]> {
    const result = await this.database.query<{ id: string; github_username: string }>(
      `SELECT id::text AS id, github_username
         FROM app.people
        WHERE lower(github_username) = lower($1)
        ORDER BY id`,
      [githubUsername],
    );
    return result.rows.map((row) => ({ id: row.id, githubUsername: row.github_username }));
  }

  async upsertVerifiedGitHubIdentity(identity: VerifiedGitHubIdentity): Promise<{ id: string }> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO app.people (auth_user_id, github_user_id, github_username)
       VALUES ($1::uuid, $2::bigint, $3)
       ON CONFLICT (auth_user_id) DO UPDATE
         SET github_username = EXCLUDED.github_username
       WHERE app.people.github_user_id = EXCLUDED.github_user_id
       RETURNING id::text AS id`,
      [identity.authUserId, identity.githubUserId, identity.githubUsername],
    );

    const person = result.rows[0];
    if (!person) {
      throw new Error("The signed-in GitHub identity conflicts with the existing account.");
    }
    return person;
  }
}
