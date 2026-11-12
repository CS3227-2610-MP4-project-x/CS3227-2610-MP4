# NoPressure User Guide

This guide explains the current project workspace for developers and product managers. The workspace keeps task planning, progress updates, review, and GitHub commit evidence together. Sign in with the GitHub account registered for the project; the workspace uses that verified identity for project membership and commit authorship.

## About the app

NoPressure aims to bridge the gap between developers and product managers, by helping software project teams plan and track tasks from assignment through review. Developers manage their assigned work and submit GitHub commit evidence, while product managers organize the project and review completed work. An AI Acceptance Criteria Check can help developers compare attached changes with task criteria; the product manager remains responsible for approval.

## Quick start

1. Open the application URL supplied by your team. For local setup, use the environment and sign-in instructions in the [Developer Guide](developer-guide.md).
2. Choose **Sign in with GitHub** and authorize the account that belongs to the project.
3. Select a project from the project switcher. Your last selected project is remembered in this browser. The remembered selection does not automatically grant access; project membership will be checked each time.
4. Open **Dashboard** for a project overview or **Board** for an overview of tasks.
5. Follow the workflow for your project role below. For developers, you may skip to [Developer workflow](#developer-workflow). For product managers, you may skip to [Product manager workflow](#product-manager-workflow). If you have no project yet, create one from the workspace and become its product manager, or ask an existing product manager to add your registered GitHub username.

## Features

- **Projects and roles:** A person can belong to multiple projects as a developer or product manager. Each project has one product manager. The creator of a project becomes its product manager.
- **Dashboard:** Both roles can see project completion and task allocation. Developers also get their own task summary and filters. Product managers get task-management actions.
- **Board and task details:** Tasks move through **To Do**, **In Progress**, **In Review**, and **Done**. Details include acceptance criteria, assignee, due date, optional branch, progress updates, attached commits, and review feedback.
- **Task management:** Product managers can create, edit, assign, reassign, and delete tasks. A task must have at least one acceptance criterion and an assigned project developer.
- **GitHub repository and commits:** A product manager links one repository in Project Settings. The assigned developer can select their own commits from a branch and save the selection while the task is In Progress.
- **Acceptance Criteria Check:** The assigned developer can request an AI review of attached commit diffs against each criterion. Results show addressed, not addressed, or unclear, with verified evidence grouped by file and commit, plus possible gaps.
- **Project switching and account controls:** Use the top-left project selector to switch projects. Your verified GitHub account and sign-out control are at the top right.

## Developer workflow

1. On the Dashboard, review **My tasks** and use the status filters to find work. The project progress figure covers the whole project; your task summary covers tasks assigned to you.
2. Open a task and read its description and acceptance criteria. Ask the product manager to clarify or update criteria if needed.
3. Open **Change status** and choose **Move to In Progress**. If the task has a branch, use that branch when preparing your work.
4. Add a progress update from the task page when you have useful status to share.
5. If a repository is linked, open the commit picker, choose the branch and commits you authored, then save. You can stage removals and additions before saving. Commit selection is available only while the task is **In Progress**.
6. Run **Acceptance Criteria Check** to get an advisory comparison of the attached diffs with the criteria. Review each status, expand **Evidence by file** to inspect the supporting excerpts, and check possible gaps or files not assessed. If evidence cannot be verified, the result may mark the criterion **Unclear**. Make any changes you consider appropriate; the check does not change task status or decide whether work is acceptable.
7. Choose **Submit for review** when ready. The task moves to **In Review** for the product manager.
8. If changes are requested, read the feedback, return the task to **In Progress**, address it, update commits as needed, and submit again. A product manager's approval moves the task to **Done**.

## Product manager workflow

### Create a project

1. From the workspace, choose **Create project**. You can reach the workspace with **Back to Project Space** or use **Create project** in the project switcher.
2. Enter a unique **Project key** using 2–10 uppercase letters and digits, starting with a letter (for example, `WEB2`). Keys are not automatically converted to uppercase.
3. Enter the **Project name** and choose **Create project**. If the key is already in use or a field is invalid, correct it and try again.
4. The project opens on its Board, and you become its product manager.
5. Navigate to Settings. This page shows **Project Settings**. You may add a developer to the project using their username before assigning tasks to them.
6. You may then connect a repository to the project created by installing the GitHub App as instructed in the `GitHub repository` section of the page.

### Manage a project

1. Open the project Dashboard to review completion, allocations, and items awaiting attention. Use the project switcher to move among projects you manage.
2. Create tasks from the Dashboard or Board. Enter a title, description, due date or branch if applicable, at least one acceptance criterion, and a project developer as assignee.
3. Use the Board or a task page to edit task details, reassign work, or delete a task. Deletion removes it from active views while preserving its history.
4. In **Project Settings**, add developers by their registered GitHub username. You can also transfer the product-manager role to a current developer. A transfer is refused while the project has open tasks.
5. In **Project Settings**, connect the GitHub App and link one repository to the project. You may need to be an owner or administrator of the GitHub account or organization to install the App or grant it repository access.
6. Open **Review Queue** to find tasks in **In Review**. Inspect the task details, attached commits, developer updates, and any Acceptance Criteria Check result associated with the submission.
7. Choose **Approve** to move the task to **Done**, or **Request changes** and provide feedback. Only the product manager can make this review decision.

## Constraints

- Sign-in uses GitHub. A product manager can add only a person whose GitHub identity is registered in the application.
- Project pages and actions require membership and the appropriate project role. A developer can manage only tasks assigned to them; product-manager actions are unavailable to developers.
- Each project links one GitHub repository. GitHub access, branch/commit availability, rate limits, or revoked permissions can temporarily prevent evidence from loading; an unavailable result does not mean there are no commits.
- Commit selection and changes to the attached commit set are limited to **In Progress** tasks. Newly selected commits must be reachable from the selected repository branch and authored by the assigned developer's verified GitHub identity.
- The Acceptance Criteria Check assesses filtered diffs, not whether code builds, tests pass, or the task should be approved. It is advisory and may identify unclear results or omitted files. Evidence is shown by file and commit only when it can be verified against the assessed changes; older check history may not include file provenance. The product manager remains responsible for review.
- The Progress Report page and project AI usage view are not available yet. The Dashboard's Progress Report control is marked as coming soon.
- A task must retain at least one acceptance criterion. A product-manager transfer cannot proceed while open tasks remain.

## FAQ

### I signed in but cannot see a project. What should I do?
Ask the product manager to add the GitHub username shown in your account menu. If this is a new project, create it from the workspace or ask a signed-in person to create it and add you.

### I added a member, but the username was not found.
The person must first sign in with GitHub so the application has their verified identity. Then try the exact GitHub username shown on their account.

### Why can’t I change commits on my task?
Commit selection can be edited only while the task is **In Progress**, and only by its assigned developer. Ask the product manager to return a task in review to **In Progress** if revisions are needed.

### Why is a repository or commit list unavailable?
The product manager should check the repository link and the GitHub App installation's access. GitHub may also be temporarily unavailable or rate limited. Retry later or ask the project manager to restore access.

### Does the Acceptance Criteria Check approve my task?
No. It provides criterion-by-criterion evidence from attached diffs. You choose how to use its suggestions, and the product manager makes the review decision.

### Why was a criterion marked Unclear even though the AI suggested it was addressed?
The check verifies evidence against the attached changes. If it cannot verify enough evidence, it marks the final status **Unclear** and explains the verification issue. Open **Evidence by file** to inspect any verified excerpts that remain.

### Can a developer approve or request changes?
No. Developers submit their assigned task for review. Only the project's product manager can approve it or request changes.

### Why is Progress Report disabled?
The report-generation service exists, but its user interface and project usage view are not implemented yet. The Dashboard labels this feature as coming soon.

### How do I switch projects or return to the project list?
Use the project selector at the top left to switch directly. Choose **Back to Project Space** to return to the workspace project list.
