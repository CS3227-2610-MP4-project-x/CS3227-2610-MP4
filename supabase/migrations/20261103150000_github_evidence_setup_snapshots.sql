-- Short-lived, server-only records for the GitHub App setup and repository picker.
-- OAuth credentials and access tokens are intentionally never stored.
CREATE TABLE app.github_repository_setup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES app.people (id) ON DELETE CASCADE,
  expected_github_user_id bigint NOT NULL CHECK (expected_github_user_id > 0),
  state_hash bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  installation_id bigint CHECK (installation_id > 0),
  status text NOT NULL CHECK (status IN ('setup_pending', 'oauth_pending', 'verified', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT github_repository_setup_attempt_expiry CHECK (expires_at > created_at),
  CONSTRAINT github_repository_attempt_installation_state CHECK (
    (status = 'setup_pending' AND installation_id IS NULL) OR
    (status IN ('oauth_pending', 'verified') AND installation_id > 0) OR
    (status = 'expired' AND (installation_id IS NULL OR installation_id > 0))
  ),
  CONSTRAINT github_repository_attempt_scope_key UNIQUE (id, project_id, person_id, installation_id)
);

CREATE INDEX github_repository_setup_attempt_scope_idx
  ON app.github_repository_setup_attempts (project_id, person_id, expires_at);

CREATE TABLE app.github_repository_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES app.github_repository_setup_attempts (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES app.people (id) ON DELETE CASCADE,
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT github_repository_snapshot_expiry CHECK (expires_at > created_at),
  CONSTRAINT github_repository_snapshot_attempt_scope_fk
    FOREIGN KEY (attempt_id, project_id, person_id, installation_id)
    REFERENCES app.github_repository_setup_attempts (id, project_id, person_id, installation_id)
    ON DELETE CASCADE
);

CREATE INDEX github_repository_snapshot_scope_idx
  ON app.github_repository_snapshots (project_id, person_id, expires_at);

CREATE TABLE app.github_repository_snapshot_repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES app.github_repository_snapshots (id) ON DELETE CASCADE,
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  owner text NOT NULL CHECK (owner <> ''),
  name text NOT NULL CHECK (name <> ''),
  is_private boolean NOT NULL,
  default_branch text,
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (snapshot_id, repository_id),
  UNIQUE (snapshot_id, position)
);

-- Match the application-table privilege boundary from the base schema migration.
-- Revoke object-level grants explicitly so permissive default privileges cannot expose
-- these newly-created tables through Supabase roles.
REVOKE ALL ON TABLE
  app.github_repository_setup_attempts,
  app.github_repository_snapshots,
  app.github_repository_snapshot_repositories
FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE
      app.github_repository_setup_attempts,
      app.github_repository_snapshots,
      app.github_repository_snapshot_repositories
    FROM service_role;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  app.github_repository_setup_attempts,
  app.github_repository_snapshots,
  app.github_repository_snapshot_repositories
TO app_runtime;
