# Board, task detail and review queue: task 4.4 handoff

## Task record `[ORCH]`

- Task ID: 4.4 (`openspec/changes/project-task-management/tasks.md`), change `project-task-management`
- Summary: Build the board, task detail, and review queue pages following `specs/ui-spec.md`. The approved scope and decisions are in "Board, Detail and Review Queue Decisions (4.4)" (B1–B12 plus closing notes) in `openspec/changes/project-task-management/design.md`, and the seven ADDED 4.4 requirements in `openspec/changes/project-task-management/specs/task-management/spec.md`.
- Human owner (Developer A / Developer B): Developer B (thegrimbee). Developer A (Lim-ZY) cross-reviews, because 4.4 reuses Developer A components (`CheckHistory`, `DeveloperCheckPanel`, `CommitPicker`), wires into the shared `src/server/composition.ts`, and may add a page-access helper under `src/server/auth/`.
- Requirement IDs: none exist and none were constructed. Requirements are referenced by their OpenSpec requirement titles. Do not construct IDs.
- Status: Spec gate closed (spec delta and decisions approved by thegrimbee on 2026-11-08). Orchestrator plan written 2026-11-08. thegrimbee resolved O1 (O1-a, recorded in `design.md` B4) and approved assumptions A4 and A5 on 2026-11-08. No open question blocks dispatch.
- Next human action (thegrimbee): (1) approve or amend this plan; (2) then dispatch the test-writer.

## Source and scope `[ORCH]`

- Repository / branch / worktree: `CS3227-2610-MP4`, branch `feat/tasks-board-detail-review-queue`, primary checkout `D:/Education/CS3227/CS3227-2610-MP4`. Worktree plan: no extra worktree. All writing roles run sequentially in the primary checkout (see "Parallelism plan" in the orchestrator session block). Do not use `isolation: worktree`, which branches from `master` and would lose the uncommitted spec delta.
- Source revision: base commit `4503dec` (docs(tasks): verify CRUD and lifecycle completion). The approved spec edits to `openspec/changes/project-task-management/specs/task-management/spec.md` and `openspec/changes/project-task-management/design.md` are in the working tree, uncommitted, on top of `4503dec`. The human decides whether to commit the spec delta before dispatch; the plan does not depend on it.
- Date: 2026-11-08
- Permitted paths and actions (summary; the full per-role list is in the orchestrator session block):
  - test-writer: create and edit under `tests/` only (enforced by `.claude/hooks/guard-write-scope.mjs`).
  - implementer: the `src/` paths listed per role below only. The hook denies `tests/`, `openspec/`, `specs/`, `workflow/` but allows the rest of the repository, so the listed scope is a contract the reviewer checks.
  - frontend and reviewer: read-only. The frontend agent may run `npm run dev` against the development environment and use a browser only with safe synthetic data.
  - orchestrator: this handoff and `workflow/plans/` only.
  - main session: runs checks, saves review artifacts in its scratchpad directory, writes the session log in `logs/`.
- Prohibited paths and actions (all roles):
  - `openspec/`, `specs/`, `supabase/` (no migration; if one seems needed, stop and report), `package.json`, `package-lock.json` (no new dependency, B12), `next.config.*`, `src/proxy.ts`, `.env*`, `.vercel/`, `.claude/`, `.codex/`.
  - Any new `/api/v1` route or edit under `src/app/api/` (B2).
  - `src/server/tasks/`, `src/server/task-detail/` (B5: the detail read is unchanged), `src/server/completion-assessment/`, `src/server/github*/`, `src/server/ai/`, `src/server/repositories/` (except as stated per role), `src/components/completion-assessment/`, `src/components/github-evidence/`, `src/components/github-repository/`, `src/components/auth/`. These are consumed through their public entries only.
  - `tests/unit/ai/`, AI security evaluation cases (Developer A), `tests/e2e/` (9.2 deferred).
  - Ticking the 4.4 checkbox in `tasks.md` (human only). Any git write (commit-pr only, after explicit authorization). Production deploys or production data.
- Dependencies and parallel work:
  - 4.4 depends on 4.2, 4.3, 5.3 and 7.3, all complete at `4503dec`.
  - Inside 4.4: test-writer → implementer → frontend → reviewer → commit-pr (only after authorization). Details and the reason it is sequential are in the orchestrator session block.
  - Lim-ZY (Developer A) cross-reviews `src/server/composition.ts` and the new auth page helper before merge (B6).

## Context references `[ALL, when relevant]`

- Approved spec paths:
  - `openspec/changes/project-task-management/specs/task-management/spec.md` (seven ADDED 4.4 requirements)
  - `openspec/changes/project-task-management/design.md` (section "Board, Detail and Review Queue Decisions (4.4)", B1–B12)
- Analysis record: `logs/2026-11-08-task-4.4-analysis.md` (awaiting human verification).
- The analyst's full source index is in the analyst session block below.

## Decisions and open questions `[ORCH]`

