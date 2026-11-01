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
The database SHALL store at most one check result per task for a given commit set and acceptance-criteria hash, and at most one report per project and date range, so that the reuse rules of the Acceptance Criteria Check and the Progress Report can be applied.

#### Scenario: Same check stored twice
- **WHEN** a second check result is written for the same task, commit set, and criteria hash
- **THEN** the database rejects the duplicate

### Requirement: Stored records exclude secrets and AI content
The database SHALL store the GitHub credential only in encrypted form. Usage records SHALL NOT contain prompt or response content.

#### Scenario: Credential at rest
- **WHEN** a project's repository credential is stored
- **THEN** no column holds it in plaintext

### Requirement: Runtime access is least-privilege and server-only
The application SHALL access the database through a role that cannot change the schema, over the transaction-pooler connection. Application tables SHALL NOT be readable or writable through Supabase Data APIs.

#### Scenario: Data API access
- **WHEN** a client calls the Supabase Data API for an application table with a project member's session
- **THEN** the request is denied
