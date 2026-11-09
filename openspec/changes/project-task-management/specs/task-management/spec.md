# Spec Delta

## Purpose

Defines how project members are organized and how product managers and developers create, assign, progress, submit, and review project tasks.

## ADDED Requirements

<!-- Task 4.6 approved by the human on 9 November 2026; decisions recorded in design.md. -->

### Requirement: Product-manager task control visibility
The board SHALL show New Task only to the project's product manager. Task detail SHALL show Edit, Reassign and Delete only to that product manager, in every non-deleted task state. These controls SHALL use existing task routes and server authorization. Developers SHALL receive no task-management forms or member-choice data.

#### Scenario: Product manager opens task pages
- **WHEN** the current product manager opens the board or an accessible task detail
- **THEN** the board offers New Task and task detail offers Edit, Reassign and Delete
- **AND** task-management controls offer no lifecycle transition or check execution

#### Scenario: Developer opens task pages
- **WHEN** a developer opens their board or assigned task detail
- **THEN** none of New Task, Edit, Reassign or Delete is rendered, including disabled variants
- **AND** no member-choice data is sent for these forms

### Requirement: Product manager chooses task assignees
New Task and Reassign SHALL use the existing PM-authorized member read, called from the Server Component, and offer only developer memberships by GitHub username, submitting their person UUIDs. They SHALL preserve member-read ordering and add no route, server contract or authorization rule.

#### Scenario: Eligible developers
- **WHEN** member loading succeeds
- **THEN** the selector lists only this project's developers, excluding the product manager
- **AND** Reassign initially selects the task's current assignee

#### Scenario: No developer or unavailable members
- **WHEN** the list has no developers or member loading fails
- **THEN** the affected form cannot submit and explains respectively that a developer must be added in Settings or that member loading must be retried
- **AND** Edit and Delete do not depend on member-list availability

### Requirement: Product manager creates a task from the board
New Task SHALL open an inline form with labeled title, description, developer assignee, due date, optional branch and ordered acceptance-criterion inputs. It SHALL POST the existing create payload, with criteria as strings, to the project's tasks route. A blank optional branch SHALL be sent as null. Cancel SHALL close the form without a request.

#### Scenario: Successful task creation
- **WHEN** the product manager submits valid inputs and the route returns 201
- **THEN** the UI navigates to the returned task's detail and refreshes server data
- **AND** the task key is server-allocated and its initial state follows the existing create contract

### Requirement: Product manager edits task fields
Edit SHALL open an inline form initialized from current task detail, using existing field validation and PATCH with the displayed version. It SHALL edit title, description, due date, optional branch and ordered criteria, preserve retained criterion IDs, omit IDs for new criteria and omit removed criteria. Assignee and state SHALL NOT be sent in this request.

#### Scenario: Save edited criteria and fields
- **WHEN** the product manager saves valid edits
- **THEN** PATCH sends version and editable fields, with criteria as the complete ordered list of objects
- **AND** success closes the form and refreshes detail before another write uses the new version

#### Scenario: Cancel an edit
- **WHEN** the product manager cancels
- **THEN** the draft is discarded without a request or task change

### Requirement: Product manager reassigns or deletes a task
Reassign SHALL submit exactly `{assigneeId, version}` to the existing assignee PUT route. Delete SHALL require explicit confirmation naming the task key and explaining removal from the board, then send exactly `{version}` as JSON to the task DELETE route. These actions SHALL use the displayed task version and retain existing soft-delete and reassignment semantics.

#### Scenario: Reassign succeeds
- **WHEN** PUT returns 200, including a current-assignee no-op
- **THEN** the UI closes the form and refreshes detail, showing the returned assignment without locally changing state

#### Scenario: Confirm or cancel deletion
- **WHEN** the product manager cancels confirmation
- **THEN** no request is sent
- **WHEN** the product manager confirms and DELETE returns 204
- **THEN** the UI navigates to the board and refreshes it, without parsing a response body

### Requirement: Task forms explain validation failures
Task forms SHALL follow the existing task field limits, trimming, Unicode code-point counts, real calendar dates and branch rules. Criteria SHALL support ordered addition and removal within the existing 1–20 limit. Validation messages SHALL be safe and accessible, preserve draft input and identify required corrections; server validation remains authoritative.

#### Scenario: Invalid form input
- **WHEN** required text or criteria are blank, a limit is exceeded, the due date is invalid, or the optional branch is invalid
- **THEN** submission is blocked with an actionable message
- **AND** past due dates remain allowed and a blank branch means no branch

