# Spec Delta

## Purpose

Defines the AI-assisted assessment of developer-submitted task work against the task's acceptance criteria, for use during product-manager review.

## ADDED Requirements

### Requirement: Assess submitted work against acceptance criteria
The system SHALL provide the product manager an AI-generated confidence score assessing how well the developer-submitted work meets the task's acceptance criteria.

#### Scenario: Assessment is available for review
- **WHEN** a developer submits work for a task that has acceptance criteria
- **THEN** the system provides the product manager with an AI-generated confidence score about how well the submitted work meets those criteria

### Requirement: AI assessment does not decide task completion
The system SHALL NOT use an AI-generated assessment to approve or reject a task or change its completion status.

#### Scenario: Assessment is generated
- **WHEN** the system generates an AI assessment for submitted work
- **THEN** the task remains Awaiting Product-Manager Approval until the product manager approves or rejects it
