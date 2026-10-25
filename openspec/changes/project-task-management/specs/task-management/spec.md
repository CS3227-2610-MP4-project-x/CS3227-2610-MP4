# Spec Delta

## Purpose

Defines how project members are organized and how product managers and developers assign, update, submit, and review project tasks.

## ADDED Requirements

### Requirement: Project membership and product manager
The system SHALL allow a person to belong to multiple projects, and each project SHALL have exactly one product manager.

#### Scenario: Person belongs to multiple projects
- **WHEN** a person is added to a second project
- **THEN** the person remains a member of both projects

#### Scenario: Project has one product manager
- **WHEN** a project is created or its product manager is changed
- **THEN** the project has exactly one product manager

### Requirement: Product manager assigns tasks
The system SHALL allow a project's product manager to create tasks, define their acceptance criteria, and assign them to developers who belong to that project.

#### Scenario: Product manager assigns a task
- **WHEN** the product manager creates a task with acceptance criteria and assigns it to a project developer
- **THEN** the task is visible to that developer as assigned work

### Requirement: Developer submits task progress
The system SHALL allow an assigned developer to submit progress updates for a task, and SHALL retain those updates for project reporting.

#### Scenario: Developer submits an update
- **WHEN** an assigned developer submits a task update
- **THEN** the update is associated with the task and available to the project's product manager

### Requirement: Task completion requires product-manager approval
The system SHALL keep a developer-submitted completion pending until the project's product manager approves or rejects it.

#### Scenario: Developer submits work for approval
- **WHEN** an assigned developer submits a task as complete
- **THEN** the task enters Awaiting Product-Manager Approval and is presented to the product manager for review

#### Scenario: Product manager approves submitted work
- **WHEN** the product manager approves a task awaiting review
- **THEN** the task becomes Completed

#### Scenario: Product manager rejects submitted work
- **WHEN** the product manager rejects a task awaiting review and provides feedback
- **THEN** the feedback is associated with the task and the task returns to In Progress

#### Scenario: Developer cannot approve own submission
- **WHEN** a developer submits a task as complete
- **THEN** the submission remains pending until the product manager acts
