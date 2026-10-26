# Spec Delta

## Purpose

Defines how project members are organized and how product managers and developers create, assign, progress, submit, and review project tasks.

## ADDED Requirements

### Requirement: Project membership and roles
The system SHALL allow a person to belong to multiple projects with one role per project, either Product Manager or Developer, and each project SHALL have exactly one product manager.

#### Scenario: Person belongs to multiple projects
- **WHEN** a person is added to a second project
- **THEN** the person remains a member of both projects, with a separate role in each

#### Scenario: Project has one product manager
- **WHEN** a project is created or its product manager is changed
- **THEN** the project has exactly one product manager

#### Scenario: Product manager adds a developer
- **WHEN** the product manager adds a registered person to the project as a developer
- **THEN** that person can see the project and can be assigned its tasks

### Requirement: Product manager manages tasks
The system SHALL allow a project's product manager to create, edit, reassign, and delete tasks. Each task SHALL have a title, a description, at least one acceptance criterion, an assignee who is a developer in the project, a due date, and an optional branch name.

#### Scenario: Product manager creates a task
- **WHEN** the product manager creates a task with acceptance criteria and assigns it to a project developer
- **THEN** the task is in To Do and appears on that developer's board as assigned work

#### Scenario: Task without acceptance criteria is refused
- **WHEN** the product manager saves a task with no acceptance criteria
- **THEN** the system refuses the task and explains that at least one acceptance criterion is required

#### Scenario: Assignee must belong to the project
- **WHEN** the product manager assigns a task to a person who is not a developer in the project
- **THEN** the system refuses the assignment

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
The system SHALL keep a submitted task in In Review until the project's product manager approves it or requests changes. A submission SHALL include the commits attached to the task and the latest acceptance criteria check, if one was run.

#### Scenario: Developer submits work for review
- **WHEN** the assigned developer submits a task in In Progress for review
- **THEN** the task moves to In Review and appears in the product manager's review queue with its attached commits and latest criteria check

#### Scenario: Product manager approves submitted work
- **WHEN** the product manager approves a task in In Review
- **THEN** the task moves to Done

#### Scenario: Product manager requests changes
- **WHEN** the product manager requests changes on a task in In Review and provides feedback
- **THEN** the feedback is associated with the task, visible to the assigned developer, and the task returns to In Progress

#### Scenario: Developer cannot approve a submission
- **WHEN** a developer tries to approve a task or move it to Done
- **THEN** the system refuses the request and the task remains in In Review
