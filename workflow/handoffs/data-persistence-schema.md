# Agent task handoff

## Task record `[ORCH]`

- Task ID: data-persistence-schema
- Summary: OpenSpec task 2.4. Create the database schema and migrations for people, projects, memberships, tasks, acceptance criteria, task events, progress updates, attached commits, check results, reports, and usage records. Add the PostgreSQL integration tests that cover them, the `db-integration` CI job, and the migration, backup and restore procedure in the developer guide.
- Human owner (Developer B / Developer A): Developer B (thegrimbee), who owns database/migrations, deployment/CI, usage logging, and the developer guide. The `people` table touches Developer A's identity and access area (Lim-ZY), so Developer A cross-reviews it.
- Requirement IDs: none exist and none are invented. Requirements are referenced by name from `openspec/changes/project-task-management/specs/data-persistence/spec.md`:
  - "Schema is created by versioned migrations"
  - "Identifiers, timestamps, and revisions"
  - "Membership integrity is enforced by the database"
  - "Task data stays inside its project"
  - "Stored results are keyed for reuse"
  - "Stored records exclude secrets and AI content"
  - "Runtime access is least-privilege and server-only"
- Status: planned. The human approved the spec ("Spec approved"). Next step: test-writer.
- Next human action: resolve open question Q1 (PostgreSQL major version) before the implementer starts. No action is needed before the test-writer starts, but the test-writer must not hard-code a version.

## Source and scope `[ORCH]`

- Repository / branch / worktree: `D:\Education\CS3227\CS3227-2610-MP4` / `ci/ci-cd-setup` / primary checkout with no worktree. Workers run one after another and their write paths do not overlap.
- Source revision: `de3f088` (`docs(openspec): add data-persistence spec and record task 2.4 decisions`). The working tree was clean when this handoff was created.
- Permitted paths and actions:
  - Test-writer:
    - `tests/integration/db/**` (new). This includes a helper that:
      - creates the Supabase baseline roles `anon` and `authenticated` when they are missing, so the grant tests run on plain PostgreSQL;
      - applies `supabase/migrations/*.sql` in filename order with `pg`, as a superuser or migration role;
      - opens connections as `app_runtime` to test the grants.
    - The helper reads the test database URL from `TEST_DATABASE_URL` (see Env vars). It may give `app_runtime` a password for the test, but only inside the disposable test database and never in a migration.
  - Implementer:
    - `supabase/config.toml` (new).
    - `supabase/migrations/*.sql` (new). Files are named `<UTC timestamp>_<name>.sql` (D-B). They contain:
      - the `app` schema;
      - the `app_runtime` role without a password, with its grants (D-J);
      - all eleven tables;
      - the per-person, per-SGT-day quota lock-row table (D-G);
      - `text` + `CHECK` statuses and outcomes, and `jsonb` result columns (D-M);
      - encrypted-token columns: key version, IV, ciphertext, authentication tag (D-H).
    - `package.json` and `package-lock.json`. Add pinned exact versions of `pg`, `@types/pg`, and the `supabase` CLI as a devDependency. Add a `test:integration` script.
    - `vitest.config.ts`. Add a separate integration project for `tests/integration/db/**`. `npm test` must keep running only unit tests and must need no database. The current config includes only `tests/unit/**`.
    - `.github/workflows/ci.yml`. Add only a `db-integration` job:
      - a PostgreSQL service container (D9, D-K) whose image is pinned to the version from Q1;
      - it applies migrations only to that disposable container (D10) and runs `npm run test:integration`;
      - no `secrets.*` and no Supabase credentials;
      - any new action pinned by full commit SHA with its version tag in a comment (D13);
      - existing jobs, triggers, permissions, and concurrency stay unchanged.
    - `docs/developer-guide.md` (new; does not exist yet). Document only the migration, backup and restore procedure (D-L):
      - first-migration rollback: drop the `app` schema and the `app_runtime` role;
      - `pg_dump` of the `app` schema before every later migration, stored outside the repository;
      - restore with `psql`;
      - the operator setting the `app_runtime` password outside the repository;
      - applying migrations with `supabase db push`.
  - Reviewer: read-only.
