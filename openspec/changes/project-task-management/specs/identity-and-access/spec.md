# Spec Delta

## Purpose

Defines how people sign in, how their GitHub identity is verified, and how access to projects and actions is enforced by project role.

## ADDED Requirements

### Requirement: Sign in with GitHub
The system SHALL authenticate people through GitHub sign-in and SHALL record the verified GitHub user ID and username of each person.

#### Scenario: First sign-in
- **WHEN** a person signs in with GitHub for the first time
- **THEN** an account is created with their verified GitHub user ID and username

#### Scenario: Sign-out
- **WHEN** a signed-in person signs out
- **THEN** their session ends and private pages and API routes require signing in again

### Requirement: Access is enforced by project role on the server
The system SHALL enforce project membership and role on the server for every page and API request. Hiding controls in the UI SHALL NOT be the only protection.

#### Scenario: Non-member requests a project
- **WHEN** a signed-in person who is not a member requests a project or any of its tasks
- **THEN** the system refuses the request without revealing the project's contents

#### Scenario: Developer calls a product-manager action directly
- **WHEN** a developer sends an API request for a product-manager action, such as creating a task or approving a submission
- **THEN** the system refuses the request and nothing changes

#### Scenario: Unauthenticated request
- **WHEN** a request without a valid session reaches a private API route
- **THEN** the system refuses it
