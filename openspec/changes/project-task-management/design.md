# Design

## Context

The change introduces nine capabilities described in the delta specs. The repository has OpenSpec configuration, agent guidance (`AGENTS.md`), and UI guidance (`specs/ui-spec.md`), but no application code yet. `AGENTS.md` sets the stack: Next.js App Router with TypeScript, Route Handlers under `/api/v1`, PostgreSQL on Supabase behind a server-only repository layer, the SoC LLM behind a replaceable adapter, and Vercel hosting.

## Goals / Non-Goals

**Goals:**
- Give each role one clear AI feature: the Acceptance Criteria Check for developers and the Progress Report for product managers.
- Keep AI output advisory. Only the product manager approves tasks or requests changes.
- Let developers attach commits without copying links or hashes.
- Keep prompts small and focused (context engineering) and avoid repeat LLM calls (resource awareness).
- Keep project, task, GitHub, AI, and reporting responsibilities in separate modules.

**Non-Goals:**
- GitHub webhooks or real-time commit syncing.
- Running or testing submitted code. The AI only reads diffs.
- More than one repository per project.
- Email or chat notifications.

## Decisions

- **Keep integrations server-side.** GitHub and SoC LLM calls happen only in server code behind adapters (`src/server`). UI code never calls GitHub or the LLM. Provider output is untrusted and can never call task mutation services.

- **GitHub sign-in through Supabase Auth.** Supabase Auth with the GitHub provider gives a verified GitHub user ID and username, which the commit picker needs. Supabase Auth is used for identity and sessions only. Application tables are still accessed through the server-side repository layer and are not exposed through Supabase Data APIs.

- **Commit picker instead of pasted references.** The project stores its repository (owner/name). To list commits, the server calls `GET /repos/{owner}/{repo}/commits` with `author`, `since`, `until`, and `sha` (branch). It then fetches diffs for the selected commits with `GET /repos/{owner}/{repo}/commits/{sha}`, or with the compare endpoint for consecutive commits. The server checks commit authorship against the developer's verified GitHub user ID before attaching anything.

- **Read-only, project-level GitHub credential.** The product manager provides a fine-grained personal access token with read-only Contents and Metadata permissions for the one repository. The token is encrypted at rest with a server-side key, never sent to clients, and never logged. A GitHub App with short-lived tokens is the production-grade alternative and a stretch goal.

- **Acceptance Criteria Check without a score.** Output is a schema-validated list, with one entry per criterion (`addressed` | `not_addressed` | `unclear`, plus evidence quotes), and a list of possible gaps. The server verifies that each evidence quote appears in the assessed diff, and downgrades unverifiable criteria to `unclear`. A number would read as a grade of the developer and is hard to test, so there is none.

- **Context engineering for the check.** The prompt contains only the acceptance criteria and the filtered diff. Lockfiles, generated files, and binaries are dropped, and a fixed input budget applies. Files left out because of the budget are listed in the result.

- **Context engineering for the report.** Report input is structured activity (state changes, progress updates, submissions, check results, feedback, commit metadata), never diffs. Each item carries its task ID so the model can cite it, and the server checks every citation against the project's tasks. The range is at most 7 days, and the input has its own budget. A range whose activity exceeds the budget is refused, and the product manager is asked to choose a shorter range. Activity is never silently dropped.

- **Caching.** Check results are keyed by the sorted set of commit SHAs plus a hash of the acceptance criteria. Reports are keyed by project and date range, and are invalidated when activity is recorded in that range. An empty range is answered without an LLM call.

- **One LLM gateway.** All AI features call a single server module. It builds prompts with untrusted content separated from instructions, redacts secrets, enforces quotas, calls the SoC LLM adapter, validates output (one retry), and records usage. A fake adapter provides deterministic success and failure paths for tests.

- **Single timezone.** Dates and default ranges use SGT (UTC+08:00) for every project. Timestamps are stored in UTC.

- **Separate environments.** Development and production each have their own Supabase project, Vercel environment (`dev` branch preview and `master` production), GitHub OAuth app (different callback URLs), SoC LLM credentials, and quota settings. The SoC LLM keys come from two different SoC accounts (see SoC LLM and Quota Decisions).

## SoC LLM Facts

The SoC LLM is SoCLaaS. These facts come from the SoC DocHub SoCLaaS guides (access, API, quickstart, usage-limits, and models pages, last modified between 29 August and 7 October 2026), saved and checked in the CS3227-2610-MP3 project on 16 October 2026. Facts marked *(MP3 key)* were observed with that project's API key and must be re-checked with this project's key.