#### Scenario: Server rejects validation
- **WHEN** the route returns 400 INVALID_REQUEST or ACCEPTANCE_CRITERIA_REQUIRED
- **THEN** the form preserves input and shows a safe correction message without claiming success

#### Scenario: Assignee eligibility changed
- **WHEN** create or reassign returns 409 ASSIGNEE_NOT_DEVELOPER
- **THEN** the form asks the product manager to reload developer choices and choose an eligible assignee
- **AND** it does not treat this as a stale-version error or retry automatically

### Requirement: Task controls recover safely from refused writes
Task controls SHALL prevent repeat submission while pending and SHALL refresh authoritative data after success. They SHALL NOT retry mutations automatically or optimistically change task data. Errors SHALL show safe accessible messages without raw provider or server details. A refreshed version SHALL require a new explicit user action before another mutation.

#### Scenario: Stale task version
- **WHEN** edit, reassign or delete returns 409 VERSION_CONFLICT
- **THEN** the UI shows "The task was changed by someone else. Reload and try again", closes the stale form or confirmation and refreshes task data
- **AND** it does not resubmit the discarded draft with the new version

#### Scenario: Forbidden task mutation
- **WHEN** any task-management mutation returns 403
- **THEN** the UI shows a safe reload-and-retry message, disables the current task-management controls and refreshes server access and data
- **AND** refreshed role visibility controls whether new PM actions are available

#### Scenario: Session or task unavailable
- **WHEN** a mutation returns 401 or 404
- **THEN** the UI disables further submission and refreshes server access and data, using the existing sign-in, unavailable or not-found page outcomes

#### Scenario: Network or unexpected failure
- **WHEN** a request fails operationally or returns an unexpected response
- **THEN** the UI displays a safe failure message without claiming success or retrying automatically
- **AND** it asks the person to reload authoritative data before repeating a mutation whose outcome is uncertain

### Requirement: Return to Project Space
The shared project-page navigation SHALL expose a "Back to Project Space" link with href `/`, above the project tabs for both developers and product managers. Existing tab order, active states and server access checks SHALL remain unchanged.

#### Scenario: Developer returns to Project Space
- **WHEN** an authorized developer opens a project board or task-detail page
- **THEN** the shared navigation shows "Back to Project Space" above the tabs linking directly to `/`

#### Scenario: Product manager returns to Project Space
- **WHEN** an authorized product manager opens a project page
- **THEN** the shared navigation shows the same return link above the tabs
- **AND** role-specific tab visibility and active states remain unchanged

### Requirement: Signed-in people use the create-project page
The system SHALL provide dynamically rendered `/projects/new`, reachable from My projects for every signed-in person, including those with no projects. Labeled key and name inputs SHALL submit exactly `{key,name}` to `POST /api/v1/projects`, following "Signed-in people create projects" validation without normalizing lowercase keys.

#### Scenario: Successful creation through the page
- **WHEN** a signed-in person submits a valid key and name
- **THEN** the existing route atomically creates the project and sole PM membership
- **AND** the UI navigates to `/projects/{returned id}/board`

#### Scenario: Invalid or duplicate project through the page
- **WHEN** input is invalid or the route returns `PROJECT_KEY_TAKEN`
- **THEN** the form preserves entered values and shows a safe validation or conflict message

#### Scenario: Signed-out create-page visitor
- **WHEN** a person without a valid session opens `/projects/new`
- **THEN** they are redirected to `/sign-in`

#### Scenario: Pending or failed creation request
- **WHEN** submission is pending
- **THEN** repeat submission is disabled
- **AND** a failed request shows a safe message without claiming success or automatically repeating the mutation

### Requirement: Product manager reads project members
The system SHALL provide a server-only projects-module read that independently checks current membership and PM authorization. It SHALL return only `{personId, githubUsername, role}`, including the PM, ordered by case-insensitive username then person ID ascending. It SHALL return all members without pagination, perform no writes, expose no new HTTP route and use no persistent cache.

#### Scenario: Product manager lists members
- **WHEN** the current PM opens project settings
- **THEN** the members section shows all members and their roles in the recorded order

#### Scenario: Unauthorized direct member read
- **WHEN** a developer invokes the member read
- **THEN** it refuses with `FORBIDDEN` and no member data
- **AND** a nonmember or missing project receives `NOT_FOUND`

