# Developer Commit Selection and Branch Provenance Plan

## Task record

- **Task ID:** `developer-commit-branch-provenance` (coordination label, not a requirement ID).
- **Summary:** Make the developer task commit picker reflect persisted attachments as checked and stage selection changes until the developer presses **Save commits**. Saving synchronizes attachments (including removals) only while the task is **In Progress**. Record the selected source branch for each attachment, show each commit's recorded branch in the Attached commits card, and show distinct source branches with attached-commit counts in developer Details.
- **Human owner:** Developer A (Lim-ZY) owns the commit picker and developer experience. Developer B (thegrimbee) owns task management and the data model/database path if persistence changes are needed. This crosses human ownership; Developer A leads picker work and Developer B must own/review any task data/persistence changes. Both humans cross-review and integrate.
- **Requirement IDs:** None assigned. Active OpenSpec task 11.1–11.3 in `openspec/changes/project-task-management/tasks.md` tracks this work.
- **Status:** Tasks 11.1–11.3 are checked. Both P2 findings and the frontend wording recommendation were addressed; independent re-review found no new defects. Three PostgreSQL cases and runtime/build checks remain unverified. The user explicitly authorized split scoped local commits on `feat/dev-update-ui`; no push, PR creation, or remote edit is authorized.
- **Next human action:** Developer A and B review the completed three-commit series and handoff. Push, PR creation, or remote edits require separate authorization.

## Source and scope

