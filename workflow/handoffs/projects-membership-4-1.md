# Projects and membership: task 4.1 handoff

## Task record `[ORCH]`

- Task ID: `projects-membership-4-1` (OpenSpec task 4.1)
- Summary: 4.1 — Implement creation, keys, memberships, one-PM invariant and PM transfer; decide project-creation policy and initial PM selection; add PostgreSQL integrity and project-route authorization tests (`openspec/changes/project-task-management/tasks.md:31`).
- Change: `project-task-management`
- Branch: `feat/projects-membership-4-1`
- Human owner (Developer A / Developer B): Developer B (thegrimbee); cross-review Lim-ZY (per C3 resolution)
- Date: 2026-11-06
- Requirement IDs: None. No formal IDs exist and none are constructed. Workers cite requirements by name:
  - task-management: "Signed-in people create projects", "Project membership and roles", "Product manager transfers the role", "Transfer targets are identified by GitHub username", and "Projects and tasks have readable IDs" (only the "Project key cannot change" scenario).
  - identity-and-access: "Protected route authorization stubs" (only the "Project details require membership" and "Project creation is functional" scenarios), "Mutating project routes check the request origin", and "Protected API errors use stable safe responses".
- Status: planned. No workers have been launched.
- Next human action: thegrimbee answers open questions Q1–Q6 below (Decisions and open questions). The answers must be recorded in `design.md` "Project and Membership Decisions" or in the spec delta. thegrimbee also confirms or changes the sequence: implementer, then test-writer, then reviewer. After that, thegrimbee launches the implementer (assignment A1).

## Source and scope `[ORCH]`

- Repository / branch / worktree: `CS3227-2610-MP4`, branch `feat/projects-membership-4-1`, primary checkout `D:/Education/CS3227/CS3227-2610-MP4`. The two workers run one after the other in this checkout, so they do not need separate worktrees. If the human decides to run them in parallel, each needs its own worktree from the same revision.
- Source revision: `d3ce36218749794f43be9e2910420f95772ed982`, plus one uncommitted edit to `openspec/changes/project-task-management/design.md`. That edit is the C5 "Risks / Trade-offs" correction and does not affect 4.1. Workers must not edit, revert or commit it.
- Permitted paths and actions: see the Orchestrator fields in the orchestrator session block below. Assignment A1 is the implementer and A2 is the test-writer. Their write paths do not overlap.
- Prohibited paths and actions:
  - Do not edit OpenSpec: `openspec/**`, including the uncommitted `design.md` edit.
  - Do not edit `specs/ui-spec.md`. Do not add a migration or edit `supabase/migrations/**` (D10).
  - Do not add UI (C4). Do not add listing routes (D4).
  - Do not add member-removal or role-change logic (D7).
  - Do not edit the task stub functions in `src/server/auth/project-authorization.ts`. These are `handleTaskCreationStub`, `handleTaskReadStub`, `handleTaskEditStub` and `handleTaskStateStub`, and they belong to 4.2 and 4.3.
  - Do not edit the task route files under `src/app/api/v1/projects/[projectId]/tasks/**`.
  - Do not edit the github-repository route or its spec (D8). Do not edit other `src/server/*` modules.
  - Do not edit `.env*`, `package.json` or `package-lock.json`. No new dependencies.
  - Do not edit the existing tests and fixtures in `tests/integration/db/`, except where A2 allows it.
  - Do not touch AI security evaluation paths (Developer A).
  - Do not commit, push or open a PR. Do not run git rebase or reset.
- Dependencies and parallel work:
  - Upstream: task 3.2 is complete (route stubs and authorization helpers). Requirements were approved at the human gate below and committed in `07974b9`.
  - Overlap with task 4.2: 4.2 also edits `src/server/composition.ts`, `src/server/auth/project-authorization.ts` and `tests/unit/project-authorization-routes.test.ts`. 4.2 has no branch or worktree yet.
  - Recommendation: do not start 4.2 work on those three files until 4.1 is merged to `master`. Branch 4.2 from that merge. 4.2 may begin analysis and spec work earlier. If 4.2 must start writing code earlier, it should limit itself to new files and leave the three shared files to one integration pass after 4.1 merges.

