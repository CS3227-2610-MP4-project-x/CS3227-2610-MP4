# Tasks

Tasks marked **[P]** can be worked on at the same time as the other **[P]** tasks in the same group, by separate agents in separate git worktrees. Unmarked tasks depend on the tasks before them in their group. Each group lists the groups it depends on.

## 1. Resolve Open Decisions

- [x] 1.1 **[P]** Confirm SoC LLM details (API format, models, context window, limits, data retention, reachability from Vercel) and record them in the design.
- [x] 1.2 **[P]** Choose values for the check input budget, per-person quotas, and maximum report range; record them in the design.

## 2. Foundations

Depends on: none.

- [x] 2.1 Scaffold the Next.js App Router project with TypeScript, linting, Vitest, and Playwright; commit the lockfile.
- [x] 2.2 **[P]** Set up GitHub Actions: lint, type-check, unit tests, build, secret scanning, and dependency audit.
- [x] 2.3 **[P]** Create the development and production Supabase projects, Vercel environments (`dev` and `master`), and GitHub OAuth apps; document every environment variable in `.env.example`.
- [x] 2.4 **[P]** Create the database schema and migrations for people, projects, memberships, tasks, acceptance criteria, task events, progress updates, attached commits, check results, reports, and usage records.

## 3. Identity and Access

Depends on: 2.

- [x] 3.1 Implement GitHub sign-in and sign-out with Supabase Auth, storing the verified GitHub user ID and username; add tests for first sign-in and sign-out.
- [x] 3.2 Implement server-side membership and role authorization and temporary project/task API stubs for the approved routes in `identity-and-access`; add API tests for unauthenticated requests, non-members, product-manager-only actions, assigned and unassigned developer transitions, product-manager transitions, and denied requests making no state changes. Authorized stubs return HTTP 501 without mutation.
- [x] 3.3 Build the public `/sign-in` page and signed-in workspace account UI with verified GitHub username and avatar, sign-out success and generic failure handling, and session-based redirects; follow `specs/ui-spec.md` and cover the identity-and-access scenarios.

## 4. Task Management

Depends on: 3.

- [ ] 4.1 **[P]** Implement project creation, keys, memberships, the one-product-manager invariant, and product-manager transfer; decide who may create a project and how its initial product manager is selected; add PostgreSQL integrity and project-route authorization tests.
- [ ] 4.2 **[P]** Implement task create, read, edit, reassign, and soft delete with acceptance criteria and task IDs; replace the task stubs and add API authorization tests plus tests for missing criteria, assignees outside the project, and task IDs that are never reused.
- [ ] 4.3 Implement the To Do → In Progress → In Review → Done lifecycle, request-changes with feedback, and progress updates; replace the state stub and add transition, assignment/permission, competing-write, and route authorization tests.
- [ ] 4.4 Build the board, task detail, and review queue pages following `specs/ui-spec.md`.

## 5. GitHub Evidence

Depends on: 3. Can run alongside group 4.

- [x] 5.1 **[P]** Implement the product-manager repository authorization/link flow: start a server-side setup attempt bound to the project and verified PM with single-use state and a 10-minute expiry; verify the GitHub installation through separate user authorization before listing repositories; retain a normalized server-side repository-list snapshot with a 10-minute expiry and no OAuth-token persistence; and link only a repository from that verified snapshot after rechecking current App access. Any failure leaves an existing binding unchanged. Implement the approved setup callback, snapshot-read, and final-link route contracts in `specs/github-evidence/spec.md`. Add product-manager authorization, failed-link, and PostgreSQL integrity tests. Add OAuth client ID/secret settings to server config and `.env.example`, plus minimal composition wiring. Task 5.3 provides the setup URL entry point and UI. Create a new versioned migration to replace the shipped PAT ciphertext columns with installation and repository IDs and add normalized attempt/snapshot storage; do not edit the shipped migration. Clear any legacy repository fields and PAT ciphertext so affected projects become unlinked for PM relinking. Developer A owns all Section 5 work and migrations by explicit human-approved exception to the general migration ownership rule in `AGENTS.md`. PostgreSQL migration/integrity tests were completed in the remote development environment, as confirmed by the user on 2026-11-06.
- [x] 5.2 **[P]** Implement the server-side GitHub App adapter and deterministic fake. Use GitHub REST API version `2026-03-10`; mint short-lived installation tokens restricted to one linked repository with read-only permissions; list branches and commits by verified author, date range, and branch; fetch diffs; and test safe provider-error handling and token scoping.
- [x] 5.3 Wire the remaining App environment configuration and repository-read adapter composition; provide the PM-only setup URL route; build the PM Project Settings repository panel and developer commit picker; and implement the approved task-scoped branch/commit listing and idempotent commit attachment routes. Add only the minimal task-detail host page needed to open and mount the commit picker because the task-detail page from 4.4 does not yet exist. Update `.env.example`. Add assigned-developer route authorization tests and tests for branch choices, date filters, task-ID preselection, no commits found, unavailable evidence, foreign authors, atomic refusal, and already-attached SHA idempotency.