- **Repository / branch / worktree:** `/home/klzy/Documents/NUS/Y3S1/CS3227/MP4/CS3227-2610-MP4`, branch `feat/dev-update-ui`, primary worktree.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`. Initial worktree was clean (`git status --short --branch` showed only the branch header).
- **Permitted paths and actions:** This phase changes only this coordination record. Approved specs are `openspec/changes/project-task-management/specs/github-evidence/spec.md` and `openspec/changes/project-task-management/specs/task-management/spec.md`; task 11 is in `openspec/changes/project-task-management/tasks.md`. No further spec/design edits are assigned.
  - **Test-writer (11.1, tests only; complete and checked):** Changed `tests/unit/github-evidence-routes.test.ts`, `tests/unit/github/github-app-adapter.test.ts`, `tests/unit/task-detail-read.test.ts`, `tests/unit/task-pages/task-detail-page.test.tsx`, `tests/unit/task-pages/task-actions.test.tsx`, `tests/unit/completion-assessment/service.test.ts`, and added `tests/unit/github-evidence/commit-picker.test.tsx` and `tests/integration/db/attached-commit-source-branch.test.ts`. The test-writer owned only tests; no source/spec/migration paths. Three PostgreSQL integration tests were skipped without `TEST_DATABASE_URL` and remain unverified.
  - **Implementer B-side (11.2, `src/**` plus one new migration only):** `supabase/migrations/20261110120000_add_attached_commit_source_branch.sql`; `src/server/task-detail/read-repository.ts`; `src/server/task-detail/read-service.ts`; `src/server/review-queue/repository.ts`; and `src/components/tasks/task-page-parts.tsx`. Developer B owns task-data, migration, and task/review read-projection work. Never edit shipped migrations.
  - **Implementer A-side (11.3, `src/**` only):** `src/app/api/v1/projects/[projectId]/tasks/[taskId]/attached-commits/route.ts`; `src/server/github-evidence/service.ts`; `src/server/github-evidence/repository.ts`; `src/server/github/github-adapter.ts` (branch reachability verification); `src/components/github-evidence/commit-picker.tsx`; `src/components/tasks/task-commit-picker.tsx`; and `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`. Developer A owns the picker, attachment API, adapter verification, and developer task page. No tests/spec/migration paths.
  - **Frontend QA:** source-only inspection of picker, developer details, and PM attached-commit display; conditional **Edit commits** / **Add commits** wording addresses its recommendation. Runtime inspection was unavailable. **Reviewer:** re-review found no new defects after remediation. Three PostgreSQL tests remain unverified.
- **Prohibited paths and actions:** Each worker may edit only assigned paths; test-writer does not edit source/spec/migration, implementer does not edit tests/specs, and shipped migrations are untouched. User authorized split scoped local commits on `feat/dev-update-ui`; only the commit/PR agent may perform those commits. Push, PR creation, remote edits, rebase/reset, and deployment remain unauthorized. Human-verified interaction summary is due at chat-session closure.
- **Dependencies and parallel work:** Requirements are human-approved. Test-writer and implementer worked concurrently on disjoint paths. Tasks 11.1–11.3 are checked. Developer B owns migration/read projections; Developer A owns picker/API/page. Frontend source QA and independent re-review are complete. No further implementation dependencies; local scoped commits are authorized to the commit/PR agent only.

## Context references

- `AGENTS.md` — role ownership, change order, ambiguity, migration and workflow constraints.
- `openspec/changes/project-task-management/design.md` — active architecture and recorded decisions/open questions.
- `openspec/changes/project-task-management/specs/github-evidence/spec.md` — branch/commit picker and attachment contracts.
- `openspec/changes/project-task-management/specs/task-management/spec.md` — task details and task read behavior.
- `openspec/changes/project-task-management/tasks.md` — existing active-change work boundaries.
- `src/components/github-evidence/commit-picker.tsx` — current selection and attachment UI.
- `src/server/github-evidence/service.ts` and `src/server/github-evidence/repository.ts` — current attach contract and persisted attachment writes.
- `src/server/task-detail/read-repository.ts` and `src/server/task-detail/read-service.ts` — task detail read model.
- `src/app/projects/[projectId]/tasks/[taskId]/page.tsx` — developer task page and Details card.
- `tests/unit/task-pages/task-detail-page.test.tsx`, `tests/unit/task-pages/task-actions.test.tsx`, `tests/unit/github-evidence-routes.test.ts`, `tests/unit/task-detail-read.test.ts` — likely existing behavior coverage; analyst should confirm the complete test boundary.

## Decisions and open questions

- **Human-approved decisions:** (1) The picker initializes attached commits as checked. (2) Checkbox edits remain staged until the developer presses **Save commits**. (3) Attachment-set changes are allowed only while the task is **In Progress**. (4) Use `PUT /api/v1/projects/{projectId}/tasks/{taskId}/attached-commits` for atomic replacement with `{ "attachments": [{ "sha", "sourceBranch" }] }`, including an empty array; preserve existing `POST` as add-only. (5) Persist the selected source branch for newly attached commits. Retained attachments keep their original `sourceBranch`; legacy selected rows carry null and remain **Branch not recorded**; new attachments require a valid repository branch and source attribution. Do not infer it from the configured task branch. (6) Each commit shows its recorded source branch in the Attached commits card for both developer and PM views; legacy rows show **Branch not recorded**. (7) Developer Details lists distinct source branches with attached-commit counts; the PM's configured task Details branch stays unchanged. (8) Picker selection state includes all current attachments despite branch/date/page filters (for example, an Attached section seeded from task-detail data), so each can be deselected and saved. (9) PM Attached commits view is read-only in all task states; developer edit/save is available only In Progress. (10) Existing completion-assessment contracts settle history behavior: saved attachment changes leave old check history intact, and submission references only a result matching the current unique tip and criteria after transactional recheck. A recorded source branch means the branch selected at attachment time, not a permanent or exclusive home for a commit.
- **Assumptions (unapproved):** None.
- **Open questions / conflicts:** None. Human approval is recorded; implementation may proceed.

## Assignments and sequence

1. **Analyst — complete:** Prepared the approved spec delta in `specs/github-evidence/spec.md` and `specs/task-management/spec.md`.
2. **Human owners — complete:** Explicitly approved requirements and authorized workflow continuation.
3. **Test-writer — complete, task 11.1 checked:** Added tests and remediations; focused picker regression passed 5/5. Three PostgreSQL tests skipped without `TEST_DATABASE_URL`.
4. **Implementer — tasks 11.2 and 11.3 checked:** Changed only assigned `src/**` paths and the new migration. Developer A and B scopes are documented above.
5. **Frontend — complete, source-only:** Conditional **Edit commits** / **Add commits** wording addresses the low-severity recommendation. Browser runtime remains unavailable.
6. **Reviewer — re-review complete:** No new defects; both P2 issues addressed. PostgreSQL execution remains unverified.
7. **Human owners — next:** Review the handoff and evidence limits. Split local scoped commits on `feat/dev-update-ui` are authorized; no push, PR, or remote edit.

## Initial repository-context findings

- Before the analyst delta, OpenSpec described task-branch fallback for picker queries, task-ID mention as a preselection cue, and idempotent attachment by SHA, without persisted checked state, replacement, detach/removal, state guard, source branch provenance, branch/count summaries, or legacy null display. The approved changes are recorded in the two capability specs and task 11.
- The current task-detail DTO contains the configured task branch and attached commits, but attachment DTO entries have no branch field. The picker client loads branch-specific commits and submits only `commitShas`. Approved behavior adds `sourceBranch` to task-detail and review data, branch labels in both roles' Attached commits cards, developer-only source-branch counts, and preserves the PM configured Details branch.
- Candidate implementation areas above are provisional until the analyst checks all API routes, migration constraints, task lifecycle behavior, and existing tests. No requirements are inferred from current implementation.

## Initial coordination session report

### Session `orchestrator / root task coordination`

- **Provider:** codex
- **Provider session ID:** not available
- **Work ID:** `developer-commit-branch-provenance`
- **Agent:** orchestrator
- **Phase:** intake / initial plan
- **Platform and model (if surfaced):** not available
- **Role:** Orchestrator
- **Human owner and assigned task scope:** Developer A leads commit-picker behavior; Developer B owns any task data and persistence changes; orchestration only in this session.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`
- **Resource usage (provider-reported):** tokens in / out / total; cache read / write; cost; tool calls: not available
- **Unavailable resource metrics:** provider usage metrics and exact provider session ID
- **Work completed / findings:** Read canonical orchestrator and handoff contracts; inspected branch/worktree, specs, picker, attachment service/repository, and task-detail read model. Human approved the requirements and directed continuation. Active OpenSpec task 11 divides the work into tests, migration/read projections, and PUT/picker changes. Root confirmed the test-writer and implementer proceeded concurrently on disjoint paths and the test-writer completed; implementer continues only on `src/**` and migration paths. Recorded exact ownership and this sequencing update. No new product decisions made.
- **Files changed:** `workflow/plans/developer-commit-branch-provenance.md`
- **Checks run and exact results:** `git status --short --branch` (clean at intake); `git rev-parse HEAD` (`ec5eb6829d44f410d90fa8c8ce6feeae18960c29`); read-only source inspection. No tests run.
- **Gaps / blockers:** Three PostgreSQL tests were skipped because `TEST_DATABASE_URL` is unset; migration application and DB transaction behavior remain unverified. Production build was sandbox-blocked; browser runtime/responsive/accessibility remains unverified. Broader active-change task 9.5 remains outstanding. Human verification of the session interaction summary remains pending. Push, PR creation, and remote edits are not authorized.
- **Assignments, dependencies, and handoff decisions:** Tasks 11.1–11.3 checked. Test-writer and implementer ownership stayed disjoint; frontend source QA and independent re-review complete. Split scoped local commits on `feat/dev-update-ui` are explicitly authorized to the commit/PR agent only.
- **Consolidation notes:** Final evidence and limitations are consolidated in `workflow/handoffs/developer-commit-branch-provenance.md`. The commit/PR agent created the authorized local commits and updated the PR draft locally; the orchestrator performed no Git actions.

### Session `test-writer / task 11.1`

- **Provider:** codex
- **Provider session ID:** not available
- **Work ID:** `developer-commit-branch-provenance-11-1`
- **Agent:** test-writer
- **Phase:** approved requirement tests / red phase
- **Platform and model (if surfaced):** not available
- **Role:** Test-writer
- **Human owner and assigned task scope:** Developer A feature scope; tests only for task 11.1 across replacement API, picker, read projections, and persistence.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`
- **Resource usage (provider-reported):** tokens in / out / total; cache read / write; cost; tool calls: not available
- **Unavailable resource metrics:** provider-reported usage and exact provider session ID
- **Work completed / findings:** Added initial coverage for PUT authorization/validation/atomic replace/removal/provenance/provider failures; picker persisted selection, staged selection, Save, Cancel and branch changes; task-detail branch counts and commit labels, legacy fallback and read-only states; PostgreSQL source-branch persistence; and adapter short-SHA canonicalization. Follow-ups aligned picker assertions with `onSaved`, added the adapter mock's `getCommitIdentity`, and added mixed-case SHA regression plus PostgreSQL rollback/competing-replacement cases. Existing submission suites cover matching tip/criteria, empty attachments, and attachment changes during submission.
- **Files changed:** `tests/unit/github-evidence-routes.test.ts`; `tests/unit/github/github-app-adapter.test.ts`; `tests/unit/task-detail-read.test.ts`; `tests/unit/task-pages/task-detail-page.test.tsx`; `tests/unit/task-pages/task-actions.test.tsx`; `tests/unit/completion-assessment/service.test.ts`; `tests/unit/github-evidence/commit-picker.test.tsx`; `tests/integration/db/attached-commit-source-branch.test.ts`.
- **Checks run and exact results:** Initial red-phase run: 81 passed, 39 expected failures before implementation. Type-check identified missing PUT export and picker prop, expected in that phase. `git diff --check` passed. Follow-up: 73 tests passed across picker and completion-assessment adapter files. Remediation: picker 5/5 passed; TypeScript and diff check passed; three PostgreSQL cases skipped because `TEST_DATABASE_URL` is unset.
- **Gaps / blockers:** Three PostgreSQL tests were skipped without `TEST_DATABASE_URL`; migration execution remains unverified. AI security cases were not changed. Resource usage not available.

### Session `implementer / tasks 11.2–11.3`

- **Provider:** codex
- **Provider session ID:** not available
- **Work ID:** `developer-commit-branch-provenance-implementation`
- **Agent:** implementer
- **Phase:** implementation
- **Platform and model (if surfaced):** not available
- **Role:** Implementer
- **Human owner and assigned task scope:** Developer A picker/API and Developer B persistence/task-data/read-model paths, exactly as listed in the implementation scope above.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29`
- **Resource usage (provider-reported):** tokens in / out / total; cache read / write; cost; tool calls: not available
- **Unavailable resource metrics:** all resource usage metrics and exact provider session ID
- **Work completed / findings:** Implemented branch provenance on attachment rows, atomic PUT replacement with server-side In Progress guard while preserving POST add-only, branch verification, task/review read projections, picker persisted selection and Save staging, and source-branch labels/counts. No dependencies added.
- **Files changed:** `src/server/github-evidence/service.ts`; `src/server/github-evidence/repository.ts`; `src/server/github/github-adapter.ts`; `src/app/api/v1/projects/[projectId]/tasks/[taskId]/attached-commits/route.ts`; `supabase/migrations/20261110120000_add_attached_commit_source_branch.sql`; `src/server/task-detail/read-repository.ts`; `src/server/task-detail/read-service.ts`; `src/server/review-queue/repository.ts`; `src/components/github-evidence/commit-picker.tsx`; `src/components/tasks/task-commit-picker.tsx`; `src/components/tasks/task-page-parts.tsx`; `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`.
- **Checks run and exact results:** TypeScript check passed; scoped ESLint passed; focused unit suite 326/326 passed; `git diff --check` passed. Full suite: 2,279 passed, 28 unrelated failures in environment config, `.gitignore` spawn, and guard-write-scope hooks. Full lint failed only on generated `product-website/_site` files; scoped lint passed. Production build blocked by sandbox Turbopack process/port permission. PostgreSQL integration skipped because no DB was configured. Visual diff: `/tmp/commit-branch-provenance-visual-diff.html`.
- **Gaps / blockers:** Database migration application/integration remains unverified. Build is unverified due to sandbox restriction. No commits or pushes were made by the implementer.

### Session `frontend / task 11 UI QA`

- **Provider:** codex
- **Provider session ID:** not available
- **Work ID:** `developer-commit-branch-provenance-frontend-qa`
- **Agent:** frontend
- **Phase:** read-only UI QA
- **Platform and model (if surfaced):** not available
- **Role:** Frontend
- **Human owner and assigned task scope:** Developer A / Developer B feature UI; read-only source QA of developer and PM task details, attached commits, and commit selection.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29` plus uncommitted implementation.
- **Resource usage (provider-reported):** tokens in / out / total; cache read / write; cost; tool calls: not available
- **Unavailable resource metrics:** provider-reported tokens, cost, tool calls, and exact provider session ID
- **Work completed / findings:** Checked approved task-detail and commit-provenance specs plus task-detail UI guidance. Source inspection found branch summaries, labels, staged picker, In Progress restriction, legacy fallback, and PM configured branch aligned with intent. Assessment was partly matches, source-only. Low-severity copy suggestion to change the “＋ Add commits” trigger was addressed with conditional “Edit commits” / “Add commits” text.
- **Files changed:** none.
- **Checks run and exact results:** No app/browser was open and no development server was running; runtime, viewport, responsive layout and rendered accessibility were not inspected. UI tests were not run by this session.
- **Gaps / blockers:** Runtime UI behavior and visual/accessibility states remain unverified because no app/browser was available. No files changed by frontend QA.

### Session `reviewer / task 11 independent review`

- **Provider:** codex
- **Provider session ID:** not available
- **Work ID:** `developer-commit-branch-provenance-review`
- **Agent:** reviewer
- **Phase:** independent review
- **Platform and model (if surfaced):** not available
- **Role:** Reviewer
- **Human owner and assigned task scope:** Developer A / Developer B approved task 11 implementation; read-only review of all criteria and code quality.
- **Source revision:** `ec5eb6829d44f410d90fa8c8ce6feeae18960c29` plus current worktree.
- **Resource usage (provider-reported):** tokens in / out / total; cache read / write; cost; tool calls: not available
- **Unavailable resource metrics:** provider-reported token, cache, cost, elapsed-time, tool-call metrics and exact provider session ID
- **Work completed / findings:** Initial review identified two P2s: mixed-case checkbox state mismatch and missing PostgreSQL failure-atomicity/competing-replacement evidence. After remediation, re-review found no new defects and confirmed the checkbox behavior is fixed. The PostgreSQL rollback/competing-replacement tests are authored, but execution was skipped. Stale browser-tab replacement remains possible because the approved API has no client revision; reviewer judged this a limitation, not a contract violation.
- **Files changed:** none.
- **Checks run and exact results:** Source/spec/test inspection and `git diff --check` passed. No test suite or browser run.
- **Gaps / blockers:** Three PostgreSQL test cases skipped without `TEST_DATABASE_URL`; no browser runtime check. No new defects on re-review.

## Consolidated outcome

- **Changed files and rationale:** Product/spec/test/migration paths listed above implement approved task 11. Workflow records: this plan and `workflow/handoffs/developer-commit-branch-provenance.md`; interaction disclosure: `logs/2026-11-10-developer-commit-branch-provenance.md` (human verification pending).
- **Tests/checks and results:** Root final focused run: 7 files, 327/327 passed; TypeScript, scoped ESLint, ordinary OpenSpec validation, and diff check passed. Full-suite, lint, build, and PostgreSQL limitations are recorded above. Resource usage metrics were not available.
- **Generated artifacts:** `/tmp/commit-branch-provenance-visual-diff.html` was regenerated after all four commits against baseline `ec5eb6829d44f410d90fa8c8ce6feeae18960c29` and shows 25 changed files.
- **Dependencies added:** None.
- **Known gaps and unverified items:** Three PostgreSQL tests skipped because `TEST_DATABASE_URL` was unavailable; migration application/real DB behavior remain unverified. Production build blocked by sandbox. Runtime browser/accessibility behavior source-only. Broader OpenSpec task 9.5 remains outstanding. No dependencies added. Generated artifact: `/tmp/commit-branch-provenance-visual-diff.html` (refreshed before the final handoff file).
- **Reviewer findings:** Both P2 findings resolved; independent re-review found no new defects. Frontend's low-severity wording suggestion was addressed; runtime QA unavailable.
- **Branch inventory / commits:** The commit/PR agent created four scoped commits on `feat/dev-update-ui`: `4349571 feat(tasks): track attached commit source branches`; `f49843a test(github-evidence): cover commit replacement and provenance`; `a2d16e2 docs(workflow): record commit provenance delivery`; and `a0d1301 docs(workflow): reconcile commit status records`. This final documentation correction is the fifth local commit. The PR draft was updated locally only; no push, PR creation, or remote edit occurred. The final worktree is clean and the branch is ahead by five commits.
- **Next action and responsible human:** Developer A and B review the five-commit series and remaining validation limits; a human verifies the interaction summary. Push, PR creation, or remote edits require separate authorization.

## Change log

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-11-10 10:47 | orchestrator / root task coordination | Created initial plan and recorded the user-approved behavior and provisional scopes. |
| 2026-11-10 11:06 | orchestrator / root task coordination | Recorded PUT atomic replacement contract, analyst-completed spec delta, resolved history behavior, and human-approval gate. |
| 2026-11-10 11:06 | orchestrator / root task coordination | Recorded explicit requirement approval, OpenSpec task 11, exact test/source/migration ownership, and sequential workflow with no git actions. |
| 2026-11-10 11:17 | orchestrator / root task coordination | Recorded concurrent disjoint test/implementation work, test-writer completion, and implementation-in-progress status. |
| 2026-11-10 11:19 | orchestrator / root task coordination | Consolidated test-writer's six changed test files and red-phase evidence: 81 passed, 39 expected failures; PostgreSQL unrun. |
| 2026-11-10 11:30 | orchestrator / root task coordination | Added test-writer follow-up: callback/mock alignment and focused 73-test pass. |
| 2026-11-10 11:30 | orchestrator / root task coordination | Consolidated implementation checks, migration/build limits, visual diff artifact, and frontend source-only QA recommendation. |
| 2026-11-10 11:32 | orchestrator / root task coordination | Recorded independent review: two P2 findings requiring remediation and re-review; no approval/merge. |
| 2026-11-10 11:34 | orchestrator / root task coordination | Recorded root-approved remediation; mixed-case fix applied, DB regression/integration tests in progress, task 11.1 remains unchecked pending completion. |
| 2026-11-10 11:35 | orchestrator / root task coordination | Recorded remediation test additions, picker 5/5 pass, TypeScript/diff pass, and three PostgreSQL skips pending DB setup. |
| 2026-11-10 11:36 | orchestrator / root task coordination | Recorded tasks 11.1–11.3 complete, re-review clean, final focused validation, and explicit local split-commit authorization (no push/PR). |
| 2026-11-10 11:44 | orchestrator / root task coordination | Reconciled final handoff evidence, PostgreSQL/browser/build limitations, human-verified log status, and local-only split-commit authorization; no Git actions performed. |
| 2026-11-10 11:44 | orchestrator / root task coordination | Recorded commit/PR agent's four scoped local commits, clean worktree/ahead-by-4 report, local-only PR draft update, and 25-file visual diff regenerated after commits; no orchestrator Git actions. |
