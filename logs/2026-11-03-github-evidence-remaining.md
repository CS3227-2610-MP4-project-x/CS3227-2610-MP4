# AI interaction summary — remaining GitHub evidence work

## Human verification

Pending review by the human owner. This summary records the approved requirements, implementation, checks, and remaining verification limits for this chat.

## User requests and decisions

- The user asked to create a branch from `dev` for remaining Section 5 GitHub evidence work without changing files. Created `feat/github-evidence-remaining` from the then-current `dev` tip.
- The user supplied three developer UI mockups and asked for a product-manager-side mockup proposal. A frontend agent proposed one Project Settings screen and generated a first-time, unlinked repository state image outside the repository. The user approved using that mockup.
- The user then asked to complete the remaining Section 5 work following the repository agent workflow.
- Before implementation, the analyst identified an unspecified handoff from GitHub App installation to the in-app repository chooser, plus missing commit route/payload contracts. The user chose an in-app repository list and authorized the analyst to draft task-scoped commit list and attachment API contracts for review.

## Work completed in this session

- Created branch `feat/github-evidence-remaining` from the `dev` tip observed at session start.
- The analyst recorded the user's approved repository setup flow and route contracts in OpenSpec. `openspec validate project-task-management --strict` passes.
- Implemented the Section 5.1 PM-bound GitHub App setup attempt, verified installation/repository snapshot, final repository link, and versioned migration replacing legacy PAT fields while preserving existing links on failed relinks.
- Implemented Section 5.3 setup URL/callback/snapshot/link API flow, task-scoped branch and commit listing, atomic/idempotent commit attachment with authorship verification, PM Project Settings repository UI, developer commit picker, and the user-approved minimal task evidence host page. The host page does not complete Section 4.4.
- Added `.env.example` settings and composition wiring. No dependencies were added.
- The reviewer found repository response parsing, picker pagination, provider-unavailable mapping, runtime grants, and a migration fixture issue. The implementer and test-writer corrected these findings; targeted regression coverage was added for the repository response shape and runtime grants.
- Updated `workflow/handoffs/github-evidence-remaining.md` with current scope, ownership, checks, review findings, and remaining verification limits.

## Checks and limitations

- Passed: `npm run lint`, `npm run typecheck`, `git diff --check`, `openspec validate project-task-management --strict`, and focused GitHub evidence/auth route tests (96 passed).
- The full unit suite reported 500 passed and 5 failed. All five failures are `spawnSync git EPERM` in existing `.gitignore` checks within `tests/unit/environment-configuration.test.ts`; the process-spawn restriction prevents those tests from invoking Git in this environment.
- `npm run test:integration -- tests/integration/db/github-repository-binding-migration.test.ts` discovered 8 tests and skipped all because `TEST_DATABASE_URL` is unavailable. PostgreSQL migration, grants, constraints, and transaction behavior therefore remain unverified at runtime.
- The build was attempted earlier but could not complete in this sandbox: default Turbopack failed while spawning/binding a process; the webpack fallback failed while parsing TypeScript `--showConfig`. The implementation passed lint and type-check.
- Frontend QA was source-only. The workspace had no running app/browser surface, and private UI flows, responsive behavior, pagination interaction, and accessibility were not exercised in a rendered browser.
- Tasks 5.1 and 5.3 remain unchecked in `tasks.md` pending database and rendered-flow verification; task 5.2 was already complete. Section 4.4 remains out of scope and unchecked.
- The generated PM mockup is stored outside the repository at `/home/klzy/.codex/generated_images/01a1a000-db97-7983-b4fb-d16538b162b7/exec-8d8ae46b-1c78-4454-8dde-b3ea13c6f679.png`.
- No dependencies were added. After the user explicitly authorized scoped commits on `feat/github-evidence-remaining`, the commit agent created three local commits: `3a017e0` (approved OpenSpec/handoff/log), `e1ce9bd` (GitHub setup and evidence API implementation/tests), and `4f03e8a` (PM repository settings and developer commit picker UI). The worktree is clean and `git diff --check dev...HEAD` passed. No push, pull request, or deployment was made.

## Review needed

The human owner should review the three commits, OpenSpec decisions, product-manager mockup implementation, and known verification gaps before deciding whether to provide a disposable PostgreSQL test database and browser/runtime validation environment. A PR title/description draft is available in the commit-agent handoff; no push or pull request was authorized or performed.

## Follow-up: db-integration CI failure

- The user supplied a CI log and requested the database integration failure be fixed. The leading Vite `configLoader: 'native'` text is a warning; the log reports nine actual database-test failures.
- Read-only analyst diagnosis identified four causes: the setup-test fixture passed a `{ id, key }` project object instead of its UUID; the new snapshot-repository table lacked the schema-wide UUID `id` primary key; its app_runtime grants and its missing default-role revocations contradicted the active D-D/D-J decisions and CI access tests.
- The migration and integration test were updated in the working tree. The snapshot repository keeps the `(snapshot_id, repository_id)` and `(snapshot_id, position)` uniqueness constraints while adding its UUID primary key. The migration revokes new-table privileges from PUBLIC, anon, authenticated, and optional `service_role`, then grants app_runtime CRUD as D-J requires. Test fixtures now pass project UUIDs and assert the correct runtime and Data API access.
- Independent reviewer found no remaining issues and mapped all nine pasted failures to those fixes.
- Checks after the fix: lint, type-check, strict OpenSpec validation, and `git diff --check` passed. The focused integration suite was discovered but all 8 tests skipped because `TEST_DATABASE_URL` is unset; `psql` is unavailable. Therefore the repaired integration suite still needs confirmation against disposable PostgreSQL 17 or by a fresh CI run.
- No commit, push, or PR was made for this follow-up. Existing Section 5 commits were preserved; the migration and test corrections remain uncommitted for review.

## Follow-up: unit-test CI failure

### Human verification

Pending human review. This entry records the requested CI repair and observed checks; it is not marked human-verified.

### Request and diagnosis

- The user supplied a unit-test CI log and requested the failure be resolved.
- The leading Vite `configLoader: 'native'` notice is a warning. The attached run reports 39 failed and 585 passed.
- Five failures in `tests/unit/environment-configuration.test.ts` occurred because its shared synthetic environment did not include the required GitHub App ID, slug, and private key.
- Thirty-four failures in `tests/unit/github-evidence-routes.test.ts` occurred because the mocked server config omitted `ai`, which composition now reads to initialize the configured adapter.

### Work and verification

- Updated only those two test fixtures with synthetic values. Production code, assertions, and specifications were unchanged; no dependencies were added.
- Focused command: `npx vitest run tests/unit/environment-configuration.test.ts tests/unit/github-evidence-routes.test.ts` — both files passed, 87/87, exit 0 in the permitted run. The Vite warning remained informational.
- The default restricted run passed 82/87; five `.gitignore` checks could not spawn Git (`spawnSync git EPERM`). The full suite and a hosted CI rerun were not performed.
- Independent reviewer found no issues; reviewer also passed `git diff --check`. Root confirmed `git diff --check` passed.
- No commit, push, or PR was made. Changes remain uncommitted on `feat/github-evidence-remaining` for human review.
