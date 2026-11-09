# PR title

Build project task workflows, GitHub evidence and AI acceptance checks

# PR description

The full comparison against local `master` (`1d53b31`) includes earlier identity, project/task, GitHub and AI work plus task 4.5. Signed-in people can create projects and use task boards; product managers manage members and review submissions.

## Changes

- GitHub sign-in/sessions, server-enforced roles, project/membership services, task CRUD/lifecycle/progress updates, and board/detail/review-queue pages.
- GitHub App repository linking, scoped evidence reads, commit selection/attachment, and cached Acceptance Criteria Checks with validated evidence/history.
- SoC LLM adapter/fake, redaction, prompt/output validation, quotas/usage accounting, supporting migrations/configuration and tests.
- Task 4.5: `/projects/new`, workspace creation entry, authorized ordered member listing, member addition and confirmed PM transfer in Settings, plus Back to Project Space for both roles.
- MarkBind product site/GitHub Pages workflow, local usage tooling, specifications, guides and agent workflow/evidence records.
- Human-requested 4.4/4.5 completion tracking; this does not claim a new independent 4.4 review or release approval.

## Validation

Task 4.5 source/tests are committed at `f31a287b00a015d4cd326ae7b08879740f5868c0`; tracking is `1b188c9`. Checks ran on the same source before committing, with hashes in `workflow/evidence/projects-create-members-4-5/source-manifest.txt`:

- Lint, TypeScript and production build passed; 2,124 unit tests and 347 PostgreSQL tests passed.
- Two fix rounds/fresh reviews closed six findings; security review and synthetic desktop/mobile browser checks completed.
- Ordinary OpenSpec validation passed; strict validation exits 1 on six pre-existing length warnings.

Commands, reviews and limitations are in `workflow/handoffs/projects-create-members-4-5.md`. These checks do not constitute a fresh release review of all earlier branch contributions or the product site.

## Remaining verification

Developer A cross-review, actual authenticated Next.js navigation/refresh, live repository-panel success, full journeys, accessibility and release verification remain pending. Browser harnesses use synthetic data and mocked router/fetch. Progress Reports and other unchecked tasks remain incomplete. The session-log closure awaits human verification and is excluded from these commits.
