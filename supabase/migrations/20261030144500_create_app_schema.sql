-- Task 2.4: initial application schema.
-- Requirements: openspec/changes/project-task-management/specs/data-persistence/spec.md
-- Decisions:    "Data Persistence Decisions" D-A to D-M in
--               openspec/changes/project-task-management/design.md
--
-- Applied by an operator as a controlled release step (`supabase db push`), never by the
-- running application. Shipped migrations are never edited; later changes are new files.
-- Restore plan for this first migration (D-L): drop schema app and role app_runtime.
-- See docs/developer-guide.md.

-- ---------------------------------------------------------------------------
-- Runtime role (D-J)
-- ---------------------------------------------------------------------------
-- Created without a login credential. The operator enables login and sets the
-- credential outside the repository after this migration runs. Guarded so the
-- migration still applies if the role already exists in the cluster.
-- Assumption: this runs against fresh Supabase projects, where app_runtime does not yet
-- exist. If it does exist (for example after a rollback and re-apply on a development
-- database), the existing role is kept as it is, including any login the operator enabled;
-- the grants below still apply to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Schema (D-B)
-- ---------------------------------------------------------------------------
CREATE SCHEMA app;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Every mutable record carries an integer version that increases on each update
-- (requirement "Identifiers, timestamps, and revisions"). Callers still guard their
-- updates with `WHERE version = $n`; this trigger guarantees the increase.
CREATE FUNCTION app.bump_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$$;

-- A project key cannot change after creation (D-D).
CREATE FUNCTION app.projects_key_is_fixed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'a project key cannot change after creation',
      CONSTRAINT = 'projects_key_is_fixed';
  END IF;
  RETURN NEW;
END
$$;

-- The per-project task counter never goes down, so a task number is never handed out
-- twice, even after a task row is removed (D-D).
CREATE FUNCTION app.projects_task_counter_never_decreases() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.last_task_number < OLD.last_task_number THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'a project''s task counter cannot decrease',
      CONSTRAINT = 'projects_task_counter_never_decreases';
  END IF;
  RETURN NEW;
END
$$;

-- A task never moves to another project and never changes its number, so task IDs
-- are never reused and a task's records always stay in its project (D-D, D-E).
CREATE FUNCTION app.tasks_identity_is_fixed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'a task cannot change its project or number',
      CONSTRAINT = 'tasks_identity_is_fixed';
  END IF;
  RETURN NEW;
END
$$;

-- When a task is written with an assignee, the assignee must hold a developer membership
-- in the task's project (requirement "Task data stays inside its project"). The membership
-- row is share-locked so a concurrent role change or removal waits for this transaction.
CREATE FUNCTION app.tasks_assignee_is_project_developer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
     FROM app.memberships m
    WHERE m.project_id = NEW.project_id
      AND m.person_id = NEW.assignee_id
      AND m.role = 'developer'
      FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'foreign_key_violation',
      MESSAGE = 'the task assignee must be a developer in the task''s project',
      CONSTRAINT = 'tasks_assignee_is_project_developer';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- people (D-I)
-- ---------------------------------------------------------------------------
-- Own UUID; auth_user_id is the Supabase Auth user ID, deliberately without a foreign
-- key into the auth schema. Authorship checks use github_user_id only.
CREATE TABLE app.people (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid        NOT NULL,
  github_user_id  bigint      NOT NULL,
  github_username text        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_auth_user_id_key UNIQUE (auth_user_id),
  CONSTRAINT people_github_user_id_key UNIQUE (github_user_id),
  CONSTRAINT people_github_user_id_positive CHECK (github_user_id > 0),
  CONSTRAINT people_github_username_not_empty CHECK (github_username <> ''),
  CONSTRAINT people_version_positive CHECK (version >= 1)
);

