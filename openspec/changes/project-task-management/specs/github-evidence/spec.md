# Spec Delta

## Purpose

Defines how a product manager links one GitHub repository to a project and how assigned developers select and attach their own commits for assessment and reporting.

## ADDED Requirements

### Requirement: Product manager links one repository through a GitHub App
The system SHALL let a project's product manager link one repository that is available to a GitHub App installation. The system SHALL verify the product manager's GitHub identity and access to the selected installation and repository before saving the link.

#### Scenario: Product manager links a repository
- **WHEN** the project's product manager selects a repository available to a GitHub App installation
- **THEN** the system verifies the separate GitHub App authorization matches the product manager's verified GitHub identity, confirms the repository is available to that installation, and links that repository to the project

#### Scenario: Product manager adds a repository to an existing installation
- **WHEN** the product manager needs to link a repository that is not yet available to an existing GitHub App installation
- **THEN** the system provides a flow to install or configure the App for the relevant GitHub account or organization and select the repository before linking it

#### Scenario: One repository per project
- **WHEN** a project already has a linked repository and its product manager links a different repository
- **THEN** the new repository replaces the existing link, and the project still has only one linked repository

#### Scenario: Installation or repository is not accessible
- **WHEN** the selected installation or repository is not accessible to the verified product manager or the App lacks access
- **THEN** the system refuses the link, reports a safe reason category, and leaves the existing project link unchanged

#### Scenario: Installation ID is untrusted
- **WHEN** GitHub returns an installation ID during App setup
- **THEN** the system treats it as untrusted input and verifies it against the separately authorized GitHub user and selected repository before saving or using it

#### Scenario: Only a product manager may manage the link
- **WHEN** a project developer or a person who is not a project member tries to add, replace, or remove the repository link
- **THEN** the system refuses the request and leaves the project unchanged

### Requirement: GitHub access tokens are not exposed or persisted
The system SHALL keep GitHub App credentials and access tokens on the server, SHALL NOT log or return them, and SHALL NOT persist user or installation access tokens.

#### Scenario: Link authorization token is temporary
- **WHEN** the system completes the separate GitHub App authorization used to verify a product manager during linking
- **THEN** it uses the user access token only for identity and installation/repository verification and does not store or return it

#### Scenario: Repository read token is temporary and scoped
- **WHEN** the system reads repository evidence
- **THEN** it uses a short-lived installation token restricted to the linked repository and read-only repository permissions, without storing or returning the token

#### Scenario: No access token is logged
- **WHEN** an application or provider error occurs during GitHub authorization or repository access
- **THEN** logs and responses contain neither access tokens nor raw provider error details

### Requirement: Assigned developers can choose branches and list their own commits
The system SHALL let an assigned developer list available branches and commits in the project's linked repository, filtered to the developer's verified GitHub identity, a date range, and a branch.

#### Scenario: Developer opens the commit picker
- **WHEN** an assigned developer opens the commit picker for a task
- **THEN** the system lists available branches and the developer's commits for the default date range and branch, with commits that mention the task ID pre-selected

#### Scenario: Default branch and date range
- **WHEN** the developer opens the commit picker without choosing a date range or branch
- **THEN** the date range defaults to the current day in Singapore Time (SGT, UTC+08:00), and the branch defaults to the task's branch or to the repository's default branch when the task has none

#### Scenario: No commits in range
- **WHEN** the developer has no commits in the selected date range and branch
- **THEN** the system states that no commits were found, distinct from evidence being unavailable

#### Scenario: Only assigned developers may list commits
- **WHEN** a project member who is not the task's assigned developer requests the task's commit list
- **THEN** the system refuses the request without returning repository evidence

### Requirement: Developer attaches only their own commits
The system SHALL allow an assigned developer to attach selected commits to a task only when each commit is authored by that developer's verified GitHub identity.

#### Scenario: Developer attaches commits
- **WHEN** an assigned developer confirms a selection of their own commits
- **THEN** the commits are attached to the task and available to the acceptance criteria check and project reporting

#### Scenario: Commit by another author is refused
- **WHEN** a request tries to attach a commit authored by someone other than the developer
- **THEN** the system refuses the request and attaches nothing

### Requirement: Unavailable evidence is reported distinctly
The system SHALL report GitHub evidence as unavailable when the linked installation or repository cannot be reached, access has been revoked or suspended, or GitHub rate limits are hit, and SHALL NOT represent unavailable evidence as an absence of commits.

#### Scenario: GitHub evidence cannot be retrieved
- **WHEN** the system cannot access the linked repository or installation
- **THEN** it reports that evidence is unavailable with a safe reason category, without exposing credentials or raw provider errors

#### Scenario: Branch listing is unavailable
- **WHEN** the system cannot retrieve branches from the linked repository
- **THEN** it reports unavailable evidence rather than presenting the branch list as empty
