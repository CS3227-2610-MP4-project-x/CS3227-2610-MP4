# Spec Delta

## Purpose

Defines how a product manager links one GitHub repository to a project and how assigned developers select and attach their own commits for assessment and reporting.

## ADDED Requirements

### Requirement: Product managers start a verified GitHub App setup
The system SHALL let the project's PM start a project-bound App setup attempt with single-use state. The attempt expires after 10 minutes. The server verifies the installation through separate user authorization before listing repositories and never persists the OAuth user token.

#### Scenario: Product manager starts App installation or configuration
- **WHEN** the PM sends `GET /api/v1/projects/{projectId}/github-repository/setup-url`
- **THEN** the route returns HTTP 200 with `{ "setupUrl": "..." }` built from the configured App slug and starts an attempt bound to that project and the verified PM
- **AND** the installation URL carries single-use state correlated with the attempt

#### Scenario: Setup redirect is associated with the active project and PM
- **WHEN** GitHub redirects to `GET /api/v1/auth/github-app/setup-callback?installation_id=…&state=…`
- **THEN** the system treats both values as untrusted, consumes the matching single-use state, validates the active project/verified-PM attempt, stores the candidate installation ID only in that attempt, and begins separate GitHub user authorization
- **AND** an expired, replayed, mismatched, or unauthorized attempt cannot list repositories or alter the project binding

#### Scenario: Installation is verified before repository listing
- **WHEN** the PM completes GitHub App user authorization at `GET /api/v1/auth/github-app/callback?code=…&state=…`
- **THEN** the server verifies that the authorized GitHub user matches the PM's verified GitHub identity and that the installation is associated with that user
- **AND** only after verification does the server create a 10-minute repository snapshot and redirect to Project Settings with an opaque snapshot identifier
- **AND** the OAuth token is not persisted, returned, or logged

#### Scenario: Installation ID is untrusted
- **WHEN** GitHub returns an installation ID during App setup
- **THEN** the system verifies it against the separately authorized GitHub user before listing repositories or linking a repository

### Requirement: Product managers read verified repository snapshots
The system SHALL keep normalized setup attempts and repository snapshots bound to the project, PM, and installation. Each expires 10 minutes after creation. No OAuth token is stored.

#### Scenario: Product manager chooses from the verified snapshot
- **WHEN** the PM sends `GET /api/v1/projects/{projectId}/github-repository/snapshots/{snapshotId}` for an active setup attempt
- **THEN** the route returns only that PM's unexpired, verified snapshot as `{ "repositories": [{ "repositoryId": 123, "owner": "…", "name": "…", "private": true, "defaultBranch": "…" }] }`
- **AND** the snapshot contains repository ID, owner, name, privacy, and default branch, bound to the attempt, project, PM, and installation
- **AND** browser-supplied installation identifiers or repository lists are not trusted as evidence

#### Scenario: Setup association cannot be verified
- **WHEN** the system cannot establish that the installation and repository selection belong to the active PM's setup flow for this project
- **THEN** it refuses to list or link repositories and leaves the current project binding unchanged

#### Scenario: Repository setup evidence is unavailable
- **WHEN** setup verification, repository-list retrieval, or the snapshot is unavailable or expired
- **THEN** Project Settings shows a safe recovery state with a retry action and does not display an unverified list
- **AND** an existing repository link remains visible and unchanged

### Requirement: Product managers link a repository from a verified snapshot
The final link route SHALL be `POST /api/v1/projects/{projectId}/github-repository` with `{ "snapshotId": "…", "repositoryId": 123 }`. The server rechecks PM/project binding, snapshot membership, and current App access before replacing the project's one repository binding. Any failure leaves an existing binding unchanged.

#### Scenario: Product manager links a repository
- **WHEN** the PM submits a repository present in the active verified snapshot
- **THEN** the system rechecks current App access and links that repository and installation to the project

#### Scenario: Product manager changes a linked repository
- **WHEN** the PM links a different repository
- **THEN** the old repository remains linked until the new binding succeeds, after which the new repository is displayed

#### Scenario: Product manager adds a repository to an existing installation
- **WHEN** the PM needs a repository not yet available to an existing installation
- **THEN** the PM can install or configure the App for the relevant account or organization and select the repository before linking it