### Approved scope note for task 5.3

- Project Settings repository panel using the approved mockup as visual reference: unlinked state, install/configure action, in-app list after installation, linked state, and safe unavailable/recovery state.
- Minimal task-detail host page sufficient to mount and open the Section 5 developer commit picker. This is a narrow Section 5.3 dependency allowance, not completion of task 4.4.
- Approved task-scoped branch and commit listing routes and commit attachment route are specified in `specs/github-evidence/spec.md`.
- The approved security flow, setup callback, snapshot-read, final-link routes and payloads, 10-minute attempt and snapshot TTLs, normalized persistence, current App-access recheck, task-scoped pagination (`page` default 1, `perPage` default 50/max 100, `nextPage`), and in-request first-seen SHA deduplication are recorded in that spec. PostgreSQL migration/integrity tests were completed in the remote development environment, as confirmed by the user on 2026-11-06.
- Keep task 5.3 unchecked until implementation and applicable tests are complete.
- Task 4.4 remains unchecked and pending. Its remaining board, task-detail, and review-queue page work is outside this Section 5.3 allowance; do not expand the minimal host page into general task-management UI or mark 4.4 complete.

## 6. LLM Gateway and Safeguards

Depends on: 2. Can run alongside groups 3–5.

- [x] 6.1 **[P]** Implement the SoC LLM adapter and a deterministic fake adapter.
- [x] 6.2 **[P]** Implement secret redaction; add unit tests for common secret patterns.
- [x] 6.3 Implement the gateway: prompt building with untrusted content separated, schema validation with one retry, safe errors, per-person rate limits and quotas (reserved before the call, reset at 00:00 SGT, cached results not counted), and usage records; add unit tests for each.

## 7. Acceptance Criteria Check

Depends on: 5 and 6.

- [x] 7.1 Implement diff filtering, repository-owned `.acceptance-check.json` loading from the current default-branch tip, normalization and hashing of category prefixes, exact lockfile basenames, and generated path prefixes, GitHub-marked binary exclusion, destination-path handling for renames, and the 48,000-character budget; add tests for exclusions, priority ordering, whole-file selection, skipped-file reporting, and safe refusal when configuration is missing, invalid, or unavailable.
- [x] 7.2 Implement the check service: per-criterion result, evidence verification against the diff, and caching by task, commit-set hash, criteria hash, and normalized path-rules hash; add fake-adapter tests for success, failure, unverifiable evidence, and cache hits. Add a new versioned migration and PostgreSQL integration tests for `check_results.path_rules_hash` and the corresponding uniqueness keys. Developer B owns the database migration and persistence tests; Developer A owns the check service. Do not modify shipped migrations.
- [x] 7.3 Add the task-scoped assigned-developer check API, Acceptance Criteria Check UI/history component, and the read-only task-detail GET DTO that exposes check history; add assigned-developer and product-manager task-detail result-access API tests, plus tests that a check never changes task state. The read-only GET slice is a Group 7 exception to Task 4.2 ownership; Task 4.2 retains task create/edit/reassign/delete and other task writes. Task 4.3 retains lifecycle and submission state changes, and Task 4.4 retains task-detail and review-queue page integration. Group 7 does not implement a review-queue API/page, submission, or task-state changes.

## 8. Progress Report

Depends on: 4 and 6. Can run alongside group 7.

- [ ] 8.1 Implement report input assembly from structured activity for a date range in SGT; add tests for range boundaries (including late-evening activity), excluded diffs, empty ranges, ranges longer than 7 days, and activity over the input budget.
- [ ] 8.2 Implement report generation with citation checks and caching invalidated by new activity; add fake-adapter tests and product-manager-only API authorization tests.
- [ ] 8.3 Build the report page and the project AI usage view; add product-manager-only project usage API authorization tests.

## 9. Verification and Evidence

Depends on: all groups above.

- [ ] 9.1 **[P]** Run the AI security evaluation: prompt-injection and secret-redaction fixtures for both AI features against the live SoC LLM in development; record outcomes without asserting exact model wording.
- [ ] 9.2 **[P]** Write end-to-end tests for one complete developer journey and one complete product-manager journey, including fake-provider success and failure paths.
- [ ] 9.3 **[P]** Run accessibility checks on the main pages and record results.
- [ ] 9.4 Deploy to production, run the release checks (including one real SoC LLM call from each environment, after confirming with `GET /v1/models` that each key can use the pinned model, and a GitHub sign-in on each environment that returns to that environment's own URL), and record commands, revision, environment, results, and evidence paths.
- [ ] 9.5 Run OpenSpec validation and all lint, type-check, test, and build checks; resolve findings and record the final results.
