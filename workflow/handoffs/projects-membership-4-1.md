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
- Status: planned (revised in `orchestrator / 4-1-plan-2`). Q1–Q6 are approved and recorded. No workers have been launched.
- Next human action: thegrimbee decided the worker order (test-writer first) and approved Q7, Q8 and the two process points as recommended, on 6 November 2026. Next, the main session launches A2 (test-writer), then A1 (implementer). The plan is in `orchestrator / 4-1-plan-2`.

## Source and scope `[ORCH]`

- Repository / branch / worktree: `CS3227-2610-MP4`, branch `feat/projects-membership-4-1`, primary checkout `D:/Education/CS3227/CS3227-2610-MP4`. If the workers run in sequence, they share this checkout. If the human chooses parallel, the test-writer gets a manual worktree (commands in `orchestrator / 4-1-plan-2`, "Parallelism plan").
- Source revision: `68a12fb` (HEAD of `feat/projects-membership-4-1`, clean tree). The C5 `design.md` correction and the Q1–Q6 record are committed.
- Permitted paths and actions: see the Orchestrator fields in `orchestrator / 4-1-plan-2`, which supersede those in `4-1-plan`. Assignment A1 is the implementer and A2 is the test-writer. Their write paths do not overlap.
- Prohibited paths and actions:
  - Do not edit OpenSpec: `openspec/**`.
  - Do not edit `specs/ui-spec.md`. Do not add a migration or edit `supabase/migrations/**` (D10).
  - Do not add UI (C4). Do not add listing routes (D4).
  - Do not add member-removal or role-change logic (D7).
  - Do not edit the task stub functions in `src/server/auth/project-authorization.ts`. These are `handleTaskCreationStub`, `handleTaskReadStub`, `handleTaskEditStub` and `handleTaskStateStub`, and they belong to 4.2 and 4.3.
  - Do not edit the task route files under `src/app/api/v1/projects/[projectId]/tasks/**`.
  - Do not edit the github-repository route or its spec (D8). Do not edit other `src/server/*` modules, and no other file in `src/server/auth/` than those A1 lists (Q7, Q8).
  - Do not change existing imports of `@/server/auth/*` files elsewhere in `src/`.
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
  - `openspec/changes/project-task-management/design.md`: "Project and Membership Decisions" (D1–D10, C4), its "Planning decisions Q1 to Q6" bullet (`design.md:179-185`), "API Error Contract" (new 409 codes), and "Data Persistence Decisions" (D-C transfer, D-D keys, D-E open tasks).
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
  - `APP_ORIGIN` is read as `config.appOrigin` in `src/server/config/index.ts`.
  - Auth module layout: `src/server/auth/` has `auth-port.ts`, `auth-service.ts`, `project-authorization.ts`, `session-identity.ts` and `supabase-auth.ts`. It has no `index.ts`; callers import these files directly.
- Workflow evidence for the Step 4 plan: `temp/reflection-notes.md` §1, §2, §3 (D2, D5, D6, D8, D9) and §6 (X1, X2); `.claude/agents/*.md`; `.claude/settings.json`.
- Tests to change or reuse:
  - `tests/unit/project-authorization-routes.test.ts`: the real handlers run with `pg` and Supabase mocked; 501 is asserted at L215-222.
  - `tests/integration/db/support/harness.ts` and `tests/integration/db/support/fixtures.ts` (`createPerson`, `createProject`, `addMembership`, `createTask`, `runtimePool`).
  - Existing DB coverage for key immutability, at-most-one PM and the swap: `tests/integration/db/identifiers-and-revisions.test.ts:141-240` and `tests/integration/db/memberships.test.ts:87-110`.
  - `vitest.config.ts`: `npm test` runs unit tests; `npm run test:integration` needs `TEST_DATABASE_URL`.
- Prior handoff: `workflow/handoffs/identity-access-3-2.md:261,293` (the Origin/CSRF requirement carries into 4.1).

## Decisions and open questions `[ORCH]`

