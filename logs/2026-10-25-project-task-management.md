# AI Interaction Summary: Project Task Management

Date: 2026-10-25

## User-confirmed decisions

- Developers submit task work for product-manager approval before a task can be completed.
- The product manager can reject a submission with feedback; the task returns to In Progress.
- The application connects to GitHub and retrieves commits using developer-provided GitHub evidence. Whether supported inputs are pull requests, branch links, or both remains to be confirmed.
- The AI confidence score assesses how well submitted work meets the task's acceptance criteria. The score scale and interpretation remain to be decided.
- Daily reports summarize developer-submitted task updates and GitHub activity for 8:00am–6:00pm SGT (UTC+08:00), shared across projects.
- A person can belong to multiple projects; each project has exactly one product manager.

## Interaction summary

The user asked how to apply OpenSpec to a task-management product for software project teams. During OpenSpec exploration, the user clarified the task review flow, GitHub evidence, AI assessment target, daily-report sources and window, timezone, and project membership rules. The user then asked to capture the decisions as an OpenSpec change. The change artifacts record these decisions and identify the unresolved GitHub reference format, authorization, score interpretation, and architecture review as prerequisites to implementation.

## Artifacts created

- `openspec/changes/project-task-management/proposal.md`
- `openspec/changes/project-task-management/specs/task-management/spec.md`
- `openspec/changes/project-task-management/specs/github-evidence/spec.md`
- `openspec/changes/project-task-management/specs/completion-assessment/spec.md`
- `openspec/changes/project-task-management/specs/daily-progress-report/spec.md`
- `openspec/changes/project-task-management/design.md`
- `openspec/changes/project-task-management/tasks.md`

OpenSpec standard and strict validation both passed.
