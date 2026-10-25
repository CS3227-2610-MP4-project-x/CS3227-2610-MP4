# AI Interaction Summary: Align Specs with Agreed Design

Date: 2026-10-25

## User-confirmed decisions

These supersede the matching decisions in `2026-10-25-project-task-management.md`.

- The AI confidence score is removed. The Acceptance Criteria Check reports, for each criterion, addressed / not addressed / unclear with diff evidence, plus possible gaps.
- The check is the developer's AI feature: the developer runs it before submitting, and the latest result is attached to the submission for the product manager.
- Developers attach commits with a commit picker. The project links one GitHub repository, and the app lists the developer's own commits by verified GitHub identity, date range, and branch, instead of the developer pasting PR or branch links.
- The Progress Report covers a date range chosen by the product manager (default: the full current SGT day), replacing the 8:00am–6:00pm window. Every statement cites task IDs.
- Tasks move through To Do, In Progress, In Review, and Done.
- Sign-in uses Supabase Auth with the GitHub provider, for identity and sessions only.
- The runtime LLM is the school-provided SoC LLM.

## Interaction summary

The user discussed the project idea with the AI, covering feasibility, fit with the course requirements, the GitHub commits API, and the tech stack. The user then asked the AI to compare the teammate's initial specs against the agreed idea and list differences and problems. After the teammate agreed to the user's design, the user asked the AI to fix the differences and problems. The AI revised the OpenSpec change and added two capabilities (`identity-and-access`, `ai-safeguards`), adapted `AGENTS.md` to this project, and simplified `specs/ui-spec.md` while adding the missing screens. Role assignment (one role per project), the ownership split, and the UI screen list were written by the AI from the agreed design and need human review.

## Artifacts changed

- `openspec/changes/project-task-management/proposal.md`
- `openspec/changes/project-task-management/design.md`
- `openspec/changes/project-task-management/tasks.md`
- `openspec/changes/project-task-management/specs/task-management/spec.md`
- `openspec/changes/project-task-management/specs/github-evidence/spec.md`
- `openspec/changes/project-task-management/specs/completion-assessment/spec.md`
- `openspec/changes/project-task-management/specs/daily-progress-report/spec.md`
- `openspec/changes/project-task-management/specs/identity-and-access/spec.md` (new)
- `openspec/changes/project-task-management/specs/ai-safeguards/spec.md` (new)
- `AGENTS.md`
- `specs/ui-spec.md`

OpenSpec validation was not run because the OpenSpec CLI is not installed on this machine.