- Prohibited paths and actions:
  - No edits to `openspec/`, `AGENTS.md`, `.env.example`, `.gitignore`, `.nvmrc`, `.gitleaksignore`, or `src/`.
  - The test-writer does not edit implementer paths, and the implementer does not edit `tests/`.
  - Out of scope:
    - application repositories and services (tasks 4.x, 5.x, 6.x);
    - the `src/server` composition root and pool;
    - token encryption and decryption code (task 5.1);
    - quota reservation logic;
    - any `app_runtime` password in the repository.
  - No migrations applied to any Supabase project. Migrations are an operator release step.
  - No ORM. No dependencies beyond `pg`, `@types/pg`, and `supabase` without a new human decision.
  - No row-level security policies and no exposing `app` to the Data API (D-J).
  - No commits, pushes, PRs, or branch-protection changes.
  - No secrets, real credentials, or production data in fixtures or logs.
- Dependencies and parallel work:
  - Depends on task 2.1 (scaffold and lockfile, on `master`) and task 2.2 (`ci.yml`, on this branch).
  - Task 2.3 runs in parallel (`[P]`). It owns `.env.example` and creates the Supabase projects; it does not overlap these paths.
  - Order: test-writer → implementer → reviewer (read-only) → at most 2 fix rounds with the implementer → escalate to the human. After that, the main session runs `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` (against a local Docker PostgreSQL), and `npm run build`.
  - The test-writer's tests cannot run until the implementer adds `pg` and the integration Vitest project. The test-writer reports them as written but not run, and the implementer runs them after adding those.
  - Frontend agent: skipped (no UI).
  - Commit-pr agent: not assigned yet. It needs separate authorization.

## Context references `[ALL, when relevant]`

- `openspec/changes/project-task-management/specs/data-persistence/spec.md`: the approved requirements and scenarios.
- `openspec/changes/project-task-management/design.md`, section "Data Persistence Decisions": D-A to D-M and `.env.example` ownership.
- `openspec/changes/project-task-management/design.md`, section "CI Decisions": D7, D9, D10 (amended), D13.
- `openspec/changes/project-task-management/tasks.md`: task 2.4. Task 2.3 is the parallel task.
- Spec deltas that drive table contents (read-only context):
  - `specs/task-management/spec.md`: membership and roles, PM transfer, readable IDs, task fields, lifecycle states To Do / In Progress / In Review / Done, progress updates, request-changes feedback, soft delete.
  - `specs/github-evidence/spec.md`: one repository per project, encrypted credential, attached commits authored by the verified GitHub user ID.
  - `specs/identity-and-access/spec.md`: GitHub user ID and username (Developer A area).
  - `specs/completion-assessment/spec.md`: per-criterion `addressed` / `not_addressed` / `unclear`, evidence, gaps, skipped files, redaction note, reuse keyed by commit set and criteria hash.
  - `specs/daily-progress-report/spec.md`: range, citations, invalidation on new activity, GitHub-unavailable note.
  - `specs/ai-safeguards/spec.md`: usage-record fields (feature, project, person, environment, input/output tokens, latency, outcome, cached flag), no content, reserve and settle quotas.
- `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`: the current state the implementer extends.
- `workflow/handoffs/ci-github-actions.md`: CI conventions (pinned SHAs, job naming, no secrets).
- `AGENTS.md`: migration, dependency, secret, and Git rules.

## Decisions and open questions `[ORCH]`

- Current state:
  - No `supabase/` directory, migrations, database client, `tests/integration/`, or `docs/developer-guide.md` exists.
  - `src/` contains only `app`.
  - `ci.yml` has no PostgreSQL job.
- Human-approved decisions:
  - The `data-persistence` spec and D-A to D-M (approved by thegrimbee on 2026-10-30, `de3f088`).
  - CI decisions D9, D10 (amended), and D13.
  - The write paths, role order, skipped frontend agent, and fix-round limit given in this handoff's assignment.
  - Test interpretations:
    - "Data API access" means `anon` and `authenticated` have no privileges on schema `app`.
    - "Application does not migrate" means `app_runtime` cannot `CREATE` or `ALTER` in `app`, or `CREATE` in the database.
