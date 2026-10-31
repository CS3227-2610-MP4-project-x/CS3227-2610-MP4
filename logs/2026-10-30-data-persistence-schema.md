# AI interaction summary — 2026-10-29/30 (task 2.4 data persistence)

- **Human request:** run the agent workflow for task 2.4, in this order:
  1. The analyst writes a context brief and draft scenarios. Stop for approval.
  2. After approval: the orchestrator writes the handoff, then the test-writer, then the implementer, then the reviewer (at most 2 fix rounds), then the local checks. Stop and report.

  Along the way the human also asked:
  - why a project has only one product manager;
  - for a commit message;
  - for the `.env.example` variables;
  - about the migration connection URL and the SSL certificate;
  - for suggested Supabase project settings.

  Finally the human asked the agent to resolve the review decisions as it recommended, write this log, and commit as it saw fit.
- **Human decisions:**
  - Approved the `data-persistence` spec delta.
  - Asked the agent to resolve open decisions D-A to D-M and the source conflicts as it recommended. These were recorded in `design.md`, "Data Persistence Decisions". This added spec scenarios for product-manager transfer, readable task IDs and soft delete, and amended CI decision D10.
  - Recorded the Supabase details: PostgreSQL 17 (17.11.0.011), Singapore region, Data API turned off.
  - Approved the `pg`, `@types/pg` and `supabase` dependencies.
  - Asked for `.env.example` to be created now. It took `DATABASE_URL`, `TEST_DATABASE_URL` and `GITHUB_TOKEN_ENCRYPTION_KEY`, and `.gitignore` got the `!.env.example` exception that D16 approved.
  - Chose to store the Supabase CA certificate in the environment variable `DATABASE_CA_CERT`, with `sslmode=verify-full`, recorded in D-J.
  - Kept the migration (superuser) URL out of `.env.example`; it stays an operator-only credential.
  - Asked the agent to resolve the task 2.4 review findings as it recommended. Recorded in `design.md`, "Task 2.4 review decisions":
    - no `DELETE` on `tasks`;
    - `task_events` append-only;
    - services keep assignees valid after membership changes;
    - `service_role` revoked;
    - accepted schema details;
    - a `github_evidence_unavailable` column on reports;
    - the developer guide's wider scope.
- **Agents (Claude Code subagents):**
  - **Analyst:** wrote the context brief, drafted `specs/data-persistence/spec.md`, and listed open decisions and conflicts.
  - **Orchestrator:** wrote `workflow/handoffs/data-persistence-schema.md` and raised the PostgreSQL version question.
  - **Test-writer:** wrote the PostgreSQL integration tests in `tests/integration/db/**`, then updated them for the review decisions.
  - **Implementer:** wrote the migration, `supabase/config.toml`, dependency pins, the integration Vitest mode, the `db-integration` CI job and `docs/developer-guide.md`. It also regenerated the lockfile on Linux so `npm ci` works in CI.
  - **Reviewer:** reported no must-fix findings. Fix round 1 then:
    - restored the lockfile root name;
    - added a guard so a project's task counter cannot decrease;
    - commented the assumption about the pre-existing role;
    - clarified the guide on `TEST_DATABASE_URL`.
  - The frontend agent was skipped because the task has no UI.
- **Checks (local, Windows, Docker `postgres:17`):** lint, `tsc --noEmit`, unit tests, integration tests and `next build` passed. The tracked `next-env.d.ts`, which the build regenerates, was reverted. Final counts, rerun by the main session after the review-decision changes:
  - unit tests: 1 of 1 passed;
  - integration tests: 11 files, 192 of 192 passed.
- **Commits:** the human committed `de3f088`. The agent committed the task 2.4 work on `feat/data-persistence-env-schema` as authorized; see the git log. Nothing was pushed and no PR was opened.
- **Unverified until push or release:**
  - the live CI `db-integration` run;
  - a gitleaks scan of the new files (the binary download was blocked locally);
  - `supabase db push` and the `\dp app.*` privilege check on the real Supabase projects.
- **Human follow-up:**
  - make `db-integration` a required check on `master`;
  - Developer A cross-reviews the `people` table.
- **Dependencies added:** `pg` 8.23.1, `@types/pg` 8.23.1, `supabase` 2.122.0. No secrets were recorded. Human verification of this summary is pending.
