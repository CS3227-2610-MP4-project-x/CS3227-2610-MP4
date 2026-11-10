# Developer dashboard and project switching

- Work label: `developer-dashboard-project-switching` (coordination label, not a requirement ID).
- Human ownership: Developer A owns the developer experience and identity/access; Developer B owns the existing product-manager dashboard and task-management domain. Both humans cross-review shared changes.
- Baseline: `feat/dev-update-ui`, revision `463455c4bbfdbe451768fbb14ddad32a38e11f17`, primary checkout. Initial `git status --short --branch` showed no working-tree changes.
- Status: Implementation complete with disclosed validation gaps. Human-approved behavior and architecture implemented; final human review, cross-review and interaction-log verification pending. No commit authorized.

## Confirmed user intent

1. Sign-in reopens the last selected project. Users with no projects see empty dashboard cards and a highlighted Create project action.
2. `/` redirects to the selected project's dashboard; the dashboard route is `/projects/{projectId}/dashboard` for the existing product-manager overview and the requested developer view.
3. A project switcher selects the project reflected by Dashboard and Board. Switching projects while on Board stays on Board.
4. Preserve the existing product-manager dashboard. Developer dashboard follows the supplied mockup with Project progress, Task summary, and My tasks; expand these cards into the space left by omitted Recent activity.
5. Project progress uses project-wide Done / total for both roles. Developer Task summary counts the developer's assigned tasks; product-manager Task summary counts all project tasks.
6. Developer task filters and View task links work. Recent activity, search, notifications, task checkboxes and Check ready are excluded from this change.
7. Status colors may be grey for To Do, blue for In Progress, yellow for In Review and green for Done.
8. Last-project selection persists in the same browser (human-confirmed preference reported by root).
9. Switching projects retains the current section when the destination permits access; otherwise it opens Dashboard.
10. My tasks uses the full mockup row: description, branch, progress-update count and attached-commit count as well as task status, due date and View task.

## Sequence and boundaries

| Stage | Role / owner | Permitted work | Dependency / evidence |
|---|---|---|---|
| Context and requirements | Analyst `dashboard_analyst`, completed | Scoped task-management specification and source-linked context | Concrete draft subsequently human-approved |
| Coordination | Orchestrator `dashboard_coordination` | This plan and the corresponding handoff only | Confirm exact implementation/test scopes from analyst brief; no invented requirement IDs |
| Human requirements review | Responsible humans, completed | Concrete requirement/design/UI delta approved | No remaining pre-implementation permission gate |
| Tests | Test-writer `dashboard_tests`, completed red phase | Root-assigned bounded developer-dashboard/home/dashboard/navigation test scope | Red: 10 failed, 33 passed; targeted DB skipped without URL |
| Implementation | Implementer `dashboard_implementation`, complete | Exact approved source paths below | Approved scope and tests; installed Next.js documentation read; visual diff |
| Visible UI check | Frontend, completed synthetic browser inspection | Read-only rendered UI inspection | Approved acceptance criteria; authenticated runtime if available |
| Independent review | Reviewer, completed with no outstanding findings | Read-only acceptance and quality review | Source, tests, frontend evidence; no self-approval |
| Closure | Orchestrator and humans | Consolidated handoff; root-owned session interaction summary for human verification | Applicable lint/type/build/tests, disclosed gaps, human findings resolution |

Concurrent write assignments must be disjoint; separate worktrees are required for concurrent writing scopes. Current analysis and coordination touch separate document paths only. Product implementation follows the active test-writer within the approved exact scope below. No code, test, specification, log or git-history edits are authorized to this coordination worker.

## Current scope decisions

- Analyst must reconcile current sources with the confirmed behavior and identify any remaining fallback or no-project decisions without inventing them. Human resolved switching from other sections and task-row metadata as recorded above.
- Root verified that `src/app/projects/[projectId]/dashboard/page.tsx` now exists after the user completed the merge. Earlier conversational claims that no product-manager dashboard exists are superseded.
- Use existing requirement titles; no new backlog ID is assigned here.
- Human review of concrete planning artifacts and architecture is complete. Do not request another implementation approval.

## Coordination evidence

- Contracts read: `workflow/agents/orchestrator.md`, `workflow/agent-handoff-template.md`.
- Existing reusable references located: `workflow/handoffs/projects-dashboard-4-7.md`, `workflow/handoffs/developer-workspace-mockup-review-and-nextjs-install.md`.
- Primary handoff: `workflow/handoffs/developer-dashboard-project-switching.md`.
- Provider resource usage and exact provider session ID: not available. Agent path `/root/dashboard_coordination` is an orchestration identifier, not a provider session UUID.

