# Task CRUD: task 4.2 handoff

## Task record `[ORCH]`

- Task ID: `tasks-crud-4-2` (OpenSpec task 4.2)
- Summary: 4.2. Implement task create, read, edit, reassign and soft delete with acceptance criteria and task IDs. Replace the task create, read and edit stubs. Add API authorization tests, plus tests for missing criteria, assignees outside the project, and task IDs that are never reused (`openspec/changes/project-task-management/tasks.md:43`).
- Change: `project-task-management`
- Branch: `feat/tasks-crud-4-2`
- Human owner (Developer A / Developer B): Developer B (thegrimbee). Lim-ZY cross-reviews the `src/server/auth/project-authorization.ts` change (T16).
- Date: 2026-11-07
- Requirement IDs: None. No formal IDs exist and none are constructed. Requirements are cited by name:
  - task-management:
    - "Product manager manages tasks", every scenario.
    - "Task management routes".
    - "Projects and tasks have readable IDs": the "Task receives an ID", "Deleted task number is not reused", "Concurrent task creation receives distinct IDs" and "Refused creation does not use a task number" scenarios.
  - identity-and-access:
    - "Protected route authorization stubs": the "Task creation is functional", "Task read is functional" and "Task field edit is functional" scenarios, and the safe-error scenarios as they apply to the task routes.
    - "Mutating project routes check the request origin", for the four task mutation routes.
    - "Protected API errors use stable safe responses".
  - data-persistence: "Identifiers, timestamps, and revisions": the "Concurrent edits to a task" and "Concurrent task creation" scenarios.
- Status: Implemented (TDD: red, then green). Unit and PostgreSQL integration tests pass. U1–U13 are approved and recorded in `design.md`. The commit-pr agent is authorized to commit on `feat/tasks-crud-4-2` (order: openspec, tests, feat, workflow/handoff) and draft the PR against `dev`; no push, no PR.
- Next human action: thegrimbee reviews the commits and the PR draft, then separately authorizes any push or PR creation. Still to run: `/security-review`, the X1 yardstick reviewer, and Lim-ZY's cross-review of `src/server/auth/project-authorization.ts`.

## Source and scope `[ORCH]`