## Context references `[ALL, when relevant]`

- Requirements:
  - `openspec/changes/project-task-management/specs/task-management/spec.md:9-131`
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md:78-87`, `:142-152` and `:168-181`
- Decisions:
  - `openspec/changes/project-task-management/design.md`: "Project and Membership Decisions" (D1–D10, C4), "API Error Contract" (new 409 codes), and "Data Persistence Decisions" (D-C transfer, D-D keys, D-E open tasks).
- Task line: `openspec/changes/project-task-management/tasks.md:31`
- Schema (read-only):
  - `supabase/migrations/20261030144500_create_app_schema.sql`: assignee trigger with a `FOR SHARE` membership lock at L102-120 and L435-437; `people.github_username`, which is not unique, at L135-142; project key check and immutability at L152-179; partial unique index for one PM at L188-205.
- Code to change or reuse:
  - `src/server/composition.ts`
  - `src/server/auth/project-authorization.ts`: project stubs at L150-170; reuse its session and membership helpers.
  - `src/server/repositories/people-repository.ts`
  - `src/app/api/v1/projects/route.ts` and `src/app/api/v1/projects/[projectId]/route.ts`
  - Module layout precedent: `src/server/github-evidence/` (service, repository, types, errors and `index.ts`).
  - Origin check precedent: `src/app/api/v1/projects/[projectId]/github-repository/route.ts:12`.
- Tests to change or reuse:
  - `tests/unit/project-authorization-routes.test.ts`: the real handlers run with `pg` and Supabase mocked; 501 is asserted at L215-222.
  - `tests/integration/db/support/harness.ts` and `tests/integration/db/support/fixtures.ts` (`createPerson`, `createProject`, `addMembership`, `createTask`, `runtimePool`).
  - Existing DB coverage for key immutability, at-most-one PM and the swap: `tests/integration/db/identifiers-and-revisions.test.ts:141-240` and `tests/integration/db/memberships.test.ts:87-110`.
  - `vitest.config.ts`: `npm test` runs unit tests; `npm run test:integration` needs `TEST_DATABASE_URL`.
- Prior handoff: `workflow/handoffs/identity-access-3-2.md:261,293` (the Origin/CSRF requirement carries into 4.1).

## Decisions and open questions `[ORCH]`

- Current state: Planned. Requirements and decisions were approved and committed in `07974b9`. The two assignments are defined below. Workers are waiting for the human to answer Q1–Q6 and launch them.
- Human-approved decisions:
  - D1–D10 and C1–C5, as recorded under "Human gate" below and in `design.md` "Project and Membership Decisions".
  - Error codes: 409 `PROJECT_KEY_TAKEN`, 409 `GITHUB_USERNAME_AMBIGUOUS`, 409 `ALREADY_MEMBER`, 409 `TRANSFER_TARGET_NOT_DEVELOPER`, 409 `TRANSFER_BLOCKED_OPEN_TASKS`, and 404 `NOT_FOUND` for an unmatched username. These are recorded in the "API Error Contract".
  - Developer B (thegrimbee) owns all 4.1 paths, and Lim-ZY cross-reviews.
- Orchestrator decisions (coordination only; the human may override):
  - Sequence: A1 implementer, then A2 test-writer, then reviewer. The approved records do not fix the public seam the tests need: the composition field, the service interface and the module exports. The route tests mock `pg` by SQL text, and the integration tests drive the service against PostgreSQL. Writing tests first would mean guessing those names or the SQL.
  - Route file paths for the new routes follow D4 directly: `src/app/api/v1/projects/[projectId]/members/route.ts` and `src/app/api/v1/projects/[projectId]/product-manager-transfer/route.ts`.
- Assumptions (identify unapproved assumptions):
  - A-1 (REJECTED 2026-11-06 by thegrimbee, see Q5 in design.md): the handlers for the members and transfer routes live in `src/server/auth/project-authorization.ts`, next to the replaced project stubs. So does the shared Origin and content-type helper (D8). This lets them reuse the file's private session and membership helpers. The module `src/server/projects/` stays limited to service, repository, types and errors, as D9 lists.
  - A-2: the existing DB tests already cover key immutability at the database level. For 4.1, A2 adds a check that no 4.1 route or service changes a key, and does not duplicate the trigger test.
  - A-3: the "Creation is atomic" test may force the membership insert to fail with a test-only trigger, created by the harness superuser and dropped in the same test file. It must not change shared infrastructure.
- Open questions / conflicts (unrecorded decisions; not resolved here):
  - Q1 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question: (blocks A1 and the A2 body assertions): the success response bodies are not recorded for `POST /members` (201) and `POST /product-manager-transfer` (200). D4 gives only the status codes.
  - Q2 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question: (blocks the exact message text): no fixed `message` strings are recorded for the five new 409 codes. The spec says only that the `TRANSFER_BLOCKED_OPEN_TASKS` message asks for the task to be reassigned first. The human can record the strings, or decide that tests assert only the `code` and the implementer chooses messages that follow the "Message" rule.
  - Q3 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question:: validation of the `githubUsername` body is not recorded. Open points: whether it must be exactly one field, whether it must be a string, whether it is trimmed, whether empty is allowed, and the length limit. Each case that fails should return 400 `INVALID_REQUEST`. The AGENTS.md rule on strict mutation fields suggests unknown fields are rejected, but nothing records this for these routes.
  - Q4 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question:: the order of checks on the three mutating routes is not fully recorded. The spec puts Origin and content-type before authentication. It does not record which comes first when both Origin and content-type are bad. It also does not record whether a bad body or path UUID (400) comes before authentication (401), membership (404) and role (403). The 3.2 stubs validate the body and UUID before authentication.
  - Q5 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question:: confirm or reject A-1, the handler and Origin-helper placement. D9 says `project-authorization.ts` gets "minimal edits", and adding two handlers plus a helper there may go beyond that. The alternative is a handler file inside `src/server/projects/`, which would need the session and membership helpers exported from `project-authorization.ts`.
  - Q6 — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation; recorded in design.md "Planning decisions Q1 to Q6" and the spec delta). Original question:: `POST /api/v1/projects` from a signed-in user with no `people` row is not recorded. The 3.2 creation stub checked only authentication, and the project-scoped routes return 404 for an unmapped identity. D2 needs a person ID to create the membership.
  - Conflicts: none found between the approved specs, design.md and the code.

## Worker session reports

Repeat one session block for each assigned agent session. Include the shared fields and only the fields for that session's role.

### Session `analyst / a4c7d9e33d08ddc74`

- Provider: `claude`
- Provider session ID: not available (agent ID surfaced: `a4c7d9e33d08ddc74`)
- Work ID: `projects-membership-4-1`
- Agent: analyst
- Phase: context brief and spec delta (two runs: draft, then writing the approved spec delta)

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code, Sonnet 5.5 (`claude-sonnet-5-5`)
- Role: Analyst
- Human owner and assigned task scope: Developer B (thegrimbee); task 4.1 repository-context brief and scoped OpenSpec spec delta
- Source revision: `e9c29cdf875b93589fbe4ef1b6816f9c0e742157`
- Started / ended / elapsed `[ALL, optional when surfaced]`: Run 1 121,672 ms; Run 2 870,673 ms; total 992,345 ms (about 16 min 32 s). Start/end timestamps not available.
- Resource usage (provider-reported): tokens in / out / total; cache read / write; cost; tool calls or other surfaced metrics:
  - Run 1 (draft): 126,295 tokens, 18 tool uses, 121,672 ms
  - Run 2 (spec write): 140,743 tokens, 10 tool uses, 870,673 ms
  - Total: 267,038 tokens, 28 tool uses, 992,345 ms
- Unavailable resource metrics: Token in/out split, cache read/write, cost: not available
- Work completed / findings: Produced the source-linked context brief and candidate edit paths below; drafted spec delta and recommendations D1–D10 with conflicts C1–C5; after human approval, wrote the approved spec delta.
- Files changed (use `none` if read-only):
  - `openspec/changes/project-task-management/specs/task-management/spec.md`
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md`
- Checks run and exact results (use `none` if none were run): `npx openspec validate project-task-management --strict` → valid (recorded at the human gate).
- Gaps / blockers (use `none` if none): See "Open items at the gate" under the human gate section.