## Analyst-derived context (approved exact assignments below)

Root-relayed analyst findings confirm the merged PM dashboard follows design D1–D8; `/` still renders the project-list placeholder. `readMyProjects` already filters memberships and orders by project name then ID. Existing dashboard aggregation does not include task detail, and the board's developer public task projection lacks description, branch and update/attached-commit counts. No browser-preference convention exists.

Candidate paths: `src/app/page.tsx`; `src/app/projects/[projectId]/layout.tsx`; `src/app/projects/[projectId]/dashboard/page.tsx`; project navigation and dashboard components; `src/server/project-dashboard/`; `src/server/task-board/`; `src/server/projects/my-projects.ts`; auth callback. The exact approved files/writer boundaries below supersede these exploratory candidates; no auth callback or project-list service writes are assigned. Extend only an approved authorized read projection for My tasks rather than duplicating task/GitHub logic.

Approved mechanism: a per-account same-browser cookie containing a project UUID, revalidated for current membership at `/`, with stale/malformed values falling back safely. Analyst proposes no database/API/migration changes. The human approved this mechanism after reviewing the concrete draft.

## Approved implementation design

- Persist the last project UUID in a persistent browser cookie scoped to the authenticated account. A client project selector/selection recorder writes the cookie only after server-side project membership has been checked.
- On `/`, read the cookie on the server and validate its UUID against the membership-scoped `readMyProjects` result. Missing, malformed or stale values fall back to the first permitted project in existing project-name/ID order. Zero permitted projects render empty dashboard cards with the highlighted Create project action.
- Retain the current section while switching projects if the destination role permits it; otherwise use Dashboard. A task-detail route falls back to Dashboard because its task belongs to the original project.
- Reuse authorized public task read services; extend their owned read projection for description, optional branch, progress-update count and attached-commit count when needed. UI reads do not call AI or domain mutation services.
- Add no database schema, migration, HTTP API or dependency for this design. Preserve existing role authorization and existing PM overview.

Analyst reports no remaining open product choices; human concrete requirements review and architecture approval are complete. Root created `logs/2026-11-09-developer-dashboard-project-switching.md`; human verification remains pending.

## Approved execution scope

Human approved the concrete draft review and continuing the workflow. Root updated `openspec/changes/project-task-management/design.md`, the specification comment, `specs/ui-spec.md` and unnumbered `tasks.md` checkboxes. The cookie and owned task-read projection design above is now approved. No new requirement ID is invented.

Execute sequentially in the shared checkout: test-writer → implementer → read-only frontend browser inspection and independent reviewer. Do not run concurrent file writers. No additional implementation permission gate remains; human's next action is final review, not commit authorization.

Implementer permitted paths:

- `src/app/page.tsx`
- `src/app/projects/[projectId]/layout.tsx`, `src/app/projects/[projectId]/dashboard/page.tsx`
- `src/components/project-dashboard/developer-dashboard.tsx`, `empty-dashboard.tsx`, `index.ts`
- `src/components/project-navigation/project-navigation.tsx`, `project-switcher.tsx`
- `src/lib/project-selection.ts`
- `src/server/task-board/repository.ts`, `service.ts`, `index.ts`
- `src/app/globals.css`
- `src/components/tasks/task-page-parts.tsx`
- Existing `src/components/project-dashboard/project-dashboard.tsx` only for a warranted `PendingLink` import adjustment.

No composition changes: add `TaskBoardService.getDashboardTasks(projectId, access)` calling owned `repository.listAssignedDashboardTasks`. Test-writer owns scoped developer-dashboard tests, `tests/unit/home.test.tsx`, existing project-dashboard view/page tests and navigation tests. Exact test files are confirmed by root/test-writer before writes; no AI security fixtures. Source/specification/coordination paths remain outside test-writer ownership; tests/specifications remain outside implementer ownership.

Required evidence: meaningful behavioral red/green tests for selection persistence/validation/fallback, no-project state, section retention, role-specific cards and counts, task projection/authorization and working filters/task links; existing related PM regressions; lint, `npx tsc --noEmit`, build and `git diff --check`. Inspect installed Next.js guides before code. Implementer generates the available visual diff. Frontend safely exercises authenticated browser UI at applicable sizes/roles, including switcher/filter/link/empty/error states, and records exact limitations. Reviewer independently assesses acceptance and service boundaries. Record unavailable DB/runtime evidence honestly; no invented pass or human approval. No commits, pushes, PR or deployment authorized.

## Historical red-phase evidence update (superseded by final execution status)

