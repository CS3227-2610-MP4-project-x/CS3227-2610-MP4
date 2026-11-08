# 2026-11-09 — Missing user-flow tasks

- **Human:** thegrimbee (Developer B). **Agent:** Claude Code (Opus 5.5).
- **Prompt 1:** Asked whether project creation was missing from the tasks and to find similar gaps across the complete user flow.
- **Agent findings:** The 4.1/4.2 APIs exist, but no task covered a create-project UI. The 4.4 decision B1 deferred the members screen and member listing, product-manager task create/edit/reassign/delete controls, and the project dashboard without any tracking task. The product-manager transfer UI also had no task. Task 9.2's end-to-end journeys depend on these gaps being closed. Other gaps noted but not changed: `specs/ui-spec.md` still says "token status" (superseded by the GitHub App), and tester accounts are still an open question.
- **Prompt 2:** Asked the agent to add the tasks to `tasks.md` and relevant files, then commit.
- **Changes:** Added tasks 4.5 (create-project page and members screen, including PM transfer), 4.6 (PM task controls) and 4.7 (project dashboard) with a tracking note to `openspec/changes/project-task-management/tasks.md`, and clarified group 8's dependency. Each new task requires a human-approved spec delta before implementation. No requirements or spec text were invented. `design.md` was not edited because it holds uncommitted task 4.4 work.
- **Checks:** Documentation-only change; no tests run.
- **Human verification:** Pending review by thegrimbee.