#### Scenario: Safe members page access outcomes
- **WHEN** the page has no valid session, no project access, or insufficient role
- **THEN** it respectively redirects to `/sign-in`, shows safe not-found, or shows a safe unavailable members view without member data

#### Scenario: Member loading operational failure
- **WHEN** member loading fails operationally
- **THEN** the section shows a safe retry message without raw errors or member data

### Requirement: Product manager manages members through settings
The system SHALL provide the member list, Add member form and PM-transfer control within `/projects/{projectId}/settings`, preserving the repository panel. Client actions SHALL use existing 4.1 routes, payloads and safe errors. Member removal and standalone role changes SHALL NOT be offered.

#### Scenario: Add registered developer through settings
- **WHEN** the PM submits a GitHub username
- **THEN** the UI sends exactly `{githubUsername}` to the existing members POST route
- **AND** success refreshes the server member list and clears the successful input

#### Scenario: Refused member addition through settings
- **WHEN** addition returns invalid input, unregistered or ambiguous username, or already-member errors
- **THEN** a safe actionable message appears, input is preserved and success is not displayed

#### Scenario: Confirm product-manager transfer
- **WHEN** the PM selects an existing developer from the member list
- **THEN** explicit confirmation names the target and explains that the caller becomes a developer
- **AND** only confirmation sends exactly `{githubUsername}` to the existing transfer route

#### Scenario: Successful transfer through settings
- **WHEN** transfer succeeds
- **THEN** the UI navigates to the board and refreshes server-rendered access and navigation so outgoing-PM controls disappear

#### Scenario: Refused transfer or changed access
- **WHEN** transfer is blocked by open tasks or another existing domain error
- **THEN** the UI displays the safe reason without claiming a role change
- **AND** authorization failures trigger fresh server access evaluation without keeping actionable PM controls

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

#### Scenario: Concurrent task creation receives distinct IDs
- **WHEN** two tasks are created in the same project at the same time
- **THEN** they receive different task IDs

#### Scenario: Refused creation does not use a task number
- **WHEN** a task creation in a project whose previous task was `WEB-11` is refused
- **THEN** the next successful creation receives `WEB-12`

#### Scenario: Project key cannot change
- **WHEN** any request tries to change an existing project's key
- **THEN** the key is unchanged

### Requirement: Product manager manages tasks
The system SHALL allow a project's product manager to create, edit, reassign, and delete tasks. Each task SHALL have a title, a description, at least one acceptance criterion, an assignee who is a developer in the project, a due date, and an optional branch name. Edits, reassignments, and deletions SHALL carry the task's current `version`.

#### Scenario: Product manager creates a task
- **WHEN** the product manager creates a task with acceptance criteria and assigns it to a project developer
- **THEN** the task is in To Do and appears on that developer's board as assigned work

#### Scenario: Created task is returned
- **WHEN** the product manager creates a valid task in project `WEB`
- **THEN** the system returns HTTP 201 with the task's `id`, `taskKey` (such as `WEB-12`), `title`, `description`, `assignee` (`personId` and `githubUsername`), `dueDate`, `branchName`, `state` of `To Do`, `acceptanceCriteria` (each with `id`, `position`, and `description`), `version`, `createdAt`, and `updatedAt`

#### Scenario: Task reads follow task detail
- **WHEN** a person reads a task through `GET /api/v1/projects/{projectId}/tasks/{taskId}`
- **THEN** the response and its access rules are those of "Authorized members read task detail"

#### Scenario: Task without acceptance criteria is refused
- **WHEN** the product manager saves a task with no acceptance criteria
- **THEN** the system refuses the task and explains that at least one acceptance criterion is required

#### Scenario: Missing acceptance criteria use a specific error
- **WHEN** a task creation has no `acceptanceCriteria` field or an empty list, or an edit sends an empty `acceptanceCriteria` list, and the body has no other error
- **THEN** the system returns HTTP 400 with code `ACCEPTANCE_CRITERIA_REQUIRED`, and nothing changes

#### Scenario: Invalid task fields
- **WHEN** a task body has an unknown field, a wrong type, a title, description, criterion, or branch name outside the recorded limits, a due date that is not a real `YYYY-MM-DD` calendar date, or more than 20 criteria
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, and nothing changes

#### Scenario: Product manager edits a task
- **WHEN** the product manager edits a task with its current `version`
- **THEN** only the fields sent change, the version increases by one, and the system returns HTTP 200 with the updated task

#### Scenario: Acceptance criteria are edited as a list
- **WHEN** the product manager sends a new acceptance criteria list in which some items carry the `id` of a current criterion
- **THEN** those criteria keep their IDs with the new text and position, items without an `id` become new criteria, and current criteria left out are removed

