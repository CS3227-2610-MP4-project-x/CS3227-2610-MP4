# Tasks

Tasks marked **[P]** can be worked on at the same time as the other **[P]** tasks in the same group, by separate agents in separate git worktrees. Unmarked tasks depend on the tasks before them in their group. Each group lists the groups it depends on.

## 1. Resolve Open Decisions

- [x] 1.1 **[P]** Confirm SoC LLM details (API format, models, context window, limits, data retention, reachability from Vercel) and record them in the design.
- [x] 1.2 **[P]** Choose values for the check input budget, per-person quotas, and maximum report range; record them in the design.

## 2. Foundations

Depends on: none.

- [x] 2.1 Scaffold the Next.js App Router project with TypeScript, linting, Vitest, and Playwright; commit the lockfile.
- [x] 2.2 **[P]** Set up GitHub Actions: lint, type-check, unit tests, build, secret scanning, and dependency audit.
- [ ] 2.3 **[P]** Create the development and production Supabase projects, Vercel environments (`dev` and `master`), and GitHub OAuth apps; document every environment variable in `.env.example`.
- [x] 2.4 **[P]** Create the database schema and migrations for people, projects, memberships, tasks, acceptance criteria, task events, progress updates, attached commits, check results, reports, and usage records.

## 3. Identity and Access

Depends on: 2.

- [ ] 3.1 Implement GitHub sign-in and sign-out with Supabase Auth, storing the verified GitHub user ID and username; add tests for first sign-in and sign-out.
- [ ] 3.2 Implement server-side membership and role checks used by every Route Handler and service; add API tests for non-members, developers calling product-manager actions, and unauthenticated requests.

## 4. Task Management

Depends on: 3.

- [ ] 4.1 **[P]** Implement projects with keys, memberships, the one-product-manager invariant, and product-manager transfer; add PostgreSQL tests for multiple memberships, manager uniqueness, and transfer.
- [ ] 4.2 **[P]** Implement task create, edit, reassign, and soft delete with acceptance criteria and task IDs; add tests for missing criteria, assignees outside the project, and task IDs that are never reused.
- [ ] 4.3 Implement the To Do → In Progress → In Review → Done lifecycle, request-changes with feedback, and progress updates; add transition, permission, and competing-write tests.
- [ ] 4.4 Build the board, task detail, and review queue pages following `specs/ui-spec.md`.

## 5. GitHub Evidence

Depends on: 3. Can run alongside group 4.

- [ ] 5.1 **[P]** Implement repository linking with an encrypted read-only token; add tests that the token is never returned or logged and that unreadable repositories are refused.
- [ ] 5.2 **[P]** Implement the GitHub adapter (list commits by author, date range, and branch; fetch diffs) with a fake for tests.
- [ ] 5.3 Implement the commit picker and commit attachment with the authorship check; add tests for pre-selection by task ID, no commits found, unavailable evidence, and commits by other authors.

## 6. LLM Gateway and Safeguards

Depends on: 2. Can run alongside groups 3–5.

- [ ] 6.1 **[P]** Implement the SoC LLM adapter and a deterministic fake adapter.
- [ ] 6.2 **[P]** Implement secret redaction; add unit tests for common secret patterns.
- [ ] 6.3 Implement the gateway: prompt building with untrusted content separated, schema validation with one retry, safe errors, per-person rate limits and quotas (reserved before the call, reset at 00:00 SGT, cached results not counted), and usage records; add unit tests for each.

## 7. Acceptance Criteria Check

Depends on: 5 and 6.

- [ ] 7.1 Implement diff filtering and the input budget; add tests for excluded files and skipped-file reporting.
- [ ] 7.2 Implement the check service: per-criterion result, evidence verification against the diff, and caching by commit set and criteria; add fake-adapter tests for success, failure, unverifiable evidence, and cache hits.
- [ ] 7.3 Show the check to the developer and attach the latest result to submissions; add tests that a check never changes task state.

## 8. Progress Report

Depends on: 4 and 6. Can run alongside group 7.

- [ ] 8.1 Implement report input assembly from structured activity for a date range in SGT; add tests for range boundaries (including late-evening activity), excluded diffs, empty ranges, ranges longer than 7 days, and activity over the input budget.
- [ ] 8.2 Implement report generation with citation checks and caching invalidated by new activity; add fake-adapter tests and product-manager-only access tests.
- [ ] 8.3 Build the report page and the project AI usage view.

## 9. Verification and Evidence

Depends on: all groups above.

- [ ] 9.1 **[P]** Run the AI security evaluation: prompt-injection and secret-redaction fixtures for both AI features against the live SoC LLM in development; record outcomes without asserting exact model wording.
- [ ] 9.2 **[P]** Write end-to-end tests for one complete developer journey and one complete product-manager journey, including fake-provider success and failure paths.
- [ ] 9.3 **[P]** Run accessibility checks on the main pages and record results.
- [ ] 9.4 Deploy to production, run the release checks (including one real SoC LLM call from each environment, after confirming with `GET /v1/models` that each key can use the pinned model, and a GitHub sign-in on each environment that returns to that environment's own URL), and record commands, revision, environment, results, and evidence paths.
- [ ] 9.5 Run OpenSpec validation and all lint, type-check, test, and build checks; resolve findings and record the final results.
