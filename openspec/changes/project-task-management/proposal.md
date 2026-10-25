# Proposal

## Why

Software project teams need a shared way to assign work, report progress, review completed work, and understand project activity without piecing updates together across conversations and GitHub. This change defines the product's initial task-management and AI-assisted progress workflow so implementation can proceed against reviewed requirements.

## What Changes

- Introduce projects with one product manager and members who may participate in multiple projects.
- Let product managers create and assign tasks, including acceptance criteria, and let developers submit progress and work for review.
- Require product-manager approval before a developer-submitted task is completed; rejection includes feedback and returns the task to In Progress.
- Let developers provide GitHub evidence for a task and let the application retrieve related commit activity.
- Add AI assessment of how well submitted work appears to meet task acceptance criteria.
- Provide product managers a daily summary of developer-submitted task updates and GitHub activity for 8:00am–6:00pm Singapore Time (SGT, UTC+08:00).
- Keep the supported GitHub reference types (pull requests, branch links, or both) open for product confirmation.

## Capabilities

### New Capabilities

- `task-management`: Project membership, the single product-manager role per project, task assignment, progress updates, and approval/rejection lifecycle.
- `github-evidence`: Developer-supplied GitHub references and retrieval of associated commit activity. Supported reference types remain to be confirmed.
- `completion-assessment`: AI assessment of submitted work against task acceptance criteria, presented as decision support for the product manager.
- `daily-progress-report`: Daily project summaries combining developer task updates and GitHub activity within the shared SGT reporting window.

### Modified Capabilities

None.

## Impact

- Product requirements and later implementation for project membership, tasks, review workflow, GitHub integration, AI assessment, and daily reports.
- GitHub authorization and data access requirements, which must be specified before implementation.
- AI input/output and reporting contracts, which must avoid treating generated assessments as approval actions.
- No existing OpenSpec capability specs are present to modify.