- Current state: Planned. Requirements and decisions were approved and committed in `07974b9`; Q1–Q6 were approved and recorded in `design.md:179-185` and the spec delta. A1 and A2 were refreshed in `orchestrator / 4-1-plan-2`. On 6 November 2026 the human chose test-writer first and approved Q7 and Q8 (recorded in `design.md` "Planning decisions Q7 and Q8"). Ready to launch A2.
- Human-approved decisions:
  - D1–D10 and C1–C5, as recorded under "Human gate" below and in `design.md` "Project and Membership Decisions".
  - Q1–Q6, approved 2026-11-06 by thegrimbee as recommended (`design.md:179-185`): Q1 success bodies; Q2 code-only assertions with fixed server messages; Q3 `githubUsername` body rules; Q4 check order; Q5 handlers and Origin helper in `src/server/projects/`, project stubs replaced in place with thin calls, helpers exposed through the auth module's public entry (A-1 rejected); Q6 no `people` row on `POST /api/v1/projects` → 401 `UNAUTHENTICATED`.
  - PR base: `dev` (main session, Change log).
  - Error codes: 409 `PROJECT_KEY_TAKEN`, 409 `GITHUB_USERNAME_AMBIGUOUS`, 409 `ALREADY_MEMBER`, 409 `TRANSFER_TARGET_NOT_DEVELOPER`, 409 `TRANSFER_BLOCKED_OPEN_TASKS`, and 404 `NOT_FOUND` for an unmatched username. These are recorded in the "API Error Contract".
  - Developer B (thegrimbee) owns all 4.1 paths, and Lim-ZY cross-reviews.
