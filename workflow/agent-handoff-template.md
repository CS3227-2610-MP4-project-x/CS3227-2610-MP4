# Agent task handoff

Use one consolidated handoff per task at `workflow/handoffs/<task-id>.md`. The orchestrator owns that file and consolidates the assigned workers' session reports.

## How to fill this template

- `[ALL]` means every agent contributing a session report must provide the field.
- A role tag means only that role provides the field: `[ORCH]` orchestrator, `[ANALYST]` analyst, `[TEST-WRITER]` test-writer, `[IMPLEMENTER]` implementer, `[REVIEWER]` reviewer, `[COMMIT-PR]` commit/PR agent.
- Include only fields tagged `[ALL]` or with your role. Omit unrelated role fields and whole sections that do not apply; do not fill them with `N/A`.
- Required fields must be present. For required resource metrics the platform does not expose, write `not available`; never estimate usage. For a required results/findings field with no results/findings, write `none`.
- Keep source documents linked by repository path rather than copying them. Never include secrets, credentials, personal data, or production data.

## Task record `[ORCH]`

- Task ID:
- Summary:
- Human owner (Developer A / Developer B):
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

List only the OpenSpec, design, code, tests, or prior handoff paths needed for this agent's task. Omit this section if no references apply.

## Decisions and open questions `[ORCH, ANALYST]`

- Current state:
- Human-approved decisions:
- Assumptions (identify unapproved assumptions):
- Open questions / conflicts:

## Worker session reports

Repeat one session block for each assigned agent session. Include the shared fields and only the fields for that session's role.

### Session `<role> / <session-id>`

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

#### Analyst fields `[ANALYST]`

- Requirement IDs and acceptance examples:
- Open product/design decisions:
- OpenSpec files changed:

#### Test-writer fields `[TEST-WRITER]`

- Test files changed:
- Scenarios and requirement IDs covered:
- Coverage gaps:

#### Implementer fields `[IMPLEMENTER]`

- Implementation files and rationale:
- Visual diff path, or reason skill was unavailable:
- Other generated artifacts / dependencies:

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

## Consolidated outcome `[ORCH]`

- Changed files and rationale:
- Tests/checks and results:
- Generated artifacts:
- Dependencies added:
- Known gaps and unverified items:
- Reviewer findings:
- Branch inventory, scoped commits, and PR draft (include only when commit/PR agent was assigned):
- Suggested skills / references for the next worker `[ORCH, when applicable]`:
- Next action and responsible human:

## Change log `[ORCH]`

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| YYYY-MM-DD HH:MM | role / session-id | concise update |
