# Spec Delta

## Purpose

Defines the automated checks GitHub Actions runs on repository changes so that a change reaches `master` only with its quality, secret-scanning, and dependency-audit evidence available.

## ADDED Requirements

### Requirement: CI runs the recorded quality checks
The system SHALL provide a GitHub Actions workflow that installs dependencies from the committed lockfile and runs lint, type-check, unit tests, and production build as separate, individually reported checks.

#### Scenario: Clean change passes
- **WHEN** the workflow runs on a change whose lint, type-check, unit tests, and build all succeed
- **THEN** each check reports success

#### Scenario: Failing check is reported
- **WHEN** any of lint, type-check, unit tests, or build fails
- **THEN** that check reports failure and the workflow run is marked failed

#### Scenario: Lockfile is authoritative
- **WHEN** the workflow installs dependencies
- **THEN** it installs from the lockfile (`npm ci`) and fails if `package.json` and the lockfile disagree

### Requirement: CI scans for committed secrets
The workflow SHALL scan the change for committed secrets and SHALL fail when a secret is detected.

#### Scenario: Secret in a change
- **WHEN** a change contains a credential-like value
- **THEN** the secret-scanning check fails and the run is marked failed

#### Scenario: No secret in a change
- **WHEN** a change contains no detected secret
- **THEN** the secret-scanning check reports success

### Requirement: CI audits dependencies
The workflow SHALL audit installed dependencies for known vulnerabilities and report the result.

#### Scenario: Audit result reported
- **WHEN** the dependency audit runs
- **THEN** its result is reported as its own check
- **AND** the severity at which it fails is as recorded in `design.md` (CI decision D6)

### Requirement: CI uses no production credentials
The workflow SHALL run without production credentials, database access, or SoC LLM access, and tests it runs SHALL use isolated synthetic fixtures.

#### Scenario: Workflow environment
- **WHEN** the workflow runs
- **THEN** no production database, GitHub OAuth, or SoC LLM secret is available to any step

### Requirement: CI results gate merging to master
Changes SHALL reach `master` only through a reviewed pull request whose CI checks have passed.

#### Scenario: CI green before merge
- **WHEN** a pull request targets `master`
- **THEN** the checks above have run on it, and a failing check is visible to reviewers before merge
