# Spec Delta

## Purpose

Defines the separate development and production environments, how their configuration is documented in `.env.example`, and how credentials are kept server-side.

## ADDED Requirements

### Requirement: Development and production are separate environments
The system SHALL run separate development and production environments. Each SHALL use its own Supabase project, Vercel environment, GitHub sign-in app, GitHub App registration, SoC LLM credential, and quota settings. Each GitHub App SHALL use credentials and callback URLs specific to its environment. The Vercel `dev` preview SHALL use development settings, and the `master` deployment SHALL use production settings.

#### Scenario: Environments do not share credentials
- **WHEN** the development and production configurations are compared
- **THEN** no database credential, encryption key, GitHub App private key, OAuth client secret, or SoC LLM key is the same in both

#### Scenario: Callback URL per environment
- **WHEN** a person signs in or authorizes repository linking on one environment
- **THEN** the flow uses that environment's GitHub application callback and returns only to that environment's configured URL

### Requirement: Every environment variable is documented in .env.example
The repository SHALL include `.env.example` listing every environment variable the application, its tests, or its operators read, each with a placeholder value and a comment stating its purpose and which environments set it. `.env.example` SHALL contain no real value.

#### Scenario: Variable read by code
- **WHEN** code reads an environment variable
- **THEN** that variable appears in `.env.example`

#### Scenario: Placeholders pass secret scanning
- **WHEN** secret scanning runs on `.env.example`
- **THEN** it reports no finding

### Requirement: Secrets are server-only
Database, encryption, GitHub App private key, OAuth client, and SoC LLM credentials SHALL be server-side environment variables only. No such variable SHALL have a `NEXT_PUBLIC_` prefix, appear in a Client Component prop, be committed, or be logged.

#### Scenario: Secret named with NEXT_PUBLIC_
- **WHEN** a variable that holds a credential is named with a `NEXT_PUBLIC_` prefix
- **THEN** this requirement is not met

#### Scenario: Real environment file not committed
- **WHEN** a change adds `.env`, `.env.local`, or a Vercel environment download
- **THEN** the change is rejected, and `.gitignore` ignores them
