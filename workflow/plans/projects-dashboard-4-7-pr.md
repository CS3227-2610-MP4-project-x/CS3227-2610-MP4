# PR title

Add project task workflows, acceptance checks and dashboard

# PR description

This branch extends the application from its cached default-branch baseline with project membership management, task creation and lifecycle controls, developer acceptance checks, and project board, review, member-management and dashboard pages. The dashboard gives both project roles project-wide progress and allocation counts while retaining the existing role restrictions on task detail and member-management reads.

## Changes

- Add project creation, developer membership and product-manager transfer, task CRUD/lifecycle/progress updates, and their authorization and persistence tests.
- Add acceptance-check input filtering, path-rule persistence, assessment/caching/submission integration and developer result UI.
- Add the workspace project list, board/task-detail/review pages, project creation/member settings, and product-manager task controls.
- Add the dynamic project dashboard with a separately authorized aggregate read, consistent read snapshot, SGT completed-today count, state-filtered allocation, shared account-menu behavior and product-manager actions. Progress Report remains disabled until task 8.3.
- Include the product-information website and its GitHub Pages workflow, approved specifications, user-guide updates and workflow/interaction evidence already present on this branch.

## Validation and limits

Task 4.7 final recorded checks on the product working tree: lint, TypeScript and production build passed; `npm.cmd test -- --maxWorkers=4` passed 2,218 tests across 53 files. The default `npm.cmd test` run passed 2,213 tests but failed five cases with 5,000 ms timeouts; the cause remains unresolved and configuration was not changed.

PostgreSQL integration collected 353 tests across 21 suites, all skipped because `TEST_DATABASE_URL` was unavailable. Strict OpenSpec validation exited 1 with six existing requirement-length warnings and no new dashboard warning. Final fresh source review reported zero must/should/nit findings after two fix rounds. The aggregate-authorization security pass reported no confirmed security defect. Commit whitespace checks passed.

These results do not establish a full branch release pass. Isolated PostgreSQL execution, actual authenticated responsive/menu/form/filter/keyboard/contrast checks, complete journeys/accessibility, Developer A authentication/composition cross-review, default-concurrency diagnosis and human verification of the closure interaction summary remain follow-up.

## Comparison and commits

Inventory uses cached `origin/master` (`b78a787a2b2c160d72038c85dc4cab70c49a46db`), confirmed by `origin/HEAD`; no fetch was performed. Local `master` is stale. The comparison includes pre-existing branch work, so this PR draft intentionally describes more than task 4.7.

- Approved dashboard specification: `ca3d1a26daeb0467d730c2405fa2612cc2cb8ce2`.
- Dashboard implementation, tests and approved task closure: `aaa32b7b5d91c0bb0ef35eafb923ae94c7d9e02c`.

No new dependency, migration, HTTP route or persistent cache was added for task 4.7. This is a local draft only; no push or PR creation was authorized.
