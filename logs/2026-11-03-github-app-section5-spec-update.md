# GitHub App section 5 specification update

## Human-verified interaction summary

The user approved the GitHub App with installation-token approach, specified that the product manager should be able to add repositories for new projects, confirmed that repository linking should verify the product manager through GitHub App OAuth, and confirmed that each project links one GitHub repository. The user authorized updating the necessary specifications and explicitly said not to implement the work yet. The implementation and validation details below are agent-reported and pending the user's review.

## Work and outcome

- Updated the active proposal, design, GitHub evidence, data persistence, environment configuration, and task breakdown to describe PM-verified repository linking, temporary user authorization, per-repository short-lived installation tokens, branch and commit selection, and one repository binding per project.
- Recorded that one App installation can serve multiple repositories/projects and new repositories can be added to an existing installation. Development and production use separate App registrations.
- Reconciled task ownership: task 5.1 covers PM linking, task 5.2 the GitHub adapter, and task 5.3 shared wiring and environment configuration; Developer B owns the follow-up migration, and the shipped migration remains unchanged.
- No implementation, tests, runtime configuration, or migrations were changed.

## Verification and limits

- `openspec validate project-task-management --strict`: passed.
- `git diff --check`: passed.
- No tests were run because this session only updated specifications and planning artifacts.
- No live GitHub App registration, installation, OAuth flow, or repository access was exercised.

## Changed files

- `openspec/changes/project-task-management/proposal.md`
- `openspec/changes/project-task-management/design.md`
- `openspec/changes/project-task-management/specs/github-evidence/spec.md`
- `openspec/changes/project-task-management/specs/data-persistence/spec.md`
- `openspec/changes/project-task-management/specs/environment-configuration/spec.md`
- `openspec/changes/project-task-management/tasks.md`
- `workflow/handoffs/github-evidence-5.md` (orchestrator handoff update pending)
- This session summary.

No dependencies or generated artifacts were added. The updated OpenSpec contract and handoff remain subject to human review before implementation begins.