#### Scenario: Edit with a stale version
- **WHEN** the product manager edits, reassigns, or deletes a task using a version that is no longer current
- **THEN** the system returns HTTP 409 with code `VERSION_CONFLICT`, and the task is unchanged

#### Scenario: Product manager reassigns a task
- **WHEN** the product manager reassigns a task to another developer in the project with its current `version`
- **THEN** the task has the new assignee and the same state, an assignment change recording the previous and new assignee is kept in its history, and the system returns HTTP 200 with the updated task

#### Scenario: Reassigning to the current assignee
- **WHEN** the product manager reassigns a task to its current assignee
- **THEN** the system returns HTTP 200 with the task unchanged, and no assignment change is recorded

#### Scenario: Product manager deletes a task
- **WHEN** the product manager deletes a task
- **THEN** the task no longer appears on the board, in the review queue, or in new progress reports, and its history is kept

#### Scenario: Deleted task is no longer available
- **WHEN** the product manager deletes a task with its current `version`
- **THEN** the system returns HTTP 204, the task is kept and marked as deleted, and later reads, edits, reassignments, and deletions of it return HTTP 404 with code `NOT_FOUND`

#### Scenario: Assignee must belong to the project
- **WHEN** the product manager assigns a task to a person who is not a developer in the project
- **THEN** the system refuses the assignment

#### Scenario: Assignee outside the project uses a specific error
- **WHEN** a task is created or reassigned with an `assigneeId` that is not a developer in the project, including the product manager, a person from another project, or an unknown person
- **THEN** the system returns HTTP 409 with code `ASSIGNEE_NOT_DEVELOPER`, and nothing changes

#### Scenario: Developer cannot manage tasks
- **WHEN** a developer creates, edits, reassigns, or deletes a task
- **THEN** the system returns HTTP 403 and nothing changes, and a non-member receives HTTP 404

### Requirement: Task management routes
The system SHALL let the product manager create a task through `POST /api/v1/projects/{projectId}/tasks`, edit its fields and acceptance criteria through `PATCH /api/v1/projects/{projectId}/tasks/{taskId}`, reassign it through `PUT /api/v1/projects/{projectId}/tasks/{taskId}/assignee`, and delete it through `DELETE /api/v1/projects/{projectId}/tasks/{taskId}`. Reads through `GET /api/v1/projects/{projectId}/tasks/{taskId}` SHALL follow "Authorized members read task detail".

#### Scenario: Task responses are not cached
- **WHEN** any of these routes returns a response
- **THEN** the response sends `Cache-Control: no-store`

#### Scenario: Task in another project is concealed
- **WHEN** a request names a task that belongs to a different project than the one in the path
- **THEN** the system returns HTTP 404 with code `NOT_FOUND`, and nothing changes

### Requirement: Authorized members read task detail
The system SHALL provide task detail through `GET /api/v1/projects/{projectId}/tasks/{taskId}` to the assigned developer and the project's product manager. The response SHALL be `{ "task": ..., "attachedCommits": [...], "progressUpdates": [...], "reviewFeedback": [...], "checkHistory": [...] }` and SHALL use `Cache-Control: no-store`.