#### Scenario: One repository per project
- **WHEN** a project already has a linked repository and its PM links a different repository
- **THEN** the new repository replaces the existing link, and the project still has only one linked repository

#### Scenario: Installation or repository is not accessible
- **WHEN** the selected installation or repository is not accessible to the verified PM or the App lacks access
- **THEN** the system refuses the link, reports a safe reason category, and leaves the existing binding unchanged

#### Scenario: Only a product manager may manage the link
- **WHEN** a developer or a non-member tries to add, replace, or remove the repository link
- **THEN** the system refuses the request and leaves the project unchanged

### Requirement: Product managers manage repository links in Project Settings
Project Settings SHALL show the linked repository state and offer a change action. For an unlinked project it SHALL explain that the App must be installed or configured and offer the setup action. It SHALL never display an access token. The approved PM mockup is the visual reference.

#### Scenario: Project has no linked repository
- **WHEN** the PM opens Project Settings for an unlinked project
- **THEN** the repository area shows an unlinked state and an install/configure action that obtains the project setup URL

#### Scenario: Product manager changes a linked repository
- **WHEN** the PM selects a different verified repository
- **THEN** the previous repository remains displayed until the new binding succeeds, after which the new repository is displayed

### Requirement: GitHub access tokens are not exposed or persisted
The system SHALL keep App credentials and access tokens on the server, SHALL NOT log or return them, and SHALL NOT persist user or installation access tokens.

#### Scenario: Link authorization token is temporary
- **WHEN** the system verifies a PM during linking
- **THEN** it uses the user access token only for identity and installation/repository verification and does not store or return it

#### Scenario: Repository read token is temporary and scoped
- **WHEN** the system reads repository evidence
- **THEN** it uses a short-lived installation token restricted to the linked repository and read-only repository permissions, without storing or returning the token

#### Scenario: No access token is logged
- **WHEN** an application or provider error occurs during GitHub authorization or repository access
- **THEN** logs and responses contain neither access tokens nor raw provider error details

### Requirement: Assigned developers list branches for their task repository
The branch route SHALL be `GET /api/v1/projects/{projectId}/tasks/{taskId}/github-evidence/branches`. It returns HTTP 200 with `{ "defaultBranch": "...", "branches": [{ "name": "..." }] }` and is available only to the assigned developer.

#### Scenario: Assigned developer opens the branch list
- **WHEN** the task's assigned developer requests the branch route
- **THEN** the route returns the linked repository's branch choices and default branch
- **AND** another project member receives the existing safe authorization error without repository evidence

#### Scenario: Branch listing is unavailable
- **WHEN** the system cannot retrieve branches from the linked repository
- **THEN** it reports unavailable evidence rather than presenting the branch list as empty

### Requirement: Assigned developers list their own task commits
The system SHALL let only the task's assigned developer list commits. The server derives the author from that developer's verified GitHub identity and returns matching commits.

#### Scenario: Developer opens the commit picker
- **WHEN** an assigned developer opens the task commit picker
- **THEN** it requests `GET /api/v1/projects/{projectId}/tasks/{taskId}/github-evidence/commits` and receives `since`, `until`, `branch`, `page`, `perPage`, `nextPage`, and commit records with SHA, short SHA, message, authored time, and `mentionsTaskId`
- **AND** it lists the developer's commits for the default interval and branch, with task-ID matches preselected but not attached automatically

#### Scenario: Commit list filters and pagination are defined
- **WHEN** the assigned developer sends optional `since`, `until`, `branch`, `page`, or `perPage` query parameters
- **THEN** timestamps are ISO 8601 UTC and define `[since, until)`, the default interval is today's SGT calendar day converted to UTC, and the default branch is the task branch or repository default branch
- **AND** pagination defaults to page 1 and 50 items, with a maximum page size of 100; `nextPage` is the next integer or `null`
- **AND** `mentionsTaskId` identifies messages containing the canonical task ID as a UI preselection cue only

#### Scenario: Commit pagination uses approved defaults and bounds
- **WHEN** the assigned developer omits pagination parameters
- **THEN** the route uses `page: 1` and `perPage: 50`
- **AND WHEN** the developer requests more than 100 items per page
- **THEN** the route returns the existing safe invalid-request error