- Repository / branch / worktree: `CS3227-2610-MP4`, branch `feat/tasks-crud-4-2`, primary checkout `D:/Education/CS3227/CS3227-2610-MP4`. There are no worktrees: one main session does all the work.
- Source revision: `03f750c` (HEAD of `feat/tasks-crud-4-2`, a merge of `dev` that includes task 4.1, PR #20, and Group 7, PR #22). The spec, design and handoff edits from this session are uncommitted on top.
- **Workflow deviation (deliberate, X1 single-agent arm).** On 2026-11-07 thegrimbee chose to run 4.2 entirely in the main session. No analyst, orchestrator, test-writer, implementer or pipeline reviewer subagent is used. The main session did the analyst's work and wrote this handoff, which is normally the orchestrator's file. The only subagents planned are the commit-pr agent and the X1 yardstick reviewer, both at the end. The AGENTS.md roles still apply as stages: tests come first (TDD), then implementation. Human gates stay in place.
- Permitted paths and actions (main session):
  - New: `src/server/tasks/index.ts`, `service.ts`, `repository.ts`, `types.ts`, `errors.ts`, `validation.ts`, `handlers.ts` (T16).
  - New: `src/app/api/v1/projects/[projectId]/tasks/[taskId]/assignee/route.ts` (T1).
  - Edit: `src/app/api/v1/projects/[projectId]/tasks/[taskId]/route.ts`. Add a `DELETE` export only if the GET and PATCH stub names change.
  - Edit: `src/server/auth/project-authorization.ts`. Replace `handleTaskCreationStub`, `handleTaskReadStub` and `handleTaskEditStub` in place with thin calls into `@/server/tasks` (T16). Remove helpers that are left unused. Leave `handleTaskStateStub` and its behaviour unchanged.
  - Edit: `src/server/projects/index.ts`, adding exactly one export, `refuseUnsafeMutation` (T14).
  - Edit: `src/server/composition.ts`, adding one field, `taskService` (T16).
  - Tests: see "Main session plan", test targets.
  - Docs: this handoff, and one `logs/` summary for this chat session.
- Prohibited paths and actions:
  - Do not edit OpenSpec (`openspec/**`) again without a new human approval.
  - Do not edit `specs/ui-spec.md` or add UI; task 4.4 owns pages.
  - Do not add a migration or edit `supabase/migrations/**`.
  - Do not add a task listing route (T1).
  - Do not edit the state route (`src/app/api/v1/projects/[projectId]/tasks/[taskId]/state/route.ts`), `handleTaskStateStub` or `src/server/repositories/task-access-repository.ts`; task 4.3 owns them.
  - Do not edit `src/server/completion-assessment/**`, `src/server/github-evidence/**`, `src/server/github-repository-link/**`, `src/server/ai/**`, the attached-commits and github-evidence routes, or the task-detail host page `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`. Do not add `checkHistory` (C1).
  - Do not edit other `src/server/projects/*` files, `src/server/auth/request-access.ts` or `src/server/auth/index.ts`. Do not change existing `@/server/auth/*` imports elsewhere.
  - Do not edit `.env*`, `package.json` or `package-lock.json`. No new dependencies.
  - Do not edit `tests/integration/db/support/**` or other existing integration tests.
  - Do not touch AI security evaluation paths (Developer A).
  - Do not commit, push or open a PR. Do not run git rebase or reset.
- Dependencies and parallel work:
  - Upstream: tasks 3.2 and 4.1 are complete and merged to `dev`.
  - Task 4.3 will edit the same task routes, `project-authorization.ts` and the tasks module. It should start from 4.2's merge.
  - Task 7.3 (Developer A) adds `checkHistory` to the task read built here (C1).
  - Task 8.2 treats deletion time as report activity (T12).

## Context references `[ALL, when relevant]`

- Requirements:
  - `openspec/changes/project-task-management/specs/task-management/spec.md`: "Projects and tasks have readable IDs", "Product manager manages tasks" and "Task management routes".
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md`: "Protected route authorization stubs", "Protected API errors use stable safe responses" and "Mutating project routes check the request origin".
  - `openspec/changes/project-task-management/specs/data-persistence/spec.md:19-29`.
- Decisions in `openspec/changes/project-task-management/design.md`:
  - "Task Management Decisions (4.2)" (T1–T17, C1).
  - "Data Persistence Decisions": D-D, D-E, D-F, and the Task 2.4 review decisions.
  - "Project and Membership Decisions": D8, Q2, Q4, Q5, R1, R7 and R8.
  - "API Error Contract".
- Schema (read-only): `supabase/migrations/20261030144500_create_app_schema.sql`:
  - `bump_version` at L41-50, and the triggers at L407-441.
  - The assignee trigger (SQLSTATE `23503`, constraint `tasks_assignee_is_project_developer`) at L102-125.
  - `tasks` at L213-233, `acceptance_criteria` at L240-252 and `task_events` at L280-306.
  - Grants: no DELETE on tasks, and only SELECT and INSERT on `task_events`, at L483-487.
- Code to change or reuse:
  - `src/server/auth/project-authorization.ts:131-170` (task stubs).
  - `src/server/projects/` (module layout, `handlers.ts` flow, `request-guard.ts`, `errors.ts`, `validation.ts`, the `repository.ts` transaction pattern).
  - `src/server/auth/request-access.ts` (`resolveProjectAccess`).
  - `src/server/composition.ts`.
- Tests to change or reuse:
  - `tests/unit/project-authorization-routes.test.ts`: the task-stub 501 assertions, and its regex `pg` fake, which throws on writes.
  - `tests/unit/project-routes.test.ts:55-532` and `tests/unit/projects/project-service.test.ts:53-530`: the copied SQL fake (T17).
  - `tests/integration/db/support/fixtures.ts`: `createProjectWithTeam`, `createTask`, `allocateTaskNumber`, `addMembership`.
  - `tests/integration/db/projects-membership.test.ts`, the 4.1 integration test pattern.
- Prior handoff: `workflow/handoffs/projects-membership-4-1.md`. Its A1 and A2 shape is reused below. It also holds the X1 yardstick prompt and the reviewer blob `92ce8a9963b5bb086e60a0921fdf85fff7795fa7`, which matches `.claude/agents/reviewer.md` at `03f750c`.

## Decisions and open questions `[ORCH]`

- Current state: requirements and decisions were approved on 2026-11-07 and are recorded in the working tree, not committed. `npx openspec validate project-task-management --strict` reports the change "has issues": 6 warnings for requirement text over 500 characters. All 6 are in requirements written before 4.2, and the baseline at `03f750c` gives the same 6. None come from the 4.2 delta.
- Human-approved decisions (thegrimbee, 2026-11-07):
  - The spec delta: accepted as drafted. While writing it, the main session split the route list out of "Product manager manages tasks" into a new requirement, "Task management routes", and added its two scenarios ("Task responses are not cached" and "Task in another project is concealed"). This avoids a new over-length warning; it covers the routes and `no-store` rule in the approved draft and adds no new behaviour. Human review of the split is pending.
  - T1–T17: all accepted as recommended. Verdict counts: **accepted 17, modified 0, rejected 0**. They are recorded in `design.md` "Task Management Decisions (4.2)".
  - C1: delegated to the agent ("choose an alternative which you think would be best"). The agent chose (c): no `checkHistory` in 4.2, and task 7.3 adds it. This is recorded in `design.md` as C1. It is not counted in the accepted, modified or rejected totals because the human made no verdict on the option itself.
  - New error codes, added to the "API Error Contract": 400 `ACCEPTANCE_CRITERIA_REQUIRED`, 409 `ASSIGNEE_NOT_DEVELOPER`, 409 `VERSION_CONFLICT`.
- Assumptions (identify unapproved assumptions):
  - A-1: the unit route tests run the real handlers with `pg` and Supabase mocked, as in 4.1. Locking and concurrency are verified only by the PostgreSQL integration tests (R7).
  - A-2: the new `tests/unit/task-routes.test.ts` uses the shared SQL fake (T17) rather than the regex fake in `project-authorization-routes.test.ts`. That file keeps its fake and changes only its task create, read and edit assertions.
- Open questions / conflicts:
  - C1 follow-up for task 7.3: whether an unassigned developer's task read has no `checkHistory` field or an empty list.
  - Lim-ZY cross-review of the `project-authorization.ts` change before merge.

## Main session plan

The single-agent equivalent of the 4.1 A1 (implementer) and A2 (test-writer) assignments. The main session runs A2 first, then A1 (TDD). After writing the tests it confirms they fail for the right reason, then implements until they pass. It does not weaken a test to make it pass. If a test proves to contradict the spec, it stops and reports.

**A2: tests (main session, first)**

- Scope: tests for every requirement scenario listed under Requirement IDs, written from the specs, `design.md` and this handoff.
- May edit:
  - `tests/unit/project-authorization-routes.test.ts`: replace the task create, read and edit 501 assertions with the approved behaviour or remove them. Keep every task-state stub assertion.
  - `tests/unit/project-routes.test.ts` and `tests/unit/projects/project-service.test.ts`: only to import the shared fake (T17). No assertion changes.
- May create:
  - `tests/unit/support/sql-fake.ts`: the extracted evaluator, extended for `tasks`, `acceptance_criteria` and `task_events` columns and the statement forms 4.2 needs. It still throws on anything unsupported (R7).
  - `tests/unit/task-routes.test.ts`: route tests for all five routes.
  - `tests/unit/tasks/task-service.test.ts`: validation and service unit tests.
  - `tests/integration/db/tasks-crud.test.ts`: PostgreSQL tests through `TaskService` with `runtimePool`.
- Test targets:
  - T1 and T3:
    - Each route's success status: 201, 200, 200, 200, 204.
    - The exact task view fields. `taskKey` is `<KEY>-<n>`, `state` is `To Do`, criteria come in position order, timestamps are ISO 8601 UTC, and `dueDate` is `YYYY-MM-DD`.
    - DELETE has an empty body.
    - Every response sends `Cache-Control: no-store`.
  - T2 and T5, each failure giving 400 `INVALID_REQUEST` and no write:
    - an unknown field, and each wrong type;
    - title: blank after trim, 201 code points, contains CR or LF (200 code points is accepted, and trimming applies);
    - description: blank, or 5,001 code points;
    - criteria: 21 items, an item blank after trim, an item of 501 code points;
    - `dueDate`: `2026-02-30`, `2026-1-05`, a non-string;
    - `branchName`: `""`, `a..b`, `/a`, `-a`, `a/`, `a.`, `a.lock`, `a//b`, `a b`, 256 characters (`null` and absent are accepted);
    - a non-UUID `assigneeId`;
    - `version` of 0, a string, or absent.
  - T4:
    - PATCH with only `version` gives 400.
    - `assigneeId` or `state` in a PATCH gives 400.
    - Partial edits change only the fields sent.
    - A criteria list keeps the IDs of items that send their `id`, inserts items without one, and removes criteria left out.
    - A foreign or duplicated criterion `id` gives 400.
    - A criteria-only edit bumps the version by exactly 1.
  - T6:
    - A stale `version` on PATCH, PUT and DELETE gives 409 `VERSION_CONFLICT` with the task unchanged.
    - DELETE without a `{version}` JSON body gives 400.
    - PostgreSQL: two edits racing with the same version, where exactly one succeeds.
  - T7:
    - Absent or empty criteria on create, and empty criteria on edit, give 400 `ACCEPTANCE_CRITERIA_REQUIRED`.
    - When there is also another body error, the result is `INVALID_REQUEST`.
    - An `assigneeId` that is a non-member, the PM, a member of another project only, or unknown gives 409 `ASSIGNEE_NOT_DEVELOPER` on create and reassign.
    - The trigger's `23503` error maps to the same code.
    - Codes and statuses are asserted. Messages are asserted to be non-empty and free of input (Q2). The exact text of the new codes is not asserted.
  - T8, one case per adjacent pair in the order:
    - Bad Origin with no session gives 403.
    - Bad Origin with a bad content type gives 403.
    - A bad body with no session gives 400.
    - No session gives 401 before the membership check.
    - A non-member on a PM-only route gives 404, not 403.
    - A missing, deleted or cross-project task on a PM-only route, requested by a developer, gives 404, not 403.
    - A developer gives 403.
    - A domain 409 is checked only after the role.
    - GET with a bad UUID gives 400 with no Origin check.
  - T9:
    - Reassign writes exactly one `assignment_change` event with the actor and the previous and new assignee, and leaves the state unchanged in every state.
    - Reassigning to the same assignee gives 200 with no event and no version change.
    - PostgreSQL: a reassignment to the incoming developer racing a PM transfer never leaves an open task with the new PM (D6).
  - T10: create, edit and delete write no `task_events` row.
  - T11: edit, reassign and delete succeed in every state.
  - T12 and D-E:
    - Delete sets `deleted_at` and keeps the row, criteria and events.
    - Later GET, PATCH, PUT and DELETE give 404.
    - No `app.reports` write.
  - T13 and D-D:
    - Creating after `WEB-11` gives `WEB-12`.
    - After deleting `WEB-12`, the next task is `WEB-13`.
    - A refused create (criteria, assignee, validation) does not use up a number.
    - PostgreSQL: concurrent creates get distinct numbers.
  - Authorization:
    - Unauthenticated requests give 401 on every route.
    - A non-member gets 404.
    - A developer on create, edit, reassign or delete gets 403.
    - A developer reading any task, assigned or not, gets 200.
    - Every denied request causes no write.
    - An operational lookup failure gives 500 `INTERNAL_ERROR` with no details.
- Must not edit product code, OpenSpec, migrations, `tests/integration/db/support/**` or AI security evaluation paths.
- Checks: `npm test`. Run `npm run test:integration` only if `TEST_DATABASE_URL` points to a disposable database; otherwise mark the integration tests unverified.

**A1: implementation (main session, after A2)**

- Scope: the 4.2 behaviour in the approved specs and T1–T17, inside the permitted paths above.
- Must follow:
  - T1: only the five routes; no listing route; the state route is untouched.
  - T2, T4 and T5: exact-field validation in `src/server/tasks/validation.ts`, following `src/server/projects/validation.ts`. Lengths are counted in code points after trimming.
  - T3: one task view builder used by create, read, edit and reassign. State is mapped from storage to display names.
  - T6: every update uses `WHERE version = $n`. A miss on a live task becomes `VERSION_CONFLICT`. A successful edit, including a criteria-only edit, bumps `tasks.version` exactly once.
  - T7: fixed messages, as recorded. A unique or foreign-key violation is recognised by SQLSTATE and constraint name (S6 style). Never put user input in a message.
  - T8: the Q4 order with the task lookup before the role check; reuse `refuseUnsafeMutation` and `resolveProjectAccess`.
  - T9 and T10: reassignment writes one `assignment_change` event in the same transaction. No other 4.2 path writes `task_events`.
  - T12: soft delete only (`deleted_at = now()`); never `DELETE FROM app.tasks`; no `app.reports` write.
  - T13: increment `projects.last_task_number` and insert the task and criteria in one transaction; roll back on any error.
  - T14 and T16: add one export to `@/server/projects`, one composition field, and stubs replaced in place with thin calls.
  - The service rechecks the actor's product manager role inside the transaction, with a `FOR SHARE` lock on the actor's membership, as R5 does. If no membership is found, it fails with `NOT_FOUND` (R4).
  - All SQL is parameterized. Every response sends `Cache-Control: no-store`. Follow the "API Error Contract". Hold no transaction across anything but database calls.
  - AGENTS.md coupling rules: no module-level mutable state, no control flags (separate named functions for create and edit), imports only through public entries.
- Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build` and `npm test`. Then `npm run test:integration` if a disposable database is available.
- After A1: run `/security-review` in the main session (1 fix round, as in 4.1). Then the X1 yardstick reviewer, using the 4.1 prompt with only the task-specific inputs changed, blob `92ce8a9`, against diff base `dev`. Then the commit-pr agent, only when authorized.

## Worker session reports

### Session `main session / analyst stage`

- Provider: `claude`
- Provider session ID: not available (not surfaced to the session)
- Agent: main session (analyst, planning and handoff work; X1 single-agent arm)
- Phase: requirements and planning

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (VS Code extension), `claude-opus-5-5`
- Role: main session doing the analyst and orchestrator work (deliberate deviation, see Source and scope)
- Human owner and assigned task scope: thegrimbee; the task 4.2 analysis, spec delta, decisions and handoff
- Source revision: `03f750c`
- Started / ended / elapsed: not available
- Resource usage (provider-reported): not available
- Unavailable resource metrics: tokens, cost, tool calls (to be computed afterwards from the transcripts, as was done for 4.1)
- Work completed / findings:
  - Context brief, candidate edit paths, draft spec delta, T1–T17 recommendations and the C1 conflict were presented to and approved by thegrimbee.
  - C1 was chosen by the agent at the human's request.
- Files changed:
  - `openspec/changes/project-task-management/design.md`
  - `openspec/changes/project-task-management/specs/task-management/spec.md`
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md`
  - this handoff
- Checks run and exact results: `npx openspec validate project-task-management --strict` reported "Change 'project-task-management' has issues", with 6 warnings for requirement text over 500 characters, all in requirements written before 4.2. The baseline at `03f750c` also gives 6 warnings.
- Gaps / blockers: the strict validation result above was already present and is not caused by 4.2.

#### Analyst fields `[ANALYST]`

- Exploration scope / task question: the requirements, decisions, schema, code seams and tests that 4.2 depends on; the unrecorded decisions.
- Compressed repository-context brief: given in chat on 2026-11-07. Its essentials are in Context references above and in `design.md` "Task Management Decisions (4.2)".
- Candidate files / modules likely to need changes: see Permitted paths.
- Dependencies, conflicts, and open product/design decisions: C1 (resolved by the agent, as delegated); T1–T17 (approved).
- Requirement IDs and acceptance examples: see Task record. The spec scenarios are the acceptance examples.
- OpenSpec files changed: `design.md`, `specs/task-management/spec.md`, `specs/identity-and-access/spec.md`.

### Session `main session / test and implementation stage`

- Provider: `claude`
- Provider session ID: not available (not surfaced to the session)
- Agent: main session (test-writer, then implementer; X1 single-agent arm)
- Phase: TDD (A2, then A1)

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (VS Code extension), `claude-opus-5-5`
- Role: main session doing the A2 and A1 work (deliberate deviation, see Source and scope)
- Human owner and assigned task scope: thegrimbee; the "Main session plan" A2 and A1
- Source revision: `03f750c` plus the uncommitted analyst-stage edits
- Started / ended / elapsed: not available
- Resource usage (provider-reported): not available
- Unavailable resource metrics: tokens, cost, tool calls (to be computed afterwards from the transcripts)
- Work completed / findings: A2 tests were written first and confirmed red. A1 was then implemented until green, with no test weakened after the red run. The decisions made along the way are listed as U1–U13 under "Consolidated outcome".
- Files changed: see "Consolidated outcome".
- Checks run and exact results (PowerShell, at `03f750c` plus the working tree):
  - **Red** (`npm test`, after A2 and before A1): `Test Files 2 failed | 24 passed (26)`, `Tests 190 failed | 1164 passed (1354)`.
    - `tests/unit/tasks/task-service.test.ts` failed to load: `Cannot find package '@/server/tasks'`.
    - In `tests/unit/task-routes.test.ts`, 190 of 226 tests failed. The 36 that passed were denial cases the 3.2 stubs already gave (401, 403 and 404), and routes the stubs did not have yet failed with "Cannot find module .../assignee/route" and "DELETE is not a function".
    - The extracted fake left the 4.1 files green: `npx vitest run tests/unit/project-routes.test.ts tests/unit/projects/project-service.test.ts` gave 2 files and 199 tests passed, before any 4.2 test existed.
  - **Green** (after A1):
    - `npm test`: `Test Files 26 passed (26)`, `Tests 1443 passed (1443)`.
    - `npm run lint`: no output (pass).
    - `npx tsc --noEmit`: exit 0.
    - `npm run build`: exit 0, with the new route `/api/v1/projects/[projectId]/tasks/[taskId]/assignee` listed. `next-env.d.ts` was rewritten by the build and reverted with `git checkout -- next-env.d.ts`.
    - `npm run test:integration -- tests/integration/db/tasks-crud.test.ts`: `Test Files 1 skipped (1)`, `Tests 13 skipped (13)`. `TEST_DATABASE_URL` is not set, so these are **unverified**.
    - **Integration, run by thegrimbee** on 2026-11-07 at 14:46 SGT against a disposable database (`npm run test:integration`, full suite): `Test Files 16 passed (16)`, `Tests 305 passed (305)`, duration 18.51s. This includes the 13 tests in `tests/integration/db/tasks-crud.test.ts`. Result reported by the human; the main session did not see the run.
- Gaps / blockers: none.

#### Test-writer fields `[TEST-WRITER]`

- Test files changed:
  - New: `tests/unit/support/sql-fake.ts` (T17), `tests/unit/task-routes.test.ts`, `tests/unit/tasks/task-service.test.ts` and `tests/integration/db/tasks-crud.test.ts`.
  - Edited `tests/unit/project-routes.test.ts` and `tests/unit/projects/project-service.test.ts`: import the shared fake only; assertions unchanged.
  - Edited `tests/unit/project-authorization-routes.test.ts`: see U11.
- Scenarios and requirement IDs covered: every A2 test target in the "Main session plan", with these exceptions:
  - The D6 race, concurrent creation and concurrent edits are covered only by the PostgreSQL file (passed in thegrimbee's integration run).
  - Concurrent edits also have a unit test that simulates the competing write.
- Coverage gaps:
  - No unit test models locks (R7).
  - The PostgreSQL file has not been run.

#### Implementer fields `[IMPLEMENTER]`

- Implementation files and rationale: see "Consolidated outcome".
- Visual diff path, or reason skill was unavailable: the `present-changes-visually` skill is not available in this session.
- Other generated artifacts / dependencies: none. No dependency added.

## Consolidated outcome `[ORCH]`

- Changed files and rationale:
  - `src/server/tasks/` (new module, T16):
    - `types.ts`: view and input types, and `ParseResult`.
    - `errors.ts`: `TaskError` and `taskErrorResponse`, with the T7 codes and fixed messages.
    - `validation.ts`: the T2, T4, T5 and T6 body rules.
    - `repository.ts`: `TaskRepository` and `TaskTransaction`. All SQL is parameterized. Soft delete is an `UPDATE`.
    - `service.ts`: `TaskService` covering create, get, edit, reassign and delete, with the version guard, the role recheck and the `assignment_change` event.
    - `handlers.ts`: the T8 check order.
    - `index.ts`: the public entry.
  - `src/server/projects/index.ts`: one added export, `refuseUnsafeMutation` (T14).
  - `src/server/composition.ts`: one new field, `taskService` (T16).
  - `src/server/auth/project-authorization.ts`:
    - The create, read and edit stubs are replaced in place with thin calls into `@/server/tasks`.
    - The now-unused `projectIdFrom` and `hasJsonObjectBody` are removed.
    - `handleTaskStateStub` and its helpers are unchanged (T16).
  - `src/app/api/v1/projects/[projectId]/tasks/[taskId]/route.ts`: adds the `DELETE` export.
  - `src/app/api/v1/projects/[projectId]/tasks/[taskId]/assignee/route.ts`: new, `PUT`.
  - Tests: see the test-writer fields above.
- Tests/checks and results: see the session's "Checks run". The unit tests, lint, type-check, build and PostgreSQL integration tests (16 files and 305 tests, run by thegrimbee) pass.
- Generated artifacts: none. `next-env.d.ts` was rewritten by the build and reverted.
- Dependencies added: none.
- Decisions made during implementation, approved by thegrimbee on 2026-11-07 and recorded in `design.md` "Implementation decisions U1 to U13 (task 4.2)". Verdict counts: **accepted 13, modified 0, rejected 0**.
  - **U1 Public seam.** The module's exports:
    - The exports are `TaskService`, `TaskRepository`, `TaskError`, `taskErrorResponse`, `parseCreateTaskBody`, `parseEditTaskBody`, `parseReassignTaskBody` and `parseDeleteTaskBody`. Each parser returns `{ok: true, value} | {ok: false, code}`, where `code` is `INVALID_REQUEST` or `ACCEPTANCE_CRITERIA_REQUIRED`.
    - The handlers are `handleTaskCreate`, `handleTaskRead`, `handleTaskEdit`, `handleTaskReassign` and `handleTaskDelete`, plus the view and input types.
    - The service is `new TaskService(repository)`. Its methods are `createTask(projectId, actorPersonId, input)`, `getTask(projectId, taskId)`, `editTask(projectId, taskId, actorPersonId, input)`, `reassignTask(projectId, taskId, actorPersonId, {assigneeId, version})` and `deleteTask(projectId, taskId, actorPersonId, version)`.
    - 4.1 recorded its equivalent seam as S1–S7.
  - **U2 Version upper bound.** `version` must be at most 2,147,483,647, the maximum of the `integer` column; a larger value is 400 `INVALID_REQUEST` rather than a database error and 500. T5 recorded only "at least 1". The year `0000` in `dueDate` is also rejected, because PostgreSQL has no year 0.
  - **U3 Lock order.**
    - Create and reassign share-lock the actor's and the assignee's memberships in one statement, ordered by person ID (`FOR SHARE`).
    - Edit and delete share-lock the actor's membership only.
    - The order matches the transfer's `FOR UPDATE … ORDER BY person_id`, so a reassignment racing a transfer waits instead of deadlocking. Without this, the assignee trigger's later `FOR SHARE` could deadlock against the transfer, depending on how the UUIDs sort.
    - The handoff recorded only the actor's `FOR SHARE` lock (R5 pattern).
  - **U4 Consistent read.** `getTask` reads the task and its criteria in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, so it never shows half of a concurrent edit.
  - **U5 UUID case.** `assigneeId` and criterion `id` in bodies are lowercased after validation, so they compare equal to the IDs PostgreSQL returns. Path IDs are unchanged, as in 4.1.
  - **U6 Unchanged criteria.** In a criteria edit, a kept criterion whose text and position are unchanged is not written, so its own `version` does not change. The task's version still increases once (T6).
  - **U7 Service invariants.**
    - The service also refuses an empty criteria list (`ACCEPTANCE_CRITERIA_REQUIRED`).
    - A criterion `id` that is not one of the task's current criteria is detected in the service, inside the transaction, and returns `INVALID_REQUEST` as T4 recorded.
  - **U8 Path ID before missing criteria.** A malformed path ID together with missing criteria returns `INVALID_REQUEST`. T7 orders only body errors.
  - **U9 Task lookup.** The handler's "task exists" step (T8) reuses the existing `TaskAccessRepository.findTaskInProject`, which belongs to 4.3. It is read-only use, and the file is unchanged.
  - **U10 Reassignment order.** The version check runs before the same-assignee no-op, so a stale version to the current assignee is a 409. The no-op does not recheck the current assignee's role.
  - **U11 Changes to the 3.2 test file.** In `tests/unit/project-authorization-routes.test.ts`:
    - The task create and edit default bodies became valid bodies, because the body is now validated before the session.
    - The three "reaches the stub (501)" cases for task create, read and edit were removed. The authorized success paths write, and this file's regex fake refuses writes. That coverage moved to `tests/unit/task-routes.test.ts`.
    - All task-state stub assertions are unchanged.
  - **U12 Shared fake semantics.** The extracted fake now:
    - sorts `ORDER BY` and applies `LIMIT`, both of which it previously ignored;
    - returns `null` rather than `undefined` for a column a row lacks;
    - accepts updates on all application tables except `people`, and models the version and `updated_at` trigger on them.

    The 4.1 tests pass unchanged.
  - **U13 Edit write order.** In an edit, the task `UPDATE`, which carries the version guard, runs before any criteria write. A conflicting edit therefore writes no criteria.
- Known gaps and unverified items:
  - `/security-review` has not been run.
  - The X1 yardstick reviewer has not been run.
  - Lim-ZY has not yet cross-reviewed the `src/server/auth/project-authorization.ts` change.
  - The `logs/` session summary is drafted in `logs/2026-11-07-task-4.2-implementation.md` and awaits human verification. It is left uncommitted.
  - The C1 follow-up for 7.3 (`checkHistory`) is still open.
- Reviewer findings: none yet (no reviewer has run).
- Next action and responsible human: thegrimbee (see the Task record).

## Change log `[ORCH]`

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-11-07 13:53 | main session | Analyst stage done in the main session (X1 single-agent arm; no orchestrator, a deliberate deviation). thegrimbee approved the spec delta and T1–T17 as recommended (17 accepted / 0 modified / 0 rejected) and delegated C1; the agent chose (c). Decisions, error codes and spec delta recorded (uncommitted). OpenSpec strict validation gives the same 6 warnings as the baseline. Main session plan written. Stopped for human review. |
| 2026-11-07 14:25 | main session | TDD for 4.2. A2 tests written and confirmed red: 190 failed / 1,164 passed, and `task-service.test.ts` could not load. A1 implemented until green: 26 files and 1,443 tests passed. Lint, type-check and build pass (`next-env.d.ts` reverted). The 13 integration tests were skipped with no `TEST_DATABASE_URL` (unverified). Unrecorded decisions U1–U13 listed for human review. The 13:53 entry above was first written as 05:53 (UTC) and has been corrected. Nothing committed. Stopped for human review. |