#### Analyst fields `[ANALYST]`

- Exploration scope / task question: Task 4.1 (`openspec/changes/project-task-management/tasks.md:31`) — project creation, keys, memberships, the one-PM invariant and PM transfer, plus the project-creation policy and initial PM selection.
- Compressed repository-context brief (about 300 words maximum; source index excluded):

  Note on source index: the analyst did not produce a separate source-index section; its context brief is source-linked inline. The sources it cited are listed under "Source index" below, extracted verbatim from its brief.

  **Task.** `openspec/changes/project-task-management/tasks.md:31`. Implement creation, keys, memberships, the one-PM invariant and PM transfer. It must also decide who may create a project and how the initial PM is chosen, and add PostgreSQL integrity and project-route authorization tests. This is the only item listed in `design.md` Open Questions that blocks 4.1 (`design.md:281`). AGENTS.md says recorded open questions must be resolved before dependent work starts.

  **Confirmed decisions**
  - **PM transfer (D-C, `design.md:108`).** Only the current PM may transfer, and only to an existing developer. The swap happens in one transaction. It is refused while the incoming developer has assigned tasks that are not Done.
  - **Task IDs and keys (D-D, `design.md:109`).** The key is 2-10 characters, `[A-Z][A-Z0-9]`, unique and fixed. Task numbers come from a per-project counter.
  - **Membership changes (`design.md:124`).** Task services must keep open tasks assigned to developers when a membership is removed or its role changes.
  - **Existing schema (`supabase/migrations/20261030144500_create_app_schema.sql`)**
    - `projects` has `key` unique, a format CHECK and a key-immutability trigger (lines 152-179).
    - `memberships` has a unique (project, person) pair and a partial unique index allowing at most one `product_manager` per project (188-205). The comment says the demote-then-promote swap works in one transaction.
    - The database enforces at most one PM. "Exactly one" depends on the service creating the project and the PM membership together.
  - **3.2 stubs (`design.md:153,171`).** `POST /api/v1/projects` and `GET /api/v1/projects/{projectId}` are 501 stubs. Task 4.1 owns the project-creation policy.
  - **3.2 handoff.** The CSRF/Origin requirement carries into 4.1-4.3 before the first mutating handler (`workflow/handoffs/identity-access-3-2.md:261,293`).

  **Code state**
  - Project stubs live in `src/server/auth/project-authorization.ts` (`handleProjectCreationStub` ~L152, `handleProjectReadStub` ~L161).
  - `ProjectAccessRepository` is read-only. It has `projectExists` and `findProjectRole`.
  - `PeopleRepository` finds people only by `auth_user_id` and has no lookup by GitHub username.
  - `people.github_username` is not unique, only non-empty.
  - There is no project/membership service, and no `src/server/projects/` module.
  - There are no list-projects or member routes.
  - `tests/unit/project-authorization-routes.test.ts:215-222` asserts 501 for project read and create. Those tests must change.
  - Existing DB tests are `tests/integration/db/memberships.test.ts`, `identifiers-and-revisions.test.ts` and `support/fixtures.ts`.
  - The API error contract is in `design.md:254-265`. A new code must be recorded by the task that first returns it.