The `task` object SHALL contain `id` (task UUID), `projectKey`, `taskKey` (the readable key formed from the project key and task number, such as `WEB-12`), `title`, `description`, `status` (the stored task status), `version` (the task's current integer version, which the task write routes require), `assignee` (`{ "id", "githubUsername" }`), `dueDate` (an ISO calendar date), `branchName` (string or null), and `acceptanceCriteria` (objects containing `id`, `position`, and `description`, ordered by `position` ascending then `id` ascending).

`attachedCommits` SHALL contain objects with `id`, `sha`, `attachedBy` (`{ "id", "githubUsername" }`), and `attachedAt`, ordered by `attachedAt` ascending then `id` ascending. `progressUpdates` SHALL contain objects with `id`, `author` (`{ "id", "githubUsername" }`), `body`, and `createdAt`, ordered by `createdAt` ascending then `id` ascending. `reviewFeedback` SHALL contain objects with `id`, `author` (`{ "id", "githubUsername" }`), `feedback`, and `createdAt`, ordered by `createdAt` ascending then `id` ascending. Timestamps SHALL be ISO 8601 UTC strings. The response SHALL contain only fields needed by the client and SHALL NOT expose auth-user IDs, GitHub numeric user IDs, credentials, tokens, or ORM-private fields.

`checkHistory` SHALL contain one entry per distinct stored check result, ordered by `createdAt` descending then `id` descending, with each entry containing `id`, `anchorSha`, `createdAt`, `redacted`, and `payload`. The project manager's access is read-only.

All collection fields SHALL be JSON arrays, including when no records exist. Task and child records SHALL be read-only in this response; this endpoint SHALL NOT mutate task state, attached commits, progress updates, review feedback, or check history.

#### Scenario: Assigned developer reads task detail
- **WHEN** the assigned developer requests task detail
- **THEN** the response contains the task, attached commits, progress updates, review feedback, and distinct check history using the shapes and ordering above
- **AND** the request changes no task or history state

#### Scenario: Task detail exposes the current version
- **WHEN** an authorized person requests task detail
- **THEN** `task.version` equals the task's current version, so the person can send it with a state change, edit, reassignment, or deletion

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
The system SHALL move tasks through the states To Do, In Progress, In Review, and Done. Only the assigned developer SHALL move a task from To Do to In Progress or from In Progress to In Review, and only the project's product manager SHALL move a task from In Review to Done or back to In Progress. No other transition SHALL be performed, and Done has no outgoing transition.

#### Scenario: Developer starts a task
- **WHEN** the assigned developer starts a task in To Do
- **THEN** the task moves to In Progress

#### Scenario: Developer cannot move another developer's task
- **WHEN** a developer tries to change the state of a task assigned to someone else
- **THEN** the system refuses the request with HTTP 403 and the task state is unchanged

#### Scenario: Product manager cannot start or submit a task
- **WHEN** the product manager requests In Progress on a task in To Do, or In Review on a task in In Progress
- **THEN** the system returns HTTP 403 and the task state is unchanged

#### Scenario: Transition not allowed from the current state
- **WHEN** a person requests a state that is not allowed for that person from the task's current state, including any request on a task in Done, a request for the task's current state, or the product manager requesting Done on a task that is not In Review
- **THEN** the system returns HTTP 403 with code `FORBIDDEN`, and the task and its history are unchanged

#### Scenario: Refused request writes nothing
- **WHEN** a state change request is refused for any reason
- **THEN** no task field, task event, or progress update is written

### Requirement: Task state route
The system SHALL change a task's state through `PATCH /api/v1/projects/{projectId}/tasks/{taskId}/state`. The JSON body SHALL contain `state` (`To Do`, `In Progress`, `In Review`, or `Done`) and the task's current `version`, and SHALL contain `feedback` only when the product manager requests changes. A change SHALL be applied only while the task still has that `version`.

#### Scenario: State change returns the task
- **WHEN** an authorized person requests an allowed transition with the task's current `version`
- **THEN** the system returns HTTP 200 with the task view of "Product manager manages tasks", with the new `state` and a `version` increased by one

#### Scenario: Stale version is refused
- **WHEN** a person requests a transition using a `version` that is no longer current and the transition is otherwise permitted
- **THEN** the system returns HTTP 409 with code `VERSION_CONFLICT`, and the task and its history are unchanged

#### Scenario: Competing transitions
- **WHEN** two transition requests carrying the same `version` are sent for one task at the same time
- **THEN** exactly one succeeds, the other is refused with nothing written, and the task records one state change
- **AND** the refused request returns HTTP 409 with code `VERSION_CONFLICT` when it reaches the version guard before the winning change is visible to it
- **AND** the refused request returns HTTP 403 with code `FORBIDDEN` when the route's pre-read of the task already sees the winning change and the requested transition is no longer allowed from that state

#### Scenario: Invalid state request
- **WHEN** the body has no valid `state`, no integer `version` between 1 and 2,147,483,647, a field other than `state`, `version`, and `feedback`, or `feedback` together with a `state` other than `In Progress`
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, and nothing changes

#### Scenario: Task is concealed or missing
- **WHEN** the task is deleted, belongs to a different project than the path, or the person is not a project member
- **THEN** the system returns HTTP 404 with code `NOT_FOUND`, and nothing changes

#### Scenario: State responses are not cached
- **WHEN** the route returns any response
- **THEN** the response sends `Cache-Control: no-store`

### Requirement: Task completion requires product-manager approval
The system SHALL keep a submitted task in In Review until the project's product manager approves it or requests changes. Approval SHALL move the task to Done. Requesting changes SHALL require feedback and SHALL return the task to In Progress.

#### Scenario: Developer submits work for review
- **WHEN** the assigned developer submits a task in In Progress for review
- **THEN** the task moves to In Review and appears in the product manager's review queue with its attached commits and the result referenced by that submission, if any

#### Scenario: Product manager approves submitted work
- **WHEN** the product manager approves a task in In Review
- **THEN** the task moves to Done

#### Scenario: Product manager requests changes
- **WHEN** the product manager requests changes on a task in In Review and provides feedback
- **THEN** the feedback is associated with the task, visible to the assigned developer, and the task returns to In Progress

#### Scenario: Feedback is plain trimmed text
- **WHEN** the product manager requests changes with `feedback` that trims to between 1 and 5,000 characters
- **THEN** the system stores the trimmed text, which task detail returns in `reviewFeedback` with the product manager as its author

#### Scenario: Missing or invalid feedback
- **WHEN** the product manager requests In Progress on a task in In Review with no `feedback`, feedback that is blank after trimming, feedback that is not a string, or feedback longer than 5,000 characters
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, and the task and its history are unchanged

#### Scenario: Feedback on another transition
- **WHEN** a request that is allowed for the person but is not In Review to In Progress carries `feedback`
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, and nothing changes

#### Scenario: Developer resubmits after changes were requested
- **WHEN** the assigned developer submits a task that returned to In Progress after a request for changes
- **THEN** the task moves to In Review again, earlier events and feedback are kept, and the submission is recorded as a new event

#### Scenario: Developer cannot approve a submission
- **WHEN** a developer tries to approve a task or move it to Done
- **THEN** the system refuses the request and the task remains in In Review

#### Scenario: Developer cannot request changes
- **WHEN** a developer requests In Progress on a task in In Review, with or without feedback
- **THEN** the system returns HTTP 403 and the task remains in In Review

### Requirement: Submission records attached commits and a matching check
A submission SHALL include the commits attached to the task, and a task with no attached commits MAY be submitted. It SHALL reference a stored acceptance criteria check only when that check's anchor SHA matches the unique tip of the submitted commit history and its criteria hash matches the current acceptance criteria; otherwise the submission has no check reference. The tip SHALL be resolved before the state change begins, with no database transaction open during the lookup.

#### Scenario: Submission has no matching check result
- **WHEN** the assigned developer submits a task for review and no stored check matches both the unique submitted commit-history tip and current criteria hash
- **THEN** the task moves to In Review with its attached commits and no check-result reference
- **AND** the task's distinct stored check history remains available

#### Scenario: Submission references a matching check
- **WHEN** the assigned developer submits a task and a stored check matches both the unique tip of the attached commits and the current criteria hash
- **THEN** the submission event references that check result

#### Scenario: Submission without attached commits
- **WHEN** the assigned developer submits a task in In Progress that has no attached commits
- **THEN** the task moves to In Review with no check-result reference

#### Scenario: Evidence is unavailable at submission
- **WHEN** the submitted tip cannot be resolved, or GitHub or the repository path rules are unavailable
- **THEN** the task still moves to In Review with its attached commits and no check-result reference

### Requirement: Submission rechecks its inputs before it is stored
Inside the submission transaction the system SHALL recheck that the task's attached commit set and acceptance criteria hash are unchanged since the tip was resolved. If either changed, the submission SHALL proceed without a check reference.

#### Scenario: Attached commits change during submission
- **WHEN** the attached commit set or the criteria hash changes after the tip was resolved and before the submission is stored
- **THEN** the task moves to In Review with no check-result reference, and no stale reference is stored

#### Scenario: Check never changes state
- **WHEN** a check result is stored or read during a submission
- **THEN** the check itself does not approve, reject, submit, or change the task's state

### Requirement: Review reads expose check history
Task-detail reads for the assigned developer and project manager, and review reads for the product manager, SHALL expose `checkHistory` with one entry per distinct stored result in stable newest-first order. Each entry SHALL contain the result ID, anchor SHA, creation timestamp, redaction flag, and result payload. The project manager's check access is read-only.

#### Scenario: Submission history remains readable
- **WHEN** the assigned developer or product manager reads task detail, or the product manager reads the submitted task in the review queue
- **THEN** each response presents `checkHistory` with one entry per distinct result in stable newest-first order, with result ID as the tie-breaker for equal creation timestamps
- **AND** each entry includes result ID, anchor SHA, creation timestamp, redaction flag, and result payload
- **AND** the review response also presents the check result referenced by that submission, if any
- **AND** the product manager cannot initiate or alter a check

### Requirement: Lifecycle changes are recorded as task events
Each successful state change SHALL write exactly one append-only task event in the same transaction as the change. Starting a task and approving it SHALL write a `state_change` event, submitting SHALL write a `submission` event, and requesting changes SHALL write a `review_feedback` event. Each event SHALL record the actor and the from and to status.

#### Scenario: Start and approve record state changes
- **WHEN** a task is started or approved
- **THEN** one `state_change` event records the actor and the from and to status

#### Scenario: Submission records its check reference
- **WHEN** a task is submitted for review
- **THEN** one `submission` event records the actor, the from and to status, and the matching check result, if any

#### Scenario: Request for changes records its feedback
- **WHEN** the product manager requests changes
- **THEN** one `review_feedback` event records the product manager, the from and to status, and the trimmed feedback

#### Scenario: Failed change records no event
- **WHEN** a state change is refused or its transaction fails
- **THEN** the task keeps its previous state and version and no event is stored

### Requirement: Developer submits task progress
The system SHALL let the assigned developer post a free-text progress update through `POST /api/v1/projects/{projectId}/tasks/{taskId}/progress-updates`. The JSON body SHALL contain exactly `body`, plain text trimmed to 1 to 2,000 characters. The update SHALL be retained for the product manager and for project reporting, and posting SHALL NOT change the task.

#### Scenario: Developer submits an update
- **WHEN** an assigned developer posts a progress update on a task
- **THEN** the system returns HTTP 201 with `id`, `author` (`id` and `githubUsername`), `body`, and `createdAt`, as in task detail `progressUpdates`
- **AND** the update is associated with the task and visible to the project's product manager

#### Scenario: Update in any state
- **WHEN** the assigned developer posts a progress update on a task in any state that is not deleted
- **THEN** the update is stored and the task's state and version are unchanged

#### Scenario: Update is trimmed plain text
- **WHEN** the body is a string that trims to between 1 and 2,000 characters
- **THEN** the trimmed text is stored and later returned unchanged, never interpreted as markup

#### Scenario: Invalid progress update
- **WHEN** the body is blank after trimming, not a string, or longer than 2,000 characters, or the request has a field other than `body`
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST`, and nothing is stored

#### Scenario: Only the assigned developer posts
- **WHEN** the product manager or a developer who is not assigned to the task posts a progress update
- **THEN** the system returns HTTP 403 and nothing is stored
- **AND** a nonmember, a deleted task, or a task in another project returns HTTP 404

#### Scenario: Update racing with reassignment
- **WHEN** a person posts a progress update while the task is reassigned to someone else and the reassignment is stored first
- **THEN** the system returns HTTP 403 and no update is stored

#### Scenario: Progress responses are not cached
- **WHEN** the route returns any response
- **THEN** the response sends `Cache-Control: no-store`

### Requirement: Project members read the task board
The system SHALL show a project's task board at `/projects/{projectId}/board` to its members, grouped into the columns To Do, In Progress, In Review and Done. The project's product manager SHALL see every non-deleted task in the project, and a developer SHALL see only the non-deleted tasks assigned to them. Tasks in a column SHALL be ordered by task number ascending, then task `id`.

#### Scenario: Product manager sees every task
- **WHEN** the product manager opens the board of a project with tasks in several states assigned to several developers
- **THEN** each non-deleted task appears once, in the column for its state

#### Scenario: Developer sees only own tasks
- **WHEN** a developer opens the board
- **THEN** only tasks assigned to that developer appear
- **AND** no other developer's task keys, titles or assignees are sent to the browser

#### Scenario: Deleted tasks are absent
- **WHEN** a task has been deleted
- **THEN** it appears on no board

### Requirement: Board cards and board reads
Each board card SHALL show the task key, title, assignee GitHub username, due date and state name, and the page SHALL carry the task's `id` and current `version`. The page SHALL read through a server-side read service that checks membership and role itself, SHALL add no `/api/v1` route, and SHALL NOT be cached.

#### Scenario: Board access is enforced on the server
- **WHEN** a nonmember opens the board
- **THEN** the system shows the safe not-found result without project contents
- **AND** a request without a valid session is redirected to `/sign-in`

#### Scenario: Stored status is shown as a state name
- **WHEN** a task's stored status is `in_review`
- **THEN** the board places it in the In Review column and labels it "In Review"

### Requirement: Board status menu applies only permitted transitions
The board SHALL let the assigned developer move their own task from To Do to In Progress and from In Progress to In Review through a status menu that calls the task state route with the task's current `version`. The menu SHALL offer no transition the person may not make. The product manager's Approve and Request changes SHALL be performed from the review queue or task detail, and a product manager's In Review card SHALL link to the review queue. Drag-and-drop is not required.

#### Scenario: Developer starts a task from the board
- **WHEN** the assigned developer chooses In Progress from a To Do card's menu
- **THEN** the card appears in the In Progress column after the board reloads, and the next action uses the task's new `version`

#### Scenario: Refused or stale move
- **WHEN** the state route returns 403 `FORBIDDEN` or 409 `VERSION_CONFLICT`
- **THEN** the page shows a short message asking the person to reload, reloads the board data, and changes no card locally

#### Scenario: Menu hides forbidden moves
- **WHEN** the product manager or an unassigned developer opens a card's menu
- **THEN** no To Do to In Progress or In Progress to In Review option is offered

### Requirement: Task detail page
The system SHALL show a task-detail page at `/projects/{projectId}/tasks/{taskId}` to the assigned developer and the project's product manager, using the task-detail read. It SHALL show the title, description, acceptance criteria, assignee, due date, branch, progress updates, attached commits, review feedback and distinct check history, and SHALL display the stored status as its state name.

#### Scenario: Unassigned developer or nonmember
- **WHEN** a developer who is not assigned to the task opens it
- **THEN** the page shows a safe unavailable view and no task or check data
- **AND** a nonmember, a missing task or a deleted task shows the safe not-found result

### Requirement: Task detail actions follow the role
The assigned developer SHALL see Run check, the commit picker, a progress-update form and, while the task is In Progress, a Submit for review action that is not blocked when no matching check exists. The product manager SHALL see none of those actions and SHALL read check history only.

#### Scenario: Assigned developer opens a task
- **WHEN** the assigned developer opens an In Progress task
- **THEN** the page shows the detail fields and the developer actions above

#### Scenario: Product manager opens the same task
- **WHEN** the product manager opens it
- **THEN** the page shows the same detail and check history and offers no run, attach, progress-update or submit action

#### Scenario: Submit for review without a matching check
- **WHEN** the assigned developer submits a task that has no attached commits or no matching check
- **THEN** the task moves to In Review and the page does not present a check as completed

#### Scenario: Progress update appears
- **WHEN** the assigned developer posts a progress update
- **THEN** it appears in the task's progress updates after the page refreshes, in `createdAt` order

### Requirement: Product manager reads the review queue
The system SHALL show the project's product manager the review queue at `/projects/{projectId}/review-queue`: every non-deleted task in In Review, each with its attached commits, its `checkHistory` in the existing entry shape, and the check result referenced by the task's most recent `submission` event (if any). The referenced result SHALL be exposed by the review read only, not by the task-detail read.

#### Scenario: Submitted task appears in the queue
- **WHEN** a task moves to In Review
- **THEN** it appears in the queue with its attached commits and the referenced result, if any

#### Scenario: Resubmitted task references its latest submission
- **WHEN** a task has more than one `submission` event
- **THEN** the queue entry presents the result referenced by the most recent one

#### Scenario: No referenced result
- **WHEN** the most recent submission event has no check reference
- **THEN** the entry shows the commits and distinct check history and states that no result is referenced

### Requirement: Review queue actions and access
Each review queue entry SHALL offer Approve and Request changes, and Request changes SHALL require feedback that trims to 1 to 5,000 characters before it is sent. Developers and nonmembers SHALL receive no queue data. The page SHALL read through a server-side read service, SHALL add no `/api/v1` route, SHALL start no check, and SHALL change task state only through the task state route when the product manager acts.

#### Scenario: Approve
- **WHEN** the product manager approves an entry with its current `version`
- **THEN** the task moves to Done and leaves the queue after the page reloads

#### Scenario: Request changes needs feedback
- **WHEN** the product manager requests changes
- **THEN** the page requires non-blank feedback before sending, the task returns to In Progress, and the entry leaves the queue after the page reloads

#### Scenario: Queue access is enforced on the server
- **WHEN** a developer opens the queue
- **THEN** the page shows a safe unavailable view and exposes no entries
- **AND** a nonmember sees the safe not-found result, and a request without a valid session is redirected to `/sign-in`

#### Scenario: Another reviewer acted first
- **WHEN** an approve or request-changes action returns 403 or 409
- **THEN** the page tells the product manager to reload and reloads the queue
