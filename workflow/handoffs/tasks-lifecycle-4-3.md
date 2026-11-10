# Task lifecycle: task 4.3 handoff

## Completion verification (8 November 2026)

This section supersedes the planning-only status of the historical record below. Source revision: `9b61ed713e7c490af095495c65a6819871494174`, branch `feat/tasks-board-detail-review-queue`. Human owner: Developer B; Developer A retains the recorded cross-review responsibilities. Scope: verify existing tasks 4.2/4.3 and correct completion records only; no product code, tests, requirements, migrations, or dependencies changed.

### Independent reviewer findings

All inspected functional criteria were met. No new must-fix code-quality findings were identified; CRUD, lifecycle, validation, persistence and the read-only tip lookup retain cohesive module boundaries.

| Task 4.3 criterion | Status and source/test evidence |
|---|---|
| Four transitions and assigned-developer/PM permissions | Met: `src/server/tasks/states.ts`, `lifecycle-service.ts`; `tests/unit/project-authorization-routes.test.ts` and `task-lifecycle-routes.test.ts`. |
| Request changes requires feedback and permits resubmission | Met: task validation and dedicated lifecycle service method; feedback and resubmission route cases in `tests/unit/task-lifecycle-routes.test.ts`. |
| Progress updates restricted to the assignee without changing task state/version | Met: lifecycle service and route tests; reassignment race in `tests/integration/db/task-lifecycle.test.ts`. |
| Atomic state/event writes and optimistic version guard | Met: row lock, version comparison, guarded update and event share one transaction; competing-write cases in `tests/integration/db/task-lifecycle.test.ts`. |
| Task-detail read exposes version | Met: `src/server/task-detail/read-repository.ts` and `read-service.ts`; `tests/unit/task-detail-read.test.ts`. |
| Read-only submission tip lookup and safe failure behavior | Met: `src/server/completion-assessment/submission-tip.ts`, its public entry point and composition wiring; unit tip-lookup tests and `tests/integration/db/submission-tip-lookup.test.ts`. Lookup precedes the transaction; commit set and criteria are rechecked under lock. |
| Functional state route replaces stub and stub assertions | Met: task state Route Handler calls `handleTaskStateChange`; functional permission matrix replaces authorized 501 assertions. |

Task 4.2 criteria and evidence are recorded in the matching completion section in `workflow/handoffs/tasks-crud-4-2.md`.

### Checks and limits

- Fresh local Windows verification at the source revision above: `npm.cmd test` passed 32 files / 1,895 tests; `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run build` exited 0.
- Prior PostgreSQL execution: `logs/2026-11-07-task-4.3-implementation.md`, verified by Gabriel on 8 November 2026, records the human's post-fix run: 18 files / 331 tests passed. The 4.2 handoff separately records 16 files / 306 tests passed after rework.
- No `TEST_DATABASE_URL` was configured and Docker's daemon was unavailable. PostgreSQL tests were not rerun; prior human evidence is not represented as a fresh run. No UI or end-to-end testing was performed for this documentation correction.
- OpenSpec CLI was unavailable on PATH and no local executable was found; validation was not rerun. Only task checkboxes/evidence changed in OpenSpec.
- Initial `npm` invocations were blocked by PowerShell script execution policy; `npm.cmd` ran successfully without changing that policy. The build regenerated `next-env.d.ts`; its generated-only diff was restored to the pre-session content.
- Existing task 4.4 design/spec edits, local Claude settings and the 4.4 analysis log are outside scope. Task 4.4 remains unchecked.

### Remaining human follow-ups

- Confirm the recorded Lim-ZY cross-reviews of authorization, completion-assessment and task-detail changes. This session does not approve or infer completion of human review.
- Record the matching-check tie-break decision noted in the 4.3 implementation log. The implementation selects the newest matching check, which satisfies the existing matching-check requirement; this documentation gap remains open.
- The implementation log's F1 open item is resolved by the already approved design decision L9 and commit `dafe4c8`: either 403 or 409 can refuse the losing transition, with no write. No new decision was made here.
- The human verified this session's disclosure log and explicitly authorized the scoped documentation commit on `feat/tasks-board-detail-review-queue` on 8 November 2026.

### Verification session reports

- Root: provider `codex`; agent orchestrator/coordinator; work ID `tasks-4-2-4-3-verification`; phase verification and completion records; source revision as above. Provider session ID and model: not available. Changed files: `openspec/changes/project-task-management/tasks.md`, both task handoffs, and `logs/2026-11-08-tasks-4-2-4-3-verification.md`. Work completed: consolidated independent review and fresh checks, corrected task status and historical handoff status. Resource metrics (tokens in/out/total, cache read/write, cost): not available.
- Reviewer `/root/verify_tasks`: read-only source/spec/test inspection; all task 4.2/4.3 functional criteria met; no new must-fix findings; no files changed or tests executed. Review limits: no live database or UI; pending human cross-review. Platform: Codex; configured model GPT-6.1 Sol; exact provider session ID and resource metrics: not available.
- Commit/PR: the human verified the interaction summary and authorized one scoped documentation commit on `feat/tasks-board-detail-review-queue`. The commit agent audited the branch against `dev` (identical at `9b61ed7`), confirmed a clean index, and selected only the four verification records. Subject: `docs(tasks): verify CRUD and lifecycle completion`. Existing unrelated changes are excluded. No push or PR creation authorized. Resource metrics: not available. No generated deliverables or dependencies added.

