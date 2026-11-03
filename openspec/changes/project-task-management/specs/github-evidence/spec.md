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
The system SHALL let only the assigned developer attach commits. The server verifies authorship before writing, deduplicates SHAs in first-seen order, and attaches all or none. Repeating an attached SHA is idempotent and returns it once.

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

### Requirement: Unavailable GitHub evidence is reported distinctly
The system SHALL report GitHub evidence as unavailable when the linked installation or repository cannot be reached, access is revoked or suspended, or GitHub rate limits are hit. It SHALL NOT report unavailable evidence as an empty commit list.

#### Scenario: GitHub evidence cannot be retrieved
- **WHEN** the system cannot access the linked repository or installation
- **THEN** it reports unavailable evidence with a safe reason category and without credentials or raw provider errors

#### Scenario: Branch listing is unavailable
- **WHEN** the system cannot retrieve branches from the linked repository
- **THEN** it reports unavailable evidence rather than presenting an empty branch list
