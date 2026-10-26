# Spec Delta

## Purpose

Defines how a project is linked to a GitHub repository and how developers attach their own commits to tasks without copying links, so the commits can be used for the acceptance criteria check and for project reporting.

## ADDED Requirements

### Requirement: Product manager links a repository to the project
The system SHALL allow the project's product manager to link one GitHub repository to the project using a read-only access credential. The credential SHALL be stored encrypted on the server and SHALL NOT be returned to any client or written to logs.

#### Scenario: Product manager links a repository
- **WHEN** the product manager provides a repository owner/name and a credential that can read it
- **THEN** the repository is linked to the project and the credential is stored encrypted

#### Scenario: Credential cannot read the repository
- **WHEN** the product manager provides a credential that cannot read the repository
- **THEN** the system refuses the link and explains that the repository is not accessible

#### Scenario: Credential is never exposed
- **WHEN** any client requests project or repository details
- **THEN** the response does not contain the credential or any part of it

### Requirement: Developer lists their own commits
The system SHALL allow an assigned developer to list the commits in the linked repository that were authored by their verified GitHub identity, filtered by a date range and a branch. The date range SHALL default to the current day in Singapore Time (SGT, UTC+08:00), and the branch SHALL default to the task's branch, or to the repository's default branch when the task has none. Commits whose message contains the task's ID SHALL be pre-selected.

#### Scenario: Developer opens the commit picker
- **WHEN** an assigned developer opens the commit picker for a task
- **THEN** the system lists that developer's commits for the default date range and branch, with commits that mention the task ID pre-selected

#### Scenario: No commits in range
- **WHEN** the developer has no commits in the selected date range and branch
- **THEN** the system states that no commits were found, distinct from evidence being unavailable

### Requirement: Developer attaches commits to a task
The system SHALL allow an assigned developer to attach selected commits to a task. The system SHALL only attach commits authored by the developer's verified GitHub identity.

#### Scenario: Developer attaches commits
- **WHEN** an assigned developer confirms a selection of their own commits
- **THEN** the commits are attached to the task and available to the acceptance criteria check and project reporting

#### Scenario: Commit by another author is refused
- **WHEN** a request tries to attach a commit authored by someone other than the developer
- **THEN** the system refuses the request and attaches nothing

### Requirement: Unavailable evidence is reported distinctly
The system SHALL report GitHub evidence as unavailable when the repository cannot be reached, the credential is revoked or expired, or GitHub rate limits are hit, and SHALL NOT represent unavailable evidence as an absence of commits.

#### Scenario: GitHub evidence cannot be retrieved
- **WHEN** the system cannot access the linked repository
- **THEN** the system reports that the evidence is unavailable and the reason category, without exposing the credential or raw provider errors