## Task record `[ORCH]`

- Task ID: 4.3 (`openspec/changes/project-task-management/tasks.md` L33)
- Summary: Implement the To Do → In Progress → In Review → Done lifecycle, request changes with feedback, and progress updates. Replace the state-route stub. Add `version` to the task-detail read and the read-only completion-assessment tip lookup used by submission. Replace the stub assertions in `tests/unit/project-authorization-routes.test.ts`. Add tests for transitions, assignment and permissions, competing writes, and route authorization. The approved decisions are in "Task Lifecycle Decisions (4.3)" (L1–L8, the check order, and the conflict resolutions) in `openspec/changes/project-task-management/design.md` L333–356.
- Human owner (Developer A / Developer B): Developer B (thegrimbee). Developer A (Lim-ZY) agreed to two changes in Developer A's modules: L5's public tip-lookup function in `src/server/completion-assessment/`, and L1's `version` field in the Group 7.3 task-detail DTO (design.md L335, L355). The 4.3 agents write both changes, and Lim-ZY cross-reviews them before merge (Q3).
- Requirement IDs: none assigned. design.md L175 says "No formal API requirement IDs are assigned" for these routes, and none were given for 4.3. Requirements are referenced by their OpenSpec requirement titles (see Context references). Do not construct IDs.
- Status: Implemented and merged at `9b61ed7`; independently verified on 8 November 2026. The planning sections below are historical. See "Completion verification (8 November 2026)" for current evidence and remaining human follow-ups.
- Next human action: Verify the new interaction summary, confirm the recorded cross-review status, and record the matching-check tie-break decision. No new implementation is required for the task 4.3 checkbox.

## Source and scope `[ORCH]`