#### Scenario: Commit pagination indicates another page
- **WHEN** additional matching commits exist after the requested page
- **THEN** `nextPage` is the next integer page
- **AND WHEN** no additional matching commits exist
- **THEN** `nextPage` is `null`

#### Scenario: Default branch and date range
- **WHEN** the developer opens the picker without choosing a date range or branch
- **THEN** the date range defaults to today's SGT interval and the branch defaults to the task's branch or the repository default branch

#### Scenario: No commits match
- **WHEN** GitHub successfully returns no commits for the selected author, interval, and branch
- **THEN** the route returns HTTP 200 with an empty `commits` array so the UI can show “No commits found”

#### Scenario: Evidence is unavailable
- **WHEN** branch or commit evidence cannot be retrieved because access is revoked, suspended, unavailable, or rate-limited
- **THEN** the route returns the existing safe error envelope with an unavailable category, not an empty list

#### Scenario: Invalid commit-list filters
- **WHEN** the assigned developer supplies malformed timestamps, an empty or reversed interval, or an unavailable branch
- **THEN** the route returns the existing safe invalid-request error and does not query or expose commits

#### Scenario: No repository is linked
- **WHEN** an assigned developer requests evidence for a task whose project has no linked repository
- **THEN** the route reports unavailable evidence rather than returning empty lists

#### Scenario: Only assigned developers may list commits
- **WHEN** a project member who is not the task's assigned developer requests commits
- **THEN** the system refuses the request without returning repository evidence

### Requirement: Assigned developers attach their own commits atomically
The system SHALL let only the assigned developer attach commits through the existing `POST /api/v1/projects/{projectId}/tasks/{taskId}/attached-commits` add-only operation while the task is In Progress. The server verifies authorship before writing, deduplicates SHAs in first-seen order, and attaches all or none. Repeating an attached SHA is idempotent and returns it once. The POST operation SHALL NOT remove attachments omitted from its request; complete replacement and removal use the PUT operation below. The task SHALL remain In Progress when the attachment transaction applies.

#### Scenario: Assigned developer attaches own commits
- **WHEN** the assigned developer sends `POST /api/v1/projects/{projectId}/tasks/{taskId}/attached-commits` with `{ "commitShas": ["..."] }` containing SHAs authored by that developer in the linked repository
- **THEN** the route returns HTTP 201 with `{ "attachedCommits": [{ "sha": "..." }] }` and attaches the selected commits
- **AND** provider errors use the safe error envelope without raw provider details

#### Scenario: Selection contains a commit by another author
- **WHEN** any submitted SHA is authored by another GitHub identity
- **THEN** the route refuses the request and attaches none of the submitted commits

#### Scenario: Caller is not the assignee
- **WHEN** a project member who is not the task's assigned developer submits an attachment request
- **THEN** the route returns the safe authorization error and makes no changes

#### Scenario: Task is not In Progress
- **WHEN** the assigned developer submits an add-only attachment request while the task is not In Progress, or the task leaves In Progress before the attachment transaction applies
- **THEN** the route returns the safe forbidden response and makes no changes

#### Scenario: Provider cannot verify a selected commit
- **WHEN** GitHub cannot provide current authorship evidence for any submitted SHA
- **THEN** the route reports evidence unavailable and attaches none of the submitted commits

#### Scenario: Unknown commit is not exposed
- **WHEN** a request includes a SHA absent from or inaccessible in the linked repository
- **THEN** the route refuses the whole request with a safe error and attaches nothing

#### Scenario: Invalid attachment payload
- **WHEN** a request has missing or empty `commitShas`, malformed SHA values, or fields outside the approved schema
- **THEN** the route returns the safe invalid-request error and attaches nothing

#### Scenario: Duplicate SHAs in one request
- **WHEN** an otherwise valid request repeats one SHA
- **THEN** the service verifies and processes that SHA once, preserving its first-seen response position

#### Scenario: Already attached commits are idempotent
- **WHEN** the assigned developer submits own commits and some or all are already attached
- **THEN** the request succeeds with HTTP 201, attaches any new commits, and returns each selected SHA once

