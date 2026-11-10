# Developer Commit Selection and Branch Provenance Handoff

## Task record

- **Task ID:** `developer-commit-branch-provenance` (coordination label; no invented requirement ID).
- **Summary:** Implement approved task 11 behavior for persisted commit selection, atomic replacement, source-branch provenance, and role-appropriate task detail display.
- **Human owner:** Developer A (Lim-ZY) owns the commit picker and attachment API. Developer B (thegrimbee) owns migration, task/review read projections, and task-management data. Both humans cross-review and integrate.
- **Requirement IDs:** OpenSpec task 11.1, 11.2, and 11.3 in `openspec/changes/project-task-management/tasks.md`.
- **Status:** Tasks 11.1–11.3 checked; implementation and independent re-review complete. Three authorized scoped local commits were created. No push, PR creation, remote edit, or deployment occurred.
- **Next human action:** Review the three commits and evidence limits below; perform any requested DB verification or runtime UI checks. Separately verify the required human-approved interaction summary in `logs/`.

## Source and scope

- **Repository / branch / worktree:** `/home/klzy/Documents/NUS/Y3S1/CS3227/MP4/CS3227-2610-MP4`, branch `feat/dev-update-ui`, primary worktree.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`.
- **Requirement sources:** `openspec/changes/project-task-management/specs/github-evidence/spec.md`, `openspec/changes/project-task-management/specs/task-management/spec.md`, and task 11 in `openspec/changes/project-task-management/tasks.md`.
- **Architecture references:** `openspec/changes/project-task-management/design.md`; task-detail guidance in `specs/ui-spec.md`.
- **Scope boundaries:** Test-writer owned tests only. Implementer owned only `src/**` and one new migration. Frontend and reviewer were read-only. Orchestrator edited only this handoff and the plan. No shipped migration or dependency was changed.

## Approved behavior implemented

- The picker loads the task's persisted attachments as checked and keeps the full attached set visible despite branch/date/page filters.
- Checkbox changes remain staged until Save. Save atomically replaces the whole attachment set; Cancel discards staged edits. Empty replacement removes all attachments. Existing POST remains add-only.
- PUT and POST writes are restricted to the assigned developer while the task is In Progress, with state and assignment rechecked transactionally.
- New attachments store the selected repository source branch after branch existence/reachability and authorship verification. Retained attachments keep their original source branch. Legacy null provenance remains null and displays “Branch not recorded”; the configured task branch is never used to infer attachment provenance.
- Developer Details shows distinct source branches and attached-commit counts. Each attached commit displays its source branch for both developer and PM views. PM Details continues to show the configured task branch; PM attachment views are read-only.
- Existing check history remains. Submission continues to reference only a result matching the current unique tip and criteria after transactional recheck.

## Changed files and rationale

- **Specifications and tracking:** `openspec/changes/project-task-management/specs/github-evidence/spec.md`; `openspec/changes/project-task-management/specs/task-management/spec.md`; `openspec/changes/project-task-management/tasks.md` (task 11 scope/status).
- **Migration:** `supabase/migrations/20261110120000_add_attached_commit_source_branch.sql` adds nullable source-branch provenance for legacy-compatible storage. Migration application remains unverified.
- **Attachment API and GitHub verification:** `src/app/api/v1/projects/[projectId]/tasks/[taskId]/attached-commits/route.ts`; `src/server/github-evidence/service.ts`; `src/server/github-evidence/repository.ts`; `src/server/github/github-adapter.ts`.
- **Task and review projections:** `src/server/task-detail/read-repository.ts`; `src/server/task-detail/read-service.ts`; `src/server/review-queue/repository.ts`.
- **UI:** `src/components/github-evidence/commit-picker.tsx`; `src/components/tasks/task-commit-picker.tsx`; `src/components/tasks/task-page-parts.tsx`; `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`.
- **Tests:** `tests/unit/github-evidence-routes.test.ts`; `tests/unit/github/github-app-adapter.test.ts`; `tests/unit/task-detail-read.test.ts`; `tests/unit/task-pages/task-actions.test.tsx`; `tests/unit/task-pages/task-detail-page.test.tsx`; `tests/unit/completion-assessment/service.test.ts`; `tests/unit/github-evidence/commit-picker.test.tsx`; `tests/integration/db/attached-commit-source-branch.test.ts`.
- **Coordination records:** `workflow/plans/developer-commit-branch-provenance.md` and this handoff.

## Checks and evidence

- **Final focused validation (root report):** 7 files, 327 tests passed; TypeScript check passed; scoped ESLint passed; ordinary OpenSpec validation passed; `git diff --check` passed. Exact shell command strings were not surfaced in the consolidated report.
- **Test-writer remediation:** Picker regression 5/5 passed; TypeScript and diff check passed. The PostgreSQL suite reported 3 skipped tests because `TEST_DATABASE_URL` was unset.
- **Full unit suite (earlier root run):** 2,279 passed, 28 failures attributed to unrelated environment configuration, `.gitignore` spawn, and guard-write-scope hook cases.
- **Full lint:** Failed only on generated `product-website/_site` files; scoped lint passed.
- **Production build:** Blocked in the sandbox by Turbopack process/port permission restrictions.
- **PostgreSQL:** Rollback after second-insert failure and competing-replacement/stale-snapshot cases are authored, but execution is unverified. Docker was inaccessible due to socket permission denial; no `TEST_DATABASE_URL` was configured.
- **Rendered UI:** Frontend source-inspected developer and PM task views and picker; runtime browser, responsive layout, and rendered accessibility behavior remain unverified because no app/browser was available. The frontend's wording suggestion was addressed with conditional “Edit commits” / “Add commits” button text.
- **Independent review:** Re-review found no new defects; the mixed-case checkbox issue was resolved. The reviewer confirmed the PostgreSQL execution limitation and did not approve or merge the change.
- **Visual diff:** [`/tmp/commit-branch-provenance-visual-diff.html`](/tmp/commit-branch-provenance-visual-diff.html), generated before commits and refreshed to show 25 changed files.

## Worker session reports

### Orchestrator

- **Provider / session ID:** codex / not available.
- **Work ID / role:** `developer-commit-branch-provenance` / orchestrator.
- **Human owner and scope:** Coordinated Developer A picker/API and Developer B data/migration work; plan and handoff only.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`.
- **Resource usage:** Provider-reported metrics not available.
- **Work completed:** Read canonical workflow contracts, recorded ownership/dependencies, consolidated test, implementation, frontend, and reviewer evidence. No product code or tests changed in this role.
- **Files changed:** `workflow/plans/developer-commit-branch-provenance.md`; `workflow/handoffs/developer-commit-branch-provenance.md`.
- **Checks:** Read-only status/source inspection and workflow record validation; no tests run by the orchestrator.
- **Gaps:** Human-verified session summary in `logs/` remains to be verified. No git actions performed by the orchestrator.

### Test-writer — task 11.1

- **Provider / session ID:** codex / not available.
- **Work ID / role:** `developer-commit-branch-provenance-11-1` / test-writer.
- **Human owner and scope:** Developer A feature; tests only, including replacement route, picker, projections, and persistence.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`.
- **Resource usage:** Provider-reported metrics not available.
- **Work completed:** Added route, adapter, task detail, page, picker, and PostgreSQL tests; later added mixed-case SHA regression and PostgreSQL rollback/competing replacement tests. No source/spec/migration paths changed by the test-writer.
- **Files changed:** The six test paths in the test section above, plus `tests/unit/task-pages/task-actions.test.tsx` and `tests/unit/completion-assessment/service.test.ts`.
- **Checks:** Initial red run 81 passed / 39 expected failures; follow-up 73 passed across picker and completion-assessment adapter suites; remediation picker 5/5 passed; TypeScript and diff check passed. PostgreSQL 3 skipped due unset `TEST_DATABASE_URL`.
- **Gaps:** PostgreSQL execution remains unverified. AI security cases were not modified.

### Implementer — tasks 11.2–11.3

- **Provider / session ID:** codex / not available.
- **Work ID / role:** `developer-commit-branch-provenance-implementation` / implementer.
- **Human owner and scope:** Developer A picker/API and Developer B migration/task/review projections; source and migration paths only.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`.
- **Resource usage:** Provider-reported metrics not available.
- **Work completed:** Added attachment provenance, atomic PUT replacement, transactional state checks, branch verification, role-aware projections, staged picker behavior, mixed-case selected-state fix, and conditional picker button wording. No dependencies added.
- **Files changed:** The migration and source paths listed above.
- **Checks:** TypeScript, scoped ESLint, focused unit suite 326/326, and diff check passed. The root's final focused run is reported separately above.
- **Gaps:** PostgreSQL application/runtime and production build remain unverified; build was sandbox-blocked. No commits or pushes.

### Frontend — task 11 UI QA

- **Provider / session ID:** codex / not available.
- **Work ID / role:** `developer-commit-branch-provenance-frontend-qa` / frontend.
- **Human owner and scope:** Read-only source QA of developer and PM task detail, attached commits, and commit selection.
- **Source revision:** baseline revision plus uncommitted implementation.
- **Resource usage:** Provider-reported metrics not available.
- **Work completed:** Source inspection found behavior aligned except low-severity picker button wording; implementer corrected it. No files changed by frontend QA.
- **Checks:** No browser/runtime or UI tests run. Runtime/responsive/accessibility states remain unverified.
- **Gaps:** Source-only QA.

### Reviewer — initial and follow-up review

- **Provider / session ID:** codex / not available.
- **Work ID / role:** `developer-commit-branch-provenance-review` / reviewer.
- **Human owner and scope:** Read-only independent review of all task 11 acceptance criteria and code quality.
- **Source revision:** baseline revision plus implementation worktree.
- **Resource usage:** Provider-reported metrics not available.
- **Work completed:** Initial review found mixed-case checkbox state mismatch and missing PostgreSQL atomicity/competing-write coverage. After remediation, re-review reported no new defects and confirmed the case mismatch was fixed; DB execution remains unverified.
- **Files changed:** none.
- **Checks:** Source/spec/test inspection and diff check; no reviewer-run suites or browser checks.
- **Gaps:** PostgreSQL execution and runtime UI remain unverified. No approval/merge action.

## Consolidated outcome

- **Tests/checks:** Focused suite 327/327; TypeScript, scoped ESLint, ordinary OpenSpec validation, and diff check passed. Full test/lint/build and PostgreSQL limitations are detailed above.
- **Generated artifacts:** `/tmp/commit-branch-provenance-visual-diff.html`.
- **Dependencies added:** None.
- **Known gaps:** PostgreSQL tests skipped and migration application unverified; production build sandbox-blocked; browser runtime UI unverified; full suite has 28 unrelated failures; full lint reports generated website errors.
- **Reviewer findings:** Both P2 findings were addressed; re-review found no new defects. PostgreSQL behavior remains unverified.
- **Branch inventory / commits / PR:** The task's three scoped commits on `feat/dev-update-ui` are `4349571 feat(tasks): track attached commit source branches`; `f49843a test(github-evidence): cover commit replacement and provenance`; and `a2d16e2 docs(workflow): record commit provenance delivery`. A separate documentation-only follow-up records the final authorization and commit status in this handoff and interaction log. The commit/PR agent prepared the updated PR title and body as a local draft; no push, PR creation, or remote edit occurred. The final worktree was clean, with the branch ahead by four local commits.
- **Next action and responsible human:** Developer A and Developer B review the four-commit local series and decide whether to obtain DB/runtime evidence. Separately, a human must verify the interaction summary required by `AGENTS.md`. Push, PR creation, and remote edits require separate authorization.