- **API format.** An OpenAI-compatible gateway at `https://soclaas-api.comp.nus.edu.sg`. Endpoints are `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses` (a compatibility shim with non-durable state), `POST /v1/embeddings`, and `POST /v1/audio/transcriptions`. `POST /v1/chat/completions` is the primary endpoint and executes no tools in the gateway. `model` is required. Streaming uses server-sent events. The quickstart sends `"reasoning_effort": "none"` with Qwen and Gemma models.
- **Authentication.** `Authorization: Bearer <key>`. Keys have the form `clsk_<prefix>_<secret>`, are issued per SoC account through `https://soclaas-portal.comp.nus.edu.sg`, and rotating a key disables the old one at once. Keys must stay server-side.
- **Errors.** Bodies have the shape `{"error": "<message>"}`. 400 is an invalid request, 401 a missing, invalid, or revoked key, 403 a model or feature the key may not use, 429 a rate *or* budget limit, and 5xx a temporary gateway or backend fault. The guides recommend retry with backoff for 429 and 5xx and client-side timeouts. They do not document a `Retry-After` header.
- **Models.** Model names are operator-managed aliases, and `GET /v1/models` is the authoritative list for a key. A key that may not use a model does not see it there. The models page lists `llama3.1:8b` (65,536-token context), `qwen3.5:9b` (65,536), `gemma4:26b` (131,072), `qwen3-coder-next` (196,608), `qwen3.6:35b` (262,144), `qwen3.8:27b` (262,144), `qwen3-vl:32b` (80,000), and `ornith:35b` (262,144), plus trial models such as `x-test-1`. New or test models may appear before the page is updated. *(MP3 key)* On 16 October 2026 the list also had a `default` alias pointing to `qwen3.6:35b`, and operators can repoint it without notice.
- **Context window.** Per model, as above, reported by `GET /v1/models` in `context_length` (also `context_window`, `max_context_tokens`, and `max_model_len`).
- **Prices.** Prices are in microdollars per million tokens and are used only for rate control. No real money is charged. The authoritative source is `GET /v1/models` (`soclaas.input_microdollars_per_million_tokens` and `soclaas.output_microdollars_per_million_tokens`), because the models page was found to list outdated prices. *(MP3 key)* On 16 October 2026 `default` cost 411,810 per million input tokens and 1,456,571 per million output tokens.
- **Rate and budget limits.** Limits apply per API key. The current defaults are 90 requests per minute, 80,000,000 microdollars (USD 80) per day, and 800,000,000 microdollars (USD 800) per month. Lifetime credits and model access policy may also apply, and SoC may adjust any of these. The daily budget resets at 00:00 UTC (08:00 SGT), and the monthly budget at 00:00 UTC on the 1st. A key's actual limits can be read from `GET https://soclaas-portal.comp.nus.edu.sg/api-key/budget`. Requests over a limit are rejected with 429.
- **Token limits.** No tokens-per-minute or tokens-per-day limit is documented. Spending is limited by cost, which is computed from tokens and the model's prices.
- **Data retention.** The guides say only that SoCLaaS records API usage and request metadata against the key for reporting, quotas, and auditing. They say nothing about prompt or response retention, or about which data may be sent.
- **Reachability from Vercel.** A human-run smoke test in the CS3227-2610-MP3 project reached the endpoint and authenticated with an API key from a Vercel Hobby deployment on 11 October 2026. This project has not repeated the check.

## SoC LLM and Quota Decisions

Approved by thegrimbee on 26 October 2026. Cost estimates use the `qwen3.6:35b` prices observed on 16 October 2026: one check with a full input budget costs about USD 0.01, so the USD 80 daily key budget allows about 8,000 checks.

