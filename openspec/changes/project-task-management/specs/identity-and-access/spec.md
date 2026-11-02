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

#### Scenario: Sign-out from the workspace succeeds
- **WHEN** a signed-in person chooses the account's sign-out action and the sign-out request succeeds
- **THEN** the browser navigates to `/sign-in`

#### Scenario: Sign-out fails
- **WHEN** a signed-in person chooses the account's sign-out action and the sign-out request fails
- **THEN** the workspace remains visible and the account UI shows the generic message `Try again later`
- **AND** it does not expose provider or server error details

#### Scenario: Signed-in account identity is shown
- **WHEN** a signed-in person views the workspace account UI
- **THEN** it shows their verified GitHub username and avatar from the verified GitHub identity
- **AND** it offers a sign-out action

#### Scenario: Successful GitHub sign-in opens the workspace
- **WHEN** the callback establishes a valid session
- **THEN** the browser navigates to the signed-in workspace at `/`

#### Scenario: GitHub sign-in callback fails
- **WHEN** the callback cannot establish a valid session
- **THEN** the browser is redirected to `/sign-in?auth=failed`
- **AND** the sign-in page displays a generic sign-in error without provider or server error details

#### Scenario: Sign-in page is separate from the workspace
- **WHEN** a person without a valid session opens `/sign-in`
- **THEN** the system shows a public sign-in page with an action to start GitHub sign-in

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

#### Scenario: Unauthenticated request to the protected workspace
- **WHEN** a person without a valid session requests the protected workspace
- **THEN** the browser is redirected to `/sign-in`

#### Scenario: Authenticated person opens the sign-in page
- **WHEN** a person with a valid session requests `/sign-in`
- **THEN** the browser is redirected to the signed-in workspace at `/`
