# Spec Delta

## Purpose

Defines how people sign in, how their GitHub identity is verified, and how access to projects and actions is enforced by project role.

## ADDED Requirements

### Requirement: Sign in with GitHub
The system SHALL authenticate people through GitHub sign-in and SHALL record the verified GitHub user ID and username of each person.

#### Scenario: Start GitHub sign-in
- **WHEN** a person sends a GET request to `/api/v1/auth/sign-in`
- **THEN** the system starts the GitHub PKCE sign-in flow through that environment's Supabase project

#### Scenario: First sign-in
- **WHEN** a person signs in with GitHub for the first time
- **THEN** an account is created with their verified GitHub user ID and username

#### Scenario: GitHub identity fields come from the verified provider identity
- **WHEN** the Supabase Auth response contains the signed-in user's GitHub identity
- **THEN** the system records the GitHub provider ID from that identity's `provider_id` or legacy response field `id`, and the username from that same identity's provider-origin `identity_data`, never from editable `user_metadata` or callback query values

#### Scenario: Supabase returns to the application callback
- **WHEN** GitHub authentication succeeds and Supabase redirects the browser with an authorization code using GET to `/api/v1/auth/callback`
- **THEN** the callback exchanges the code for a Supabase session and establishes the server-managed session

#### Scenario: Sign-out
- **WHEN** a signed-in person sends a POST request to `/api/v1/auth/sign-out`
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