- Repository / branch / worktree: `CS3227-2610-MP4`, branch `feat/tasks-lifecycle-4-3` (cut from `dev` at `6542a48`), primary checkout `D:/Education/CS3227/CS3227-2610-MP4`. Workers run one after another in the primary checkout with no worktree (see "Parallelism plan").
- Source revision: `d5fc31a` (HEAD at planning; working tree clean).
- Permitted paths and actions: per role, under "Write paths per role" in the orchestrator session below.
- Prohibited paths and actions (all roles):
  - `.env`, `.env.*` other than `.env.example`, and `.vercel/`: no reading or writing (D3 deny rules).
  - `supabase/` migrations: no edits. design.md L6 records that no migration is needed.
  - `openspec/` and `specs/`: read-only for every role in this task. The spec gate is closed.
  - `.claude/`, `.codex/`, `AGENTS.md`, `eslint.config*` and `package.json`/lockfile: no edits, and no dependencies may be added.
  - AI security evaluation fixtures (Developer A's) and `tests/unit/ai/`: no edits.
  - UI paths `src/components/` and the page files under `src/app/` (anything that is not a `route.ts` under `src/app/api/`): no edits. Visible UI is task 4.4.
  - No git writes except by commit-pr after explicit authorization. Never push or open a PR.
- Dependencies and parallel work:
  - Depends on 4.1 and 4.2 (merged into `dev`) and on Group 7.3 (`src/server/task-detail/`, merged).
  - Task 4.4 depends on 4.3's `version` in the detail read and on the `status`/`state` mapping carry-forward (design.md L351).
  - No other branch or worktree for 4.3 exists.

## Context references `[ALL, when relevant]`

- Spec deltas in `openspec/changes/project-task-management/specs/`:
  - `task-management/spec.md` requirements:
    - "Authorized members read task detail" (L237)
    - "Task lifecycle" (L270)
    - "Task state route" (L293)
    - "Task completion requires product-manager approval" (L320)
    - "Submission records attached commits and a matching check" (L359)
    - "Submission rechecks its inputs before it is stored" (L379)
    - "Review reads expose check history" (L390)
    - "Lifecycle changes are recorded as task events" (L400)
    - "Developer submits task progress" (L419)
  - `identity-and-access/spec.md` requirements:
    - "Protected route authorization stubs" (L78)
    - "Protected API errors use stable safe responses" (L151)
    - "Mutating project routes check the request origin" (L177)
  - `completion-assessment/spec.md` requirements:
    - "Submission can look up the committed tip" (L196)
    - "AI check does not decide task completion" (L207)
- `openspec/changes/project-task-management/design.md` sections:
  - "Task Lifecycle Decisions (4.3)" (L333–356)
  - From "Task Management Decisions (4.2)": T3, T5, T6, T8, T9, T11, T14 and U2 (L260–331)
  - M1 (L327–331)
  - The "Task-state route" bullet (L179)
  - "API Error Contract" (L452 onward)
- Code to read, not to change:
  - `src/server/auth/project-authorization.ts`: the stub and the duplicate state map
  - `src/server/repositories/task-access-repository.ts`
  - `src/server/tasks/` (public entry `index.ts`)
  - `src/server/task-detail/`
  - `src/server/completion-assessment/`
  - `src/server/projects/request-guard.ts`: `refuseUnsafeMutation`, T14
  - `src/server/composition.ts`
  - `src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route.ts`
- Tests and test support:
  - `tests/unit/project-authorization-routes.test.ts`
  - `tests/unit/project-origin-check.test.ts`
  - `tests/unit/task-routes.test.ts`
  - `tests/unit/tasks/task-service.test.ts`
  - `tests/unit/task-detail-read.test.ts`
  - `tests/unit/completion-assessment/`
  - `tests/unit/support/sql-fake.ts`
  - `tests/integration/db/tasks-crud.test.ts`
  - `tests/integration/db/task-history.test.ts`
  - `tests/integration/db/support/`
- Prior handoffs: `workflow/handoffs/tasks-crud-4-2.md` (the pattern for 4.2's task writes) and `workflow/handoffs/projects-membership-4-1.md` (pipeline format, config blobs, X1).
- Analysis record: `logs/2026-11-07-task-4.3-analysis.md`.

## Decisions and open questions `[ORCH]`

- Current state: The spec gate is closed. L1–L8, the check order, and the conflict resolutions were approved by thegrimbee on 2026-11-07 (design.md L335). thegrimbee backfilled Q1 and delegated Q2–Q11 to the main session on 2026-11-07. The resolutions are recorded below.
- Human-approved decisions: design.md L333–356. They include:
  - feedback limited to 1–5,000 code points, and progress-update bodies to 1–2,000;
  - the 403 matrix kept as the invalid-transition response;
  - one state-name map, exported from `src/server/tasks/index.ts`;
  - no new error code;
  - the `status`/`state` naming carried forward to 4.4.

  The analysis log lists five points the analyst placed with some inference: the feedback-before-version check order, a stale version returning 403 when the actor is no longer allowed, a progress post losing a race with reassignment returning 403, the start and approve event fields, and path rules being unavailable. All five are in the approved delta. They are carried as approved. The reviewers should check them, and they are not reopened here.
- Resolved questions (Q1 by thegrimbee; Q2–Q11 by the main session under thegrimbee's delegation, 2026-11-07):
  - **Q1, the analyst's brief.** Backfilled under `analyst / 4-3-analysis`. Its candidate paths agree with the write paths below.
  - **Q2, where the lifecycle code goes.** In the existing `src/server/tasks/` module. design.md L340 already exports the state map from `src/server/tasks/index.ts`, 4.2's `TaskTransaction` and `lockTask` live there, and the analyst's candidate list names the same files.
  - **Q3, who writes in Developer A's modules.** The 4.3 test-writer and implementer write the tip lookup and the `version` field, as tasks.md L33 puts them in 4.3's scope and Developer A agreed. Lim-ZY cross-reviews those files before merge, and the PR description names them.
  - **Q4, a separate security pass.** None planned. AGENTS.md's Review Procedure already makes the reviewers check authorization, CSRF and parameterization. Any `/security-review` that thegrimbee runs later is recorded outside X2.
  - **Q5–Q11.** X2 details, resolved under "Reviewer plan (experiment X2)".
  - Workers run in sequence in the primary checkout, as in 4.1 (see "Parallelism plan").

## Worker session reports

### Session `analyst / 4-3-analysis`

- Provider: `claude`
- Provider session ID: not surfaced
- Phase: analysis, then the spec delta (one subagent, resumed once with `SendMessage` after human approval)

Backfilled by the main session on 2026-11-07 from its transcript (Q1). The brief below is the analyst's report as it was given to the human before approval. Where the human's approval changed something, that is marked.

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code subagent, `analyst` role. The subagent reported its model as Sonnet 5.5 (`claude-sonnet-5-5`). Config `.claude/agents/analyst.md` (blob `65543d8`): model `sonnet`, effort `high`, maxTurns 20.
- Role: analyst
- Human owner and assigned task scope: Developer B (thegrimbee). Task 4.3. Run 1 was read-only: the context brief, paths, candidate edit paths, prior decisions, a draft spec delta and open decisions. Run 2 applied the approved delta under `openspec/changes/project-task-management/` only.
- Source revision: `267cee7` (working tree clean at start)
- Started / ended / elapsed: run 1 took 202,976 ms and run 2 took 258,388 ms, as the harness reported them. Start and end times: not available.
- Resource usage (provider-reported):
  - Run 1: 127,184 subagent tokens and 31 tool uses.
  - Run 2: 177,755 subagent tokens and 28 tool uses.
  - These are the harness's task-notification totals.
- Unavailable resource metrics: the in/out split, cache read/write, thinking tokens and cost.
- Work completed / findings: run 1 produced the brief below and 8 open decisions. thegrimbee approved every recommendation and the draft delta, and delegated conflict resolution to the main session. Run 2 applied the delta and the "Task Lifecycle Decisions (4.3)" section (L1–L8).
- Files changed:
  - Run 1: none.
  - Run 2:
    - `openspec/changes/project-task-management/design.md`
    - `tasks.md`
    - `specs/task-management/spec.md`
    - `specs/identity-and-access/spec.md`
    - `specs/completion-assessment/spec.md`
  - Committed in `365a817`.
- Checks run and exact results: `openspec validate project-task-management`: "Change 'project-task-management' is valid", with 6 long-requirement warnings. All 6 are on requirements that were already over the limit before this task: five untouched, and "Authorized members read task detail" was only extended with `version`. The main session reran the check and got the same result.
- Gaps / blockers: no PostgreSQL database was available, so every finding comes from reading the source.

#### Analyst fields `[ANALYST]`

- Exploration scope / task question: What do the recorded sources fix, and what do they leave open, for these parts of 4.3?
  - replacing the state route stub
  - request-changes with feedback
  - progress updates
  - submission
  - competing writes guarded by `version`
- Compressed repository-context brief (about 280 words):
  - **The stub.** `PATCH .../tasks/{taskId}/state` calls `handleTaskStateStub` in `src/server/auth/project-authorization.ts`. The stub validates the state name and then applies one combined role, assignment and current-state predicate (`stateTransitionAllowed`). A request that passes gets 501 and nothing changes. Every other request gets 403, including requests that are only illegal from the task's current state.
  - **The schema already supports 4.3** (`supabase/migrations/20261030144500_create_app_schema.sql`). No new migration is needed.
    - `tasks.status` has a CHECK constraint, and a trigger increments `tasks.version` on every UPDATE.
    - `task_events` is append-only: `app_runtime` has SELECT and INSERT only.
      - Event types: `state_change`, `submission`, `assignment_change` and `review_feedback`.
      - Columns: from/to status, `check_result_id` (a foreign key to the same task) and `feedback`, which cannot be blank.
    - `progress_updates(task_id, author_id, body, created_at)` exists, with no length or blank-text check.
  - **Patterns from 4.2 to reuse.**
    - `src/server/tasks/` has `TaskTransaction`, with `lockRoles` and `lockTask` (`FOR UPDATE`, which returns the assignee and version).
    - It maps errors through its own `TaskError` table.
    - The check order is T8: Origin 403, then 400, 401, 404 membership, 404 task, 403 role, then 409.
    - Handlers are thin wrappers in `project-authorization.ts` (T16).
  - **The 7.3 detail read.** The task-detail GET returns `progressUpdates`, `reviewFeedback` (built from `review_feedback` events) and `checkHistory`. It returns the raw `status` value and has no `version`.
  - **Constraints.**
    - AI and check code never change task state.
    - Only the PM approves a task or requests changes.
    - No database transaction stays open during a network call.
- Relevant repository paths inspected and why:
  - **OpenSpec change** (`openspec/changes/project-task-management/`):
    - `tasks.md` (4.1–4.4, 7.3, 8.x): scope and neighbouring tasks.
    - `proposal.md` and `design.md`: D-C, D-E, D-F, T1–T16, U, M1, C1, the API Error Contract and the Open Questions.
    - The task-management, identity-and-access, completion-assessment, data-persistence and daily-progress-report spec deltas: requirements touching the lifecycle.
  - **`openspec/specs/`:** empty, so there are no archived capabilities.
  - **`specs/ui-spec.md` L79–94:** the board's status menu, and Approve / Request changes in the review queue, with feedback required.
  - **Server code:**
    - `src/server/auth/project-authorization.ts` and `.../state/route.ts`: the stub to replace.
    - `src/server/repositories/task-access-repository.ts`: owned by 4.3.
    - `src/server/tasks/*`: the 4.2 patterns.
    - `src/server/composition.ts`: wiring.
    - `src/server/task-detail/*`: the detail data shape.
    - `src/server/completion-assessment/*`: `selectedTip` is private and calls GitHub.
  - **Migration** (L205–320, L487): tables, triggers and grants.
  - **Tests:**
    - `tests/unit/project-authorization-routes.test.ts` L345–395: the stub assertions.
    - `tests/unit/task-routes.test.ts` and `tests/unit/tasks/task-service.test.ts`.
    - The integration tests `tasks-crud`, `task-history` and `task-integrity`.
  - **Handoffs:** `workflow/handoffs/tasks-crud-4-2.md`, `identity-access-3-2.md` and `group7-acceptance-criteria-check.md`, for ownership and carry-forwards.
- Prior human decisions and constraints, each linked to its source path:
  - **Ownership:** 4.3 owns lifecycle writes and state conflicts (`design.md` "Feature ownership" L345 before the edit; `tasks.md` L33).
  - **Who may make each transition** (`design.md` "Task-state route"; `identity-and-access/spec.md` L104–109):
    - The assignee may move To Do → In Progress and In Progress → In Review.
    - The PM may move In Review → Done and In Review → In Progress.
  - **Invalid transitions:** the response is deferred to 4.3 (`identity-and-access/spec.md` L140–143).
  - **Origin/CSRF check:** must be added before the first mutating handler (`workflow/handoffs/identity-access-3-2.md` L293).
  - **Version guard:** `WHERE version = $n`, returning 409 `VERSION_CONFLICT` (T6). Check order: T8. Edit, reassign and delete are allowed in every state, and 4.3 may restrict that (T11).
  - **Task events:** append-only, with the four types and non-blank feedback (D-F).
  - **Check matching:** a submission references a check only when the anchor SHA and the criteria hash match (`design.md` L144; `completion-assessment/spec.md` L173–182). 4.3 owns this matching (`group7-acceptance-criteria-check.md` L693).
  - **Checks never change state:** "AI check does not decide task completion" (completion-assessment spec).
  - **Missing version:** the detail GET has no `version`, and the open question is at `design.md` L330 before the edit.
  - **Network calls:** no transaction may stay open across a network call (`AGENTS.md`, AI execution module paragraph).
  - **Starting point:** start 4.3 from 4.2's merge, and remove the duplicate state map (`tasks-crud-4-2.md` L56, L598).
- Candidate files / modules likely to need changes and rationale (candidates only; the orchestrator confirms write scope):
  - **Existing files:**
    - `src/server/auth/project-authorization.ts`: replace the stub with a thin hand-off and remove the duplicate state map.
    - `.../tasks/[taskId]/state/route.ts`.
    - `src/server/repositories/task-access-repository.ts`.
    - `src/server/tasks/{service,repository,handlers,types,errors,validation,index}.ts`.
    - `src/server/composition.ts`.
    - `src/server/task-detail/{read-service,read-repository}.ts` (`version`).
    - `src/server/completion-assessment/{service,index}.ts` (the tip lookup; Developer A's module).
    - `tests/unit/project-authorization-routes.test.ts` L345–395.
  - **New files:**
    - `tests/unit/tasks/task-lifecycle-service.test.ts`
    - `tests/unit/task-lifecycle-routes.test.ts`
    - `tests/integration/db/task-lifecycle.test.ts`, which needs `TEST_DATABASE_URL`
    - `.../tasks/[taskId]/progress-updates/route.ts`
  - **No migration.** The analyst did not decide which module holds the lifecycle code (this handoff's Q2).
- Dependencies, conflicts, and open product/design decisions:
  - **Open decisions 1–8, all approved as recommended by thegrimbee on 2026-11-07** and recorded as L1–L8 in `design.md`:
    1. The state body is `{state, version}` and uses the T6 guard. `version` is added to the detail read.
    2. Keep the stub's 403 matrix and add no new error code.
    3. Request-changes uses the same route, with `feedback` required only for In Review → In Progress. The 1–5,000 limit was set by the human.
    4. `POST .../progress-updates` with `{body}` returns 201. Assignee only, no version guard. The 1–2,000 limit and "any non-deleted state" were set by the human.
    5. Look up the tip before the transaction and recheck it inside. Submit with no reference if anything fails, and zero commits are allowed. Developer A agreed, as confirmed by the human.
    6. One event per transition.
    7. Return 200 with `TaskView`.
    8. T11 stays unchanged.
  - **Conflicts between sources**, resolved by the main session under the human's delegation and recorded in `design.md`:
    - The stub's 403 matrix against the deferred spec: the 403 matrix becomes the real response.
    - The Origin list was missing the state route: the state and progress-updates routes are added.
    - `version` was missing from the detail read: added (L1).
    - `status` against `state` naming: carried forward to 4.4.
    - The 501 tests: superseded by 4.3.
    - The duplicate state map: one copy, exported from `src/server/tasks/index.ts`.
    - Developer A's ownership: Developer A agreed.
  - **Placed with some inference in run 2**, flagged to the human and listed in `logs/2026-11-07-task-4.3-analysis.md`:
    - feedback is checked before the version;
    - a stale version returns 403 when the actor is no longer allowed;
    - a progress post that loses a race with reassignment returns 403;
    - start and approve events also record the actor and from/to status;
    - path rules stay as a case where the lookup is unavailable;
    - which module holds the lifecycle code is unrecorded.
- Requirement IDs and acceptance examples: none exist and none were constructed. The acceptance examples are the WHEN/THEN scenarios in the committed spec deltas (`365a817`).
- OpenSpec files changed: run 1 changed none. Run 2 changed the five files under "Files changed", in `365a817`.

### Session `orchestrator / 4-3-plan`

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code subagent, `orchestrator` role, session model surfaced as Opus 5.5 (`claude-opus-5-5`). Config `.claude/agents/orchestrator.md` blob `cd30757`: model `opus`, effort `medium`, maxTurns 50.
- Role: orchestrator (planning only)
- Human owner and assigned task scope: Developer B (thegrimbee). Fill in this handoff's plan sections for task 4.3. This handoff is the only file written.
- Source revision: `d5fc31a`
- Started / ended / elapsed: not available
- Resource usage (provider-reported): not available
- Unavailable resource metrics: tokens in/out/total, cache read/write, cost, and tool-call count. None are surfaced to this subagent. The main session can backfill them from the transcript.
- Work completed / findings: Read the role contract, the template, the analysis log, commit `365a817` (design.md and tasks.md diffs, and the requirement headings of the three spec deltas), the human's experiment notes, the agent configs, and the 4.1 handoff format. Inspected the repository layout at `d5fc31a`. Wrote the plan below. Found Q1–Q11.
- Files changed: `workflow/handoffs/tasks-lifecycle-4-3.md` (created; it did not exist)
- Checks run and exact results: none
- Gaps / blockers: Q1–Q11 were raised. All are now resolved (see "Decisions and open questions").

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:

  **Dispatcher.**
  - The main session dispatches every subagent with `Agent` and sends fix rounds and resumes with `SendMessage`.
  - Subagents do not spawn subagents. Spawn depth is 1 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`), which keeps every human gate in the main session the human watches.
  - Every human gate stays in the main session.
  - The main session runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. The human runs `npm run test:integration` by hand, because it needs `TEST_DATABASE_URL`, as in 4.2.

  **Model and reasoning effort per role.**
  - These are the configs in `.claude/agents/*.md` at `d5fc31a`.
  - The configs must not change during 4.3, so the X2 comparison has no confound. R-high gets high effort through a per-run override, not a config change (Q5).
  - The main session records in each session block the resolved model ID from the transcript (`sonnet` and `opus` are aliases), plus the effort and maxTurns actually used.

  | Role | Model / effort / maxTurns (blob) | Planned for 4.3 | Reason from this task's scope and risk |
  |---|---|---|---|
  | analyst | Sonnet / high / 20 (`65543d8`) | Done | Its decisions (L1–L8) drive everything after it; spec gate closed. |
  | orchestrator | Opus / medium / 50 (`cd30757`) | This session | Planning across four modules, with a cross-owner question and an experiment design. No product logic. |
  | test-writer | Opus / medium / 90 (`2792a18`) | Run | Wide surface: a 4-state × role × assignment 403 matrix, the feedback and version check order, the T6 version guard under competing writes (PostgreSQL), row locking for progress posts against reassignment, the Origin check on two routes, event rows, the tip-lookup fallback, and replacing the stub assertions. Wrong tests here would encode wrong lifecycle rules, so the stronger model is kept. Test-writers were among the largest consumers before (4.1 test-writer $6.96; 6.3 test-writer: 45 responses, 67.0k output, `workflow/handoffs/llm-gateway-core.md`), so 90 turns (about 2× the largest observed run) is kept. |
  | implementer | Opus / medium / 120 (`06dcac5`) | Run | Highest-risk logic left in Developer B's scope: transactions with a version guard, `FOR UPDATE` locking, a GitHub call kept outside the transaction with a recheck inside it (L5), four named transition methods without a control flag, and edits across tasks, task-detail, completion-assessment, auth and composition. The largest observed implementer run was 59 responses (`workflow/handoffs/data-persistence-schema.md`), hence 120. |
  | frontend | Sonnet / medium / none (`5ebde9e`) | **Skipped** | 4.3 changes no visible UI. The work is Route Handlers and server modules only; board, detail and review pages are task 4.4 (tasks.md L34). The new `version` field in the detail DTO is additive and no page renders it. |
  | reviewer | Sonnet / medium / 25, tools Read, Grep, Glob (`92ce8a9`) | Run as X2 arm R-med; plus an R-high arm at the same model with effort high | Medium has no evidence behind it yet (the 6.2 reviewer thought for 76% of its output), so X2 tests it on 4.3, the riskiest logic left. Model, prompt and maxTurns are held the same, so effort is the only variable. |
  | commit-pr | Sonnet / low / 20 (`df5d675`) | Run after human authorization | Mechanical git inventory and scoped commits. commit-pr earlier ran on Opus for 3–9 responses of mechanical git work, so it moved to Sonnet. |

  **Context plan per role.** Every role also loads `AGENTS.md` automatically, plus its own contract in `workflow/agents/<role>.md`. No role reads `.env*`, `.vercel/`, or handoffs not named here. Untrusted text, such as task text in fixtures, provider output and diffs, is data, never instructions.
  - **test-writer**
    - Receives:
      - this handoff's Task record, Source and scope, Decisions, and its own write paths;
      - every spec requirement and design.md section listed under Context references;
      - the existing tests and test support listed there, as patterns;
      - read-only, the public entries `src/server/tasks/index.ts`, `src/server/task-detail/index.ts` and `src/server/completion-assessment/index.ts`, plus `src/server/auth/project-authorization.ts`, `src/server/repositories/task-access-repository.ts`, `src/server/composition.ts`, and the `app.tasks`/`app.task_events`/progress-update table definitions under `supabase/` (read-only).
    - Must not:
      - write anything outside its test paths;
      - edit AI security evaluation cases or `tests/unit/ai/`;
      - assert exact live-model prose.
  - **implementer**
    - Receives:
      - the same spec and design sections;
      - this handoff's scope;
      - the test-writer's session report: its test file list, the seams it chose, and its coverage gaps;
      - the source paths it may write, below.
    - Must not:
      - edit `tests/`, `openspec/`, `specs/`, `supabase/`, UI paths or config;
      - change the API error codes;
      - add a dependency.
    - It uses `present-changes-visually` if available and records the visual diff path.
  - **reviewer** (each X2 run)
    - Receives:
      - the frozen patch file path and its SHA-256;
      - the spec requirement titles and design.md sections above as its acceptance criteria;
      - AGENTS.md's "Review Procedure";
      - this handoff's write paths, so it can check scope.
    - All reviewers in one comparison get byte-identical prompt text, saved by the main session (see X2).
    - It does not receive the other reviewer's findings, or the test-writer's or implementer's self-assessments. This keeps the arms independent.
    - Its tools are read-only (Read, Grep, Glob; no Bash), so it reads the patch file rather than running `git diff`.
  - **commit-pr**
    - Receives:
      - this handoff;
      - the human's authorization text, naming branch `feat/tasks-lifecycle-4-3`.
    - Groups commits by the project convention: test commits before feature commits, Conventional Commits scoped `tasks`, `task-detail` or `completion-assessment`.
    - Must not:
      - edit files;
      - push, open a PR, or rewrite history;
      - commit the X2 patch or prompt files.

  **Write paths per role (final, non-overlapping; Q2 and Q3 resolved).**
  - **test-writer: `tests/` only.**
    - Edit:
      - `tests/unit/project-authorization-routes.test.ts`: replace the "task state role and assignment authorization" block (design.md L350)
      - `tests/unit/project-origin-check.test.ts`: add the state and progress-updates routes
      - `tests/unit/task-detail-read.test.ts`: `version` in the DTO (Q3)
      - `tests/unit/tasks/task-service.test.ts`
      - `tests/unit/task-routes.test.ts`
      - `tests/unit/support/sql-fake.ts`: only if the fake needs lock or event support
      - `tests/integration/db/tasks-crud.test.ts` or `tests/integration/db/task-history.test.ts`
      - `tests/integration/db/support/`
    - Create, with names the test-writer chooses and reports:
      - lifecycle service and route tests under `tests/unit/tasks/` or `tests/unit/`
      - a progress-update route test
      - tip-lookup tests under `tests/unit/completion-assessment/` (Q3)
      - a PostgreSQL competing-write and lock test under `tests/integration/db/`
  - **implementer: `src/server/` and two route files only.**
    - `src/server/tasks/`: `service.ts`, `repository.ts`, `handlers.ts`, `validation.ts`, `types.ts`, `errors.ts`, `index.ts`. This adds the lifecycle and progress-update code and the single exported state map (Q2).
    - `src/server/auth/project-authorization.ts`: remove `handleTaskStateStub` and the duplicate `STATE_TO_STORAGE`.
    - `src/server/repositories/task-access-repository.ts`: only if the transition needs a different access read.
    - `src/server/task-detail/read-repository.ts`, `read-service.ts`, `index.ts`: add `version` (Q3).
    - `src/server/completion-assessment/`: one new file for the tip lookup, plus `index.ts` (Q3).
    - `src/server/composition.ts`: wiring.
    - `src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route.ts`: replace the stub.
    - `src/app/api/v1/projects/[projectId]/tasks/[taskId]/progress-updates/route.ts`: new file.
    - Anything else, including `src/server/projects/request-guard.ts`, `src/server/github*` and `supabase/`, means stop and report.
  - **reviewer:** none (read-only by tools).
  - **commit-pr:** none (git only, once authorized).
  - **orchestrator:** this handoff only.
  - **main session:** the frozen patch files and prompt files in its scratchpad directory, outside the repository (Q8), and the session log in `logs/`.

  **Parallelism plan.**
  - **Sequential, in the primary checkout:**
    1. test-writer
    2. main session runs `npm test` (new tests are expected to fail) and `npm run typecheck`
    3. implementer
    4. main session checks, plus the human's integration run
    5. freeze the diff
    6. X2 round 1
    7. human resolves findings
    8. fix round
    9. freeze the fixed diff
    10. X2 re-review
    11. commit-pr after authorization
  - **Why the test-writer and implementer are not concurrent:**
    - Their paths are disjoint (`tests/` against `src/`), so concurrency would be safe for writes.
    - But the service seams (method signatures for start, submit, approve, requestChanges and the progress post, and the tip-lookup function's name and shape) are not fixed by the spec. They come from the test-writer.
    - Running both at once would leave the implementer guessing those seams. That is an unrecorded decision, which AGENTS.md forbids.
    - 4.1 used the same sequential order. If the human prefers concurrency anyway, the 4.1 manual-worktree commands apply (`workflow/handoffs/projects-membership-4-1.md`, "Parallelism plan" alternative 3). Do not use `isolation: worktree`, which branches from `master`.
  - **What can run concurrently:**
    - The two round-1 reviewers (R-med and R-high), which are read-only on one frozen patch.
    - The two re-reviewers (resumed and fresh), on the second frozen patch.
  - **Fix routing:**
    - Implementation findings go to the original implementer via `SendMessage`. Test-gap findings go to the original test-writer.
    - If both kinds exist, the test-writer goes first, then the implementer, because the implementer must make the new tests pass. They are never concurrent on one finding set.

  **Loop limit.**
  - At most 2 reviewer → fixer rounds. Round 1 ends with the X2 re-review below; round 2 ends with a single re-review by R-med (Q10).
  - If must-fix findings remain after round 2, the main session stops and escalates to thegrimbee with the outstanding findings. A third round is never sent on its own initiative.
  - A fix round starts only after the human has resolved the findings (AGENTS.md step 7). Neither the reviewer's output nor the implementer's reply is approval.

  **Reviewer plan (experiment X2).** This task runs experiment X2.
  - **Questions.**
    1. Is the reviewer's configured medium effort enough, compared with high effort, on the same diff?
    2. For a fix-round re-review, is resuming the original reviewer as good as launching a fresh one?
  - **Why 4.3.** It holds the riskiest logic left: the lifecycle, request-changes and competing writes. Reviewer runs are cheap (3–10 responses), so X2 adds about three runs. A fresh re-reviewer's result was never recorded in 6.3; X2 measures it properly.
  - **Freezing round 1.** After the implementer's checks pass, and before any reviewer starts, the main session:
    1. records `git rev-parse HEAD` (expected `d5fc31a`, since nothing is committed before review);
    2. writes one patch with every tracked change and every untracked file against that base (`git diff --binary HEAD` plus `git diff --no-index /dev/null <file>` for each path from `git ls-files --others --exclude-standard`), saved as `review-1.patch` in the main session's scratchpad directory, outside the repository;
    3. records the patch's SHA-256 in this handoff;
    4. makes no edits to the working tree until both round-1 reviewers have finished.

    A commit SHA is not used to freeze, because committing before review would need commit-pr authorization and would reverse the review-then-commit order.
  - **Round 1 (two independent reviewers, same frozen patch):**
    - R-med: the `reviewer` config as-is (Sonnet / medium / 25).
    - R-high: the same agent, model, prompt, tools and maxTurns, launched with the `Agent` tool's per-run `effort: "high"` override. thegrimbee asked for this explicitly, and `.claude/agents/reviewer.md` stays unchanged (Q5).
    - Both get byte-identical prompt text, which the main session saves next to the patch. They run concurrently and never see each other's output.
  - **Classifying findings (Q6).** The main session proposes a label for every finding in the union of both reviewers' findings, with evidence (a patch line, spec scenario or test result). thegrimbee confirms the labels before any fix.
    - Real: a defect or gap confirmed against the patch, the approved spec delta, design.md or AGENTS.md.
    - False: contradicted by the patch or the spec, already handled, or outside 4.3's scope.
    - Severity uses the X1 scale: must, should or nit.
  - **Fix.** Fixes cover the confirmed real findings that thegrimbee sends for fixing, routed as described under "Fix routing".
  - **Freezing round 2.** The same procedure on the fixed working tree gives `review-2.patch` and its SHA-256, on the same base.
  - **Re-review (two arms, same fixed patch; Q7):**
    - R-resumed: `SendMessage` to R-med. Medium is the effort under question and the configured default, so the resumed arm tests the setting actually in use.
    - R-fresh: a new `reviewer` launch with R-med's configuration (medium), so resumed against fresh is the only variable.
    - Both get the same instruction text, the fixed patch path and SHA-256, and the confirmed round-1 finding list with each finding's resolution. R-resumed already has the history; giving R-fresh the list keeps the task equal (check the fixes, then look for regressions) instead of a cold review.
  - **If round 1 sends nothing for fixing (Q9).** The re-review arms are not run, and they are recorded as "not run: no fixes" in the X2 results.
  - **What is measured, per run:**
    1. findings, each classified real or false;
    2. thinking tokens;
    3. output tokens;
    4. cache reads.

    Token figures come from the subagent transcripts (`output_tokens_details.thinking_tokens`, `output_tokens`, `cache_read_input_tokens`), de-duplicated by message ID as in X1. They are reported as raw counts only, without notional pricing (Q11). Any other figure the main session records is labelled as outside X2.
  - **Comparisons:**
    - R-med against R-high on `review-1.patch`.
    - R-resumed against R-fresh on `review-2.patch`.
  - **Where the results go (Q8):**
    - The patches and prompt files are working artifacts. They are not committed; each one's SHA-256 is recorded here.
    - Each run gets its own `reviewer / <session-id>` block in this handoff, with the resolved model, effort, patch name and SHA-256, findings with labels, and the four measures.
    - An "X2 results" section is added to this handoff after the last X2 run, with the two comparisons side by side.
  - **A second fix round (Q10).** If confirmed must-fix findings remain after the first re-review, the second re-review is a single run: `SendMessage` to R-med again, on a third frozen patch (`review-3.patch`). It is not an X2 measure and is labelled as outside X2.

- Consolidation notes: This handoff was created by this session; the file did not exist before. No worker reports exist yet. The main session appends one session block per worker run, including each X2 reviewer run, and then asks the orchestrator to consolidate.

## Change log `[ORCH]`

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-11-07 19:43 | orchestrator / 4-3-plan | Created the handoff and filled in the plan sections: task record, scope, context references, model and effort per role (frontend skipped), context plan, write paths, sequential order, loop limit of 2, depth-1 dispatch, and the X2 reviewer plan with frozen-patch procedure. Raised Q1–Q11. |
| 2026-11-07 | main session (under thegrimbee's delegation) | Resolved Q2–Q11: lifecycle code in `src/server/tasks/`; the 4.3 agents write Developer A's two changes, cross-reviewed by Lim-ZY; no separate security pass; R-high through a per-run effort override; main session proposes finding labels and thegrimbee confirms them; R-med is resumed; R-fresh gets the confirmed finding list; re-review skipped if nothing is fixed; patches are not committed; X2 results recorded in this handoff; raw token counts only. Rewrote the X2 plan to state the experiment directly. |
| 2026-11-07 | main session (commit order, thegrimbee's decision) | thegrimbee chose to commit before the X2 review. commit-pr created `cfe1edf`..`1808789` (3 test commits, then 3 feature commits) on `feat/tasks-lifecycle-4-3`, not pushed. X2's `review-1.patch` is therefore frozen as `git diff d5fc31a 1808789`, and fixes from review land as follow-up commits. The integration fixture fix (random per-row `path_rules_hash`) is included but not yet re-run by the human. |
| 2026-11-07 | main session (for analyst / 4-3-analysis) | Backfilled the analyst session block from the main-session transcript, as Q1 asked. The block records the brief, paths, prior decisions, candidate edits, approved decisions 1–8, conflict resolutions and harness-reported usage. |