- **Model.** Both AI features use `qwen3.6:35b`, pinned by name rather than through the `default` alias, so cache keys and usage records name the model actually used. Before AI is enabled, `GET /v1/models` with this project's key must list the model, and its prices are read from there. If the name is retired, calls fail safe and the model is changed in configuration.
- **Keys per environment.** Development uses an API key from thegrimbee's SoC account, and production uses one from Lim-ZY's SoC account. Each environment therefore has its own full per-key limits, and replacing one key does not affect the other. The key owner uses the key only for this application, or warns the team before replacing it. Local development uses the fake adapter by default and the development key only when needed.
- **Limit split.** No split is needed while the environments use separate keys. If they ever share one key, production gets 60 requests per minute and USD 53.33 per day, and development 30 requests per minute and USD 26.67 per day.
- **Prompt retention.** Undocumented retention is accepted. Secret redaction and minimal prompts are the safeguards. Course staff may be asked in parallel, but this does not block work.
- **Vercel reachability.** No separate smoke test. After the first deployment with the real adapter, each environment makes one real call, and the result is recorded with the release checks.
- **Quota reset.** Per-person daily quotas reset at 00:00 SGT, matching the project's day boundary. SoCLaaS's 08:00 SGT reset does not affect them, because per-person quotas are far below the key budget.
- **Check input budget.** 16,000 tokens for the filtered diff, and 2,000 output tokens. Because no token-counting endpoint exists, input size is estimated at 3 characters per token, so the diff limit is 48,000 characters.
- **Report input budget.** 24,000 tokens, estimated the same way (72,000 characters), and 2,000 output tokens.
- **Maximum report range.** 7 days.
- **Per-person rate limit.** 5 AI requests per minute per person, in each environment. Requests answered from a cached result do not count.
- **Per-person daily token quota.** 400,000 tokens in production and 1,000,000 in development, where developers run the evaluation fixtures against the real model. Tokens are counted from the usage the provider reports. If a response has no usage, the request's maximum possible tokens are charged. The maximum is reserved before the call and settled afterwards, so concurrent requests cannot exceed the quota.

## CI Decisions

Approved by thegrimbee on 29 October 2026 for task 2.2. The human approved the `continuous-integration` spec delta and asked the agent to resolve these decisions as it recommended. The numbering follows the task 2.2 analyst brief.

- **D1 Spec home.** CI behaviour is the `continuous-integration` capability in this change.
- **D2 Node version.** Node.js 24 (LTS), pinned in a root `.nvmrc` and read by the workflow through `node-version-file`, so local and CI versions match.
- **D3 Triggers.** Pull requests to any branch, pushes to `master` and `dev`, and manual runs (`workflow_dispatch`). Fork pull requests run with the read-only token and no secrets.
- **D4 Secret scanning.** The gitleaks CLI at a pinned release, downloaded and checksum-verified in the workflow. The gitleaks GitHub Action is not used because it needs a paid licence for organisation-owned repositories. The scan covers the full git history of the checked-out ref. Reviewed false positives are suppressed only by exact fingerprint in a root `.gitleaksignore`, never by path or rule allowlists; on 29 October 2026 the human approved one entry, for prose in `logs/2026-10-26-on-demand-agent-usage-dashboard.md` (commit `ce8779d`) flagged by `generic-api-key`. If the repository plan offers GitHub's own secret scanning and push protection, a human may also enable them; the workflow does not depend on them.
- **D5 Dependency audit.** `npm audit` over all installed dependencies, including development dependencies, because they run in CI. No new dependency or third-party action is added for the audit.
- **D6 Audit threshold.** The audit check fails on high or critical vulnerabilities (`--audit-level=high`) and reports lower severities without failing. The workflow also runs the audit weekly on a schedule so that new advisories surface without a code change. Dependabot version updates are not added; dependency changes stay deliberate (`AGENTS.md`).
- **D7 Required checks.** The jobs are named `lint`, `typecheck`, `unit-tests`, `build`, `secret-scan`, and `dependency-audit`. A human configures branch protection on `master` (and on `dev` once it exists) to require all six and a reviewed pull request. Agents do not change branch protection.
- **D8 End-to-end tests.** Not part of task 2.2. Task 9.2 adds a Playwright job when the journey tests exist.
- **D9 Database integration tests.** Deferred until the schema (task 2.4) and the first PostgreSQL integration tests exist. They will then run against a disposable PostgreSQL service container with synthetic data.
- **D10 Migrations.** CI does not apply migrations to any Supabase database, and GitHub holds no migration credentials. Migrations remain a controlled, operator-run release step. Applying the migrations to the disposable PostgreSQL service container used by the database integration tests (D9) is permitted, because that container is created and destroyed within the run.
- **D11 Vercel.** Vercel's Git integration deploys independently of GitHub Actions. Required checks on `master` (D7) keep unchecked code out of production. GitHub holds no Vercel secrets.
- **D12 Build environment.** The build runs without environment variables. If it later needs any, the workflow sets non-secret placeholder values, never real credentials.
- **D13 Permissions and pinning.** The workflow token is read-only (`permissions: contents: read`), and the workflow uses no repository secrets. Every action is pinned to a full commit SHA, with its version tag in a comment.
- **D14 Caching and concurrency.** The npm cache is restored through `actions/setup-node`. A new push to a pull request cancels that pull request's run in progress. Runs on `master` and `dev` are never cancelled.
- **D15 Other checks.** The Python dashboard test, OpenSpec validation, actionlint, and a format check are not in CI for task 2.2. OpenSpec validation remains a manual step in task 9.5.
- **D16 `.env.example`.** `.gitignore` ignores `.env.*`, which would hide `.env.example`. Task 2.3 adds a `!.env.example` exception, and its placeholders must not trigger the secret scan.

