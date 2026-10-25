# Design

## Context

The change introduces six capabilities described in the delta specs. The repository has OpenSpec configuration, agent guidance (`AGENTS.md`), and UI guidance (`specs/ui-spec.md`), but no application code yet. `AGENTS.md` sets the stack: Next.js App Router with TypeScript, Route Handlers under `/api/v1`, PostgreSQL on Supabase behind a server-only repository layer, the SoC LLM behind a replaceable adapter, and Vercel hosting.

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

- **Context engineering for the report.** Report input is structured activity (state changes, progress updates, submissions, check results, feedback, commit metadata), never diffs. Each item carries its task ID so the model can cite it, and the server checks every citation against the project's tasks.

- **Caching.** Check results are keyed by the sorted set of commit SHAs plus a hash of the acceptance criteria. Reports are keyed by project and date range, and are invalidated when activity is recorded in that range. An empty range is answered without an LLM call.

- **One LLM gateway.** All AI features call a single server module. It builds prompts with untrusted content separated from instructions, redacts secrets, enforces quotas, calls the SoC LLM adapter, validates output (one retry), and records usage. A fake adapter provides deterministic success and failure paths for tests.

- **Single timezone.** Dates and default ranges use SGT (UTC+08:00) for every project. Timestamps are stored in UTC.

- **Separate environments.** Development and production each have their own Supabase project, Vercel environment (`dev` branch preview and `master` production), GitHub OAuth app (different callback URLs), SoC LLM credentials, and quota settings.

## Risks / Trade-offs

- **The GitHub token gives access to the whole repository.** It is limited to read-only access for one repository, encrypted, and never exposed. The product manager can replace or remove it.
- **Developers commit with an email that is not linked to their GitHub account.** Those commits won't match the author filter. The commit picker explains this when no commits are found.
- **The model may judge criteria wrongly.** Results are advisory, evidence is verified against the diff, and only the product manager can approve.
- **Prompt injection through commits or task text.** This is mitigated by separating untrusted content, validating against the schema and evidence rules, and giving AI no ability to change state. Adversarial fixtures check it.
- **The school's LLM limits may be low.** This is mitigated by caching, input budgets, per-person quotas, and usage records.
- **Large diffs exceed the input budget.** The check assesses what fits and lists the files it skipped, instead of silently truncating.

## Open Questions

- SoC LLM details: API format, available models, context window, rate and token limits, data-retention policy, and whether it can be reached from Vercel.
- Values for the input budget, per-person quotas, and the maximum report range.
- Tester accounts for the deployed environments.

## Migration Plan

No application code or deployed data model exists yet, so this change defines no migration. Later schema changes follow the migration and release rules in `AGENTS.md`.
