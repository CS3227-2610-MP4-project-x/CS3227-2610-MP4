# GitHub evidence tasks 5.1 and 5.2 implementation session

## Human-verified interaction summary

- The user asked to update `openspec/changes/project-task-management/tasks.md`, commit the existing approved changes in scoped commits, and proceed with the agent workflow for tasks 5.1 and 5.2. The user directed that the orchestrator, rather than the primary agent, coordinate the workflow.
- The user approved assigning the replacement migration to task 5.1 and Developer A, and clarified that 5.1 owns the PM repository-link flow/API while 5.3 owns the remaining configuration, picker, and commit attachment work.
- For the 5.1 link contract, the user approved `github_installation_id` and `github_repository_id`, the authorization and callback routes documented in the active OpenSpec change, session-bound signed state in a 10-minute HttpOnly, SameSite=Lax cookie, current PM/identity revalidation, preserving an existing link when authorization changes, and never persisting the OAuth token. `installationId` is a decimal string. Legacy PAT/repository fields are cleared by the new migration so PMs relink.
- The user specified GitHub REST API version `2026-03-10` and assigned the App setup URL to 5.3. The user approved PM-only `GET /api/v1/projects/{projectId}/github-repository/setup-url` returning `{ setupUrl }` built from `GITHUB_APP_SLUG`; after installation/repository selection, the PM continues through 5.1 authorization.
- Two scoped planning commits were created before implementation: `36cbba3` (`docs(github-evidence): define GitHub App linking and evidence contract`) and `884c06e` (`docs(workflow): record GitHub evidence planning handoff`). Four scoped commits recorded the approved OpenSpec contract, replacement migration, 5.2 evidence adapter, and 5.1 PM repository-link flow: `5f250c5`, `0bec1f3`, `351965a`, and `64c363d`. `1775cdb` removes a trailing blank line from the link service. The handoff and this interaction summary were committed separately. Nothing was pushed and no PR was created.
- Task 5.2 implementation and independent review completed. The repository adapter uses API version `2026-03-10`, repository-scoped read-only installation tokens, paginated branch/commit reads and diff retrieval, safe provider errors, and a deterministic typed fake. The task checklist records 5.2 complete.
- Task 5.1 implementation includes the new binding migration and integration test, OAuth configuration and route/service/repository/verification-adapter code, and focused tests. The race, pagination, and public-module-entrypoint findings from review were addressed; a fresh independent review found no remaining code findings. Task 5.1 remains unchecked because PostgreSQL execution is unverified and its end-to-end setup entry point belongs to task 5.3.

## Verification and limits

- `tests/unit/github/github-app-adapter.test.ts`: 46 passed.
- Task 5.1 route/auth focused suites: 81 passed after the final boundary fix; typecheck, scoped ESLint, and `git diff --check` passed according to the implementer report.
- Environment configuration tests: 27 passed; 5 failed because sandboxed `git check-ignore` calls returned `spawnSync git EPERM`. No configuration assertions failed.
- PostgreSQL migration integration tests were skipped because `TEST_DATABASE_URL` is unset; no database was contacted.
- Docker is installed but its daemon was unavailable, so no local disposable PostgreSQL container could be started.
- Strict OpenSpec validation had passed earlier in the workflow. Revalidation in this session could not run because no local OpenSpec CLI was available and network access to the npm registry failed (`EAI_AGAIN`).
- No dependency changes, credentials, live provider calls, or production data were used.
- Copied-cookie replay resistance and focused pagination cycle/foreign-origin cases remain unverified; server-side one-time nonce storage was not part of the approved contract.