## Data Persistence Decisions

Approved by thegrimbee on 30 October 2026 for task 2.4. The human approved the `data-persistence` spec delta and asked the agent to resolve these decisions as it recommended. The numbering follows the task 2.4 analyst brief.

- **D-A Tooling and client.** Migrations are plain SQL files managed with the Supabase CLI, pinned as a development dependency and run by an operator (`supabase db push`) as the controlled release step. The application and the tests use `node-postgres` (`pg`) with parameterized queries and no ORM. Queries use unnamed statements only, so they work through the transaction pooler.
- **D-B Location.** Migrations live in `supabase/migrations/` as `<UTC timestamp>_<name>.sql`, the Supabase CLI format. Application tables live in a dedicated `app` schema, not `public`.
- **D-C Product-manager transfer.** Each project keeps exactly one product manager. Only the current product manager can transfer the role, and only to an existing developer in the project. In one transaction the outgoing product manager becomes a developer and the incoming developer becomes the product manager. The transfer is refused while the incoming developer has assigned tasks that are not Done; the product manager reassigns them first.
- **D-D Task IDs.** Every record keeps an opaque UUID as its identifier in the database and the API. Each project also has a key (2 to 10 uppercase letters and digits, starting with a letter, unique, fixed at creation). Each task gets a task ID `<project key>-<n>`, where `n` comes from a per-project counter incremented in the task-creation transaction and is never reused. Task IDs are what commit messages mention and what reports cite.
- **D-E Task deletion.** Deletion is soft: a deleted task keeps its row and history with a deletion timestamp. It disappears from the board and the review queue, is excluded from new reports, and its task ID is not reused. Recording the deletion invalidates stored reports for ranges that include it.
- **D-F Task events.** One append-only `task_events` table records state changes, submissions (with the check result attached at submission), assignment changes, and review feedback; feedback text is part of the request-changes event. Progress updates have their own table. "Changes requested more than once" is a count of request-changes events.
- **D-G Quota storage.** Usage records are created when a token reservation is made (outcome `pending`) and settled after the call, in a second transaction; no transaction is open during the LLM call. A per-person, per-SGT-day row is locked while reserving, so concurrent reservations are serialized. The daily quota is the sum of charged tokens, or reserved tokens for unsettled records, for that SGT day. The rate limit counts that person's non-cached records started in the last 60 seconds. A record left `pending` keeps its full reservation.
- **D-H Token encryption.** AES-256-GCM through Node.js `crypto`, with a random 96-bit IV per encryption and the project UUID as additional authenticated data. The stored value holds key version, IV, ciphertext, and authentication tag. The key is a server-only environment variable, `GITHUB_TOKEN_ENCRYPTION_KEY` (32 bytes, base64), different in each environment. The key version allows rotation. Task 5.1 implements encryption; task 2.4 provides the columns.
- **D-I People and Supabase Auth.** The `people` table has its own UUID, a unique `auth_user_id` (the Supabase Auth user ID, without a foreign key into the `auth` schema), a unique GitHub user ID, and the GitHub username, which is refreshed on each sign-in. Authorship checks use the GitHub user ID only.
- **D-J Roles and grants.** Migrations run as the Supabase `postgres` role by an operator. The application connects as `app_runtime`, which has only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on tables and `USAGE` on sequences in the `app` schema, and cannot create or alter objects. A migration creates `app_runtime` without a password; the operator sets its password outside the repository. `anon` and `authenticated` get no privileges on the `app` schema, and the schema is not added to the Data API's exposed schemas, so row-level security is not enabled. The Data API is turned off in the Supabase projects, which are in the Singapore region. Connections to Supabase use `sslmode=verify-full` and verify the server certificate against the Supabase root CA, which the app reads as PEM text from the server-only environment variable `DATABASE_CA_CERT`; certificate verification is never disabled. Operators pass the same CA to `psql` and `pg_dump` (`sslrootcert`).
- **D-K Test database.** Database integration tests run against a disposable PostgreSQL container, of the same major version as the Supabase projects (PostgreSQL 17; the projects report 17.11.0.011, recorded 30 October 2026), locally (Docker) and in CI (a service container). A test helper applies `supabase/migrations/*.sql` in order with `pg` and connects as `app_runtime` to test grants. The tests run as a separate Vitest project through `npm run test:integration`, so `npm test` needs no database. CI gains a `db-integration` job (D9), which becomes a required check.
- **D-L Backup and restore.** The first migration runs against empty databases, so its restore plan is to drop the `app` schema and the `app_runtime` role. Before every later migration, the operator takes a `pg_dump` of the `app` schema and stores it outside the repository. Restoring means loading that dump with `psql`. The developer guide documents both procedures.
- **D-M Column types.** Status and outcome values are `text` columns with `CHECK` constraints rather than PostgreSQL enums. A check result keeps its lookup fields as columns (task, sorted commit-set hash, criteria hash, model, redaction flag, created time) and the validated result (per-criterion statuses, evidence, gaps, and skipped files) as `jsonb`. A report keeps project, range, model, the latest activity time it includes, and its validated statements with cited task UUIDs as `jsonb`; regenerating a report replaces the stored one. Usage outcomes are `pending`, `succeeded`, `invalid_output`, `provider_error`, and `cached`.
- **Task 2.4 review decisions.** Approved by thegrimbee on 30 October 2026, who asked the agent to resolve the task 2.4 reviewer's findings as it recommended.
  - *History is never hard-deleted (D-E, D-D).* `app_runtime` has no `DELETE` on `tasks`, so task numbers cannot be reused through a hard delete.
  - *Task events are append-only (D-F over D-J).* `app_runtime` has only `SELECT` and `INSERT` on `task_events`. Other tables keep the D-J privileges.
  - *Assignees after membership changes.* The database checks the assignee only when a task is written. Task services must keep open tasks assigned to developers when a membership is removed or its role changes (D-C already refuses a transfer to a developer with open tasks).
  - *Other Supabase roles.* The migration also revokes all privileges on the `app` schema and its objects from `service_role` when that role exists. After the first push to each Supabase project, the operator checks `app` privileges (`\dp app.*`) and records the result with the release checks.
  - *Accepted schema details.* Projects store the linked repository as `github_repository_owner` and `github_repository_name` (github-evidence: "repository owner/name"). Task event types are `state_change`, `submission`, `assignment_change`, and `review_feedback`. Foreign keys use `ON DELETE RESTRICT`; the specs define no deletion of people or projects. Review feedback must contain non-blank text.
  - *GitHub-unavailable note.* Reports have a boolean `github_evidence_unavailable` column (daily-progress-report: "Unavailable evidence is shown in the report").
  - *Developer guide scope.* The guide also covers the CA certificate (D-J), enabling `app_runtime`, and running the integration tests locally (D-K).