- Assumptions (identify unapproved assumptions):
  - Implementation choices left open by D-C to D-G, for the implementer to choose and the reviewer to check against the scenarios:
    - the mechanism for "assignee must be a Developer member of the task's project" (trigger or composite foreign key);
    - the mechanism for "at most one PM per project" while a one-transaction swap stays possible (for example, a partial unique index with demote-then-promote, or a deferrable constraint);
    - the mechanism for "records belong to the same project as their task".
  - The D-C refusal while the incoming developer has open assigned tasks is service logic (out of scope). The schema only has to allow the swap.
  - "Concurrent edits to a task" is tested at the schema level: a version-guarded `UPDATE ... WHERE version = $n` where one of two writers affects 0 rows, plus a version that increases. Whether a trigger or the caller increments the version is the implementer's choice, and the tests must document which they assume.
- Open questions / conflicts:
  - Q1 (blocks the implementer's CI job and the test container image): D-K requires the disposable PostgreSQL to match "the same major version as the Supabase projects". Those projects are created by the parallel task 2.3 and do not exist yet, so the major version is not recorded. This also affects `supabase/config.toml` `[db] major_version`. The human must record the version before the implementer pins the image. No agent may infer it. **Resolved 30 October 2026:** the human reported PostgreSQL 17.11.0.011, Singapore region, and the Data API turned off, and approved the `pg`, `@types/pg`, and `supabase` dependencies. Use major version 17 (`postgres:17` image, `[db] major_version = 17`).
  - Q2 (follow-up, not blocking): D-K makes `db-integration` a required check. That adds it to the D7 branch-protection list, which is a human action.
  - No conflicts found between the spec, design, and existing code.

### Env vars to record (for whichever of tasks 2.3 and 2.4 merges second)

On 30 October 2026 the human asked for these variables to be added now. The main session created `.env.example` with `DATABASE_URL` (`sslmode=verify-full`), `DATABASE_CA_CERT` (Supabase root CA as PEM text, per D-J; the runtime pool that reads it belongs to task 3.x, and the developer guide in this task documents where to download it and its use with `psql`/`pg_dump`), `TEST_DATABASE_URL`, and `GITHUB_TOKEN_ENCRYPTION_KEY`, and added the `!.env.example` exception to `.gitignore` (D16). Task 2.3 adds its own variables to the same file. Agents in this task still do not edit `.env.example`.

- `DATABASE_URL`: the `app_runtime` connection through the Supabase transaction pooler (D-A, D-J). Server-only, never `NEXT_PUBLIC_`.
- `TEST_DATABASE_URL`: the superuser connection to the disposable integration-test PostgreSQL (local Docker or the CI service container, D-K). The test helper derives the `app_runtime` connection from it. Synthetic only, never a Supabase database.
- `GITHUB_TOKEN_ENCRYPTION_KEY` (D-H) belongs to task 5.1 and is listed here only for completeness. Task 2.4 does not use it.

### Acceptance criteria

| # | Requirement / scenario or decision | Evidence expected |
|---|---|---|
| AC1 | Versioned migrations / Empty database is migrated | Applying `supabase/migrations/*.sql` in order to an empty PostgreSQL creates schema `app` with tables for all eleven entities. Integration test. |
| AC2 | Versioned migrations / Application does not migrate | `app_runtime` cannot `CREATE` in the database or `app`, and cannot `ALTER`/`DROP` `app` tables. It has only `SELECT`/`INSERT`/`UPDATE`/`DELETE` on tables and `USAGE` on sequences in `app` (D-J). The migration creates the role without a password. Integration test plus a static check. |
| AC3 | Identifiers, timestamps, revisions / Concurrent edits to a task | UUID primary keys, `timestamptz` timestamps, and an integer `version` on mutable records. Of two version-guarded updates with the same version, one succeeds and the other affects 0 rows. Integration test. |
| AC4 | Identifiers / Concurrent task creation; D-D | Two concurrent task inserts in one project get different numbers from the per-project counter. Task number is unique per project. Project key is unique and limited to 2–10 uppercase letters and digits starting with a letter, enforced by `CHECK`. Numbers are not reused after soft delete. Integration test. |
| AC5 | Membership / Person in several projects | One person can have memberships in two projects with different roles. Integration test. |
| AC6 | Membership / Second membership in the same project | A second membership for the same person and project is rejected. Integration test. |
| AC7 | Membership / Second product manager; D-C | A second PM membership in a project is rejected, and a PM swap (demote then promote) succeeds in one transaction. Integration test. |
| AC8 | Task data / Assignee outside the project | A task insert or update with an assignee who is not a Developer member of the task's project is rejected. Integration test. |
| AC9 | Task data / Orphan record | An acceptance criterion, progress update, task event, attached commit, or check result without an existing task is rejected. Records cannot belong to a project different from their task's. Integration test. |
| AC10 | Task data / Deleted task keeps its history; D-E | Soft delete through a deletion timestamp. The task, its progress updates, and its check results remain. Integration test. |
| AC11 | Stored results / Same check stored twice; D-M | A unique constraint on (task, sorted commit-set hash, criteria hash) rejects duplicates. At most one report per project and date range. Lookup fields are columns and results are `jsonb`. Integration test. |
| AC12 | No secrets or AI content / Credential at rest; D-H | Repository credential columns hold only key version, IV, ciphertext, and auth tag, with no plaintext token column. Usage records have no prompt or response content column. Static and schema-introspection test. |
| AC13 | Least privilege / Data API access; D-J | `anon` and `authenticated` have no privileges on schema `app` or its tables. No RLS. Integration test. |
| AC14 | D-G quota storage | Usage records hold feature, project, person, environment, input/output tokens, latency, outcome, and cached flag. Outcome is `CHECK`ed to `pending`, `succeeded`, `invalid_output`, `provider_error`, `cached`, and `pending` is insertable. A per-person, per-SGT-day row exists and can be locked with `SELECT ... FOR UPDATE` by `app_runtime`. Integration test. |
| AC15 | D-M / D-F column types | Statuses are `text` + `CHECK`, with no PostgreSQL enums. Task states are To Do / In Progress / In Review / Done. `task_events` is a single table covering state change, submission, assignment change, and review feedback. Schema introspection test. |
| AC16 | D-I people | `people` has its own UUID, a unique `auth_user_id` with no foreign key into `auth`, a unique GitHub user ID, and a GitHub username. Integration test. Developer A cross-reviews. |
| AC17 | D-K / D9 / D10 / D13 CI and tooling | `npm test` still needs no database. `npm run test:integration` runs the `tests/integration/db/**` project. A `db-integration` job uses a PostgreSQL service container with no secrets, its actions are SHA-pinned, and the other jobs are unchanged. `pg`, `@types/pg`, and `supabase` are pinned and the lockfile is updated. Reviewer checks the YAML and `package.json`. |
| AC18 | D-L developer guide | `docs/developer-guide.md` documents the first-migration rollback, the pre-migration `pg_dump` of `app` stored outside the repository, `psql` restore, applying migrations with `supabase db push`, and the operator setting the `app_runtime` password outside the repository. Reviewer checks it. |

## Worker session reports

### Session `orchestrator / not available`

- Provider: `claude`
- Provider session ID: not available
- Work ID: data-persistence-schema
- Agent: orchestrator
- Phase: planning / handoff

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (Claude Agent SDK), Opus 5.5
- Role: orchestrator
- Human owner and assigned task scope: Developer B; coordination of task 2.4 and this handoff record only.
- Source revision: `de3f088`
- Started / ended / elapsed: not available
- Resource usage (provider-reported): tokens in / out / total: not available; cache read / write: not available; cost: not available; tool calls: not available
- Unavailable resource metrics: tokens, cache, cost, tool-call count, elapsed time
- Work completed / findings: recorded the task scope, non-overlapping write paths, role order, acceptance criteria AC1–AC18, env vars for `.env.example`, and open questions Q1 and Q2. I confirmed `supabase/`, `tests/integration/`, and `docs/developer-guide.md` do not exist and that `vitest.config.ts` includes only `tests/unit/**`.
- Files changed (use `none` if read-only): `workflow/handoffs/data-persistence-schema.md`
- Checks run and exact results (use `none` if none were run): none
- Gaps / blockers (use `none` if none): Q1 (PostgreSQL major version) blocks the implementer's image pin.

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:
  - Analyst: completed earlier in the main session. Its brief is summarized in Context references and Decisions, and it changed no files.
  - Test-writer: assigned first. It writes only `tests/integration/db/**` and covers AC1–AC16 with synthetic data. It reads `TEST_DATABASE_URL`, skips with a clear message when the variable is unset, and does not hard-code a PostgreSQL version. AI security evaluation cases are not in scope.
  - Implementer: assigned after the test-writer, and starts once Q1 is recorded. It writes only the implementer paths above and runs the test-writer's tests after adding `pg` and the integration project. It does not edit tests; failing tests go back to the orchestrator and then the human.
  - Reviewer: assigned after the implementer, read-only. It checks AC1–AC18, D-A to D-M, D9, D10, D13, and code quality. At most 2 fix rounds go back to the implementer, then the remaining findings go to the human.
  - Frontend: skipped (no UI).
  - Commit-pr: not assigned. It needs separate human authorization.
  - No worktree, because the work is sequential.
- Consolidation notes: worker sessions will be appended here as they finish.

### Session `implementer / not available`

- Provider: `claude`
- Provider session ID: not available
- Work ID: data-persistence-schema
- Agent: implementer
- Phase: implementation

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (Claude Agent SDK), Opus 5.5
- Role: implementer
- Human owner and assigned task scope: Developer B. The implementer write paths listed above, plus this session block (the orchestrator assigned it).
- Source revision: `de3f088` plus the uncommitted test-writer files and this handoff
- Started / ended / elapsed: not available
- Resource usage (provider-reported): tokens in / out / total: not available; cache read / write: not available; cost: not available; tool calls: not available
- Unavailable resource metrics: tokens, cache, cost, tool-call count, elapsed time
- Work completed / findings:
  - The migration creates schema `app`, a guarded `CREATE ROLE app_runtime NOLOGIN` with no credential, the eleven tables, and `usage_quota_days`. It revokes everything on `app` from `PUBLIC`, `anon`, and `authenticated`. It grants `app_runtime` only `USAGE` on the schema, `SELECT`/`INSERT`/`UPDATE`/`DELETE` on all tables, and `USAGE` on all sequences. No RLS.
  - Mechanisms chosen where the handoff left room:
    - At most one PM per project: a partial unique index on `memberships (project_id) WHERE role = 'product_manager'`. It is checked row by row, so demote-then-promote works in one transaction.
    - Assignee check: a `BEFORE INSERT OR UPDATE OF assignee_id, project_id` trigger on `tasks` requires a `developer` membership in the task's project and share-locks that membership row.
    - Same project: the child tables carry no `project_id`, so their project always comes from the task. A `task_events.check_result_id` can only reference a check result of the same task, through a composite FK to `check_results (id, task_id)`.
    - Versions: a `BEFORE UPDATE` trigger sets `version = OLD.version + 1` and `updated_at = now()`. Callers still guard with `WHERE version = $n`.
    - Immutability triggers stop changes to `projects.key` and to `tasks.project_id` and `tasks.number` (D-D: the key "cannot change" and task IDs are never reused).
  - Additions beyond the fixtures' list, for the reviewer to check:
    - `projects.github_repository_owner` and `github_repository_name` (nullable, set together; github-evidence "owner/name").
    - The four token columns must be all set or all null. The IV must be 12 bytes and the tag 16 bytes (D-H).
    - `version` and `updated_at` also on `acceptance_criteria`, `reports`, and `usage_records`, because they are updated (criteria edited, report replaced, usage settled).
    - `task_events`: `from_status`, `to_status`, `previous_assignee_id`, `new_assignee_id`, `check_result_id`, and a CHECK that `feedback` is present only and always on `review_feedback`.
    - `attached_commits` is unique on `(task_id, commit_sha)`.
    - `reports.range_end >= range_start`.
    - Non-negative token and latency CHECKs.
    - Indexes on FK lookup paths.
  - Not constrained, because no value set is recorded: `usage_records.feature`, `environment`, hash formats, commit SHA format, and `jsonb` shapes.
  - The lockfile was first regenerated on Windows (npm 11.6.2). That version dropped the optional `@emnapi/*` entries, and Linux `npm ci` then failed with "Missing: @emnapi/runtime@1.11.3". The committed lockfile passed Linux `npm ci`. So the final lockfile was regenerated in a `node:24` Linux container (npm 11.19.1) with `npm install --package-lock-only` from the committed lockfile plus the updated `package.json`. The result only adds entries; the one removed line is the root `"name"`, which `package.json` does not have. It was then verified with `npm ci` on both Linux and Windows.
  - CI uses `POSTGRES_PASSWORD: postgres`, the conventional value for a throwaway container, instead of a higher-entropy throwaway value that gitleaks `generic-api-key` might flag.
  - No test was found to be wrong.
- Files changed (use `none` if read-only):
  - `supabase/config.toml` (new)
  - `supabase/migrations/20261030144500_create_app_schema.sql` (new)
  - `package.json`
  - `package-lock.json`
  - `vitest.config.ts`
  - `.github/workflows/ci.yml` (new `db-integration` job only)
  - `docs/developer-guide.md` (new)
  - this session block
- Checks run and exact results (use `none` if none were run), on Windows with Node v24.12.0 and a local Docker `postgres:17` (17.11):
  - `npm run test:integration` with `TEST_DATABASE_URL` set: 10 files, 129 tests passed. With it unset: 10 files, 129 tests skipped.
  - `npm test`: 1 file, 1 test passed. Unit tests only.
  - `npm run lint`: exit 0.
  - `npx tsc --noEmit`: exit 0.
  - `npm run build`: exit 0. The build regenerated `next-env.d.ts`, which was restored to its committed content.
  - `npm audit --audit-level=high`: exit 0. The two moderate `vitest` 5.0.0 advisories were already present.
  - Linux `node:24` `npm ci --ignore-scripts` on the final lockfile: 415 packages added.
  - Windows `npm ci`: success, lockfile unchanged.
  - `npx supabase --version`: 2.122.0. The `--db-url`, `--dry-run`, and `--status` flags used in the guide were confirmed with `--help`.
  - Manual `psql` spot checks, run as `app_runtime` on a scratch database:
    - the version trigger bumps the version without the caller incrementing it;
    - changing a project key is refused;
    - changing a task's number is refused;
    - a task event citing another task's check result is refused by FK;
    - feedback on a `state_change` event is refused by CHECK;
    - hard-deleting a task with children is refused;
    - `app_runtime` and `anon` have no EXECUTE on the trigger functions.
- Gaps / blockers (use `none` if none):
  - The live CI `db-integration` run is unverified until push.
  - The gitleaks scan of the new files was not run: downloading the gitleaks binary locally was denied by the session's permission policy.
  - `supabase db push` against a real Supabase project was not run (out of scope).
  - The report "GitHub evidence unavailable" note has no dedicated column; D-M lists none, so it would have to live in `statements` or a later migration.
  - Q2 (adding `db-integration` to required checks) remains a human action.

#### Implementer fields `[IMPLEMENTER]`

- Implementation files and rationale:
  - The migration implements D-B to D-J and D-M as described above.
  - `config.toml` pins `[db] major_version = 17` (Q1) and holds no secrets.
  - `vitest.config.ts` selects the unit configuration by default and the integration configuration (`tests/integration/db/**`, files run one at a time) under `--mode integration`. That keeps the existing `test` script unchanged and database-free.
  - `ci.yml` adds `db-integration`:
    - a `postgres:17` service with a health check and an inline throwaway credential;
    - `TEST_DATABASE_URL`, then `npm ci`, then `npm run test:integration`;
    - the same SHA-pinned checkout and setup-node actions with version comments;
    - no secrets, with workflow-level read-only permissions and concurrency inherited;
    - skipped on `schedule` like the other non-audit jobs.
  - The developer guide covers D-L and D-A: Supabase CLI over the session pooler, the first-migration rollback, the `pg_dump` of `app` before each later migration stored outside the repository, `psql` single-transaction restore, `migration repair`, enabling `app_runtime` with `\password`, the CA as `sslrootcert` and `DATABASE_CA_CERT` with `verify-full`, and running the integration tests locally.
- Visual diff path, or reason skill was unavailable: the `present-changes-visually` skill is not available in this Claude environment, and no substitute was used.
- Other generated artifacts / dependencies:
  - `pg` 8.23.1 (dependency).
  - `@types/pg` 8.23.1 and `supabase` 2.122.0 (devDependencies), all exact pins.
  - `package-lock.json` regenerated as described above.

#### Fix round 1 (implementer)

- S1: the lockfile's root `"name"` was `"w"`, left over from the container's working directory. It is restored to `"CS3227-2610-MP4"`, so the lockfile diff now only adds lines. `npm ci` succeeds on Windows (417 packages) and on Linux `node:24` with `--ignore-scripts` (416 packages).
- S2: added trigger `projects_task_counter_never_decreases`, a `BEFORE UPDATE OF last_task_number` trigger that raises SQLSTATE 23514 on any decrease. Its function follows the existing ones: `search_path = ''`, schema-qualified, and EXECUTE revoked through the existing `REVOKE ALL ON ALL FUNCTIONS`. A spot check as `app_runtime` confirmed that an increment succeeds, a decrease is refused, and neither `app_runtime` nor `anon` has EXECUTE.
  - Residual: after a childless task is hard-deleted, an explicit insert of a number at or below the counter is not blocked. Normal creation always takes the next counter value, so it never reuses a number. Not changed, because it is outside the requested fix.
- S3: comment only. It states that the migration assumes fresh projects and that an existing `app_runtime` is kept as it is. No `ALTER ROLE` was added.
- Guide: the guide never suggested `.env.local` for `TEST_DATABASE_URL`; its `.env.local` mentions are for `DATABASE_CA_CERT` and `DATABASE_URL`. A sentence now says to set `TEST_DATABASE_URL` in the shell, because Vitest does not load `.env.local` into the process environment.
- Checks, using a fresh `postgres:17` container, which was stopped afterwards:
  - `npm run test:integration`: 10 files and 129 tests passed.
  - `npm test`: 1 file and 1 test passed.
  - `npm run lint`: exit 0.
  - `npx tsc --noEmit`: exit 0.
  - `npm run build`: exit 0. `next-env.d.ts` was restored afterwards.

### Session `test-writer / not available` (follow-up: task 2.4 review decisions)

- Provider: `claude`
- Provider session ID: not available
- Work ID: data-persistence-schema
- Agent: test-writer
- Phase: test update after review

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (Claude Agent SDK), Opus 5.5
- Role: test-writer
- Human owner and assigned task scope: Developer B. Only `tests/integration/db/**`, plus this session block.
- Source revision: `de3f088` plus the uncommitted task 2.4 working tree
- Started / ended / elapsed: not available
- Resource usage (provider-reported): tokens in / out / total: not available; cache read / write: not available; cost: not available; tool calls: not available
- Unavailable resource metrics: tokens, cache, cost, tool-call count, elapsed time
- Work completed / findings: encoded design.md "Task 2.4 review decisions" (approved 30 Oct 2026) and the reviewer's test-adequacy gaps. The tests for decisions 1–4 fail against the current migration as intended. The gap tests pass. No test was weakened to pass.
- Files changed (use `none` if read-only): `tests/integration/db/support/fixtures.ts`, `tests/integration/db/support/harness.ts`, `tests/integration/db/schema-migrations.test.ts`, `tests/integration/db/data-api-access.test.ts`, `tests/integration/db/identifiers-and-revisions.test.ts`, `tests/integration/db/secrets-and-content.test.ts`, `tests/integration/db/stored-results.test.ts`, `tests/integration/db/task-history.test.ts` (new), this session block
- Checks run and exact results (use `none` if none were run):
  - `npx tsc --noEmit`: exit 0.
  - `npx eslint tests/integration/db`: exit 0.
  - `npm run test:integration` against a disposable `postgres:17` container, which was stopped afterwards: 11 files (4 failed, 7 passed), 192 tests (16 failed, 176 passed). The 16 failures are the expected ones:
    - Decision 1: two grant assertions in `schema-migrations`, and three 42501 tests in `task-history` (DELETE tasks, UPDATE and DELETE task_events).
    - Decision 2: two `service_role` tests in the permissive-default-privileges block in `data-api-access`.
    - Decision 3: four blank-feedback tests in `task-history`.
    - Decision 4: five `github_evidence_unavailable` tests in `stored-results`.
- Gaps / blockers (use `none` if none): see Coverage gaps.

#### Test-writer fields `[TEST-WRITER]`

- Test files changed: as listed above.
- Scenarios and requirement IDs covered (no requirement IDs exist; referenced by decision and requirement name):
  - Decision 1 (no DELETE on tasks; task_events SELECT/INSERT only):
    - exact per-table privileges, through `runtimeTablePrivileges()` in fixtures;
    - no column-level UPDATE on task_events;
    - behavioural 42501 for DELETE on tasks, and for UPDATE and DELETE on task_events;
    - controls: soft delete, and inserting and reading events.
  - Decision 2 (`service_role`):
    - the harness creates `service_role` NOLOGIN alongside `anon` and `authenticated`;
    - all three roles have no schema, table, column, sequence, or function privilege in `app`;
    - a second block applies permissive Supabase-like `ALTER DEFAULT PRIVILEGES` before the migrations (through a new optional `beforeMigrations` harness hook), so the migration's own revocation is tested.
  - Decision 3:
    - `review_feedback` with empty or whitespace-only feedback is rejected;
    - feedback on the other three event types is rejected;
    - non-blank controls are accepted.
  - Decision 4: `reports.github_evidence_unavailable` is boolean, NOT NULL, and defaults to false; it can be set true on insert and on update, and NULL is rejected.
  - Gaps from item 5:
    - A project key change is refused.
    - A task `number` or `project_id` change is refused.
    - `last_task_number` cannot decrease.
    - The four token columns are all set or all null; IV lengths 0/11/13/16 and tag lengths 0/12/15/17 are rejected.
    - `check_result_id` must belong to the same task.
    - `app_runtime` and the three baseline roles have no EXECUTE on functions in `app`.
    - The stale-writer test no longer sets `version`; it asserts `version + 1`, plus an exact +1-per-update test.
    - Usage pending→settled as `app_runtime` was already covered and is unchanged.
- Coverage gaps:
  - The `service_role` default-privileges block simulates Supabase-like grants. It does not reproduce Supabase's exact defaults, and the operator's `\dp app.*` release check remains the real-project evidence.
  - Calling a trigger function directly is checked through the catalog (`has_function_privilege`), not by invocation.

## Consolidated outcome `[ORCH]`

- Changed files and rationale: pending (only this handoff exists so far).
- Tests/checks and results: pending.
- Generated artifacts: pending (expected: lockfile update only).
- Dependencies added: pending (approved: `pg`, `@types/pg`, `supabase`, all pinned).
- Known gaps and unverified items: Q1 is unresolved. The live CI `db-integration` run is unverified until the human pushes. No migration is applied to any Supabase project in this task.
- Reviewer findings: pending.
- Suggested skills / references for the next worker: the `workflow/handoffs/ci-github-actions.md` conventions for SHA pinning and job layout.
- Next action and responsible human: Developer B records Q1 (the PostgreSQL major version for the Supabase projects and the test container). Developer A cross-reviews `people` (AC16) after the implementer finishes.

## Change log `[ORCH]`

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-10-30 | orchestrator / not available | Created handoff for task 2.4; status planned, test-writer next; Q1 raised. |
