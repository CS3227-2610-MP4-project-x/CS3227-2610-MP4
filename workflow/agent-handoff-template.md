# Agent task handoff

Use one consolidated handoff per task at `workflow/handoffs/<task-id>.md`. The orchestrator owns the consolidated file. Each worker supplies its own session record; do not overwrite another worker's report.

## Task

- Task ID:
- Summary:
- Human owner (Developer A / Developer B):
- Requirement IDs:
- Status:
- Next human action:

## Source and scope

- Repository / branch / worktree:
- Source revision:
- Permitted paths and actions:
- Prohibited paths and actions:
- Dependencies and parallel work:

## Context references

Link to relevant OpenSpec, design, code, tests, or prior handoffs by repository path. Summarize only the context needed to continue; do not duplicate source documents or include secrets, credentials, personal data, or production data.

## Current state and decisions

- Current state:
- Human-approved decisions:
- Assumptions (mark unapproved assumptions clearly):
- Open questions / conflicts:

## Worker session reports

Repeat this section for each worker session.

### Session: `<role> / <session-id>`

- Platform and model (if surfaced):
- Role:
- Human owner and task scope:
- Started / ended / elapsed (if surfaced):
- Resource usage (provider-reported only): tokens in / out / total; cache read / write; cost; tool calls or other relevant usage:
- Unavailable metrics:
- Findings / work completed:
- Files changed:
- Checks run and exact results:
- Gaps / blockers:

Use `not available` for metrics the platform does not expose. Never estimate token usage, cost, elapsed time, or tool counts.

## Consolidated outcome

- Changed files and rationale:
- Tests/checks and results:
- Generated artifacts:
- Dependencies added:
- Known gaps and unverified items:
- Reviewer findings:
- Suggested skills / references for the next worker:
- Next action and responsible human:

## Change log

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| YYYY-MM-DD HH:MM | role / session-id | concise update |
