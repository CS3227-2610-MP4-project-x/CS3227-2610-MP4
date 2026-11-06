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
For every private page and API request, the system SHALL verify the session and enforce project membership and role on the server. Hiding controls in the UI SHALL NOT be the only protection. Public authentication lifecycle routes are excluded from project membership and role authorization.

#### Scenario: Non-member requests a project
- **WHEN** a signed-in person who is not a member requests a project or any of its tasks
- **THEN** the system returns HTTP 404 without revealing the project's contents

#### Scenario: Developer calls a product-manager action directly
- **WHEN** a developer sends an API request for a product-manager action, such as creating or editing a task
- **THEN** the system returns HTTP 403 and nothing changes

#### Scenario: Unauthenticated request
- **WHEN** a request without a valid session reaches a private API route
- **THEN** the system returns HTTP 401

#### Scenario: Public authentication lifecycle routes
- **WHEN** a person uses `GET /api/v1/auth/sign-in`, `GET /api/v1/auth/callback`, or `POST /api/v1/auth/sign-out`
- **THEN** the system does not require project membership or role authorization for that route

### Requirement: Protected route authorization stubs
The system SHALL provide temporary project and task route stubs to verify server-side access enforcement. An authorized request to a stub SHALL return HTTP 501 and SHALL make no state changes. Feature tasks SHALL replace stubs with functional endpoints and add route-level authorization tests.

#### Scenario: Project details require membership
- **WHEN** a person requests `GET /api/v1/projects/{projectId}`
- **THEN** an authenticated project member receives HTTP 200 with the project's `id`, `key`, `name`, and the requester's `role`, while an authenticated non-member receives HTTP 404

#### Scenario: Project creation is functional
- **WHEN** a person requests `POST /api/v1/projects`
- **THEN** the endpoint is no longer a stub, and the task-management requirement "Signed-in people create projects" defines its policy, payload, and responses

#### Scenario: Task creation stub requires the product-manager role
- **WHEN** a person requests `POST /api/v1/projects/{projectId}/tasks`
- **THEN** a project product manager reaches the stub, a project developer receives HTTP 403, and a non-member receives HTTP 404

#### Scenario: Task read stub requires membership
- **WHEN** a person requests `GET /api/v1/projects/{projectId}/tasks/{taskId}`
- **THEN** an authenticated project member reaches the stub, while an authenticated non-member receives HTTP 404

#### Scenario: Task field edit stub requires the product-manager role
- **WHEN** a person requests a field edit using `PATCH /api/v1/projects/{projectId}/tasks/{taskId}`
- **THEN** a project product manager reaches the stub, a project developer receives HTTP 403, and a non-member receives HTTP 404

#### Scenario: Task state transition stub enforces lifecycle permissions
- **WHEN** a person sends PATCH to `/api/v1/projects/{projectId}/tasks/{taskId}/state` with a JSON body whose `state` is `To Do`, `In Progress`, `In Review`, or `Done`
- **THEN** only the assigned developer is authorized to request `In Progress` from `To Do` or `In Review` from `In Progress`
- **AND** only the project's product manager is authorized to request `Done` or `In Progress` from `In Review`
- **AND** an authenticated project member without the required assignment or role receives HTTP 403, while a non-member receives HTTP 404
- **AND** an authorized request reaches a stub that returns HTTP 501 without changing the task state

#### Scenario: Authorized request reaches a protected route stub
- **WHEN** an authenticated person with the required project access requests one of the initial protected route stubs before its feature is implemented
- **THEN** the system returns HTTP 501 with code `NOT_IMPLEMENTED` and message `Endpoint not implemented` in the safe JSON error envelope
- **AND** no state changes

#### Scenario: Invalid session uses a stable safe error
- **WHEN** a request without a valid session reaches a private API route
- **THEN** the system returns HTTP 401 with code `UNAUTHENTICATED` and message `Authentication required`
- **AND** the response contains no provider or internal details