-- ---------------------------------------------------------------------------
-- projects (D-D, D-H)
-- ---------------------------------------------------------------------------
-- The linked repository's credential is stored only as its AES-256-GCM parts
-- (key version, 96-bit IV, ciphertext, 128-bit authentication tag); all four are
-- set together or not at all. Encryption itself is task 5.1.
CREATE TABLE app.projects (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                      text        NOT NULL,
  name                     text        NOT NULL,
  last_task_number         integer     NOT NULL DEFAULT 0,
  github_repository_owner  text,
  github_repository_name   text,
  github_token_key_version integer,
  github_token_iv          bytea,
  github_token_ciphertext  bytea,
  github_token_auth_tag    bytea,
  version                  integer     NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_key_key UNIQUE (key),
  CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  CONSTRAINT projects_last_task_number_not_negative CHECK (last_task_number >= 0),
  CONSTRAINT projects_github_repository_complete CHECK (
    (github_repository_owner IS NULL) = (github_repository_name IS NULL)
  ),
  CONSTRAINT projects_github_token_complete CHECK (
    num_nulls(github_token_key_version, github_token_iv, github_token_ciphertext, github_token_auth_tag) IN (0, 4)
  ),
  CONSTRAINT projects_github_token_key_version_positive CHECK (github_token_key_version >= 1),
  CONSTRAINT projects_github_token_iv_length CHECK (octet_length(github_token_iv) = 12),
  CONSTRAINT projects_github_token_auth_tag_length CHECK (octet_length(github_token_auth_tag) = 16),
  CONSTRAINT projects_version_positive CHECK (version >= 1)
);

-- ---------------------------------------------------------------------------
-- memberships (D-C)
-- ---------------------------------------------------------------------------
-- One membership, with exactly one role, per person per project. At most one product
-- manager per project is a partial unique index checked row by row, so a transfer that
-- demotes the outgoing product manager before promoting the incoming developer succeeds
-- in one transaction.
CREATE TABLE app.memberships (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES app.projects (id) ON DELETE RESTRICT,
  person_id  uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  role       text        NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_project_person_key UNIQUE (project_id, person_id),
  CONSTRAINT memberships_role_valid CHECK (role IN ('product_manager', 'developer')),
  CONSTRAINT memberships_version_positive CHECK (version >= 1)
);

CREATE UNIQUE INDEX memberships_one_product_manager_per_project
  ON app.memberships (project_id)
  WHERE role = 'product_manager';

CREATE INDEX memberships_person_id_idx ON app.memberships (person_id);

-- ---------------------------------------------------------------------------
-- tasks (D-D, D-E)
-- ---------------------------------------------------------------------------
-- number comes from projects.last_task_number, incremented in the task-creation
-- transaction. (project_id, number) is unique across all tasks, including soft-deleted
-- ones, so a task ID is never reused. Deletion is soft through deleted_at.
CREATE TABLE app.tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES app.projects (id) ON DELETE RESTRICT,
  number      integer     NOT NULL,
  title       text        NOT NULL,
  description text        NOT NULL,
  assignee_id uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  due_date    date        NOT NULL,
  status      text        NOT NULL DEFAULT 'to_do',
  branch_name text,
  deleted_at  timestamptz,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_project_number_key UNIQUE (project_id, number),
  CONSTRAINT tasks_number_positive CHECK (number >= 1),
  CONSTRAINT tasks_status_valid CHECK (status IN ('to_do', 'in_progress', 'in_review', 'done')),
  CONSTRAINT tasks_version_positive CHECK (version >= 1)
);

CREATE INDEX tasks_assignee_id_idx ON app.tasks (assignee_id);

-- ---------------------------------------------------------------------------
-- acceptance_criteria
-- ---------------------------------------------------------------------------
-- Task records carry no project_id of their own: their project is always the project of
-- the task they reference, so they cannot belong to a different project.
CREATE TABLE app.acceptance_criteria (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES app.tasks (id) ON DELETE RESTRICT,
  position    integer     NOT NULL,
  description text        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_criteria_position_positive CHECK (position >= 1),
  CONSTRAINT acceptance_criteria_version_positive CHECK (version >= 1)
);

CREATE INDEX acceptance_criteria_task_id_idx ON app.acceptance_criteria (task_id, position);