- Relevant repository paths inspected and why (Source index, cited in the brief):
  - `openspec/changes/project-task-management/tasks.md:31`
  - `openspec/changes/project-task-management/design.md:108, 109, 124, 153, 171, 254-265, 281`
  - `supabase/migrations/20261030144500_create_app_schema.sql:152-179, 188-205`
  - `workflow/handoffs/identity-access-3-2.md:261, 293`
  - `src/server/auth/project-authorization.ts` (~L152, ~L161)
  - `src/server/repositories/people-repository.ts`
  - `tests/unit/project-authorization-routes.test.ts:215-222`
  - `tests/integration/db/memberships.test.ts`, `tests/integration/db/identifiers-and-revisions.test.ts`, `tests/integration/db/support/fixtures.ts`
  - `specs/ui-spec.md:85`; `src/app/api/v1/auth/sign-out/route.ts:20`; `src/app/api/v1/projects/[projectId]/github-repository/route.ts:12` (cited in conflicts)
- Prior human decisions and constraints, each linked to its source path: See "Confirmed decisions" in the brief above (`design.md:108`, `design.md:109`, `design.md:124`, `design.md:153,171`, `supabase/migrations/20261030144500_create_app_schema.sql`, `workflow/handoffs/identity-access-3-2.md:261,293`).
- Candidate files / modules likely to need changes and rationale (candidates only; orchestrator confirms write scope):

  **Implementation (all new API surface needs prior approval, see D4)**
  - New module `src/server/projects/` with a service, repository, types, errors and an `index.ts` public entry. Following the existing per-feature modules (`github-evidence`, `github-repository-link`) keeps cohesion.
  - `src/server/composition.ts` for wiring. This is a shared file, and 4.2 will touch it too.
  - `src/server/repositories/people-repository.ts`, for a lookup by GitHub username, if D5 is accepted.
  - `src/server/auth/project-authorization.ts`, to replace the project create/read stubs. This is shared with 4.2's task stubs, so there is a high merge-overlap risk.
  - Route files: `src/app/api/v1/projects/route.ts`, `src/app/api/v1/projects/[projectId]/route.ts`, and new routes for members and transfer (paths pending D4).
  - No migration is needed unless D10 is chosen. The shipped migration must not be edited.

  **Tests**
  - Update `tests/unit/project-authorization-routes.test.ts` (it asserts 501 today).
  - Add new unit and route tests under `tests/unit/` for the service and handlers.
  - Add `tests/integration/db/` tests for the transfer transaction, the competing-transfer race and the creation transaction. They can reuse `support/fixtures.ts` and `support/harness.ts`.

  **Specs (analyst-writable if the orchestrator assigns them)**
  - `openspec/changes/project-task-management/specs/task-management/spec.md`
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md` (lines 78-90, the stub scenarios)
  - `openspec/changes/project-task-management/design.md`, for the decisions record and the API Error Contract. This may be outside the analyst's write scope, so the orchestrator should confirm.

- Dependencies, conflicts, and open product/design decisions:

  **Ownership**
  - AGENTS.md assigns membership and task management to Developer B (thegrimbee).
  - It assigns identity, access and the API to Developer A (Lim-ZY).
  - Task 4.1 straddles both. It sits in Developer B's PM feature lane, but it replaces Developer A's route stubs in `project-authorization.ts` and the project route files.
  - The orchestrator or a human should confirm that 4.1 owns those stub paths.

  **Overlap risks**
  - 4.2 is `[P]` and also replaces stubs in `project-authorization.ts`, `composition.ts` and the task route files. Keep 4.1 to the project routes and put its logic in the new module.
  - `tests/unit/project-authorization-routes.test.ts` is touched by both tasks.

- Requirement IDs and acceptance examples: No formal requirement IDs supplied. Acceptance examples are in the approved spec delta paths listed under the human gate.
- OpenSpec files changed:
  - `openspec/changes/project-task-management/specs/task-management/spec.md`
  - `openspec/changes/project-task-management/specs/identity-and-access/spec.md`

### Session `orchestrator / 4-1-plan`

- Provider: `claude`
- Provider session ID: not available
- Work ID: `projects-membership-4-1`
- Agent: orchestrator
- Phase: planning (assignment definition; no workers launched)

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (Agent SDK subagent), Opus 5.5 (`claude-opus-5-5`)
- Role: Orchestrator
- Human owner and assigned task scope: Developer B (thegrimbee). Plan task 4.1 in this handoff only.
- Source revision: `d3ce36218749794f43be9e2910420f95772ed982`, plus the uncommitted `design.md` C5 edit
- Started / ended / elapsed `[ALL, optional when surfaced]`: Ended about 2026-11-06 09:55 SGT. Start time and elapsed time are not available.
- Resource usage (provider-reported): tokens in / out / total; cache read / write; cost; tool calls or other surfaced metrics: 21 tool calls, counted from this session's own transcript; the final handback is not included. No usage figures were reported by the provider.
- Unavailable resource metrics: tokens in / out / total, cache read / write, cost and elapsed time: not available
- Work completed / findings:
  - Filled the Task record, Source and scope, Context references, and Decisions and open questions.
  - Defined assignments A1 and A2 with paths that do not overlap.
  - Marked the gate's open items as resolved.
  - Recorded open questions Q1–Q6 for the human.
  - Confirmed the write paths against the repository. No `src/server/projects/` module exists. The members and product-manager-transfer route directories do not exist. No 4.2 branch or worktree exists. `workflow/plans/` does not exist, so no plan file was created and the plan is kept in this handoff.
- Files changed (use `none` if read-only): `workflow/handoffs/projects-membership-4-1.md`
- Checks run and exact results (use `none` if none were run): none
- Gaps / blockers (use `none` if none): Q1–Q6 must be answered before A1 starts. Q1 and Q2 also limit what A2 can assert.

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:

  **A1: implementer** (runs first; owner thegrimbee)
  - Scope: the 4.1 behavior in the approved specs and D1–D10. Only the 4.1 project routes.
  - New files, may create:
    - `src/server/projects/index.ts`: the public entry; export only what composition and handlers need.
    - `src/server/projects/service.ts`
    - `src/server/projects/repository.ts`
    - `src/server/projects/types.ts`
    - `src/server/projects/errors.ts`
    - `src/app/api/v1/projects/[projectId]/members/route.ts`
    - `src/app/api/v1/projects/[projectId]/product-manager-transfer/route.ts`
  - Existing files, may edit:
    - `src/server/repositories/people-repository.ts`: add the exact, case-insensitive GitHub-username lookup (D5).
    - `src/server/composition.ts`: wire the new repository and service; add only the fields needed.
    - `src/server/auth/project-authorization.ts`: replace `handleProjectCreationStub` and `handleProjectReadStub`, and add the members and transfer handlers and the shared Origin and content-type helper (D8). The placement of the handlers and helper depends on Q5. Do not change the task stub functions or their behavior.
    - `src/app/api/v1/projects/route.ts` and `src/app/api/v1/projects/[projectId]/route.ts`: point them at the replaced handlers.
  - Must follow:
    - D6: lock both membership rows `FOR UPDATE`, which conflicts with the assignee trigger's `FOR SHARE`, then run the open-task check in the same transaction.
    - D2 and D10: create the project and the PM membership in one transaction.
    - Map unique violations to `PROJECT_KEY_TAKEN` or `ALREADY_MEMBER`.
    - Use parameterized SQL, send `Cache-Control: no-store`, and follow the "API Error Contract".
    - Do not hold a transaction open across anything other than database calls.
  - Must not edit tests, OpenSpec, migrations or dependencies. Use the `present-changes-visually` skill if it is available.
  - Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm test`. Before A2 runs, the 501 assertions in `tests/unit/project-authorization-routes.test.ts` are expected to fail. Report that as expected and do not fix it.

  **A2: test-writer** (runs after A1; owner thegrimbee)
  - Scope: tests for every 4.1 scenario listed under Requirement IDs, written against the approved requirements and A1's public seam: route handlers, `@/server/projects` exports and composition fields. Do not depend on private internals beyond the SQL the `pg` mock must answer.
  - May edit: `tests/unit/project-authorization-routes.test.ts`. Replace the 501 project read and create assertions (L215-222) and their unmapped-identity exemption with the approved 200 and 201 behavior. Keep all task-stub assertions.
  - May create:
    - `tests/unit/project-routes.test.ts`: route tests for create, read, members and transfer. Cover authentication (401), non-member concealment (404), developer refusal (403), validation (400), the 409 codes, an unmatched username (404 `NOT_FOUND`), case-insensitive match, and no state change on any denied request.
    - `tests/unit/project-origin-check.test.ts`: on all three mutating routes, a missing or different Origin returns 403 `FORBIDDEN`, a wrong content type returns 400 `INVALID_REQUEST`, and a match proceeds to authorization.
    - `tests/unit/projects/project-service.test.ts`: service and validation unit tests (key format without normalization, name trim and 1-100 characters, exact fields, error mapping).
    - `tests/integration/db/projects-membership.test.ts`: PostgreSQL tests through the real service using `runtimePool`. Cover:
      - the creation transaction: exactly one PM, plus the atomic-failure case per A-3;
      - a creator who keeps a role in another project;
      - add-member, including concurrent duplicate adds;
      - the transfer success path;
      - the open-task block, where deleted and Done tasks do not block;
      - two competing transfers, ending with exactly one PM;
      - a transfer racing a task assignment to the incoming developer, where the transfer never completes while that developer holds an open task;
      - key immutability through the 4.1 surface (A-2).
  - Must not edit `tests/integration/db/support/**`, other existing tests, product code, OpenSpec, or AI security evaluation paths. If a shared fixture is needed, report it and do not add it.
  - Checks: `npm test`. Run `npm run test:integration` only if `TEST_DATABASE_URL` points to a disposable database. Otherwise mark the integration tests unverified.

  **Dependencies and sequence:**
  1. Human answers Q1–Q6.
  2. A1 runs.
  3. A2 runs.
  4. An independent reviewer checks every scenario, the boundaries and code quality, and runs lint, tsc, build, unit and, where possible, integration.
  5. Human resolves the findings.
  6. Commit/PR agent, only on explicit authorization for `feat/projects-membership-4-1`.

  A1 and A2 never write the same path. Task 4.2 should wait for 4.1 to merge before editing `composition.ts`, `project-authorization.ts` or `tests/unit/project-authorization-routes.test.ts`.
