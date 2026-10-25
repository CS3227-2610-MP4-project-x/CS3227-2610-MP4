# Tasks

## 1. Resolve Product and Architecture Decisions

- [ ] 1.1 Confirm supported GitHub reference types and least-privilege authorization needs; update the GitHub evidence spec and design, then verify the chosen input and access contract is recorded.
- [ ] 1.2 Define the confidence score's scale, interpretation, evidence shown to reviewers, and behavior when evidence is missing; update the assessment spec and design, then verify the AI contract is testable.
- [ ] 1.3 Review the authoritative architecture and API specifications for this project; record any required design changes and verify that each planned integration has an approved service and adapter boundary.

## 2. Implement Project Membership and Task Review

- [ ] 2.1 Implement project membership and the one-product-manager-per-project invariant; add unit and PostgreSQL tests for cross-project membership and manager uniqueness, and document the project role behavior.
- [ ] 2.2 Implement task creation, acceptance criteria, developer assignment, and progress updates; add service and API tests for authorization and project membership, and document task operations.
- [ ] 2.3 Implement the Awaiting Product-Manager Approval, approval, and rejection-with-feedback transitions; add transition and competing-write tests, and document the review workflow.

## 3. Implement GitHub Evidence

- [ ] 3.1 Implement the approved GitHub authorization and reference retrieval through a server-side adapter; add tests for supported and unsupported references, inaccessible repositories, and retrieval failures, and document required setup.
- [ ] 3.2 Associate retrieved commits with their task evidence and expose them to authorized assessment and report services; add tests that prevent cross-project access and distinguish unavailable evidence from no commits.

## 4. Implement AI Completion Assessment

- [ ] 4.1 Implement an AI assessment service using the approved score and evidence contract, passing only task acceptance criteria and approved task evidence; add deterministic provider-fake tests for success, failure, and missing evidence.
- [ ] 4.2 Persist or return validated assessment results without changing task state; add tests proving provider output cannot approve or reject a task, and document score interpretation and limitations.

## 5. Implement Daily Progress Reports

- [ ] 5.1 Implement report aggregation for developer-submitted task updates and retrieved GitHub activity within the shared 8:00am–6:00pm SGT window; add tests for window boundaries, dates, and unavailable evidence, and document report behavior.
- [ ] 5.2 Restrict report access to the product manager for the relevant project; add API authorization tests for project membership and cross-project isolation.

## 6. Integration Verification

- [ ] 6.1 Verify the end-to-end developer submit, product-manager review, rejection and resubmission, and approval journeys with deterministic GitHub and AI fakes; record commands, environment, results, and evidence paths as required by the repository.
- [ ] 6.2 Run OpenSpec validation and applicable formatting, lint, type-check, and build checks; resolve findings and record the final results.