Test-writer red phase is complete: core seven-file command in the handoff produced six failed/one passed files, 10 failed/33 passed tests, including three missing-import failures reflecting intentional source gaps. Targeted database test was skipped without `TEST_DATABASE_URL`; scoped ESLint and whitespace checks passed. Synthetic real-component fixture config `tests/fixtures/developer-dashboard-react/vite.config.ts` uses port 4175, default and `/?empty=1`; its component test command has not yet run. Root started `dashboard_implementation` only after writer completion; no other source writer active. Root baseline production build failed under sandbox worker port binding (`OS error 1`); final reviewed escalation is planned, not a successful build result.

## Final execution status

All product/test writes finished; root marked the scoped unnumbered extension task complete with explicit PostgreSQL/full-suite limitations. Focused tests passed 97/97 across nine files; synthetic component browser tests passed 5/5. Production build and typecheck passed. Full suite returned 2249 passed and two unchanged baseline-reproduced task-manager harness failures; full lint retains six existing errors, while changed-source/test ESLint passed. New PostgreSQL projection test skipped without `TEST_DATABASE_URL`; no live authenticated journey, live DB, full E2E or formal release/accessibility 9.x evidence claimed. Frontend synthetic browser checks covered desktop/mobile, all filters, task links, role/section switching, real PM component and no-project state. Independent source review has no outstanding findings; optional native-details Escape dismissal is low priority.

Final 38-file branch inventory, session reports, commands and evidence paths are in the consolidated handoff. Visual diff `_temp/visual-diff.html` is generated and root will refresh after this documentation update. No dependencies, migrations, git actions or deployment. Next: human final review, ownership cross-review and verification of the single session log; any commit requires separate authorization.

## Approved shared-header follow-up (test-first execution pending)

The analyst's latest `task-management/spec.md` delta is the exact approved behavior source: selector aligns with developer content; shared navigation places the same developer-style AccountControl at far right for both roles, with verified identity/avatar fallback/sign-out preserved and no duplicate dashboard-body account control; role label remains; switcher Create project has a divider and plus icon; Board breadcrumb becomes a project-dashboard back link. Root will reconcile design D7 to shared developer-style AccountControl before affected code. This is authorized follow-up implementation, not another approval request.

Alignment evidence: Current project layout combines `max-w-7xl px-5 sm:px-8`, while developer content places gutters outside `max-w-7xl`; at viewport widths ≥1344px this adds 32px header inset relative to body content. Tailwind `px-5` is 20px and `sm:px-8` is 32px. Match container/gutter topology to remove the mismatch.

Sequential write ownership in shared checkout:

- Test-writer: `tests/unit/task-pages/project-navigation.test.tsx`, `tests/unit/task-pages/board-page.test.tsx` and focused layout/task-page-part tests required for these approved behaviors. Confirm any additional exact test paths with root before edits. No source/specification writes.
- Implementer, after tests: `src/app/projects/[projectId]/layout.tsx`; `src/components/project-navigation/project-navigation.tsx`; `src/components/project-navigation/project-switcher.tsx`; `src/components/project-dashboard/developer-dashboard.tsx`; `src/components/project-dashboard/project-dashboard.tsx`; `src/app/projects/[projectId]/dashboard/page.tsx`; `src/components/tasks/task-page-parts.tsx`; `src/app/projects/[projectId]/board/page.tsx`; `src/app/globals.css`; existing synthetic browser fixture if needed. No tests/specification writes.
- Frontend/reviewer follow read-only. No overlapping file writers; test-first then implement. Coordinator writes only existing plan/handoff.

Post-implementation checks: focused navigation/Board/layout/task-page-part red→green tests; existing developer/PM dashboard/page and account-control regression tests; synthetic component browser suite and rendered desktop/mobile alignment, shared-account, switcher-divider/icon, Board-back-link exercise where runtime permits; scoped ESLint, typecheck, build, whitespace check and updated visual diff. Report exact runtime restrictions rather than transferring prior browser passes. Existing full-suite/lint baseline failures, skipped DB/live-auth/E2E/formal release/accessibility and interaction-log verification remain disclosed and unchanged.

## Task-detail UI follow-up — approved findings resolution

