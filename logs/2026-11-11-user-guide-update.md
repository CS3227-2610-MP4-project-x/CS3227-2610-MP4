# AI interaction summary — pending human verification

Date: 2026-11-11

User requested that the user guide reflect repository work to date and include both role workflows, quick start, features, constraints, and FAQ, with a prior MP3 guide offered as a structural reference. Reviewed the current guide, active project/task and role specs, GitHub evidence and completion-assessment specs, dashboard behavior, task list, and implementation status. The linked MP3 page could not be fetched in this environment. Replaced the draft scaffold with current sign-in, project, developer, product-manager, feature, constraint, and FAQ instructions. Explicitly identified Progress Report UI and usage view as coming soon because task 8.3 remains incomplete. No code, dependencies, or tests changed or run. This summary is AI-prepared and requires human verification before it is considered human-verified.

Follow-up: User asked for a brief app introduction at the start of the guide. Added an “About the app” section before Quick start describing the project workflow, the two roles, commit evidence, and advisory AI check. No tests run; documentation-only change.

Follow-up: User asked for project creation steps in the product manager workflow. Added the route from Workspace/project switcher, project key and name guidance, duplicate/invalid correction, automatic creator role, Board landing, and adding developers in Project Settings. Checked these details against the current creation form and page. No tests run; documentation-only change.

Follow-up on 2026-11-12: Compared the guide with repository changes through `6cfc142`. Acceptance Criteria Check now verifies canonical line references, groups verified evidence by file/commit, displays verification downgrades as Unclear, and preserves older flat historical results without invented provenance; the UI exposes expandable evidence by file and omitted files. Updated the feature summary, developer workflow, constraints, and FAQ to explain this behavior. Also reviewed the tester-account decision, which changes local E2E setup rather than user-facing application behavior. No tests run; `git diff --check` passed.