- Current state: The spec gate is closed. thegrimbee approved the decisions below and the spec delta on 2026-11-08. They are recorded in `openspec/changes/project-task-management/design.md` as B1–B12 plus closing notes. The edits are uncommitted on top of `4503dec`.
- Human-approved decisions (thegrimbee, 2026-11-08):
  - D1 Scope — ACCEPT: build the board, task detail and review queue pages plus shared navigation and a minimal project entry point; dashboard progress, the members screen, and PM New Task/edit/reassign/delete controls are explicitly deferred.
  - D2 Data access — ACCEPT: no new `/api/v1` routes; pages are Server Components calling new read services; client components use only the existing state, progress-update, commit and check routes.
  - D3 Project entry point — ACCEPT: minimal "my projects" list on `/` (name, key, role) through a new read in `src/server/projects/`, so the Board link works.
  - D4 URLs and navigation — ACCEPT: `/projects/{projectId}/board`, `/projects/{projectId}/review-queue`, keep `/projects/{projectId}/tasks/{taskId}` and `/projects/{projectId}/settings`; Review Queue tab PM-only; Reports tab disabled until 8.3; navigation never replaces server checks.
  - D5 Referenced result — ACCEPT: "the submission" is the most recent `submission` event for the task; the referenced result is exposed in the review read only.
  - D6 Module ownership — ACCEPT: new Developer B modules for board and review reads, consuming the public completion-assessment history seam; Lim-ZY cross-reviews `composition.ts` and any `src/server/auth` page helper.
  - D7 Ordering and size — ACCEPT: order by task number ascending, then ID; no pagination now, recorded as a known limit.
  - D8 PM board menu — ACCEPT: board menu offers only developer transitions on the developer's own tasks; for the PM, In Review cards link to the review queue.
  - D9 Submit for review — ACCEPT: button on task detail for the assigned developer while In Progress, using the existing state route; submitting without a check is not blocked (L5).
  - D10 Page error handling — ACCEPT: 401 → `redirect("/sign-in")`, 404 → `notFound()`, 403 → inline safe "unavailable" view; no `authInterrupts` flag.
  - D11 Mockups — MODIFY: mockups will not be supplied; the frontend agent designs from the existing UI (sign-in page, workspace page, Project settings, Group 7 components) and the `specs/ui-spec.md` text.
  - D12 Tests — ACCEPT: Node `renderToStaticMarkup` tests, no DOM library; PostgreSQL integration test for listing queries; E2E (9.2) and accessibility (9.3) deferred and recorded.
  - D13 Stale checkboxes — MODIFY: the human resolved the 4.2/4.3 checkboxes and committed them in `4503dec`; the 4.4 checkbox stays unchecked.
  - D14 Inherited open questions — ACCEPT: none; the tester-accounts open question does not block 4.4 (it affects 9.2/9.4).
  - Spec delta: APPROVED. After splitting for length, seven ADDED requirements:
    1. Project members read the task board
    2. Board cards and board reads
    3. Board status menu applies only permitted transitions
    4. Task detail page
    5. Task detail actions follow the role
    6. Product manager reads the review queue
    7. Review queue actions and access
- Assumptions (identify unapproved assumptions; the orchestrator verified each against the code at `4503dec`):
  - A1 (verified, not a decision): the review read can find "the result referenced by the submission" (B5) inside the list returned by the public `CompletionAssessmentService.listHistory(taskId)` (`src/server/completion-assessment/service.ts:225`), because every `StoredCheckResult` carries `id` and the history query returns every result for the task (`src/server/completion-assessment/repository.ts:59-65`). So no new completion-assessment function is needed. If the implementer finds this false, it stops and reports; it must not add a function to Developer A's module or query `app.check_results` directly.
  - A2 (verified): the existing task-detail read (`src/server/task-detail/read-service.ts`) already returns every field the "Task detail page" requirement names (title, description, acceptance criteria, assignee, due date, branch, progress updates, attached commits, review feedback, check history, `status`, `version`). The detail page needs no change to that module.
  - A3 (verified): `task_events` rows of type `submission` carry `check_result_id` (`src/server/tasks/repository.ts:319-320`). The review read reads them; no migration is needed. If a query needs an index or schema change, stop and report (migrations are Developer B's but are out of 4.4's approved scope).
  - A4 (approved by thegrimbee, 2026-11-08): the shared navigation is a `src/app/projects/[projectId]/layout.tsx`. That layout also wraps the existing settings page and the expanded task page, so Settings gains the navigation bar. B4 lists settings among the navigation URLs, which the orchestrator reads as consistent.
  - A5 (approved by thegrimbee, 2026-11-08): `src/app/globals.css` is shared. The implementer may only add new classes in the existing `.workspace-*` style and may not change existing rules.
- Open questions / conflicts:
  - **O1 Navigation tabs: resolved.** thegrimbee chose O1-a on 2026-11-08, recorded in `design.md` B4: Dashboard tab shown but disabled while the dashboard is deferred (B1); Board shown to every member; Review Queue, Reports (disabled) and Settings shown to the product manager only, matching `specs/ui-spec.md:136`. Hiding tabs is never the protection (B2, B4).
  - No conflict found between the approved spec delta, `design.md` B1–B12, `tasks.md` 4.4 and the code at `4503dec`. O1 is resolved. The 5.3 note in `tasks.md:55` ("do not expand the minimal host page") governs 5.3 only; B4 now approves expanding it under 4.4.
  - No inherited open question blocks 4.4 (D14; tester accounts affect 9.2 and 9.4).