- Task 4.4 remains complete; this is a separate, unnumbered follow-up. Human owner: Developer A for the developer-only layout; Developer B cross-reviews shared breadcrumb and PM preservation.
- Approved behavior remains as recorded in `openspec/changes/project-task-management/specs/task-management/spec.md` (“Task detail page”, “Progress update appears”), `specs/ui-spec.md` (“Task detail”), and the approved design delta. Both roles receive the linked `Project Dashboard / Board / readable task key` breadcrumb. Only developer task detail is rearranged into a main content card and right-side Details, Progress updates and Attached commits cards; the PM layout remains intact. UI updates are newest-first while the data/API order remains ascending. Commit picker and Run check placements and all other actions/panels are preserved. A further human-approved steering on 10 November moves Submit for review to the developer main task card’s top-right corner; this supersedes preserving its previous position.
- Test-writer changed only `tests/unit/task-pages/task-detail-page.test.tsx`. Red phase: 21 passed, 5 expected failures.
- Implementer changed only `src/app/projects/[projectId]/tasks/[taskId]/page.tsx` and `src/components/tasks/task-page-parts.tsx`.
- Verification reported before the latest Submit for review placement steering: focused task-detail + Board tests 50/50 passed; scoped ESLint and `npm run typecheck` passed; `git diff --check` passed; `openspec validate project-task-management` passed with six existing requirement-length warnings.
- Production build remains unverified. The sandbox build failed at port binding (`Operation not permitted`); the webpack fallback could not parse TypeScript `--showConfig`.
- Rendered browser QA is unverified. Frontend could not open `http://127.0.0.1:4175/.../dashboard` (`ERR_CONNECTION_REFUSED`), leaving desktop/mobile composition and interactions unverified. The source-only observation is that developer updates render as separate rounded rows rather than the connected timeline with guide/markers shown in the supplied mockup; frontend recommends connecting the rows and adding markers.
- Reviewer reports acceptance otherwise met and no functional blocker. P3 code-quality finding: duplicate developer progress-update/review-feedback renderers in the page around lines 101/120 overlap existing helpers around lines 177/188; reviewer recommends reuse while passing the reversed display copy.
- Human resolution (10 November): add the connected vertical guide and event markers to the developer progress-update timeline; refactor to reuse the existing progress-update and review-feedback renderers. These two previously reported findings are resolved by explicit human direction and are now approved implementation scope.
- Requirements source: analyst-updated `openspec/changes/project-task-management/specs/task-management/spec.md`, `openspec/changes/project-task-management/design.md`, `specs/ui-spec.md`, and the unnumbered follow-up in `openspec/changes/project-task-management/tasks.md`. Task 4.4 remains complete; this work remains a separate unnumbered follow-up.
- Sequential ownership and exact write boundaries in the shared checkout:
  1. Test-writer owns only `tests/unit/task-pages/task-detail-page.test.tsx`; add behavioral assertions for a connected vertical timeline with event markers and for reusing existing progress-update/review-feedback renderers without losing newest-first order or role-specific PM rendering.
  2. After tests, implementer owns only `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`. The renderer and timeline can be changed within the page; request scope expansion from root before editing any other source path. Do not edit tests or specifications.
  3. Frontend is read-only and has explicit user authorization to use the browser for rendered UI QA. Check the developer task route at desktop and mobile sizes, including newest-first connected timeline, marker/guide alignment, top-right Submit for review placement, and ensure the PM task page remains visually/behaviorally preserved. If the local runtime is unavailable, record the exact error and leave rendered acceptance unverified.
  4. Reviewer is independent/read-only and checks the approved acceptance criteria and renderer reuse after implementation; no self-approval.
- Do not run concurrent file writers. Existing reviewer/front-end findings are resolved by human approval of the changes, not by agent claims of completed implementation. Re-run focused task-detail and Board tests, scoped lint, typecheck, `git diff --check`, OpenSpec validation as appropriate, and production build if the environment permits. Refresh the visual diff after source/docs are final. Preserve the existing interaction log; root owns its session summary. No dependencies, migration, commit, push, PR, merge, deployment or history action is authorized.
- Final implementation status: connected timeline guide/event markers and renderer-helper reuse are implemented in the assigned page. Root reports focused task-detail + Board tests 52/52, `npm run typecheck`, scoped ESLint for the task page and test, `git diff --check`, and `openspec validate project-task-management` passed; OpenSpec reports six existing >500-character warnings.
- Frontend QA: user-authorized browser QA was attempted. Browser inventory was empty (`browsers: []`); IAB was unavailable against localhost:3000 and :3001. A dev server attempt on :3001 exited because the same-repo server was already on :3000, but the frontend provider could not access either. Source-only inspection confirms timeline marker structure and header action placement. Responsive/rendered geometry and interactions remain unverified.
- Independent review: read-only reviewer reports all approved criteria met in source/tests and no new findings. Production build remains unverified. Findings approved by the human are resolved in the implementation; rendered browser/build limitations are evidence gaps, not pending product decisions.
- Current status: implementation and review complete with disclosed build/rendered-UI limitations. Root will refresh the visual diff after this documentation update. No commit, push, PR, merge, deployment or history action is authorized.
