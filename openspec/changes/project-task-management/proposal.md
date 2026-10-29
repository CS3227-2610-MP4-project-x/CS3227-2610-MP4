# Proposal

## Why

Small software teams lose time to status reporting: product managers chase developers for updates, and developers write updates that repeat what their commits already show. This change defines a lightweight task board where developers attach their GitHub commits to tasks, AI checks those commits against each task's acceptance criteria, and AI turns project activity into progress reports, so the product manager can see where the project stands without asking.

## What Changes

- Introduce projects with exactly one product manager and any number of developers. A person may belong to several projects, with one role in each.
- People sign in with GitHub, so each developer's GitHub identity is verified.
- Product managers create, edit, reassign, and delete tasks with acceptance criteria. Tasks move through To Do, In Progress, In Review, and Done, and only the product manager can approve a task or request changes.
- The product manager links one GitHub repository to the project. Developers pick their own commits from it with a commit picker instead of pasting links.
- **Developer AI feature: Acceptance Criteria Check.** For each criterion, the AI reports addressed, not addressed, or unclear, with evidence quoted from the diff, plus possible gaps. There is no numeric score. The latest result is attached to the submission for the product manager.
- **Product manager AI feature: Progress Report.** An on-demand summary for a date range (default: today, SGT) built from structured activity, with every statement citing task IDs.
- AI safeguards for both features: untrusted-input handling, secret redaction, output validation, per-person quotas, and usage logging.

## Capabilities

### New Capabilities

- `task-management`: Project membership and roles, task management, the task lifecycle, progress updates, and the review and approval flow.
- `identity-and-access`: GitHub sign-in, verified GitHub identity, and server-side enforcement of project roles.
- `github-evidence`: Repository linking, the developer commit picker, attaching commits to tasks, and reporting unavailable evidence.
- `completion-assessment`: The developer's Acceptance Criteria Check and how its result is shown to the product manager.
- `daily-progress-report`: The product manager's Progress Report for a date range.
- `ai-safeguards`: Protections and resource limits shared by every LLM call.
- `continuous-integration`: GitHub Actions checks (lint, type-check, unit tests, build, secret scanning, and dependency audit) that gate changes to `master`.

### Modified Capabilities

None.

## Impact

- Requirements for the whole initial product, including authentication, GitHub integration, both AI features, and AI security.
- A read-only GitHub credential per project, stored encrypted on the server.
- SoC LLM usage, limited by per-person quotas and the school's own limits.
- Separate development and production environments (database, deployment, credentials).
- A GitHub Actions workflow that runs without repository secrets, plus branch protection on `master` configured by a human.
- No existing OpenSpec capability specs are present to modify.