- Orchestrator decisions (coordination only; the human may override):
  - Sequence: withdrawn in `4-1-plan-2`. The earlier "A1, then A2" order conflicted with AGENTS.md. The human resolved the conflict: A2 runs first, then A1 ("Worker order" below).
  - File names inside `src/server/projects/` (`handlers.ts`, `request-guard.ts`, and the D9 files) are coordination choices for write scope, not product decisions. The human may rename them.
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
  - Q7 — RESOLVED 2026-11-06. thegrimbee approved the agent's recommendation: (a) create `src/server/auth/index.ts`, exporting only the moved helpers. Lim-ZY cross-reviews the auth changes. Recorded in design.md "Planning decisions Q7 and Q8". Original question: Q5 says the session and membership helpers are "exposed through the auth module's public entry". The auth module has no public entry: there is no `src/server/auth/index.ts`, and all callers import `@/server/auth/<file>` directly. Not recorded: (a) whether A1 creates `src/server/auth/index.ts` exporting only those helpers, or (b) whether the helpers are exported from `project-authorization.ts` and that file counts as the entry, or (c) something else. Ownership is also unrecorded: C3 gives Developer B the project stubs in `project-authorization.ts`, but a new auth entry file is in Developer A's identity-and-access area (AGENTS.md "Agent Workflow and Roles").
  - Q8 — RESOLVED 2026-11-06. thegrimbee approved the agent's recommendation: move the helpers, without copying them, to `src/server/auth/request-access.ts`, which also gets the Q6 session-to-person step. There is no cycle. Recorded in design.md "Planning decisions Q7 and Q8". Original question: The helpers `getAuthenticatedUserId` and `resolveProjectAccess` are private functions in `project-authorization.ts`. Under Q5 that file's project stubs call into `src/server/projects/`, and the projects handlers call those helpers back. If the helpers stay in `project-authorization.ts`, the two modules import each other. Not recorded whether that cycle is accepted, or whether the helpers move to a separate auth file (a move, not a copy) that both import. Q6 also needs a "session to person, else 401" step that no helper provides today; where it lives follows from the same answer.
  - Worker order — RESOLVED 2026-11-06. thegrimbee chose alternative 1, test-writer first (A2, then A1). See `orchestrator / 4-1-plan-2`, "Worker order".
  - Security-pass findings and the loop limit — RESOLVED 2026-11-06 (thegrimbee approved the agent's recommendation). Security findings have their own budget of 1 fix round, then go to the human. They do not use up the 2 reviewer rounds.
  - Combining a parallel test branch — NOT APPLICABLE. Workers run in sequence in the primary checkout.
  - Conflicts: none open. None found between the approved specs, design.md and the code.

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

### Session `orchestrator / 4-1-plan-2`

- Provider: `claude`
- Provider session ID: subagent `a0f9bb0c9f47eaba8`
- Work ID: `projects-membership-4-1`
- Agent: orchestrator
- Phase: re-planning after Q1–Q6 approval (no workers launched). Supersedes the A1/A2 lists and the sequence in `4-1-plan`.

#### Shared fields `[ALL]`

- Platform and model (if surfaced): Claude Code (Agent SDK subagent), Opus 5.5 (`claude-opus-5-5`)
- Role: Orchestrator
- Human owner and assigned task scope: Developer B (thegrimbee). Refresh A1/A2 for Q1–Q6, add the Step 4 plan fields, record the worker-order conflict. Edit this handoff only.
- Source revision: `68a12fb` (clean tree)
- Started / ended / elapsed `[ALL, optional when surfaced]`: 2026-11-06 18:08:57 to 18:13:05 SGT (from the subagent transcript); 248,060 ms reported by the platform.
- Resource usage (provider-reported): tokens in / out / total; cache read / write; cost; tool calls or other surfaced metrics:
  - Agent result (recorded by the main session): 107,080 tokens, 25 tool uses, 248,060 ms.
  - Per-response usage summed from the subagent transcript `subagents/agent-a0f9bb0c9f47eaba8.jsonl`, 15 responses: input 30, output 24,656, cache read 1,130,284, cache write 103,529.
  - The agent counted 23 tool calls itself; the platform figure is 25.
- Unavailable resource metrics: cost: not available
- Work completed / findings:
  - Refreshed A1 and A2 for Q1, Q3, Q4, Q5 and Q6.
  - Found that the auth module has no public entry (Q7) and that Q5 can create an import cycle (Q8). Both are recorded as open.
  - Found that the reviewer agent has only Read, Grep and Glob (`.claude/agents/reviewer.md`), so it cannot run checks. `4-1-plan` step 4 said the reviewer runs lint, tsc, build and tests; in this plan the main session runs them and gives the output to the reviewer.
  - Added the Step 4 plan fields and recorded the worker order as an open conflict.
- Files changed (use `none` if read-only): `workflow/handoffs/projects-membership-4-1.md`
- Checks run and exact results (use `none` if none were run): none
- Gaps / blockers (use `none` if none): worker order (open conflict); Q7 and Q8 block the A1 auth paths.

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:

  **A1: implementer** (owner thegrimbee; position in the order is open)
  - Scope: the 4.1 behavior in the approved specs, D1–D10 and Q1–Q6. Only the 4.1 project routes.
  - New files, may create:
    - `src/server/projects/index.ts`: the public entry; export only what composition, the route files and `project-authorization.ts` need.
    - `src/server/projects/service.ts`
    - `src/server/projects/repository.ts`
    - `src/server/projects/types.ts`
    - `src/server/projects/errors.ts`
    - `src/server/projects/handlers.ts`: the members and transfer handlers, and the create and read logic that the project stubs now call (Q5).
    - `src/server/projects/request-guard.ts`: the shared Origin and content-type helper (D8, Q5).
    - `src/app/api/v1/projects/[projectId]/members/route.ts`
    - `src/app/api/v1/projects/[projectId]/product-manager-transfer/route.ts`
    - `src/server/auth/index.ts` (Q7): the auth public entry. It exports only the `request-access.ts` helpers and their result types, and must not re-export `project-authorization.ts`.
    - `src/server/auth/request-access.ts` (Q8): `getAuthenticatedUserId`, `resolveProjectAccess`, and the private code they need, all moved here from `project-authorization.ts` rather than copied. Also the new Q6 function, which maps the session to a person ID or returns 401.
  - Existing files, may edit:
    - `src/server/auth/project-authorization.ts`:
      - Replace `handleProjectCreationStub` and `handleProjectReadStub` in place with thin calls into `@/server/projects` (Q5).
      - Remove the moved helpers and import them from `./request-access` (Q8).
      - Do not change the task stub functions or their behaviour. The existing task-stub tests must still pass.
    - Do not change the existing direct `@/server/auth/*` imports elsewhere (Q7). Lim-ZY cross-reviews the `src/server/auth/` changes.
    - `src/server/repositories/people-repository.ts`: add the exact, case-insensitive GitHub-username lookup (D5).
    - `src/server/composition.ts`: wire the new repository and service; add only the fields needed.
    - `src/app/api/v1/projects/route.ts` and `src/app/api/v1/projects/[projectId]/route.ts`: only if the stub function names change; otherwise leave them.
  - Must follow:
    - Q1: `POST .../members` → 201 `{personId, githubUsername, role: "developer"}`, with the stored username. `POST .../product-manager-transfer` → 200 `{id, key, name, role: "developer"}`, the caller's new role.
    - Q2: one fixed server-chosen message per new 409 code; never include user input in a message.
    - Q3: members and transfer bodies are exactly `{githubUsername}`; the value is a string, trimmed, then 1–39 characters of `[A-Za-z0-9-]`; anything else is 400 `INVALID_REQUEST`.
    - Q4: on the three mutating routes, check in order: Origin (403), then content type, body and path ID (400), then session (401), membership (404), role (403), then domain errors (404 or 409). Bad Origin plus bad content type → 403. `GET /api/v1/projects/{projectId}` has no Origin check and starts with the path ID.
    - Q6: `POST /api/v1/projects` with a valid session but no `people` row → 401 `UNAUTHENTICATED`. Project-scoped routes keep 404 for that case.
    - D6: lock both membership rows `FOR UPDATE`, then run the open-task check in the same transaction.
    - D2 and D10: create the project and the PM membership in one transaction.
    - Map unique violations to `PROJECT_KEY_TAKEN` or `ALREADY_MEMBER`.
    - Use parameterized SQL, send `Cache-Control: no-store`, and follow the "API Error Contract".
    - Do not hold a transaction open across anything other than database calls.
  - Must not edit tests, OpenSpec, migrations or dependencies. Use the `present-changes-visually` skill if it is available.
  - Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm test`. If A1 runs before A2, the 501 assertions in `tests/unit/project-authorization-routes.test.ts` are expected to fail; report that and do not fix it.

  **A2: test-writer** (owner thegrimbee; runs FIRST, per the human's 2026-11-06 order decision)
  - Scope: tests for every 4.1 scenario listed under Requirement IDs. A2 works from the specs, `design.md` and this handoff only, with no implementation files (see "Worker order").
  - May edit: `tests/unit/project-authorization-routes.test.ts`. Replace the 501 project read and create assertions (L215-222) and their unmapped-identity exemption with the approved 200 and 201 behavior, and add the Q6 case (no `people` row on create → 401). Keep all task-stub assertions.
  - May create:
    - `tests/unit/project-routes.test.ts`: route tests for create, read, members and transfer. Cover 401, non-member 404, developer 403, the 409 codes, unmatched username 404 `NOT_FOUND`, case-insensitive match, no state change on any denied request, and the Q1 success bodies.
    - `tests/unit/project-origin-check.test.ts`: on all three mutating routes, missing or different Origin → 403 `FORBIDDEN`; wrong content type → 400 `INVALID_REQUEST`; both bad → 403; bad Origin with no session → 403, not 401; a match proceeds to authorization.
    - `tests/unit/projects/project-service.test.ts`: validation and service unit tests (key format without normalization, name trim and 1–100 characters, exact fields, error mapping).
    - `tests/integration/db/projects-membership.test.ts`: the PostgreSQL cases listed in `4-1-plan` A2 (creation transaction and A-3 atomic failure, creator keeps other roles, add-member including concurrent duplicates, transfer success, open-task block, competing transfers, transfer racing an assignment, key immutability per A-2).
  - Test targets added by Q1–Q6:
    - Q1: assert the exact success bodies above, including the stored (not submitted) username casing.
    - Q2: assert status and `code`; assert the message is non-empty and contains no submitted input. Do not assert exact text for the new 409 codes.
    - Q3: extra field; non-string; empty after trim; 40 characters; a disallowed character; leading and trailing spaces trimmed then accepted. Each failure → 400 and no change.
    - Q4: one case per adjacent pair in the order (e.g. bad body without session → 400, not 401; a non-member on a PM-only route → 404, not 403); GET read with a bad UUID → 400 and no Origin check.
    - Q6: create with valid session and no `people` row → 401 `UNAUTHENTICATED`, no project row.
  - Must not edit `tests/integration/db/support/**`, other existing tests, product code, OpenSpec, or AI security evaluation paths. If a shared fixture is needed, report it and do not add it.
  - Checks: `npm test`. Run `npm run test:integration` only if `TEST_DATABASE_URL` points to a disposable database. Otherwise mark the integration tests unverified.

  A1 and A2 never write the same path.

  **Worker order — RESOLVED 2026-11-06: alternative 1, test-writer first (A2, then A1).** The record below is kept as it was presented. Q7 and Q8 now fix where the helpers are exposed: `@/server/auth`, via `request-access.ts`. The other "still unfixed" items remain; see the main-session note in the Change log. A1 receives A2's tests read-only, must make them pass, and reports any test it believes contradicts the specs without editing it.
  - The conflict: `4-1-plan` put the implementer first. AGENTS.md "Agent Workflow and Roles" lists the test-writer (step 3) before the implementer (step 4). `workflow/agents/test-writer.md` says tests are created "from approved requirements and acceptance examples", and the past workflow ran test-writer before implementer (`temp/reflection-notes.md` §1).
  - Now fixed for tests written first:
    - Route paths and methods (D4) and the `GET`/`POST` exports of the route files under `src/app/api/v1/projects/`.
    - Request bodies (D3, Q3), success statuses and bodies (D3, Q1, the read shape in the identity-and-access spec).
    - Error status and `code` for every case (API Error Contract, Q2), the check order (Q4), Origin rules (D8) and the Q6 case.
    - The handler location: `src/server/projects/` (Q5).
    - The schema (migration) and the existing fixtures in `tests/integration/db/support/`.
  - Still unfixed for tests written first:
    - The exported names and signatures in `@/server/projects` (handlers, service, errors).
    - The composition field names for the new service and repository.
    - The service constructor and method signatures that the PostgreSQL integration tests call with `runtimePool`.
    - The SQL text the `pg` mock must answer. The existing route test answers `Pool.query` by SQL text (`tests/unit/project-authorization-routes.test.ts`).
    - The new `PeopleRepository` method name.
    - Where the session and membership helpers are exposed (Q7, Q8), which decides what a route test can mock.
  - Alternatives:
    1. Test-writer first (A2, then A1). Matches the AGENTS.md order. A2 works from the specs and this handoff only. The unfixed items above must be recorded by the human before A2 starts, or A2 reports the tests it cannot write without guessing as gaps.
    2. Implementer first (A1, then A2). The earlier plan. A2 reads A1's public seam and SQL, so the unfixed items are settled by the code. This departs from the AGENTS.md order, and the tests are written with the implementation in view.
    3. Parallel in worktrees (A1 and A2 at the same time from `68a12fb`). The same unfixed items as alternative 1 apply to A2. A1 cannot run A2's tests until the two trees are combined, and combining them needs a git action that requires explicit human authorization.

- Step 4 plan fields:

  **Model and effort per role** (from `.claude/agents/*.md` at `68a12fb`; configs must not change during 4.1)

  | Role | Model / effort / maxTurns | Config blob at `68a12fb` | Reason (project data) |
  |---|---|---|---|
  | test-writer | Opus / medium / 90 | `2792a18` | Test-writers were among the largest consumers (2.4: 64.1k output; 6.3: 67.0k); 90 is about 2× the largest observed run of 45 responses (reflection-notes §2, §3 D6). |
  | implementer | Opus / medium / 120 | `06dcac5` | The 2.4 implementer was the largest single consumer (67.5k output, 59 responses); 120 is about 2× that (§2, §3 D6). |
  | reviewer | Sonnet / medium / 25; tools Read, Grep, Glob | `92ce8a9` | Past Sonnet reviewers took 3–10 responses (§2). Medium effort is unproven (the 6.2 reviewer thought for 76% of its output); X2 on task 4.3 tests it, not 4.1 (§3 D5). |
  | commit-pr | Sonnet / low / 20 | `df5d675` | Commit-pr ran on Opus for 3–9 responses of mechanical git work (§3 D5); 20 is about 2× the observed 9 (§3 D6). |
  | frontend | Sonnet / medium | not used | 4.1 has no UI (C4). |
  | security pass | main-session model (`/security-review` runs in the main session) | n/a | Record the main-session model when it runs; not available to this orchestrator. |

  - X1 record: 4.1 is the full-pipeline arm of X1 and 4.2 the single-agent arm (`temp/reflection-notes.md` §6). The main session records in each worker's session block the resolved model ID (from the transcript, since `sonnet`/`opus` are aliases), effort and maxTurns actually used.
  - Yardstick reviewer (for X1): one fresh `reviewer` agent session with the config above (Sonnet / medium / 25, Read/Grep/Glob, blob `92ce8a9`), run once on the final 4.1 diff and once on the final 4.2 diff with the same prompt. It is separate from 4.1's pipeline reviewer. 4.2 must use the same blob; if `.claude/agents/reviewer.md` changes before then, the comparison is not like-for-like and must say so. The diff base for both is `dev` (the PR base).

  **Context plan**

  | Worker | Given up front | May search on its own |
  |---|---|---|
  | Implementer | This handoff (A1); both spec files; `design.md` "Project and Membership Decisions" incl. Q1–Q6, "API Error Contract", D-C/D-D/D-E; `project-authorization.ts`; `composition.ts`; `people-repository.ts`; the two project route files; `src/server/github-evidence/` (layout precedent); github-repository `route.ts:12` (Origin precedent); `src/server/config/index.ts`; the migration line ranges in Context references. Under alternative 1 also A2's test files (read only). | `src/server/**` and `src/app/api/v1/**` (read); `node_modules/next/dist/docs/` (required by AGENTS.md); `tests/**` (read only). |
  | Test-writer | This handoff (A2); both spec files; the same `design.md` blocks; `tests/unit/project-authorization-routes.test.ts`; `tests/integration/db/support/harness.ts` and `fixtures.ts`; the existing DB tests in Context references; `vitest.config.ts`; the migration. Under alternative 2 also A1's seam: `src/server/projects/index.ts`, the repository SQL and the new composition fields. | Alternatives 1 and 3: `tests/**`, `package.json` scripts, the migration; no `src/server/projects/` files (they do not exist yet). Alternative 2: also `src/server/projects/**` and `src/server/composition.ts` (read). |
  | Reviewer | This handoff (A1, A2, must-follow and Q1–Q6 targets); both spec files; the `design.md` blocks; the list of changed files and the branch diff against `dev`; the main session's check output (lint, tsc, build, unit, integration or "unverified"). | Whole repository, read only. |
  | Security pass | The branch diff against `dev`; identity-and-access "Mutating project routes check the request origin" and "Protected route authorization stubs"; AGENTS.md "Review Procedure" focus list. | Whole repository, read only. |

  **Parallelism plan**
  - Chosen (alternative 1): sequential in the primary checkout. No worktree. The alternative 3 commands below are kept for the record only.
  - Alternatives 1 and 2: sequential in the primary checkout. No worktree.
  - Alternative 3: the implementer stays in the primary checkout; the test-writer gets a manual worktree. Do not use `isolation: worktree`, because it branches from `master` (reflection-notes §3 D9) and this branch is cut from `dev`. A worktree cannot check out a branch that is already checked out, so it needs its own branch:

    ```
    git -C D:/Education/CS3227/CS3227-2610-MP4 worktree add -b feat/projects-membership-4-1-tests D:/Education/CS3227/wt-projects-membership-4-1-tests feat/projects-membership-4-1
    cd D:/Education/CS3227/wt-projects-membership-4-1-tests && npm ci
    ```

    The branch name and directory are placeholders for the human to confirm. `.env.local` is not copied; unit tests need none, and integration tests need `TEST_DATABASE_URL`. How the test branch is combined back (commit then merge, or copying files) is not recorded and needs explicit human authorization. Removing the worktree afterwards also needs the human's permission (AGENTS.md rule 9).

  **Loop limit**
  - At most 2 reviewer fix rounds, then escalate to the human. Fixes go to the worker that owns the path (A1 for product code, A2 for tests).
  - Re-review choice: to be recorded per round (resumed reviewer via SendMessage, or fresh reviewer). X2 compares the two on 4.3; 4.1 only records what was used.

  | Round | Findings (must/should/nit) | Fixed by | Disputed? | How resolved |
  |---|---|---|---|---|
  | 1 | | | | |
  | 2 | | | | |

  - Re-review used: round 1 — to be recorded; round 2 — to be recorded.

  **Who dispatches**
  - `.claude/settings.json` sets `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, so workers cannot launch workers. The main session dispatches every worker and sends fix rounds with SendMessage (flat). The orchestrator only plans and consolidates. E7 (nested dispatch) is not run.

  **Security pass**
  - 4.1 touches authorization (PM-only actions, non-member concealment) and CSRF/Origin. After the reviewer rounds close and before the commit-pr agent, the main session runs `/security-review` on the branch, confirming the diff base is `dev` (at `68a12fb` this branch is 86 commits ahead of `master` and 20 ahead of `dev`). Focus: PM-only checks in handlers and services, 404 concealment, the Q4 order (Origin before session), Q3 validation, parameterized SQL, the D6 locks against the assignee trigger, username lookup (D5 accepts that the PM may learn whether a username is registered), `no-store`, and no internal detail in errors.
  - Loop limit for security findings (resolved 2026-11-06): they have their own budget of 1 fix round, separate from the 2 reviewer rounds. The fix goes to the owning worker, and the security pass is re-run once on the fixed diff. Anything still open after that goes to the human.
  - Also add `src/server/auth/index.ts` and `request-access.ts` to the focus list. Check that the move kept the session and membership checks unchanged for the task stubs.

  **Sequence after the first two workers** (any order alternative)
  1. Main session runs `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`, and `npm run test:integration` only against a disposable database.
  2. Reviewer checks every scenario, the boundaries and code quality, using that output. Up to 2 fix rounds.
  3. Security pass.
  4. Human resolves findings.
  5. Commit-pr agent, only on explicit authorization for `feat/projects-membership-4-1`.
  6. Yardstick reviewer run on the final 4.1 diff (X1), recorded here.

  Task 4.2 should still wait for 4.1 to merge before editing `composition.ts`, `project-authorization.ts` or `tests/unit/project-authorization-routes.test.ts`.
- Consolidation notes: No worker reports yet. The analyst session `a4c7d9e33d08ddc74` is still reusable for 4.1 context. The A1/A2 lists and sequence in `4-1-plan` are superseded by this block; `4-1-plan` is kept as history.

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
| 2026-11-06 18:10 | orchestrator / 4-1-plan-2 | Re-plan at `68a12fb`: A1/A2 refreshed for Q1–Q6 (handlers and Origin helper in `src/server/projects/`, stubs replaced in place); Q1–Q6 must-follow items and test targets added. New open questions Q7 (no auth public entry) and Q8 (possible import cycle). Worker order recorded as an open conflict with three alternatives, no recommendation. Step 4 fields added: model/effort, X1 and yardstick reviewer config, context plan, parallelism plan, 2-round loop table, flat dispatch, security pass. Corrected: reviewer cannot run checks; the main session runs them. Task record, Source and scope, Context references and Decisions updated. |
| 2026-11-06 | main session | Recorded the usage for `4-1-plan-2`. The human chose test-writer first (worker-order conflict resolved) and approved Q7, Q8, the security-pass budget and the not-applicable merge point as the agent recommended. Q7 and Q8 are recorded in design.md "Planning decisions Q7 and Q8". A1 lists `src/server/auth/index.ts` and `request-access.ts`; A2 runs first. Still open before A2 starts: the remaining unfixed seam items (the `@/server/projects` export names, composition fields, service signatures, the SQL text for the `pg` mock, and the `PeopleRepository` method name). Under alternative 1, the human records them, or A2 reports the tests it cannot write without guessing as gaps. |