- Consolidation notes: There are no worker reports to consolidate yet. Reusable sessions: the analyst session `a4c7d9e33d08ddc74` has the 4.1 context. No earlier implementer or test-writer session exists for 4.1.

## Human gate

- Approver: thegrimbee (Developer B), 2026-11-06. The human approved the analyst's draft spec delta and recommendations D1–D10, and chose resolutions for conflicts C2, C3, C5 and the D4 transfer-identifier gap.

### Decisions (verdict + final wording)

- **D1 — Accept.** Who may create a project: Any signed-in person.
- **D2 — Accept.** Initial product manager: The creator becomes the project's only product manager, in the same transaction that creates the project. Handing the project over later uses the D-C transfer.
- **D3 — Accept.** Creation payload: `POST /api/v1/projects` accepts exactly `{key, name}`. A key that fails `^[A-Z][A-Z0-9]{1,9}$` is rejected, not normalized. The name is trimmed, 1 to 100 characters, plain text. Success is 201 with `{id, key, name, role: "product_manager"}`. Bad input is 400 `INVALID_REQUEST`. A duplicate key is 409 `PROJECT_KEY_TAKEN`.
- **D4 — Modify** (transfer target identified by `githubUsername` instead of the drafted `personId`). Routes: Task 4.1 approves only `GET /api/v1/projects/{projectId}` returning `{id, key, name, role}`; `POST /api/v1/projects/{projectId}/members` with `{githubUsername}`, product manager only, 201; `POST /api/v1/projects/{projectId}/product-manager-transfer` with `{githubUsername}`, product manager only, 200. Project and member listing are left to task 4.4.
- **D5 — Accept.** Identifying a person: GitHub username, matched exactly and case-insensitively against registered people. More than one match is an error. Any non-match returns a generic not-found; the product manager may learn whether a username is registered. The same rule serves both the members and transfer routes.
- **D6 — Accept.** Open tasks and refusal: Only non-deleted, non-Done tasks block a transfer, consistent with D-E. A blocked transfer is 409 `TRANSFER_BLOCKED_OPEN_TASKS`. The check runs inside the transfer transaction after locking both membership rows `FOR UPDATE`, so a concurrent assignment (which share-locks the developer membership) cannot slip in.
- **D7 — Accept.** Out of scope: Member removal and role change are not part of task 4.1. The reassignment rule in "Assignees after membership changes" stays pending until they are specified.
- **D8 — Accept, with C2 resolution.** Origin check: The three mutating routes share one helper: `Origin` must equal `APP_ORIGIN` and `Content-Type` must be `application/json`. A bad Origin returns 403 `FORBIDDEN`; a wrong content type returns 400 `INVALID_REQUEST`. The existing github-repository route and spec are unchanged, so the two behaviors differ until a later task aligns them.
- **D9 — Accept, with C3 resolution.** Placement: A new `src/server/projects/` module holds the service, repository, types and errors behind an `index.ts` entry. `composition.ts` and the stubs in `project-authorization.ts` get minimal edits. Developer B (thegrimbee) owns all task 4.1 paths, including the project route files and the project stubs in `src/server/auth/project-authorization.ts`; Lim-ZY cross-reviews.
- **D10 — Accept.** "Exactly one" product manager: The database enforces at most one (partial unique index). At least one relies on the creation transaction and an integration test; no new migration.

