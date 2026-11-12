# Spec Delta

## Purpose

Defines reproducible browser verification of complete developer and product-manager journeys using isolated synthetic data and controlled external providers.

## ADDED Requirements

### Requirement: Complete local role journeys
The suite SHALL exercise rendered application pages, HTTP handlers, domain services and disposable PostgreSQL with distinct synthetic developer and product-manager sessions. Only external authentication, GitHub and AI boundaries SHALL be substituted.

#### Scenario: Developer completes submission
- **GIVEN** an assigned To Do task and controlled repository evidence
- **WHEN** the developer starts work, records progress, saves commit selection, runs a successful acceptance check and submits
- **THEN** persisted task state is In Review and progress, attachments and check history remain visible after reload
- **AND** the acceptance check itself has not changed task state

#### Scenario: Product manager completes review and reporting
- **WHEN** the product manager creates and assigns a task, reviews submitted work, requests changes with feedback, receives resubmission, approves and generates a report
- **THEN** feedback survives reload, the task reaches Done only through product-manager approval, and the report shows verified task references

#### Scenario: Provider failure and recovery
- **WHEN** each AI feature encounters a deterministic provider failure
- **THEN** the UI shows its safe failure state, task state remains unchanged by AI and no successful result is fabricated
- **AND** a subsequent independently controlled success can recover

#### Scenario: Developer cannot perform product-manager actions
- **WHEN** a developer directly requests task approval or progress-report generation
- **THEN** access is denied without task mutation or report disclosure

### Requirement: Local test controls fail closed
Synthetic authentication and scenario controls SHALL require explicit local/test execution and SHALL be unavailable in deployments, including Vercel previews. They SHALL preserve real membership, role and CSRF checks and require no production credentials.

#### Scenario: Deployed activation is rejected
- **WHEN** synthetic authentication or scenario controls are requested in a deployed environment
- **THEN** activation fails closed and no synthetic session or provider control is available

#### Scenario: Ordinary runtime is preserved
- **WHEN** explicit local E2E mode is absent
- **THEN** normal authentication and provider behavior remain active and synthetic sessions are rejected

### Requirement: Isolated reproducible fixtures
Every scenario SHALL use disposable synthetic data and independent provider outcomes without live GitHub, Supabase Auth or SoC calls. Missing harness prerequisites SHALL fail the journey run clearly rather than silently count skipped journeys as passing.

#### Scenario: Fresh isolated run
- **WHEN** a journey run starts
- **THEN** it applies existing migrations to a dedicated disposable database and runs application queries as app_runtime
- **AND** each scenario has isolated data and provider outcomes without resetting a shared or hosted database

#### Scenario: Missing prerequisite
- **WHEN** a required browser, disposable database or harness setting is unavailable
- **THEN** the run reports a clear failure instead of reporting skipped journeys as success

### Requirement: CI execution and release evidence
CI SHALL execute Chromium role journeys as a separate reported check using disposable local services. Evidence SHALL record command, source revision, environment, results and artifact paths. Failures SHALL retain bounded sanitized diagnostic evidence.

#### Scenario: Verification threshold
- **WHEN** task 9.2 is reported verified
- **THEN** all success and failure journey scenarios have executed and passed locally and in CI on a fresh database
- **AND** evidence discloses synthetic authentication limits and preserves manual deployed checks under task 9.4

#### Scenario: Journey failure evidence
- **WHEN** a journey fails in CI
- **THEN** the check fails and bounded sanitized traces or screenshots are retained for diagnosis
