# User Guide — Draft

> **Status: unfinished.** This document is a visible scaffold for the required user guide. It does not yet provide verified sign-in, deployment, or feature-testing instructions.

## Product overview

Add a concise description of the released product and its available roles after the task lifecycle and user journeys are implemented and reviewed.

## Access and test setup

Add the confirmed application URL, sign-in steps, account requirements, and test setup. Do not publish credentials. The correct development and production access paths still need to be confirmed by the team.

## Developer workflows

Document only the developer features available in the release, with verified steps and expected results. Include GitHub commit evidence only after confirming the deployed repository setup.

### Project dashboard and switching projects

The approved dashboard flow opens your last selected project after sign-in in the same browser. If that project is no longer available, it opens the first accessible project by name. With no projects, the dashboard shows empty cards and a prominent **Create project** action. A project-loading error shows a retry message rather than empty results.

Use the project selector at the top left to switch projects. **Dashboard** and **Board** show the same selected project. Switching from Board keeps you on Board. Other available sections are preserved when your role in the destination project permits them; otherwise Dashboard opens. Switching from an individual task opens the destination dashboard.

On the developer dashboard, **Project progress** shows completed tasks across the project. **Task summary** and **My tasks** show only tasks assigned to you. Use **All**, **To Do**, **In Progress**, **In Review** or **Done** to filter My tasks; the summary and project progress do not change when filtering. Each task shows its description, status, due date, optional branch, update count and attached-commit count. **View task** opens its detail page. Status labels accompany grey, blue, yellow and green accents respectively.

The product-manager dashboard retains Project Overview, project-wide metrics, Task Allocation and its existing management actions. Available controls always follow your role in the selected project.

Deployment and complete authenticated-journey verification remain pending; see `workflow/handoffs/developer-dashboard-project-switching.md` for local validation evidence and limitations.

## Product manager workflows

Document only the project manager features available in the release, including the review and task-state flow once those screens are complete.

## Limitations and support

Add known limitations, safe recovery steps, and a team contact after the release behavior has been verified.