- Other notes for the gate:
  - Session log: `logs/2026-11-08-task-4.4-analysis.md` (awaiting human verification).
  - Next human action: approve the orchestrator plan (to be filled later); 4.4 changes visible UI, so the frontend agent step applies after implementation.

## Worker session reports

### Session `analyst / a510b0195f81aead2`

- Provider: `claude`
- Provider session ID: not surfaced
- Agent: analyst (agent ID `a510b0195f81aead2`)
- Phase: analysis, then the spec delta, then a requirement split and B11 amendment (one subagent, three runs)

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code, analyst subagent (Sonnet 5.5 as configured)
- Role: analyst
- Human owner and assigned task scope: Developer B (thegrimbee). Task 4.4. Run 1 was read-only: the context brief, source index, candidate edit paths and open decisions. Run 2 wrote the approved spec delta. Run 3 split the requirements for length and amended B11.
- Source revision: `4503dec`
- Started / ended / elapsed:
  - Run 1 (brief): 151,041 ms
  - Run 2 (write spec delta): 100,048 ms
  - Run 3 (split requirements, amend B11): 66,860 ms
  - Total: 317,949 ms (~5 min 18 s). Start and end times: not available.
- Resource usage (provider-reported):
  - Run 1: 160,553 tokens, 27 tool uses
  - Run 2: 175,320 tokens, 8 tool uses
  - Run 3: 185,134 tokens, 14 tool uses
  - Total: 520,007 tokens, 49 tool uses. Token figures are the platform's per-run subagent totals.
- Unavailable resource metrics: input/output/cache split and cost: not available.
- Work completed / findings: run 1 produced the brief, source index and candidate edit paths below, and the open decisions D1–D14. thegrimbee resolved them on 2026-11-08 (see "Decisions and open questions"). Run 2 wrote the spec delta and the "Board, Detail and Review Queue Decisions (4.4)" section. Run 3 split the requirements into seven for length and amended B11 per D11.
- Files changed:
  - `openspec/changes/project-task-management/specs/task-management/spec.md`
  - `openspec/changes/project-task-management/design.md`
- Checks run and exact results: `npx --no-install openspec validate project-task-management` → "Change 'project-task-management' is valid"; 6 length warnings, all pre-existing (4 completion-assessment, 1 data-persistence, "Authorized members read task detail"); none from 4.4 requirements.
- Gaps / blockers: none

#### Analyst fields `[ANALYST]`

- Exploration scope / task question: What is needed to build the board, task-detail and review-queue pages, and what is unrecorded?
- Compressed repository-context brief (about 300 words):
  - The data and write layer is complete for the pages. State, progress-update, task-detail, attach-commit and check routes all exist.
  - **Read gaps**
    - No board listing exists. 4.2 T1 deferred it to 4.4 (`design.md:271`).
    - No review-queue read exists. Group 7 forbade a review route (`group7-acceptance-criteria-check.md:692`).
    - No project or member listing exists (`design.md:195`, `:202`).
  - **Existing UI**
    - `src/app/page.tsx` is a placeholder with the "Board" link disabled (line 38).
    - The task page is a minimal commit-picker host from 5.3. It admits only the assigned developer and uses `githubEvidenceService.getTaskIdentity`. It must be expanded, not duplicated (`design.md:508`).
    - Reusable components exist: `CheckHistory`, `DeveloperCheckPanel`, `CommitPicker`.
    - Pages are `force-dynamic` Server Components.
    - Styling is Tailwind plus `.workspace-*` classes in `globals.css`.
  - **Carry-forwards from 4.3**
    - The detail read returns `task.version` and stored `status` (`to_do`, `in_review`, …). The board and review pages must map these to display names via `TASK_STATE_NAMES` (`design.md:353`).
    - A race loser gets 403 or 409. The UI must treat both as "reload and retry" (L9, `design.md:345`).
    - Request-changes needs required feedback (L3).
  - **Spec gaps**
    - No page URLs are recorded.
    - The "result referenced by the submission" is not exposed by any read. `check_result_id` lives only on `submission` task events.
    - The mockups `frontend_mockup_2.png`, `frontend_mockup_3.png` and `frontend_mockup_pm_review.png` are named in `ui-spec.md:97` but are not in the repository.
  - **Boundaries:** Server Components may call authorised services directly; Client Components use the HTTP API (AGENTS.md). The ui-spec board shows the product manager all tasks and a developer only their own.
  - **Test tooling:** unit tests run in the Node environment using `renderToStaticMarkup` (see `tests/unit/home.test.tsx`). Adding a DOM library would need justification.