### Conflict resolutions

- C1: The approved delta replaces the identity-and-access 501 stub scenarios for project create/read; specs change before tests.
- C2: 403 `FORBIDDEN` for a bad Origin on 4.1's mutating routes (see D8).
- C3: Developer B owns all 4.1 paths (see D9).
- C4: Task 4.1 has no UI; the members screen stays with task 4.4.
- C5: Leave the stale encrypted-token text in design.md "Risks / Trade-offs" untouched; follow-up only. (Superseded the same day: the human later asked for the correction; see "Open items at the gate".)

### Approved spec paths

- `openspec/changes/project-task-management/specs/task-management/spec.md`
- `openspec/changes/project-task-management/specs/identity-and-access/spec.md`
- Validation: `npx openspec validate project-task-management --strict` → valid.

### Source revision at the gate

- Commit SHA: `e9c29cdf875b93589fbe4ef1b6816f9c0e742157` (HEAD of `feat/projects-membership-4-1`). The approved spec edits are NOT yet committed; they are working-tree changes on top of this SHA.

### Open items at the gate (recorded, not resolved)

- Resolved 2026-11-06: the main session added the decisions record, the Open Questions resolution and the new error codes to `design.md` at the human's request.
- Resolved 2026-11-06 (human accepted the agent's recommendation): 409 `GITHUB_USERNAME_AMBIGUOUS`, 409 `ALREADY_MEMBER`, 409 `TRANSFER_TARGET_NOT_DEVELOPER`; unmatched usernames return 404 `NOT_FOUND` on both routes. Recorded in the task-management spec and design.md.
- Resolved 2026-11-06 (orchestrator plan): `tests/unit/project-authorization-routes.test.ts:215-222` still asserts 501, which contradicts the approved specs. Updating it is now assigned to the test-writer (A2).
- Resolved 2026-11-06 after the gate: C5 was reversed at the human's request on 6 November 2026. The out-of-date encrypted-token bullet in `design.md` "Risks / Trade-offs" was corrected. The edit is uncommitted and does not affect 4.1.

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
| 2026-11-06 | analyst / a4c7d9e33d08ddc74 | Context brief, D1–D10 and C1–C5 drafted. After the human gate, the spec delta was written and committed in `07974b9`. |
| 2026-11-06 09:55 | orchestrator / 4-1-plan | Plan written: Task record set to planned. Scope, context, decisions and open questions Q1–Q6 filled. Assignments A1 (implementer) and A2 (test-writer) defined with paths that do not overlap; sequence A1, then A2, then reviewer. Gate open items marked resolved (design.md updated, error codes chosen, 501 test assigned to A2, C5 corrected at the human's request). |
| 2026-11-06 | main session | Human approved Q1–Q6 as recommended (A-1 rejected); recorded in design.md "Planning decisions Q1 to Q6" and the spec delta, `openspec validate --strict` passes. PR base chosen: `dev`. Worker order (implementer-first plan vs AGENTS.md test-writer-first) awaits the human's decision. |
