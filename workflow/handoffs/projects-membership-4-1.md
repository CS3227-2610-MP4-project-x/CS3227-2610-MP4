# Projects and membership: task 4.1 handoff

## Task record `[ORCH]`

- Task ID: `projects-membership-4-1` (OpenSpec task 4.1)
- Summary: 4.1 — Implement creation, keys, memberships, one-PM invariant and PM transfer; decide project-creation policy and initial PM selection; add PostgreSQL integrity and project-route authorization tests (`openspec/changes/project-task-management/tasks.md:31`).
- Change: `project-task-management`
- Branch: `feat/projects-membership-4-1`
- Human owner (Developer A / Developer B): Developer B (thegrimbee); cross-review Lim-ZY (per C3 resolution)
- Date: 2026-11-06
- Requirement IDs:
- Status:
- Next human action:

## Source and scope `[ORCH]`

- Repository / branch / worktree:
- Source revision:
- Permitted paths and actions:
- Prohibited paths and actions:
- Dependencies and parallel work:

## Context references `[ALL, when relevant]`

List only the OpenSpec, design, code, tests, or prior handoff paths needed for this agent's task. Omit this section if no references apply. The analyst should use its role-specific source index below instead of duplicating the same paths here.

## Decisions and open questions `[ORCH]`

- Current state:
- Human-approved decisions:
- Assumptions (identify unapproved assumptions):
- Open questions / conflicts:

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

### Session `<role> / <session-id>`

For Codex work, include the following structured attribution fields in the root
session block so its workflow role and work item can be matched without
inference. Use the exact provider session ID surfaced by Codex; never use a
subagent hook's parent `session_id` as a child ID. Codex lifecycle hooks map
subagents through their exact transcript relationship and provide the surfaced
agent type/ID. Do not invent missing identifiers. For Claude sessions, include
these fields when surfaced.

- Provider: `codex` or `claude`; required for the root session
- Provider session ID: exact provider-generated session identifier; required when surfaced
- Work ID: explicit task/work identifier; required for Codex root sessions
- Agent: workflow role or agent label; required for Codex root sessions
- Phase: lifecycle phase; required when recorded by the workflow

#### Shared fields `[ALL]`

- Platform and model (if surfaced):
- Role:
- Human owner and assigned task scope:
- Source revision:
- Started / ended / elapsed `[ALL, optional when surfaced]`:
- Resource usage (provider-reported): tokens in / out / total; cache read / write; cost; tool calls or other surfaced metrics:
- Unavailable resource metrics:
- Work completed / findings:
- Files changed (use `none` if read-only):
- Checks run and exact results (use `none` if none were run):
- Gaps / blockers (use `none` if none):

#### Test-writer fields `[TEST-WRITER]`

- Test files changed:
- Scenarios and requirement IDs covered:
- Coverage gaps:

#### Implementer fields `[IMPLEMENTER]`

- Implementation files and rationale:
- Visual diff path, or reason skill was unavailable:
- Other generated artifacts / dependencies:

#### Frontend fields `[FRONTEND; only for UI changes]`

- UI intent / acceptance criteria / UI-spec sections checked:
- Routes, user role, browser/runtime, viewport(s), and UI states inspected:
- Actions exercised and results (or reason runtime inspection was unavailable):
- Evidence references (screenshot, browser state, or UI source path):
- UI fit assessment (matches / partly matches / unverified) and limitations:
- Specific UI update recommendations, each in `location / element: current → desired`, with rationale and severity:

#### Reviewer fields `[REVIEWER]`

- Acceptance-criteria status (met / unmet / unverified, with evidence):
- Code-quality findings (cohesion, coupling, abstractions, reuse):
- Other findings by severity and evidence:
- Review limits:

#### Commit/PR fields `[COMMIT-PR]`

- Base branch and comparison used:
- Complete branch-change inventory:
- Existing commits and proposed scoped commit groups:
- Commit hashes, or why commits were not authorized/safe:
- Draft PR title:
- Draft PR description:
- Push / PR creation status:

#### Orchestrator fields `[ORCH]`

- Assignments, dependencies, and handoff decisions:
- Consolidation notes:

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
- C5: Leave the stale encrypted-token text in design.md "Risks / Trade-offs" untouched; follow-up only.

### Approved spec paths

- `openspec/changes/project-task-management/specs/task-management/spec.md`
- `openspec/changes/project-task-management/specs/identity-and-access/spec.md`
- Validation: `npx openspec validate project-task-management --strict` → valid.

### Source revision at the gate

- Commit SHA: `e9c29cdf875b93589fbe4ef1b6816f9c0e742157` (HEAD of `feat/projects-membership-4-1`). The approved spec edits are NOT yet committed; they are working-tree changes on top of this SHA.

### Open items at the gate (recorded, not resolved)

- Resolved 2026-11-06: the main session added the decisions record, the Open Questions resolution and the new error codes to `design.md` at the human's request.
- Resolved 2026-11-06 (human accepted the agent's recommendation): 409 `GITHUB_USERNAME_AMBIGUOUS`, 409 `ALREADY_MEMBER`, 409 `TRANSFER_TARGET_NOT_DEVELOPER`; unmatched usernames return 404 `NOT_FOUND` on both routes. Recorded in the task-management spec and design.md.
- `tests/unit/project-authorization-routes.test.ts:215-222` still asserts 501 and contradicts the approved specs; for the test-writer.

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
| YYYY-MM-DD HH:MM | role / session-id | concise update |
