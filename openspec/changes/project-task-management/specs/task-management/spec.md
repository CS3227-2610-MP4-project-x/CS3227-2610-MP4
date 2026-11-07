# Spec Delta

## Purpose

Defines how project members are organized and how product managers and developers create, assign, progress, submit, and review project tasks.

## ADDED Requirements

### Requirement: Signed-in people create projects
The system SHALL allow any signed-in person to create a project with a key and a name through `POST /api/v1/projects`. The creator SHALL become the project's only product manager, and the project and that membership SHALL be created together or not at all.

#### Scenario: Creator becomes product manager
- **WHEN** a signed-in person creates a project with key `WEB` and a valid name
- **THEN** the system returns HTTP 201 with the project's `id`, `key`, `name`, and `role` of `product_manager`
- **AND** the creator is the project's only product manager and no other membership exists

#### Scenario: Unauthenticated creation
- **WHEN** a request without a valid session creates a project
- **THEN** the system returns HTTP 401 and no project exists

#### Scenario: Signed-in person without an application identity
- **WHEN** a request with a valid session creates a project, but no registered person exists for that session's user
- **THEN** the system returns HTTP 401 with code `UNAUTHENTICATED` and no project exists

#### Scenario: Invalid key
- **WHEN** the key does not match 2 to 10 uppercase letters and digits starting with a letter, including a lowercase key
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, does not normalize the key, and creates nothing

#### Scenario: Duplicate key
- **WHEN** a person creates a project with a key that already exists
- **THEN** the system returns HTTP 409 with code `PROJECT_KEY_TAKEN`, and the existing project is unchanged

#### Scenario: Invalid name or fields
- **WHEN** the name is blank after trimming or longer than 100 characters, or the body has fields other than `key` and `name`
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST` and creates nothing

#### Scenario: Creation is atomic
- **WHEN** creating the product manager's membership fails
- **THEN** no project row remains

#### Scenario: Creator keeps other roles
- **WHEN** a person who is a developer in one project creates another project
- **THEN** they remain a developer in the first project and become the product manager of the new one

### Requirement: Project membership and roles
The system SHALL allow a person to belong to multiple projects with one role per project, either Product Manager or Developer, and each project SHALL have exactly one product manager. The product manager SHALL add a registered person as a developer through `POST /api/v1/projects/{projectId}/members` with a `githubUsername`, matched exactly and case-insensitively against registered people.

#### Scenario: Person belongs to multiple projects
- **WHEN** a person is added to a second project
- **THEN** the person remains a member of both projects, with a separate role in each

#### Scenario: Project has one product manager
- **WHEN** a project is created or its product manager is changed
- **THEN** the project has exactly one product manager

#### Scenario: Product manager adds a developer
- **WHEN** the project's product manager adds the registered person with that GitHub username as a developer
- **THEN** the system returns HTTP 201 with the person's `personId`, stored `githubUsername`, and `role` of `developer`
- **AND** that person becomes a developer, can see the project, and can be assigned its tasks

#### Scenario: Invalid GitHub username body
- **WHEN** the body has fields other than `githubUsername`, or the value is not a string, or after trimming is empty, longer than 39 characters, or contains characters other than letters, digits, and hyphens
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST` and nothing changes

#### Scenario: Unregistered person
- **WHEN** the product manager adds a username that matches no registered person
- **THEN** the system returns HTTP 404 with code `NOT_FOUND` and a generic message, and adds no membership

#### Scenario: Ambiguous username
- **WHEN** the username matches more than one registered person
- **THEN** the system returns HTTP 409 with code `GITHUB_USERNAME_AMBIGUOUS` and adds no membership

#### Scenario: Person already a member
- **WHEN** the product manager adds a person who already has a role in the project, including the product manager
- **THEN** the system returns HTTP 409 with code `ALREADY_MEMBER` and the existing role is unchanged

#### Scenario: Developer cannot add members
- **WHEN** a developer tries to add a member
- **THEN** the system returns HTTP 403 and nothing changes, and a non-member receives HTTP 404

### Requirement: Product manager transfers the role
The system SHALL allow only the project's current product manager to transfer the product manager role, and only to a developer in the same project. In a single change, the outgoing product manager SHALL become a developer and the incoming developer SHALL become the product manager. The system SHALL refuse the transfer while the incoming developer has assigned tasks that are not Done and not deleted.

#### Scenario: Product manager transfers the role
- **WHEN** the product manager transfers the role to a developer in the project who has no open assigned tasks
- **THEN** the system returns HTTP 200 with the project's `id`, `key`, `name`, and the caller's new `role` of `developer`
- **AND** that developer becomes the product manager, the previous product manager becomes a developer, and the project still has exactly one product manager

#### Scenario: Incoming product manager has open tasks
- **WHEN** the product manager tries to transfer the role to a developer who has an assigned task that is not Done and not deleted
- **THEN** the system returns HTTP 409 with code `TRANSFER_BLOCKED_OPEN_TASKS` and a message asking for the task to be reassigned first, and the roles are unchanged

