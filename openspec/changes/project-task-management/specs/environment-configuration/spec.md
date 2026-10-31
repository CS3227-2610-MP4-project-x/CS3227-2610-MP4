# Spec Delta

## Purpose

Defines the separate development and production environments, how their configuration is documented in `.env.example`, and how credentials are kept server-side.

## ADDED Requirements

### Requirement: Development and production are separate environments
The system SHALL run in separate development and production environments. Each SHALL have its own Supabase project, Vercel environment, GitHub OAuth app with its own callback URL, SoC LLM credential, and quota settings. The Vercel `dev` branch preview SHALL use the development environment and the `master` production deployment SHALL use the production environment.

#### Scenario: Environments do not share credentials
- **WHEN** the development and production configurations are compared
- **THEN** no database credential, encryption key, OAuth client secret, or SoC LLM key is the same in both

#### Scenario: Callback URL per environment
- **WHEN** a person signs in on one environment
- **THEN** the sign-in uses that environment's own GitHub OAuth app and returns to that environment's own URL

### Requirement: Every environment variable is documented in .env.example
The repository SHALL include `.env.example` listing every environment variable the application, its tests, or its operators read, each with a placeholder value and a comment stating its purpose and which environments set it. `.env.example` SHALL contain no real value.

#### Scenario: Variable read by code
- **WHEN** code reads an environment variable
- **THEN** that variable appears in `.env.example`

#### Scenario: Placeholders pass secret scanning
- **WHEN** secret scanning runs on `.env.example`
- **THEN** it reports no finding

### Requirement: Secrets are server-only
Database, encryption, OAuth client, and SoC LLM credentials SHALL be server-side environment variables only. No such variable SHALL have a `NEXT_PUBLIC_` prefix, appear in a Client Component prop, be committed, or be logged.

#### Scenario: Secret named with NEXT_PUBLIC_
- **WHEN** a variable that holds a credential is named with a `NEXT_PUBLIC_` prefix
- **THEN** this requirement is not met

#### Scenario: Real environment file not committed
- **WHEN** a change adds `.env`, `.env.local`, or a Vercel environment download
- **THEN** the change is rejected, and `.gitignore` ignores them