- **`.env.example` ownership.** Task 2.3 owns `.env.example`. Task 2.4 lists the variables it needs (`DATABASE_URL` for the runtime role through the transaction pooler, and the test database URL) in its handoff, and whichever of the two merges second adds them.

## Risks / Trade-offs

- **The GitHub token gives access to the whole repository.** It is limited to read-only access for one repository, encrypted, and never exposed. The product manager can replace or remove it.
- **Developers commit with an email that is not linked to their GitHub account.** Those commits won't match the author filter. The commit picker explains this when no commits are found.
- **The model may judge criteria wrongly.** Results are advisory, evidence is verified against the diff, and only the product manager can approve.
- **Prompt injection through commits or task text.** This is mitigated by separating untrusted content, validating against the schema and evidence rules, and giving AI no ability to change state. Adversarial fixtures check it.
- **The school's LLM limits may be low.** The defaults are 90 requests per minute and USD 80 per day per API key, and 429 does not say whether the rate or the budget limit was hit. This is mitigated by caching, input budgets, per-person quotas, and usage records.
- **The model alias can change.** Operators can repoint a model alias or change its prices without notice. Results and usage records should store the model name used.
- **SoCLaaS does not document prompt retention.** Prompts carry task text and diffs, so secret redaction and small, task-focused prompts matter even more.
- **Large diffs exceed the input budget.** The check assesses what fits and lists the files it skipped, instead of silently truncating.

## Open Questions

- Tester accounts for the deployed environments.

## Migration Plan

No deployed data model exists yet. Task 2.4 creates the initial schema as migrations in `supabase/migrations/`, which an operator applies to the development and then the production Supabase project (D-A, D-L). Later schema changes are new migrations that follow the migration and release rules in `AGENTS.md`.
