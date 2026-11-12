# Spec Delta

## Purpose

Defines the integrity guarantees of the PostgreSQL schema that stores people, projects, memberships, tasks, acceptance criteria, task events, progress updates, attached commits, check results, reports, and usage records, and how that schema is created and changed.

## ADDED Requirements

### Requirement: Schema is created by versioned migrations
The system SHALL create and change the database schema only through ordered, versioned migrations kept in the repository. A migration that has shipped SHALL NOT be edited; a change SHALL be a new migration. Migrations SHALL be applied as a controlled release step, not by the running application.

#### Scenario: Empty database is migrated
- **WHEN** all migrations are applied in order to an empty PostgreSQL database
- **THEN** the schema contains the tables for people, projects, memberships, tasks, acceptance criteria, task events, progress updates, attached commits, check results, reports, and usage records

#### Scenario: Application does not migrate
- **WHEN** the application starts
- **THEN** it does not create or alter schema objects

### Requirement: Identifiers, timestamps, and revisions
The system SHALL identify every record by an opaque UUID, store every timestamp in UTC, and give every mutable record an integer version that increases on each update. Project keys SHALL be unique, and task IDs SHALL be unique within a project and never reused.

#### Scenario: Concurrent edits to a task
- **WHEN** two writers update the same task using the same version
- **THEN** only one update succeeds, and the other is refused as a conflict

#### Scenario: Concurrent task creation
- **WHEN** two tasks are created in the same project at the same time
- **THEN** they receive different task IDs

### Requirement: Membership integrity is enforced by the database
The database SHALL allow a person at most one membership, with exactly one role, per project, and SHALL allow at most one Product Manager membership per project.

#### Scenario: Person in several projects
- **WHEN** a person is given a membership in a second project
- **THEN** the database accepts it and the person has a separate role in each project

#### Scenario: Second membership in the same project
- **WHEN** a person is given a second membership in a project where they already have one
- **THEN** the database rejects it

#### Scenario: Second product manager
- **WHEN** a second Product Manager membership is added to a project
- **THEN** the database rejects it

### Requirement: Task data stays inside its project
When a task is written, the database SHALL reject it if its assignee has no Developer membership in the task's project. Deleting a task SHALL keep the task and its records, marked as deleted. Acceptance criteria, progress updates, task events, attached commits, and check results SHALL each belong to exactly one task, and a task's records SHALL belong to the same project as the task.

#### Scenario: Assignee outside the project
- **WHEN** a task is written with an assignee who is not a developer in the task's project
- **THEN** the database rejects the write

#### Scenario: Orphan record
- **WHEN** an acceptance criterion, progress update, task event, attached commit, or check result is written without an existing task
- **THEN** the database rejects the write

#### Scenario: Deleted task keeps its history
- **WHEN** a task with progress updates and check results is deleted
- **THEN** the task and those records remain stored, and the task is marked as deleted

### Requirement: Stored results are keyed for reuse
The database SHALL store at most one check result per task for a given commit-set hash, acceptance-criteria hash, and effective versioned path-rules fingerprint, and at most one report per project and date range, so that the reuse rules of the Acceptance Criteria Check and the Progress Report can be applied. Task ID SHALL be a separate key dimension. The commit-set hash SHALL be SHA-256 of full commit SHAs sorted lexicographically and joined by LF, with no trailing LF. The acceptance-criteria hash SHALL be SHA-256 of compact UTF-8 JSON containing `{ "id", "description" }` objects ordered by criterion position and then criterion ID, with object properties serialized as `id` then `description`. New check-result rows SHALL store a non-null SHA-256 path-rules hash. Existing rows without a path-rules hash SHALL be preserved as legacy history and SHALL NOT be reused by new checks.

#### Scenario: Same check stored twice
- **WHEN** a second check result is written for the same task, commit-set hash, criteria hash, and path-rules hash
- **THEN** the database rejects the duplicate

#### Scenario: Different path rules retain distinct checks
- **WHEN** check results are written for the same task, commit set, and criteria but different normalized path-rules hashes
- **THEN** the database stores one result for each distinct path-rules hash

#### Scenario: Legacy check history is preserved
- **WHEN** the path-rules hash migration encounters an existing check result
- **THEN** the result remains available as history without a fabricated path-rules hash
- **AND** a new check using a current path-rules hash may be stored for the same commit set and criteria

### Requirement: Stored records exclude secrets and AI content
The database SHALL NOT store GitHub App private keys or GitHub user or installation access tokens. A project MAY store the GitHub App installation ID and the linked repository's stable ID, owner, and name. Usage records SHALL NOT contain prompt or response content.

When the GitHub App binding migration retires legacy encrypted PAT fields, it SHALL clear any legacy repository owner/name and PAT ciphertext fields so affected projects become unlinked and can be relinked through the GitHub App.

#### Scenario: Repository binding at rest
- **WHEN** a project's repository is linked
- **THEN** the database stores its installation and repository identifiers and display coordinates, but no access token or App private key

#### Scenario: Project has at most one repository binding
- **WHEN** a project repository link is inserted or replaced
- **THEN** its owner/name, installation ID, and stable repository ID are either all present or all absent, and the project has at most one linked repository

### Requirement: Runtime access is least-privilege and server-only
The application SHALL access the database through a role that cannot change the schema, over the transaction-pooler connection. Application tables SHALL NOT be readable or writable through Supabase Data APIs.

#### Scenario: Data API access
- **WHEN** a client calls the Supabase Data API for an application table with a project member's session
- **THEN** the request is denied

### Requirement: Assessment contract version affects reuse without rewriting history
The canonical commit-set, criteria, and normalized path-rules hashes SHALL retain their recorded calculations. Version 2 check results SHALL persist the effective `path_rules_hash` fingerprint SHA-256 of compact UTF-8 JSON with fixed property order `{ "assessmentVersion": 2, "pathRulesHash": "<canonical normalized path-rules hash>" }`. Existing cache uniqueness SHALL continue to use task, commit-set hash, criteria hash, and this effective fingerprint. Legacy rows SHALL remain unchanged and readable but SHALL NOT match the version 2 fingerprint. The result JSON SHALL carry `assessmentVersion: 2`, file-grouped verified evidence, model status, and safe verification diagnostics according to the completion-assessment contract; raw model responses SHALL NOT be persisted.

#### Scenario: Contract upgrade preserves history and permits reassessment
- **WHEN** the same task, commits, criteria, and canonical path rules previously produced a legacy check
- **THEN** a version 2 check can be stored under its distinct effective fingerprint
- **AND** both checks remain in history without rewriting the old row

### Requirement: Provider-key permits are shared and server-only
A new versioned migration SHALL add server-only shared provider-key permit storage owned by the usage module. The usage repository SHALL atomically serialize permit acquisition by a SHA-256 credential fingerprint and enforce the fetched request limit using database time over a rolling 60-second window. A permit exactly 60 seconds old SHALL no longer count. Storage SHALL contain no credential, prompt, response, or user content. Concurrent acquisitions across application instances SHALL NOT exceed the permitted count. Runtime grants SHALL be least privilege, and Supabase Data API access SHALL be denied. No shipped migration SHALL be modified and no hosted migration execution is authorized by this requirement. No database transaction SHALL span a provider network call. Expired permits MAY remain stored without affecting enforcement.

#### Scenario: Shared permits enforce the rolling boundary
- **WHEN** a key has its allowed number of permits newer than database time minus 60 seconds
- **THEN** an additional acquisition is refused without creating another permit
- **AND** a permit exactly 60 seconds old is excluded from the count