#### Scenario: Invalid request body or UUID uses a stable safe error
- **WHEN** a protected route receives malformed JSON, a missing or invalid state value, or a malformed project or task UUID
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST` and message `Invalid request`
- **AND** the system performs no state changes

#### Scenario: Missing project or concealed cross-project task uses a stable not-found error
- **WHEN** a project or task does not exist, a person is not a member of the project, or a task UUID belongs to a different project than the project in the request path
- **THEN** the system returns HTTP 404 with code `NOT_FOUND` and message `Resource not found`
- **AND** the response does not reveal whether the project or task exists

#### Scenario: Member without permission uses a stable safe error
- **WHEN** an authenticated project member lacks the required project role or task assignment
- **THEN** the system returns HTTP 403 with code `FORBIDDEN` and message `Insufficient permissions`

#### Scenario: Identity, membership, or task lookup fails operationally
- **WHEN** an identity, membership, project, or task lookup fails because of an operational error
- **THEN** the system returns HTTP 500 with code `INTERNAL_ERROR` and message `Internal server error`
- **AND** the response does not expose the underlying failure details

#### Scenario: State transition validation remains with task lifecycle implementation
- **WHEN** a requested state transition is invalid for the task's current state
- **THEN** task 3.2's authorization stubs do not implement transition validation or mutation
- **AND** task 4.3 defines the functional invalid-transition response and behavior

### Requirement: Protected API errors use stable safe responses
Protected API errors SHALL use the JSON envelope `{ "error": { "code": "...", "message": "..." } }`. Codes and generic messages SHALL be stable and SHALL NOT expose provider, database, or other internal details.

#### Scenario: Error codes and messages are stable
- **WHEN** a protected API route returns an error
- **THEN** HTTP 401 uses `UNAUTHENTICATED` and `Authentication required`
- **AND** HTTP 404 uses `NOT_FOUND` and `Resource not found`
- **AND** HTTP 403 uses `FORBIDDEN` and `Insufficient permissions`
- **AND** HTTP 501 uses `NOT_IMPLEMENTED` and `Endpoint not implemented`
- **AND** HTTP 400 uses `INVALID_REQUEST` and `Invalid request`
- **AND** HTTP 500 uses `INTERNAL_ERROR` and `Internal server error`

#### Scenario: Route-level authorization is tested before feature implementation
- **WHEN** task 3.2's authorization boundary is tested
- **THEN** API tests exercise the initial protected route stubs for unauthenticated requests, non-member project concealment, and a developer calling a product-manager action
- **AND** tests distinguish task-field edit permissions from state-transition permissions, including assigned versus unassigned developers and product-manager transitions from In Review
- **AND** the tests confirm denied requests make no state changes

#### Scenario: Unauthenticated request to the protected workspace
- **WHEN** a person without a valid session requests the protected workspace
- **THEN** the browser is redirected to `/sign-in`

#### Scenario: Authenticated person opens the sign-in page
- **WHEN** a person with a valid session requests `/sign-in`
- **THEN** the browser is redirected to the signed-in workspace at `/`

### Requirement: Mutating project routes check the request origin
Every state-changing project route SHALL require an `Origin` header equal to the environment's `APP_ORIGIN` and a `Content-Type` of `application/json`, and SHALL reject other requests before changing any state.

#### Scenario: Bad origin is refused
- **WHEN** a mutating request to `POST /api/v1/projects`, `POST /api/v1/projects/{projectId}/members`, or `POST /api/v1/projects/{projectId}/product-manager-transfer` has a missing `Origin` header or one that differs from `APP_ORIGIN`
- **THEN** the system returns HTTP 403 with code `FORBIDDEN` and a safe message, and nothing changes

#### Scenario: Wrong content type is refused
- **WHEN** such a request does not have `Content-Type: application/json`
- **THEN** the system returns HTTP 400 with code `INVALID_REQUEST` and nothing changes

#### Scenario: Matching origin proceeds to authorization
- **WHEN** such a request has an `Origin` equal to `APP_ORIGIN` and a JSON content type
- **THEN** the normal authentication, membership, and role checks apply