#### Scenario: Deleted tasks do not block transfer
- **WHEN** the incoming developer's only assigned tasks that are not Done are deleted
- **THEN** the transfer succeeds

#### Scenario: Target is not a developer in the project
- **WHEN** the product manager targets a person who is not a developer in the project, or targets themselves
- **THEN** the system returns HTTP 409 with code `TRANSFER_TARGET_NOT_DEVELOPER` and the roles are unchanged

#### Scenario: Developer tries to take the role
- **WHEN** a developer requests a product manager transfer
- **THEN** the system returns HTTP 403, refuses the request, and the roles are unchanged

#### Scenario: Non-member requests transfer
- **WHEN** a non-member requests a transfer
- **THEN** the system returns HTTP 404 and nothing changes

#### Scenario: Competing transfers
- **WHEN** two transfers, or a transfer and a task assignment to the incoming developer, run at the same time
- **THEN** the project ends with exactly one product manager, and a transfer never completes while the incoming developer has an open assigned task

#### Scenario: Losing a competing transfer
- **WHEN** a transfer waits for another transfer in the same project to finish, after which its caller is no longer the product manager
- **THEN** the system returns HTTP 403 with code `FORBIDDEN`, and the waiting transfer changes nothing

### Requirement: Transfer targets are identified by GitHub username
The system SHALL accept a product manager transfer through `POST /api/v1/projects/{projectId}/product-manager-transfer` with the target's `githubUsername`, matched exactly and case-insensitively against registered people, using the same lookup rule as adding a member.

#### Scenario: Target username is not found
- **WHEN** the target username matches no registered person
- **THEN** the system returns HTTP 404 with code `NOT_FOUND` and a generic message, and the roles are unchanged

#### Scenario: Target username is ambiguous
- **WHEN** the target username matches more than one registered person
- **THEN** the system returns HTTP 409 with code `GITHUB_USERNAME_AMBIGUOUS` and the roles are unchanged

