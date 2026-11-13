# Proposal

## Why

Small software teams lose time to status reporting: product managers chase developers for updates, and developers write updates that repeat what their commits already show. This change defines a lightweight task board where developers attach their GitHub commits to tasks, AI checks those commits against each task's acceptance criteria, and AI turns project activity into progress reports, so the product manager can see where the project stands without asking.

## What Changes

- Introduce projects with exactly one product manager and any number of developers. A person may belong to several projects, with one role in each.
- People sign in with GitHub, so each developer's GitHub identity is verified.
- Product managers create, edit, reassign, and delete tasks with acceptance criteria. Tasks move through To Do, In Progress, In Review, and Done, and only the product manager can approve a task or request changes.
- The product manager links one GitHub repository to the project. Developers pick their own commits from it with a commit picker instead of pasting links.
- **Developer AI feature: Acceptance Criteria Check.** For each criterion, the AI reports addressed, not addressed, or unclear, plus possible gaps. The prompt displays compact diff-line references as bare IDs (for example, `L12`) and asks the model to return those IDs unchanged. The server accepts a bare ID or its exact `[[L12]]` wrapper only when the canonical bare ID exists in the current source map, then builds file/commit-grouped excerpts with safe verification diagnostics. A separate evidence-reference contract version in the cache identity ensures prior results are not reused under the revised prompt and validator, while the persisted version 2 result format and historical readers remain unchanged. Evidence wraps within the UI. There is no numeric score. The latest matching result is attached to the submission for the product manager.
- **Product manager AI feature: Progress Report.** An on-demand summary for a date range (default: today, SGT) built from structured activity, with every statement citing task IDs.
- AI safeguards for both features: untrusted-input handling, secret redaction, output validation, per-person quotas, and usage logging. Acceptance-check schema/evidence correction shares a two-call maximum and a complete 48,000-character prompt budget with 2,000 output tokens. Capability/context preflight and database-backed per-key permits bound every provider call, including retries.
- Shared interaction feedback: actions that wait for a request or navigation show a trailing loading indicator while they are in progress.

## Capabilities

### New Capabilities

- `end-to-end-verification`: Complete synthetic local developer and product-manager browser journeys, guarded test controls and reproducible CI evidence for task 9.2.
- `task-management`: Project membership and roles, task management, the task lifecycle, progress updates, and the review and approval flow.
- `identity-and-access`: GitHub sign-in, verified GitHub identity, and server-side enforcement of project roles.
- `github-evidence`: Repository linking, the developer commit picker, attaching commits to tasks, and reporting unavailable evidence.
- `completion-assessment`: The developer's Acceptance Criteria Check and how its result is shown to the product manager.
- `daily-progress-report`: The product manager's Progress Report for a date range.
- `ai-safeguards`: Protections and resource limits shared by every LLM call.
- `data-persistence`: The PostgreSQL schema, its migrations, and the integrity rules the database enforces.
- `continuous-integration`: GitHub Actions checks (lint, type-check, unit tests, build, secret scanning, and dependency audit) that gate changes to `master`.
- `environment-configuration`: Separate development and production environments, environment variables documented in `.env.example`, and server-only credentials.
- `interaction-feedback`: Consistent loading feedback for asynchronous actions and internal navigation across the application.

### Modified Capabilities

None.

## Impact

- Requirements for the whole initial product, including authentication, GitHub integration, both AI features, and AI security.
- A per-environment GitHub App installation, with one repository binding per project and short-lived, repository-scoped read tokens.
- SoC LLM usage, limited by per-person quotas and the school's own limits.
- Separate development and production environments (database, deployment, credentials).
- A GitHub Actions workflow that runs without repository secrets, plus branch protection on `master` configured by a human.
- No existing OpenSpec capability specs are present to modify.

## Approved evidence follow-up scope (12 November 2026)

The human approved the compact-reference evidence contract, versioned history/cache behavior, bounded correction, distributed provider-key limiter/new migration, and wrapping file-grouped UI. Preserve existing task state authority and module boundaries. Task-specific removal of logs from selected commits is excluded. Hosted migration execution, deployment and git history changes are not authorized by this follow-up. See the approved design revision and unchecked follow-up tasks for remaining verification and human review.