### Requirement: Assigned developers replace their attached commit selection
The system SHALL provide `PUT /api/v1/projects/{projectId}/tasks/{taskId}/attached-commits` for complete replacement of a task's attached-commit set. Its JSON body SHALL have exactly one property, `attachments`, containing an array of objects with exactly `sha` and `sourceBranch` properties; each SHA SHALL contain 7 to 64 hexadecimal characters and each `sourceBranch` SHALL be a non-empty string or `null`. A null source branch SHALL be accepted only for a SHA already attached to the task. An empty array SHALL remove every attachment. The request SHALL be available only to the assigned developer while the task is In Progress. The server SHALL apply all additions and removals atomically and return HTTP 200 with `{ "attachments": [{ "sha": "...", "sourceBranch": "..." }] }`, where each returned `sourceBranch` is a string or `null`, representing the complete resulting set in request order; legacy retained rows SHALL return `sourceBranch: null`. The response SHALL use `Cache-Control: no-store`.

For each requested SHA already attached to the task, the server SHALL preserve the attachment row and its original source branch regardless of the submitted `sourceBranch` value; a retained legacy row SHALL remain null. For each newly added SHA, the server SHALL treat the submitted branch as untrusted, verify that it is a current branch of the linked repository, verify that the commit is reachable from that branch, and verify commit authorship against the assigned developer's verified GitHub identity before writing. Provider calls SHALL occur outside the database transaction. Before applying changes, the transaction SHALL recheck task assignment and that the task remains In Progress. The operation SHALL leave the entire attachment set unchanged if validation, authorization, provider verification, or persistence fails.

#### Scenario: Developer saves the complete desired selection
- **WHEN** the assigned developer sends a valid `PUT` request with the desired attachments
- **THEN** the server adds newly selected commits, removes omitted commits, preserves provenance on retained rows, and returns HTTP 200 with the complete resulting attachment set

#### Scenario: Developer removes all attachments
- **WHEN** the assigned developer sends `{ "attachments": [] }` while the task is In Progress
- **THEN** the server removes every attached commit atomically and returns HTTP 200 with `{ "attachments": [] }`

#### Scenario: Retained attachment keeps its original provenance
- **WHEN** the requested selection retains an attached SHA but supplies a different branch or `null`
- **THEN** the saved attachment keeps its original source branch
- **AND** if the retained row is legacy and has no source branch, it remains null

#### Scenario: New attachment branch is verified
- **WHEN** the request adds a SHA with a source branch that is not a current branch of the linked repository, or the commit is not reachable from that branch
- **THEN** the server refuses the entire replacement and leaves every attachment unchanged

#### Scenario: New attachment author is verified
- **WHEN** the request adds a commit not authored by the assigned developer's verified GitHub identity
- **THEN** the server refuses the entire replacement and leaves every attachment unchanged

#### Scenario: Replacement request is strictly validated
- **WHEN** the request has missing or extra fields, a malformed SHA, an invalid or missing source branch for a new attachment, duplicate SHAs, or a non-array `attachments` value
- **THEN** the server returns HTTP 400 with the safe invalid-request response and leaves every attachment unchanged

#### Scenario: Only assigned developer may replace attachments
- **WHEN** a project member who is not the task's assigned developer or a nonmember sends a replacement request
- **THEN** the server returns the existing safe authorization or not-found response and leaves every attachment unchanged

#### Scenario: Task must remain In Progress when replacement applies
- **WHEN** the assigned developer sends a replacement request while the task is not In Progress, or the task leaves In Progress before the database transaction applies the replacement
- **THEN** the server refuses the operation with the safe forbidden response and leaves every attachment unchanged

#### Scenario: Provider verification is unavailable
- **WHEN** the server cannot verify a newly added commit's branch reachability or authorship because GitHub evidence is unavailable
- **THEN** it returns the existing safe unavailable-evidence response and leaves every attachment unchanged

#### Scenario: Repeating a replacement is idempotent
- **WHEN** the assigned developer repeats a valid replacement request with the already saved desired attachment set
- **THEN** the server returns HTTP 200 with the same complete attachment set and preserves all existing provenance