#### Scenario: Invalid transfer body
- **WHEN** the transfer body breaks the same `githubUsername` rules as adding a member
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST` and the roles are unchanged

#### Scenario: Target found by username
- **WHEN** the product manager submits the username of a developer in the project, in any letter case
- **THEN** the transfer proceeds to the open-task check and the role change

### Requirement: Projects and tasks have readable IDs
Each project SHALL have a key of 2 to 10 uppercase letters and digits, starting with a letter, that is unique and cannot change. Each task SHALL have a task ID made of the project key and a number, such as `WEB-12`, that is unique within the project and never reused, including after the task is deleted. Commit messages and progress reports refer to tasks by this task ID.

#### Scenario: Task receives an ID
- **WHEN** the product manager creates a task in a project with key `WEB` whose previous task was `WEB-11`
- **THEN** the new task's ID is `WEB-12`

#### Scenario: Deleted task number is not reused
- **WHEN** task `WEB-12` is deleted and a new task is created
- **THEN** the new task's ID is not `WEB-12`

#### Scenario: Project key cannot change
- **WHEN** any request tries to change an existing project's key
- **THEN** the key is unchanged

### Requirement: Product manager manages tasks
The system SHALL allow a project's product manager to create, edit, reassign, and delete tasks. Each task SHALL have a title, a description, at least one acceptance criterion, an assignee who is a developer in the project, a due date, and an optional branch name.

#### Scenario: Product manager creates a task
- **WHEN** the product manager creates a task with acceptance criteria and assigns it to a project developer
- **THEN** the task is in To Do and appears on that developer's board as assigned work

#### Scenario: Task without acceptance criteria is refused
- **WHEN** the product manager saves a task with no acceptance criteria
- **THEN** the system refuses the task and explains that at least one acceptance criterion is required

#### Scenario: Product manager deletes a task
- **WHEN** the product manager deletes a task
- **THEN** the task no longer appears on the board, in the review queue, or in new progress reports, and its history is kept

#### Scenario: Assignee must belong to the project
- **WHEN** the product manager assigns a task to a person who is not a developer in the project
- **THEN** the system refuses the assignment

### Requirement: Authorized members read task detail
The system SHALL provide task detail through `GET /api/v1/projects/{projectId}/tasks/{taskId}` to the assigned developer and the project's product manager. The response SHALL be `{ "task": ..., "attachedCommits": [...], "progressUpdates": [...], "reviewFeedback": [...], "checkHistory": [...] }` and SHALL use `Cache-Control: no-store`.

The `task` object SHALL contain `id` (task UUID), `projectKey`, `taskKey` (the readable key formed from the project key and task number, such as `WEB-12`), `title`, `description`, `status` (the stored task status), `assignee` (`{ "id", "githubUsername" }`), `dueDate` (an ISO calendar date), `branchName` (string or null), and `acceptanceCriteria` (objects containing `id`, `position`, and `description`, ordered by `position` ascending then `id` ascending).

`attachedCommits` SHALL contain objects with `id`, `sha`, `attachedBy` (`{ "id", "githubUsername" }`), and `attachedAt`, ordered by `attachedAt` ascending then `id` ascending. `progressUpdates` SHALL contain objects with `id`, `author` (`{ "id", "githubUsername" }`), `body`, and `createdAt`, ordered by `createdAt` ascending then `id` ascending. `reviewFeedback` SHALL contain objects with `id`, `author` (`{ "id", "githubUsername" }`), `feedback`, and `createdAt`, ordered by `createdAt` ascending then `id` ascending. Timestamps SHALL be ISO 8601 UTC strings. The response SHALL contain only fields needed by the client and SHALL NOT expose auth-user IDs, GitHub numeric user IDs, credentials, tokens, or ORM-private fields.

`checkHistory` SHALL contain one entry per distinct stored check result, ordered by `createdAt` descending then `id` descending, with each entry containing `id`, `anchorSha`, `createdAt`, `redacted`, and `payload`. The project manager's access is read-only.

All collection fields SHALL be JSON arrays, including when no records exist. Task and child records SHALL be read-only in this response; this endpoint SHALL NOT mutate task state, attached commits, progress updates, review feedback, or check history.

#### Scenario: Assigned developer reads task detail
- **WHEN** the assigned developer requests task detail
- **THEN** the response contains the task, attached commits, progress updates, review feedback, and distinct check history using the shapes and ordering above
- **AND** the request changes no task or history state

#### Scenario: Product manager reads task detail
- **WHEN** the project's product manager requests task detail
- **THEN** the response contains the same task detail and check history
- **AND** the response exposes no action to initiate or alter an acceptance criteria check

#### Scenario: Another project developer reads task detail
- **WHEN** a project developer who is not assigned to the task requests task detail
- **THEN** the system returns HTTP 403 and does not expose task or check data

#### Scenario: Nonmember or missing task reads task detail
- **WHEN** a nonmember requests task detail, or the task does not exist in the project or is deleted
- **THEN** the system returns the existing safe HTTP 404 response without task or check data

### Requirement: Task lifecycle
The system SHALL move tasks through the states To Do, In Progress, In Review, and Done. Only the assigned developer SHALL move a task from To Do to In Progress or from In Progress to In Review, and only the project's product manager SHALL move a task from In Review to Done or back to In Progress.

#### Scenario: Developer starts a task
- **WHEN** the assigned developer starts a task in To Do
- **THEN** the task moves to In Progress

#### Scenario: Developer cannot move another developer's task
- **WHEN** a developer tries to change the state of a task assigned to someone else
- **THEN** the system refuses the request and the task state is unchanged

### Requirement: Developer submits task progress
The system SHALL allow an assigned developer to post free-text progress updates on a task, and SHALL retain those updates for the product manager and for project reporting.

#### Scenario: Developer submits an update
- **WHEN** an assigned developer posts a progress update on a task
- **THEN** the update is associated with the task and visible to the project's product manager

### Requirement: Task completion requires product-manager approval
The system SHALL keep a submitted task in In Review until the project's product manager approves it or requests changes. A submission SHALL include the commits attached to the task. It SHALL reference a stored acceptance criteria check only when that check's anchor SHA matches the unique tip of the submitted commit history and its criteria hash matches the current acceptance criteria; otherwise the submission has no check reference. Task-detail reads for the assigned developer and project manager, and review reads for the product manager, SHALL expose `checkHistory` with one entry per distinct stored result in stable newest-first order. Each entry SHALL contain the result ID, anchor SHA, creation timestamp, redaction flag, and result payload. The project manager's check access is read-only.

#### Scenario: Developer submits work for review
- **WHEN** the assigned developer submits a task in In Progress for review
- **THEN** the task moves to In Review and appears in the product manager's review queue with its attached commits and the result referenced by that submission, if any

#### Scenario: Submission has no matching check result
- **WHEN** the assigned developer submits a task for review and no stored check matches both the unique submitted commit-history tip and current criteria hash
- **THEN** the task moves to In Review with its attached commits and no check-result reference
- **AND** the task's distinct stored check history remains available

#### Scenario: Submission history remains readable
- **WHEN** the assigned developer or product manager reads task detail, or the product manager reads the submitted task in the review queue
- **THEN** each response presents `checkHistory` with one entry per distinct result in stable newest-first order, with result ID as the tie-breaker for equal creation timestamps
- **AND** each entry includes result ID, anchor SHA, creation timestamp, redaction flag, and result payload
- **AND** the review response also presents the check result referenced by that submission, if any
- **AND** the product manager cannot initiate or alter a check

#### Scenario: Product manager approves submitted work
- **WHEN** the product manager approves a task in In Review
- **THEN** the task moves to Done

#### Scenario: Product manager requests changes
- **WHEN** the product manager requests changes on a task in In Review and provides feedback
- **THEN** the feedback is associated with the task, visible to the assigned developer, and the task returns to In Progress

#### Scenario: Developer cannot approve a submission
- **WHEN** a developer tries to approve a task or move it to Done
- **THEN** the system refuses the request and the task remains in In Review
