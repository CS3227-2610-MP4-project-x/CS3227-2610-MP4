# 2026-11-09: Shared loading feedback

Tool: Codex. Work: shared loading indicators for the application UI.

## Human prompts and decisions

1. The user requested an animated icon to the right of button text across screens, citing GitHub sign-in, account sign-out, and project creation/open-board actions.
2. The assistant recommended showing the indicator only for actions that wait on a request or navigation, while leaving immediate controls such as menu/dialog toggles and Cancel without a spinner. The user approved this scope.

## Changes

- Added the `interaction-feedback` capability to the active `project-task-management` OpenSpec change, including the visual/accessibility behavior, design approach, and tracked task 10.1.
- Added a shared inline spinner, same-origin navigation link feedback, sign-in feedback, and reload feedback. Applied it to current app navigation and asynchronous controls across workspace, project, task, review, GitHub setup, and account screens.
- Kept existing pending labels, disabled states, request flows, and failure messages. Added reduced-motion handling and `aria-busy` state. Immediate menu, dialog, local-edit, and cancel controls remain unchanged.
- Preserved the pre-existing workspace/sign-in branding and account-menu edits. `next-env.d.ts` was left untouched.

## Review and validation

- A read-only reviewer identified pagination visibility, unrelated repository-button spinners, and a canceled-request edge. These were addressed; the final source review reported no remaining findings.
- No tests, type-check, build, or browser checks were run in this session. No dependencies or migrations were added.
- Human verification of this interaction summary is pending.

## Next human action

Review the UI change and this summary. The source-level review does not confirm rendered browser behavior.