-- ---------------------------------------------------------------------------
-- check_results (D-M)
-- ---------------------------------------------------------------------------
-- Lookup fields are columns; the validated result (per-criterion statuses, evidence,
-- gaps, skipped files) is jsonb. At most one result per task, sorted commit-set hash,
-- and criteria hash, so a stored result can be reused.
CREATE TABLE app.check_results (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid        NOT NULL REFERENCES app.tasks (id) ON DELETE RESTRICT,
  commit_set_hash text        NOT NULL,
  criteria_hash   text        NOT NULL,
  model           text        NOT NULL,
  redacted        boolean     NOT NULL,
  result          jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_results_reuse_key UNIQUE (task_id, commit_set_hash, criteria_hash),
  -- Target for task_events.check_result_id, so an event can only cite its own task's result.
  CONSTRAINT check_results_id_task_key UNIQUE (id, task_id)
);

-- ---------------------------------------------------------------------------
-- task_events (D-F)
-- ---------------------------------------------------------------------------
-- One append-only table for state changes, submissions (with the check result attached at
-- submission), assignment changes, and review feedback. Feedback text belongs to the
-- request-changes event and only to it.
CREATE TABLE app.task_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              uuid        NOT NULL REFERENCES app.tasks (id) ON DELETE RESTRICT,
  actor_id             uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  event_type           text        NOT NULL,
  from_status          text,
  to_status            text,
  previous_assignee_id uuid        REFERENCES app.people (id) ON DELETE RESTRICT,
  new_assignee_id      uuid        REFERENCES app.people (id) ON DELETE RESTRICT,
  check_result_id      uuid,
  feedback             text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_events_event_type_valid CHECK (
    event_type IN ('state_change', 'submission', 'assignment_change', 'review_feedback')
  ),
  CONSTRAINT task_events_from_status_valid CHECK (from_status IN ('to_do', 'in_progress', 'in_review', 'done')),
  CONSTRAINT task_events_to_status_valid CHECK (to_status IN ('to_do', 'in_progress', 'in_review', 'done')),
  CONSTRAINT task_events_feedback_only_on_review_feedback CHECK (
    (event_type = 'review_feedback') = (feedback IS NOT NULL)
  ),
  -- Review feedback must contain non-blank text (Task 2.4 review decisions).
  CONSTRAINT task_events_feedback_not_blank CHECK (feedback ~ '[^[:space:]]'),
  CONSTRAINT task_events_check_result_same_task
    FOREIGN KEY (check_result_id, task_id) REFERENCES app.check_results (id, task_id) ON DELETE RESTRICT
);

CREATE INDEX task_events_task_id_idx ON app.task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- progress_updates
-- ---------------------------------------------------------------------------
CREATE TABLE app.progress_updates (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid        NOT NULL REFERENCES app.tasks (id) ON DELETE RESTRICT,
  author_id  uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX progress_updates_task_id_idx ON app.progress_updates (task_id, created_at);

-- ---------------------------------------------------------------------------
-- attached_commits
-- ---------------------------------------------------------------------------
CREATE TABLE app.attached_commits (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES app.tasks (id) ON DELETE RESTRICT,
  commit_sha  text        NOT NULL,
  attached_by uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attached_commits_task_commit_key UNIQUE (task_id, commit_sha)
);

-- ---------------------------------------------------------------------------
-- reports (D-M)
-- ---------------------------------------------------------------------------
-- At most one stored report per project and SGT date range; regenerating replaces it.
-- Statements, with the task UUIDs they cite, are jsonb.
CREATE TABLE app.reports (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid        NOT NULL REFERENCES app.projects (id) ON DELETE RESTRICT,
  range_start        date        NOT NULL,
  range_end          date        NOT NULL,
  model              text        NOT NULL,
  latest_activity_at timestamptz,
  statements         jsonb       NOT NULL,
  -- The report states when GitHub evidence for the range was unavailable
  -- (daily-progress-report "Unavailable evidence is shown in the report").
  github_evidence_unavailable boolean NOT NULL DEFAULT false,
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_project_range_key UNIQUE (project_id, range_start, range_end),
  CONSTRAINT reports_range_ordered CHECK (range_end >= range_start),
  CONSTRAINT reports_version_positive CHECK (version >= 1)
);

-- ---------------------------------------------------------------------------
-- usage_records (D-G, D-M)
-- ---------------------------------------------------------------------------
-- Created when tokens are reserved (outcome 'pending') and settled after the LLM call in
-- a second transaction. No prompt or response content is stored. created_at is the start
-- time used by the 60-second rate window.
CREATE TABLE app.usage_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature         text        NOT NULL,
  project_id      uuid        NOT NULL REFERENCES app.projects (id) ON DELETE RESTRICT,
  person_id       uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  environment     text        NOT NULL,
  reserved_tokens integer     NOT NULL,
  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,
  outcome         text        NOT NULL DEFAULT 'pending',
  cached          boolean     NOT NULL DEFAULT false,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_records_outcome_valid CHECK (
    outcome IN ('pending', 'succeeded', 'invalid_output', 'provider_error', 'cached')
  ),
  CONSTRAINT usage_records_reserved_tokens_not_negative CHECK (reserved_tokens >= 0),
  CONSTRAINT usage_records_input_tokens_not_negative CHECK (input_tokens >= 0),
  CONSTRAINT usage_records_output_tokens_not_negative CHECK (output_tokens >= 0),
  CONSTRAINT usage_records_latency_not_negative CHECK (latency_ms >= 0),
  CONSTRAINT usage_records_version_positive CHECK (version >= 1)
);

