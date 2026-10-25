# Spec Delta

## Purpose

Defines how developers associate GitHub work with project tasks and how the application retrieves related commit activity for assessment and reporting.

## ADDED Requirements

### Requirement: Developer supplies GitHub evidence for a task
The system SHALL let an assigned developer associate a GitHub reference with a task using a reference format supported by the product.

#### Scenario: Developer provides a supported reference
- **WHEN** an assigned developer submits a supported GitHub reference for a task
- **THEN** the reference is associated with that task

#### Scenario: Developer provides an unsupported reference
- **WHEN** an assigned developer submits a GitHub reference in an unsupported format
- **THEN** the system explains that the reference cannot be used and does not associate it with the task

### Requirement: Retrieve commit activity from task evidence
The system SHALL retrieve commit activity available through the associated GitHub reference and make that activity available for task assessment and project reporting.

#### Scenario: Commits are available through the reference
- **WHEN** the system successfully retrieves commits for an associated GitHub reference
- **THEN** the retrieved commit activity is available with its task association

#### Scenario: GitHub evidence cannot be retrieved
- **WHEN** the system cannot access or resolve an associated GitHub reference
- **THEN** the system reports that the evidence is unavailable and does not represent it as retrieved activity
