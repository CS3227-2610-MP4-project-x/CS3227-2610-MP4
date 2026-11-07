# Group 7 Acceptance Criteria Check — AI Interaction Summary

## Human-approved requirements and decisions

- The user authorized implementation of Group 7 on `feat/acceptance-criteria-check`, based on the current `dev` branch.
- The check is advisory, can be initiated by the assigned developer, and its results are readable by both the developer and project manager. It assesses every acceptance criterion and reports per-criterion status and evidence; it does not approve a task or change task state.
- A check is anchored to the unique selected commit that descends from all other selected commits. Re-running with the same commits, criteria, and path rules reuses the existing result rather than adding a history entry.
- The project manager maintains root `.acceptance-check.json` path-priority and exclusion rules. These rules are deterministic and part of the reuse key. Missing, invalid, or unavailable configuration fails safely before LLM execution.
- The check contract uses stable criterion IDs, exact evidence lines, strict output validation, redaction, and canonical input hashes. One coherent task snapshot is read before provider calls; no database transaction remains open during network requests.
- The user approved a narrow Group 7 task-snapshot read-service seam while leaving Task 4.2 task CRUD/routes/writes with Developer B.
- The user approved fixes for reviewer findings involving prompt schema/status validation and redacted criterion text, then separately approved using the prompt sanitizer for validation, mapping evidence to redacted diff lines, and adding regression tests.

## Work and verification recorded in this chat

- Group 7.1 input assembly, path-rule handling, GitHub evidence support, regression fixes, and independent review were completed earlier on this branch.
- Group 7.2 check service, repository, snapshot seam, and cache behavior were implemented with regression tests. The prompt sanitizer was shared through the AI public entry point so validation matches model-visible text. Criteria, evidence, and omitted paths are persisted in safe redacted/original repository form; ambiguous evidence is removed and downgraded to `unclear`.
- The independent reviewer reported no remaining findings for the sanitizer fixes. The combined Group 7.2 and AI suites passed 363 tests across 9 files; TypeScript and scoped ESLint passed. The migration integration suite remains unverified because `TEST_DATABASE_URL` was unavailable; no migration was applied.
- Group 7.3 was explored, but the user asked to pause it before implementation and authorize scoped commits of the branch work. No Group 7.3 route or UI implementation was started in this chat.
- Before future UI work, the frontend agent must reconfirm the developer and PM mockups and stop for user review.

## Agent and artifact notes

- No dependencies were added. No commit, push, pull request, deployment, live-provider call, or migration execution occurred before the user authorized the commit-agent workflow.
- Agent usage metrics were not surfaced and are recorded as unavailable in their reports.
- Visual diff artifact for the latest sanitizer fix: `/tmp/group7-prompt-sanitizer.html`.
