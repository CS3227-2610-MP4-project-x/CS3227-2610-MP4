-- Replace project-scoped encrypted PAT storage with a stable GitHub App binding.
-- Legacy repository links are intentionally cleared so project managers can relink
-- them through the separately authorized GitHub App flow.

UPDATE app.projects
   SET github_repository_owner = NULL,
       github_repository_name = NULL,
       github_token_key_version = NULL,
       github_token_iv = NULL,
       github_token_ciphertext = NULL,
       github_token_auth_tag = NULL
 WHERE github_repository_owner IS NOT NULL
    OR github_repository_name IS NOT NULL
    OR github_token_key_version IS NOT NULL
    OR github_token_iv IS NOT NULL
    OR github_token_ciphertext IS NOT NULL
    OR github_token_auth_tag IS NOT NULL;

ALTER TABLE app.projects
  ADD COLUMN github_installation_id bigint,
  ADD COLUMN github_repository_id bigint;

ALTER TABLE app.projects
  DROP CONSTRAINT projects_github_token_complete,
  DROP CONSTRAINT projects_github_token_key_version_positive,
  DROP CONSTRAINT projects_github_token_iv_length,
  DROP CONSTRAINT projects_github_token_auth_tag_length,
  DROP COLUMN github_token_key_version,
  DROP COLUMN github_token_iv,
  DROP COLUMN github_token_ciphertext,
  DROP COLUMN github_token_auth_tag,
  ADD CONSTRAINT projects_github_binding_complete CHECK (
    num_nulls(
      github_installation_id,
      github_repository_id,
      github_repository_owner,
      github_repository_name
    ) IN (0, 4)
  ),
  ADD CONSTRAINT projects_github_installation_id_positive CHECK (
    github_installation_id > 0
  ),
  ADD CONSTRAINT projects_github_repository_id_positive CHECK (
    github_repository_id > 0
  );

COMMENT ON COLUMN app.projects.github_installation_id IS
  'GitHub App installation ID for the linked repository; never an access token.';
COMMENT ON COLUMN app.projects.github_repository_id IS
  'Stable GitHub repository ID for the project binding.';