- Relevant repository paths inspected and why:
  - `workflow/agents/analyst.md`: role contract, read-only scope, and what the report must contain.
  - `workflow/agent-handoff-template.md`: analyst field headings to mirror.
  - `AGENTS.md` (supplied in context): boundaries, "no gap filling by inference", and the rule that Client Components use the HTTP API.
  - `openspec/changes/project-task-management/tasks.md`: task 4.4 text, dependencies, and the 5.3 allowance note at lines 44-51.
  - `openspec/changes/project-task-management/design.md`: all decisions D4/C4, T1/T3, M1, L1-L9, API Error Contract, and the 5.3 host-page allowance.
  - `openspec/changes/project-task-management/specs/task-management/spec.md`: the detail read, the state route, review reads, and the lifecycle scenarios.
  - `openspec/changes/project-task-management/specs/completion-assessment/spec.md` and `specs/identity-and-access/spec.md`: check-history access, private-page rules, and the origin list. These were searched with grep, not read in full.
  - `specs/ui-spec.md`: screens, board, review queue, navigation, action buttons, and the check behaviour.
  - `src/app/page.tsx`, `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`, `src/app/projects/[projectId]/settings/page.tsx`: existing page patterns and the host page to expand.
  - `src/server/task-detail/{index,read-service,handlers,read-repository}.ts`: the existing read DTO, access rule, and SQL source for the review reads.
  - `src/server/tasks/{index,states}.ts`: the public seam and the single state-name map.
  - `src/server/auth/{index,request-access}.ts`: `resolveProjectAccess` returns a `Response`, so Server Components need a mapping.
  - `src/server/composition.ts`: the service graph, where a new read service would be wired.
  - `src/server/projects/types.ts` and `src/server/repositories/project-access-repository.ts`: no list-projects read exists.
  - `src/server/completion-assessment/index.ts` and `src/components/completion-assessment/*`: public seam and reusable check UI.
  - `src/components/github-evidence/commit-picker.tsx`: reusable picker.
  - `src/app/globals.css`: styling conventions.
  - `package.json`, `vitest.config.ts`, `tests/unit/home.test.tsx`: test tooling (Node environment, no DOM library).
  - `workflow/handoffs/{tasks-lifecycle-4-3,tasks-crud-4-2,group7-acceptance-criteria-check,github-evidence-remaining}.md`: carry-forwards and ownership of 4.4.
  - `logs/2026-11-07-task-4.3-analysis.md`: prior analyst log format.
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/{forbidden,unauthorized,not-found,use-router}.md`: `forbidden()` and `unauthorized()` require the experimental `authInterrupts` config, so prefer `notFound()` and `redirect()`. `router.refresh()` re-renders Server Components after a mutation.
- Prior human decisions and constraints, each linked to its source path: see the brief above (each item cites its `design.md` or handoff line) and "Decisions and open questions" (D1–D14, recorded as B1–B12 in `openspec/changes/project-task-management/design.md`).
- Candidate files / modules likely to need changes and rationale (candidates only; the orchestrator confirms scope):
  - **Specs (analyst-writable if assigned)**
    - `openspec/changes/project-task-management/specs/task-management/spec.md`: add the read and page requirements in section 5.
    - `openspec/changes/project-task-management/design.md`: add a "Board, Detail and Review Queue Decisions (4.4)" section.
    - `openspec/changes/project-task-management/tasks.md`: only wording (for example, the dependency on 4.3). The checkbox is not the analyst's to tick.
    - `specs/ui-spec.md`: only if page URLs or navigation need to be recorded there.
  - **Pages (`src/app`)**
    - New `src/app/projects/[projectId]/board/page.tsx` for the board.
    - New `src/app/projects/[projectId]/review-queue/page.tsx` for the review queue.
    - Modify `src/app/projects/[projectId]/tasks/[taskId]/page.tsx` to become the full detail page. It must switch from `githubEvidenceService.getTaskIdentity` to `taskDetailService`, and support the product manager.
    - Optional new `src/app/projects/[projectId]/layout.tsx` for the shared top navigation: Dashboard, Board, Review Queue (PM only), Reports, Settings.
    - Modify `src/app/page.tsx` to enable the Board link and give an entry point to a project. This depends on decision 3 below.
  - **UI (`src/components`)**
    - New `src/components/tasks/` (client components calling the existing state and progress-update routes with `router.refresh()`):
      - board columns and cards
      - status menu
      - detail sections
      - progress-update form
      - submit control
      - review actions
    - New nav component under `src/components/`.
    - Reuse `CheckHistory`, `DeveloperCheckPanel` and `CommitPicker` unchanged.
  - **Server-only reads (`src/server`)**
    - New board listing read (for example `src/server/task-board/`). It lists non-deleted tasks scoped by role, maps `status` through `TASK_STATE_NAMES`, and is exported via an `index.ts`.
    - New review-queue read (for example `src/server/review-queue/`, or an extension of `task-detail`). It must expose commits, `checkHistory` and the submission-referenced result. It should consume the public completion-assessment history seam, not query `check_results` directly (compare `group7-acceptance-criteria-check.md:707`).
    - `src/server/projects/` and `src/server/repositories/project-access-repository.ts`: only if a project or member listing is in scope (decisions 3 and 4).
    - `src/server/auth/` or a page-access helper: a non-`Response` variant of `resolveProjectAccess` for pages. This is Developer A's area, so cross-review is needed (compare `design.md:211`).
    - `src/server/composition.ts`: wire the new read services. It is a shared file; the Developer A/B boundary needs confirming.
  - **Tests (`tests/`)**
    - Unit tests for the listing services, using the shared fake in `tests/unit/support/sql-fake.ts`.
    - Page and component render tests in the existing `renderToStaticMarkup` style, with mocked composition, covering role gating and the 404/redirect paths.
    - A PostgreSQL integration test under `tests/integration/db/` for the listing queries (needs `TEST_DATABASE_URL`).
    - End-to-end is 9.2 and accessibility is 9.3. Both stay out of 4.4, with the deferral recorded explicitly.
- Dependencies, conflicts, and open product/design decisions: the open decisions D1–D14 raised by run 1 are all resolved by thegrimbee on 2026-11-08 (see "Decisions and open questions"). No inherited open question blocks 4.4 (D14).
- Requirement IDs and acceptance examples: none exist and none were constructed. The acceptance examples are the scenarios in the approved spec.
- OpenSpec files changed:
  - `openspec/changes/project-task-management/specs/task-management/spec.md` (seven ADDED 4.4 requirements)
  - `openspec/changes/project-task-management/design.md` (section "Board, Detail and Review Queue Decisions (4.4)", B1–B12)
  - Uncommitted on top of `4503dec`.

### Session `orchestrator / 4-4-plan`

- Provider: `claude`
- Provider session ID: not surfaced
- Work ID: 4.4
- Agent: orchestrator
- Phase: planning

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code, orchestrator subagent; model ID surfaced to the session as `claude-opus-5-5`. Configured effort medium, maxTurns 50 (`.claude/agents/orchestrator.md` at `4503dec`).
- Role: orchestrator
- Human owner and assigned task scope: Developer B (thegrimbee). Write the 4.4 plan in this handoff: assignments, write paths, order, worktree boundaries, acceptance-criteria mapping, conflicts and open questions. No product code, tests or specs.
- Source revision: `4503dec` plus the uncommitted, approved spec delta.
- Started / ended / elapsed: not available
- Resource usage (provider-reported): tool calls: 25, counted from this session's own calls including the final handback (one was a refused scratchpad write, blocked by the write-scope hook). Tokens in / out / total: not available. Cache read / write: not available. Cost: not available.
- Unavailable resource metrics: tokens, cache, cost, start/end time.
- Work completed / findings: read the role contract, the template, this handoff, `git diff` of the spec delta, `tasks.md` 4.4, `specs/ui-spec.md` (screens and navigation), the agent configs and the write-scope hook, and verified A1–A3 against the code. Wrote the plan below. Found one unrecorded UI decision (O1, navigation tabs); no other conflict.
- Files changed: `workflow/handoffs/tasks-board-detail-review-queue-4-4.md` (this file) only.
- Checks run and exact results: none (planning only; `git diff` and `grep` used for reading).
- Gaps / blockers: none (O1 since resolved as O1-a).

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:

  **Required plan fields (summary, with sources).** Each field is detailed further down in this block.
  1. Model/effort per role: from the frontmatter of `.claude/agents/*.md` at `4503dec` (table below). Recorded for every role; the frontend agent has no `maxTurns` set, so it runs without a turn cap. That is the recorded value, not a gap.
  2. Context plan: "Context per role" below. The orchestrator chose it from the role contracts in `workflow/agents/` and the 4.3 pattern. thegrimbee approves it with the plan.
  3. Parallelism: sequential in the primary checkout, because the seams come from the test-writer. Only the read-only roles (frontend, reviewer) may run concurrently, and only if the human chooses to. Run in parallel only with disjoint paths and fixed seams, and use a worktree only for a parallel implementer.
  4. Loop limit: at most 2 reviewer → fixer rounds, then escalate to thegrimbee (the same limit was used in 4.3).
  5. Who dispatches: the main session (flat coordination). `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` in `.claude/settings.json` means this orchestrator cannot dispatch workers.

  **Dispatcher.** As in 4.3: the main session dispatches every subagent with `Agent`, sends fix rounds and resumes with `SendMessage`, and keeps every human gate. Spawn depth stays 1 (`.claude/settings.json`). The main session runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; the human runs `npm run test:integration` by hand because it needs `TEST_DATABASE_URL`.

  **Model and effort per role** (configs in `.claude/agents/*.md` at `4503dec`, unchanged during 4.4; the main session records the resolved model ID, effort and maxTurns actually used in each session block).

  | Role | Model / effort / maxTurns | Planned for 4.4 | Reason |
  |---|---|---|---|
  | analyst | Sonnet / high / 20 | Done | Spec gate closed. |
  | orchestrator | Opus / medium / 50 | This session | Planning only. |
  | test-writer | Opus / medium / 90 | Run | Three new read services, a role × access matrix per page (PM, assigned developer, unassigned developer, nonmember, no session), data-minimisation checks (a developer's board sends no other developer's task), the 403/409 reload path, feedback trimming, and a PostgreSQL listing test. |
  | implementer | Opus / medium / 120 | Run | Widest UI change so far: three pages, an expanded page, a layout, client components, three server reads, an auth page helper and composition wiring. |
  | frontend | Sonnet / medium / none | **Run** (4.4 changes visible UI) | B11: no mockups, so the frontend check against `specs/ui-spec.md` and the existing UI is the only design check. |
  | reviewer | Sonnet / medium / 60, tools Read, Grep, Glob | Run | Independent acceptance-criteria and code-quality review. |
  | commit-pr | Sonnet / low / 20 | Run only after explicit authorization naming the branch | Mechanical. |

  **Write paths per role (final, non-overlapping).**
  - **test-writer: `tests/` only.**
    - Edit:
      - `tests/unit/home.test.tsx`: `/` now lists the person's projects (name, key, role) with a working Board link (B3).
      - `tests/unit/projects/project-service.test.ts`: only if the test-writer places the "my projects" read tests there; otherwise a new file.
      - `tests/unit/support/sql-fake.ts`: only if the fake needs new query support.
      - `tests/integration/db/support/`: only if fixtures need submission events or several developers.
    - Create (names chosen and reported by the test-writer):
      - board read service tests (for example `tests/unit/task-board/`);
      - review read service tests (for example `tests/unit/review-queue/`);
      - "my projects" read tests;
      - auth page-access helper tests (for example `tests/unit/auth-page-access.test.ts`): 401 → redirect `/sign-in`, 404 → `notFound()`, 403 → unavailable outcome, 500 → safe error (B10);
      - page render tests for board, review queue and task detail, with mocked composition, in the `renderToStaticMarkup` / element-tree style of `tests/unit/home.test.tsx` (B12);
      - client component tests for the board status menu, the progress-update form, Submit for review, and the review actions (state route called with `version`; 403/409 → reload message and `router.refresh()`, no local card change; request-changes feedback trimmed to 1–5,000 characters before sending);
      - one PostgreSQL integration test under `tests/integration/db/` for the board and review queries (role scoping, deleted tasks absent, ordering by task number then `id`, most recent `submission` event chosen).
    - Must not edit: `tests/unit/ai/`, AI security evaluation cases, `tests/e2e/`, any `src/` file.
    - Seams: the spec fixes the page URLs, not the service or component names. The test-writer chooses the read-service class and method names, the page-helper name, the client component file paths and exports under `src/components/tasks/`, and the navigation component path, and lists them in its session report. The implementer builds to those seams. Navigation tab assertions follow O1-a (`design.md` B4).
  - **implementer: these `src/` paths only.**
    - New `src/server/task-board/` (board read: repository, service, `index.ts`). Lists non-deleted tasks; product manager gets all, developer gets only own; maps stored `status` through `TASK_STATE_NAMES` from `src/server/tasks/index.ts`; returns `id` and `version`; orders by task number then `id`.
    - New `src/server/review-queue/` (review read: repository, service, `index.ts`). Product manager only; In Review tasks with attached commits, `checkHistory` from the public `completionAssessmentService.listHistory`, and the result referenced by the most recent `submission` event (A1, B5).
    - `src/server/projects/`: `repository.ts`, `service.ts` (or one new read file), `types.ts`, `index.ts`, for the "my projects" read (B3). No change to existing project handlers or validation.
    - `src/server/auth/`: one new page-access helper file plus an export in `src/server/auth/index.ts` (B6, B10). `request-access.ts` and `project-authorization.ts` stay unchanged. Lim-ZY cross-reviews.
    - `src/server/composition.ts`: minimal wiring for the new reads. Lim-ZY cross-reviews.
    - `src/app/page.tsx`: "my projects" list and the enabled Board link (B3).
    - New `src/app/projects/[projectId]/board/page.tsx`.
    - New `src/app/projects/[projectId]/review-queue/page.tsx`.
    - `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`: expand to the full detail page using `taskDetailService` instead of `githubEvidenceService.getTaskIdentity`, for the assigned developer and the product manager; reuse `CommitPicker`, `DeveloperCheckPanel` and `CheckHistory` unchanged.
    - New `src/app/projects/[projectId]/layout.tsx` (shared navigation; A4) with tabs per O1-a.
    - New `src/components/tasks/` (client components) and a new navigation component directory (for example `src/components/project-navigation/`), at the paths the test-writer reported.
    - `src/app/globals.css`: additive classes only (A5).
    - All pages `force-dynamic`; no caching of private data.
    - Anything else, including the prohibited list in "Source and scope", means stop and report. It uses `present-changes-visually` if available and records the visual diff path.
  - **frontend: none** (read-only). **reviewer: none** (read-only by tools). **commit-pr: none** except git, once authorized.
  - **orchestrator:** this handoff only. **main session:** checks, scratchpad review artifacts, `logs/` session log.

  **Acceptance criteria mapped to roles.** Each requirement title is from the approved spec delta. The test-writer covers the scenarios with automated tests; the implementer makes them pass; the frontend agent checks the visible part; the reviewer checks every row.

  | Requirement / decision | test-writer | implementer | frontend | reviewer |
  |---|---|---|---|---|
  | Project members read the task board (PM sees all; developer sees own only, nothing else sent; deleted absent; order) | board service unit + integration test + board page render | `task-board`, board page | four columns, ordering, PM vs developer view | yes; data minimisation in the rendered payload |
  | Board cards and board reads (card fields, `id`/`version`, server access, no new route, not cached; `in_review` → "In Review") | page render: nonmember → not-found, no session → redirect, card fields | board page, page helper | card content and state labels | yes; no `src/app/api/` change, `force-dynamic` |
  | Board status menu applies only permitted transitions (developer own To Do → In Progress → In Review; 403/409 → reload; PM and unassigned get no option; PM In Review card links to queue) | status menu component tests | `src/components/tasks/` menu | menu options per role, reload message | yes |
  | Task detail page (fields; unassigned developer → unavailable; nonmember, missing, deleted → not-found) | detail page render matrix | task page | layout of detail sections | yes; task-detail module unchanged |
  | Task detail actions follow the role (developer: Run check, picker, progress form, Submit while In Progress, not blocked without a check; PM: none; progress update appears in `createdAt` order) | detail page render + submit and progress component tests | task page, `src/components/tasks/` | actions per role, no "check completed" when none | yes |
  | Product manager reads the review queue (In Review only; commits; `checkHistory`; latest submission's result; "no result referenced") | review service unit + integration test + page render | `review-queue`, queue page | entry content, the "no result referenced" state | yes; no direct `check_results` query (A1) |
  | Review queue actions and access (Approve; Request changes with trimmed 1–5,000 feedback; developer → unavailable; nonmember → not-found; no session → redirect; no check started; 403/409 → reload) | review actions component tests + page render | queue page, review action components | feedback requirement, reload message | yes |
  | B3 "my projects" on `/` | `home.test.tsx`, projects read test | `src/server/projects/`, `src/app/page.tsx` | entry list and Board link | yes |
  | B4 navigation (O1-a) | nav render test per role | layout + nav component | tabs per role | yes, against O1-a |
  | B10 page errors | page helper tests | auth page helper | unavailable and not-found views show no data | yes |
  | B12 deferrals (9.2 E2E, 9.3 accessibility, no pagination) | listed as coverage gaps | none | accessibility observations as information only | confirms they are disclosed |

  **Parallelism plan (sequential in the primary checkout).**
  1. Human approves this plan (O1 resolved as O1-a).
  2. test-writer. Then the main session runs `npm test` (new tests are expected to fail) and `npm run typecheck`.
  3. Human runs `npm run test:integration` if the test-writer added integration tests (expected to fail before implementation).
  4. implementer, given the test-writer's report (seams, files, gaps). Then the main session runs lint, typecheck, test and build; the human runs the integration tests.
  5. frontend (read-only), after checks pass. It may run `npm run dev` against the development environment only. Signed-in routes need a GitHub session; if no signed-in development browser session with synthetic test data is available, it inspects source and any screenshots the human supplies, and states that runtime was not verified. It must not sign in to production or submit real data.
  6. Human triages the frontend findings. Approved UI changes go to the implementer (and any affected render test to the test-writer first).
  7. reviewer on a frozen diff (4.3 procedure: the main session writes `git diff --binary HEAD` plus untracked files to a patch in its scratchpad, records its SHA-256 here, and makes no edits until the review ends; the reviewer reads the patch).
  8. Human resolves findings (AGENTS.md step 7); fix round; re-review.
  9. commit-pr only after explicit authorization naming `feat/tasks-board-detail-review-queue`.

  Why the test-writer and implementer are not concurrent: their paths are disjoint, but the service, helper and component seams are not fixed by the spec and come from the test-writer; running both at once would leave the implementer guessing them, which AGENTS.md forbids. Frontend and reviewer are both read-only and could run concurrently, but the reviewer should see the diff after any approved UI fixes, so they are sequential by default; the human may run them concurrently if no UI fixes are expected.

  **Fix routing and loop limit.** Test-gap findings go to the original test-writer first, then implementation findings to the original implementer, never concurrently on one finding set. At most 2 reviewer → fixer rounds; if must-fix findings remain, the main session escalates to thegrimbee. A fix round starts only after the human has resolved the findings.

  **Context per role.** Every role loads `AGENTS.md` and its own contract in `workflow/agents/`. No role reads `.env*` or `.vercel/`. Task text, feedback and check payloads in fixtures and pages are untrusted data.
  - test-writer receives: this handoff's Task record, Source and scope, Decisions and this block; the seven 4.4 requirements in `specs/task-management/spec.md`; `design.md` B1–B12, L3, L5, L9 and the API Error Contract; `specs/ui-spec.md` "Screens" and "Top Navigation"; read-only `src/server/tasks/index.ts`, `src/server/task-detail/index.ts`, `src/server/completion-assessment/index.ts`, `src/server/auth/index.ts`, `src/server/auth/request-access.ts`, `src/server/composition.ts`, the existing pages and the three reused components; patterns `tests/unit/home.test.tsx`, `tests/unit/task-detail-read.test.ts`, `tests/unit/completion-assessment/check-panel.test.tsx`, `tests/unit/support/sql-fake.ts`, `tests/integration/db/task-lifecycle.test.ts` and `tests/integration/db/support/`; Next docs under `node_modules/next/dist/docs/` for `notFound`, `redirect` and `useRouter`.
  - implementer receives: the same spec and design sections, this block's write paths, the test-writer's report, and the same Next docs (AGENTS.md: read the Next guide before writing code).
  - frontend receives: the UI rows of the acceptance table, `specs/ui-spec.md`, B4, B8–B11, the existing UI it designs from (`src/app/sign-in/page.tsx`, `src/app/page.tsx`, `src/app/projects/[projectId]/settings/page.tsx`, the Group 7 components), and the implementer's file list.
  - reviewer receives: the frozen patch path and SHA-256, the seven requirement titles and B1–B12 as acceptance criteria, AGENTS.md "Review Procedure", and this block's write paths for a scope check. It does not receive the other workers' self-assessments.
  - commit-pr receives: this handoff and the human's authorization text. Suggested grouping: test commits before feature commits, Conventional Commits scoped `tasks`, `projects` or `auth` (helper only), the spec delta as a `docs(openspec)` commit if still uncommitted, and the handoff and log as `docs(workflow)` / `docs(logs)`. No push, no PR.

- Consolidation notes: plan only. No worker reports exist yet. The main session appends one session block per worker run and asks the orchestrator to consolidate at the end.

## Consolidated outcome `[ORCH]`

- Changed files and rationale:
- Tests/checks and results:
- Generated artifacts:
- Dependencies added:
- Known gaps and unverified items:
- Reviewer findings:
- Frontend UI findings and requested screen/component changes (include only when frontend agent was assigned):
- Branch inventory, scoped commits, and PR draft (include only when commit/PR agent was assigned):
- Suggested skills / references for the next worker `[ORCH, when applicable]`:
- Next action and responsible human:

## Change log `[ORCH]`

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-11-08 | orchestrator (handoff setup) | Created the handoff from the template. Filled the task record, source facts, the analyst session block (brief, source index, candidate edit paths, metrics) and the human-gate decisions D1–D14 and spec-delta approval. Plan and worker sections left as template placeholders. |
| 2026-11-08 | orchestrator / 4-4-plan | Filled the plan: status and next action, scope (permitted, prohibited, dependencies), worktree plan (sequential in the primary checkout), assumptions A1–A5 (A1–A3 verified against code), open question O1 (navigation tabs), a required-plan-fields summary citing `.claude/agents/`, the orchestrator session block with model per role (frontend run), final write paths, acceptance criteria mapped to roles, order, fix routing and loop limit, and context per role. |
| 2026-11-08 | main session (thegrimbee instruction) | Recorded O1-a in `design.md` B4 and marked O1 resolved; marked A4 and A5 approved; removed O2 and all references to the temp folder. |
| 2026-11-08 | main session (thegrimbee delegated) | Test-writer gaps resolved in `design.md` B3: "my projects" ordered by name then `id`; read failure shows a safe error in place of the list. Settings under the shared layout (A4) gets one render test. Stray harness-check test deleted with thegrimbee's permission. |
| 2026-11-08 | main session (thegrimbee triage) | Frontend findings triaged by thegrimbee: fix F1 (referenced result shown with an exported single-result card from Developer A's `check-history.tsx`, referenced card marked in history; Lim-ZY cross-reviews), F2 (layout drops min-height/background), F3 (project name in layout), F4 (page-level status region surviving refresh, success messages), F5 (Board tab active on task pages), F6 (new disabled-tab class, "Coming soon" hint), F8 (Done-only green accent), F9 (no board badge, formatted due dates), F10 ("Submit for review" label), F12 validation error as `role="alert"`. Leave F7 and F11 (styled error/not-found pages, page titles, empty-board message) as recorded gaps; rest of F12 deferred to 9.3. Order: test-writer, then implementer. |
| 2026-11-08 | main session (thegrimbee decision) | F9 conflict with "Board cards and board reads" resolved as option (a): board cards drop the visible state badge but keep visually hidden state text, so the requirement is met unchanged. F1 scope exception: implementer may edit `src/components/completion-assessment/check-history.tsx` for F1 only (new `CheckResultCard` export, `referencedResultId` prop); Lim-ZY cross-reviews. |
| 2026-11-08 | main session (thegrimbee triage, review round 1) | Reviewer round 1: no blockers or majors. Fix round 2 (final) approved: R1 replace `isManager` control flag on board card; R2 per-request `React.cache` around page access lookup; R3 share one UUID check in auth module (Lim-ZY reviews `requirePagePathId`); R4 shared `AttachedCommitList` (server helpers left duplicated, prohibited modules); R5 single source for permitted board moves and `TaskState` prop type; R7 test gaps (malformed ids, home with no session, read-failure notices asserted, commit-picker refresh); R8 move "my projects" read logic out of the page; R9 one state-name helper. R6 recorded as known limit in `design.md` B7. `next-env.d.ts` excluded from commits. Order: test-writer, implementer, checks, reviewer round 2. |
| 2026-11-09 | main session (thegrimbee decision, review round 2) | Reviewer round 2: no blockers or majors; R1–R9 verified. thegrimbee accepted F1 (`request-access.ts` shared `isUuid` edit; Lim-ZY cross-reviews), F2–F5. Follow-ups: F2 profile function taking a `User` (Developer A); F3 move `taskStateName` into `src/server/tasks/`; F4 pin the task-detail failure notice in its test (React.cache dedup verified by review only). thegrimbee ran `npm run test:integration` after round 2: pass. Commits authorized on `feat/tasks-board-detail-review-queue`; `next-env.d.ts` excluded. Lim-ZY cross-review of `composition.ts`, `page-access.ts`, `uuid.ts`, `request-access.ts`, `check-history.tsx` still pending. |