### Requirement: Assigned developers save a staged commit selection
The commit picker SHALL initialize its checked selection from the task's complete attached-commit set. Task-ID matches SHALL remain a preselection cue for commits not already attached and SHALL NOT write an attachment until the developer saves. Selection changes SHALL remain staged in the picker until Save; cancelling or closing without saving SHALL leave persisted attachments unchanged. Saving SHALL synchronize the complete desired selection with persisted attachments, adding selected commits and removing deselected attached commits as one atomic operation only while the task is In Progress. Authorized task-detail readers SHALL be able to review the persisted attachment list and provenance in every task state; outside In Progress, selection editing and saving SHALL be disabled, read-only or hidden. Attached commits SHALL remain reviewable regardless of the active branch, date interval, or commit-list page, and SHALL be removable from the picker regardless of those filters while the task is In Progress. The saved source branch for each newly selected commit SHALL be the branch selected in the picker when that commit was selected.

#### Scenario: Previously attached commits are checked
- **WHEN** the assigned developer opens the picker for a task with attached commits
- **THEN** every returned commit whose SHA is attached to the task is checked
- **AND** task-ID matches that are not attached are preselected only as unsaved choices

#### Scenario: Existing selection is visible across picker filters
- **WHEN** the developer changes the branch, date interval, or page in the picker
- **THEN** staged choices are retained
- **AND** every persisted attachment remains reviewable with its checked state and source branch even when it is absent from the current commit results

#### Scenario: Unchecking an attached commit stages its removal
- **WHEN** the developer unchecks a previously attached commit
- **THEN** it remains attached until Save is activated
- **AND** saving removes that attachment and refreshes the task's attached-commit state

#### Scenario: Save synchronizes additions and removals
- **WHEN** the developer saves a selection containing new commits and omitting previously attached commits
- **THEN** new commits are attached with the branch selected when each was chosen, omitted commits are removed, and the picker reflects the saved selection
- **AND** the additions and removals are committed together or none are applied

#### Scenario: Cancel discards staged edits
- **WHEN** the developer changes checked choices and closes or cancels without saving
- **THEN** the persisted attached commits and their recorded source branches remain unchanged

#### Scenario: Save requires an In Progress task
- **WHEN** the assigned developer saves an attachment selection while the task is not In Progress
- **THEN** the server refuses the operation with the safe forbidden response and leaves attachments unchanged

#### Scenario: Save revalidates authorization and commit authorship
- **WHEN** a caller is not the assigned developer, a selected commit is not authored by the developer, or GitHub cannot verify a newly selected commit
- **THEN** the server refuses the save safely and applies none of its additions or removals

#### Scenario: Invalid selection is atomic
- **WHEN** a save request has malformed commit or branch data, duplicate conflicting entries, or fields outside its approved schema
- **THEN** the server returns the safe invalid-request error and leaves all attachments unchanged

#### Scenario: Task state changes while saving
- **WHEN** the task leaves In Progress before the save transaction applies
- **THEN** the server refuses the save and leaves all attachments unchanged

### Requirement: Each attached commit records its picker source branch
Each attached commit SHALL store the source branch selected in the commit picker when it was saved. The source branch records the picker context for that attachment and SHALL NOT be represented as an exclusive or permanent property of the Git commit. Existing attachments without recorded source branch SHALL remain readable and be represented as branch not recorded.

#### Scenario: Commit is attached from a selected branch
- **WHEN** the assigned developer saves a commit selected while a branch is active in the picker
- **THEN** the attachment records that selected branch as its source branch

#### Scenario: Legacy attachment has no source branch
- **WHEN** task detail reads an attachment created before source-branch recording
- **THEN** it returns the attachment and identifies its source branch as not recorded

### Requirement: Unavailable GitHub evidence is reported distinctly
The system SHALL report GitHub evidence as unavailable when the linked installation or repository cannot be reached, access is revoked or suspended, or GitHub rate limits are hit. It SHALL NOT report unavailable evidence as an empty commit list.

#### Scenario: GitHub evidence cannot be retrieved
- **WHEN** the system cannot access the linked repository or installation
- **THEN** it reports unavailable evidence with a safe reason category and without credentials or raw provider errors

#### Scenario: Branch listing is unavailable
- **WHEN** the system cannot retrieve branches from the linked repository
- **THEN** it reports unavailable evidence rather than presenting an empty branch list
