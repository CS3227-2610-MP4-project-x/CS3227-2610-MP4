# Developer Commit Selection and Branch Provenance

## Interaction summary

- The user approved a commit picker that reflects saved attachments, stages changes until **Save commits**, permits editing only while a task is **In Progress**, and saves a complete replacement selection through `PUT` while retaining add-only `POST` behavior.
- The user approved recording each commit's source branch, showing source branch counts in developer Details, showing branch labels for attached commits for both roles, and labeling legacy records **Branch not recorded**. The product-manager configured task branch remains unchanged.
- The user asked to complete the agent workflow and later explicitly authorized the commit agent to create split scoped commits for the work on `feat/dev-update-ui` and update the supplied PR title and description. This authorizes local commits only; it does not authorize pushing or changing remote PR state.

## Work completed

- Updated the active OpenSpec requirements and tasks, added nullable source-branch persistence, implemented the replacement API and picker behavior, and updated task detail projections and branch display.
- Added route, adapter, picker, task-detail, and PostgreSQL integration coverage.
- Focused checks passed: 327 tests, TypeScript, scoped lint, ordinary OpenSpec validation, and `git diff --check`.
- Generated a visual diff at `/tmp/commit-branch-provenance-visual-diff.html`.
- The commit agent prepared an updated PR title and description. Local split commits were explicitly authorized and are being prepared; no push or remote PR edit is authorized.

## Verification limits

- PostgreSQL integration tests were authored but skipped because `TEST_DATABASE_URL` was unavailable; Docker socket access was denied. Migration application and real database transaction behavior remain unverified.
- The full unit run had 2,279 passes and 28 environment/spawn/hook failures. Full lint reports existing errors in generated `product-website/_site` files. The production build was blocked by sandbox worker-port restrictions. Browser review was source-only; rendered, responsive, and accessibility checks remain unverified.
- Ordinary OpenSpec validation passed with long-requirement warnings; strict validation does not pass those warnings.

## Disclosure status

This summary records the AI-assisted work and validation based on the available agent and command reports. **Human verification of this interaction summary is pending.**