CREATE INDEX usage_records_person_created_idx ON app.usage_records (person_id, created_at);
CREATE INDEX usage_records_project_created_idx ON app.usage_records (project_id, created_at);

-- ---------------------------------------------------------------------------
-- usage_quota_days (D-G)
-- ---------------------------------------------------------------------------
-- One lock row per person per SGT day. A reservation locks it with SELECT ... FOR UPDATE
-- so concurrent reservations for the same person and day are serialized.
CREATE TABLE app.usage_quota_days (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid        NOT NULL REFERENCES app.people (id) ON DELETE RESTRICT,
  sgt_date   date        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_quota_days_person_date_key UNIQUE (person_id, sgt_date)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER people_bump_version
  BEFORE UPDATE ON app.people
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER projects_bump_version
  BEFORE UPDATE ON app.projects
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER projects_key_is_fixed
  BEFORE UPDATE OF key ON app.projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_key_is_fixed();

CREATE TRIGGER projects_task_counter_never_decreases
  BEFORE UPDATE OF last_task_number ON app.projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_task_counter_never_decreases();

CREATE TRIGGER memberships_bump_version
  BEFORE UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER tasks_bump_version
  BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER tasks_identity_is_fixed
  BEFORE UPDATE OF project_id, number ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_identity_is_fixed();

CREATE TRIGGER tasks_assignee_is_project_developer
  BEFORE INSERT OR UPDATE OF assignee_id, project_id ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_assignee_is_project_developer();

CREATE TRIGGER acceptance_criteria_bump_version
  BEFORE UPDATE ON app.acceptance_criteria
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER reports_bump_version
  BEFORE UPDATE ON app.reports
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

CREATE TRIGGER usage_records_bump_version
  BEFORE UPDATE ON app.usage_records
  FOR EACH ROW EXECUTE FUNCTION app.bump_version();

-- ---------------------------------------------------------------------------
-- Privileges (D-J)
-- ---------------------------------------------------------------------------
-- Nobody but the schema owner and app_runtime reaches schema app. The Supabase Data API
-- roles get nothing, so the schema is unreachable through the Data API and row-level
-- security is not used. These revocations run after every object is created, so they also
-- remove anything that default privileges granted on creation.
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated;

-- service_role exists in Supabase projects but not on plain PostgreSQL, so its revocation
-- is guarded (Task 2.4 review decisions, "Other Supabase roles").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON SCHEMA app FROM service_role;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM service_role;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM service_role;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM service_role;
  END IF;
END
$$;

-- app_runtime reads and writes rows only. It owns nothing and cannot create, alter, or
-- drop objects. Trigger functions need no EXECUTE grant: that is checked only when the
-- trigger is created.
GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_runtime;

-- History is kept (Task 2.4 review decisions): tasks are only soft-deleted, so
-- app_runtime cannot DELETE them and a task number cannot be freed for reuse; task events
-- are append-only, so app_runtime can only read and insert them.
REVOKE DELETE ON app.tasks FROM app_runtime;
REVOKE UPDATE, DELETE ON app.task_events FROM app_runtime;
