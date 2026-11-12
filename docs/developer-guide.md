# Developer Guide

This guide is for developers who will maintain or extend **NoPressure**, the project task board built for CS3227 MP4, and for the operators who deploy it. It covers:

- the design of the system, with diagrams;
- the software engineering process the team used, especially the course's additional requirements: multi-agent software engineering, context engineering, resource-aware use, and AI security;
- how to set up, test, deploy, and migrate the application.

This guide describes the release on `master` as of 13 November 2026. Where this guide and the OpenSpec files disagree, the OpenSpec files win (see [Source of truth](#source-of-truth)). Decision IDs in brackets, such as (E7) or (G5), refer to sections of [`openspec/changes/project-task-management/design.md`](../openspec/changes/project-task-management/design.md).

Never commit connection strings, database credentials, the `app_runtime` credential, GitHub App keys, backups, or production data. Every value in angle brackets below (`<...>`) is a placeholder.

**Contents**

1. [Product overview](#product-overview)
2. [Getting started](#getting-started)
3. [Design](#design)
4. [Software engineering process](#software-engineering-process)
5. [Testing](#testing)
6. [Environments and configuration](#environments-and-configuration)
7. [Database migrations](#database-migrations), [Backup and restore](#backup-and-restore), [Database integration tests](#database-integration-tests), [Browser role journeys](#browser-role-journeys)
8. [Documentation and diagrams](#documentation-and-diagrams)
9. [Acknowledgements](#acknowledgements)

## Product overview

Small teams lose time to status reporting. NoPressure is a lightweight task board where developers attach their own GitHub commits to tasks, an AI checks those commits against each task's acceptance criteria, and an AI turns project activity into progress reports. The product manager can then see where the project stands without asking.

| Role | What they do | Their AI feature |
|---|---|---|
| Product manager (one per project) | Creates the project and tasks, links one GitHub repository, adds developers, reviews submitted work, approves or requests changes, transfers the role | **Progress Report**: an on-demand summary of a date range (at most 7 days, SGT) in which every statement cites task IDs |
| Developer | Moves own tasks from To Do to In Progress to In Review, posts progress updates, picks own commits from the linked repository | **Acceptance Criteria Check**: for each criterion, `addressed`, `not_addressed`, or `unclear`, with verified diff excerpts and possible gaps; no score |

AI output is always advisory. Only the product manager can approve a task or request changes, and no AI result can change task state.

### Source of truth

The repository's [`AGENTS.md`](../AGENTS.md) defines the order of authority:

1. Human-approved OpenSpec specifications: [`openspec/changes/project-task-management/`](../openspec/changes/project-task-management/) (`proposal.md`, `design.md`, `specs/`, `tasks.md`).
2. UI guidance in [`specs/ui-spec.md`](../specs/ui-spec.md).
3. Existing code on `master`.
4. `AGENTS.md` itself.

The behaviour of each capability (task management, identity and access, GitHub evidence, completion assessment, daily progress report, AI safeguards, data persistence, continuous integration, environment configuration, interaction feedback, end-to-end verification) is specified in `openspec/changes/project-task-management/specs/<capability>/spec.md`. When behaviour changes, update the specification first, then code, tests, and guides.

## Getting started

### Prerequisites

- Node.js 24 (the version in `.nvmrc`). CI reads the same file.
- Git, and access to the `CS3227-2610-MP4-project-x/CS3227-2610-MP4` repository.
- For database tests: Docker, or PostgreSQL 17 client tools. See [Database integration tests](#database-integration-tests).
- For a working sign-in locally: the development values described in [Environments and configuration](#environments-and-configuration).

### Run locally

```bash
npm ci                       # install from the lockfile
cp .env.example .env.local   # PowerShell: Copy-Item .env.example .env.local
# fill in the development values; keep AI_PROVIDER=fake and APP_ORIGIN=http://localhost:3000
npm run dev                  # http://localhost:3000
```

With `AI_PROVIDER=fake` no SoC LLM key is needed. The fake adapter returns deterministic output, so the AI features run but do not produce real assessments.

### Commands

| Purpose | Command |
|---|---|
| Install dependencies from the lockfile | `npm ci` |
| Development server | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Type-check | `npm run typecheck` (`npx tsc --noEmit`) |
| Unit and component tests (no database) | `npm test` |
| PostgreSQL integration tests | `npm run test:integration` (needs `TEST_DATABASE_URL`) |
| Browser role journeys | `npm run test:e2e` (needs `E2E_CLUSTER_ADMIN_URL` and `E2E_SESSION_SECRET`) |
| OpenSpec validation | `npx openspec validate project-task-management --strict` (six pre-existing requirement-length warnings are known) |
| Usage dashboard tests | `python3 -m unittest discover -s tests/agent_usage_dashboard -v` |

### Repository layout

| Path | Contents |
|---|---|
| `src/app/` | Next.js App Router pages and `/api/v1` Route Handlers |
| `src/components/` | React components (Server and Client) |
| `src/server/` | Server-only domain modules, repositories, adapters, the LLM gateway, and the composition root |
| `src/proxy.ts` | Next.js Proxy that only refreshes Supabase sessions |
| `supabase/migrations/` | Plain SQL migrations for the `app` schema |
| `tests/` | `unit/`, `component/`, `integration/db/`, `e2e/`, `fixtures/` |
| `openspec/` | Specifications, design decisions, and the task list |
| `specs/ui-spec.md` | UI guidance |
| `workflow/` | Agent role contracts, plans, handoffs, evidence, and experiments |
| `logs/` | Human-verified AI interaction summaries, one per chat session |
| `docs/` | User guide, developer guide, reflections; source for the product website |
| `product-website/` | MarkBind site published to GitHub Pages |
| `tools/` | The local agent usage dashboard (Python standard library only) |

## Design

### Architecture

![High-level architecture](images/developer-guide/architecture.png)

NoPressure is a single Next.js application deployed on Vercel. There is no separate backend, worker, or message broker (`AGENTS.md`, "Stack").

- **Browser.** Client Components call only the application's own `/api/v1` JSON API. They never call GitHub, Supabase, or the LLM, and they receive no credentials.
- **Proxy** (`src/proxy.ts`). Refreshes the Supabase session cookie before Server Components run, because Server Components cannot write cookies. It performs no authorisation.
- **Server Components** (`src/app/**/page.tsx`). Read pages call authorised server services directly, without an HTTP hop (B2).
- **Route Handlers** (`src/app/api/v1/**/route.ts`). Thin transport adapters. They run on the Node.js runtime, are dynamic, and return `Cache-Control: no-store`.
- **Server modules** (`src/server/`). All domain logic, persistence, and integrations. Client Components may import their types, but never call them; the composition root and the database and provider code import `server-only`.
- **Supabase** provides PostgreSQL 17 (Singapore region) and Supabase Auth with the GitHub provider. Supabase Auth is used for sign-in and sessions only; application data never goes through Supabase's Data API (D-J).
- **GitHub** provides sign-in identity (through Supabase), and a GitHub App for reading the linked repository.
- **SoC LLM (SoCLaaS)** is an OpenAI-compatible gateway. The application calls only `POST /v1/chat/completions` with the pinned model `qwen3.6:35b`, and only through the LLM gateway.

#### Technology stack

| Concern | Choice | Notes |
|---|---|---|
| UI and server | Next.js 16 App Router, React 19, TypeScript 5.9 | Read `node_modules/next/dist/docs/` before relying on older Next.js knowledge; this version has breaking changes |
| Styling | Tailwind CSS 4 | |
| Database | PostgreSQL 17 on Supabase, accessed with `pg` (node-postgres) | Parameterised, unnamed statements only, so queries work through the transaction pooler; no ORM (D-A) |
| Identity | Supabase Auth, GitHub provider, `@supabase/ssr` | Server-side PKCE flow; no browser Supabase client (E1) |
| Repository evidence | GitHub App, REST API version `2026-03-10` | Short-lived installation tokens, read-only Contents and Metadata |
| AI | SoCLaaS behind `LlmAdapter`; `FakeAdapter` for tests | Built-in `fetch`, no SDK (D4) |
| Tests | Vitest 5, Playwright 1.64 | |
| Hosting | Vercel Hobby (app), GitHub Pages (product website) | |

All dependency versions are pinned exactly in `package.json`, and `package-lock.json` is committed.

### Server layers and request handling

![Request path through the server layers](images/developer-guide/server-layers.png)

Each request passes through the same layers. Responsibilities never move up or down a layer:

1. **Route Handler** (`src/app/api/v1/.../route.ts`) exports `GET`/`POST`/`PATCH`/`PUT`/`DELETE`, sets `runtime = "nodejs"`, and delegates to a handler exported by the module's public entry (for example `handleProjectCreate` from `@/server/projects`).
2. **Module handler** validates transport input in a fixed order. For mutating project routes the order is (Q4, T8):
   1. `Origin` must equal `APP_ORIGIN`, otherwise 403 `FORBIDDEN`. This is the CSRF defence.
   2. `Content-Type` must be `application/json`, the body must contain exactly the allowed fields, and path IDs must be UUIDs, otherwise 400 `INVALID_REQUEST`.
   3. Session, otherwise 401 `UNAUTHENTICATED`.
   4. Project membership, otherwise 404 `NOT_FOUND`, so non-members cannot tell whether the project exists.
   5. Role or assignment, otherwise 403 `FORBIDDEN`.
   6. Domain rules (404 or 409).
3. **Domain service** enforces invariants. It re-checks the actor's role inside its transaction, so a role change that races with the request cannot be bypassed (S2, R5).
4. **Repository** runs parameterised SQL as `app_runtime`. Transactions use `pool.connect()`, `BEGIN`, and `COMMIT`/`ROLLBACK`. Competing writes use row locks (`FOR UPDATE`, `FOR SHARE`) and integer `version` guards.
5. **Adapters** (GitHub, LLM, Supabase Auth) sit at the edges behind interfaces the application defines, so vendor types do not spread through the code.

**Composition root.** [`src/server/composition.ts`](../src/server/composition.ts) is the only place allowed to hold module-level mutable state. On first use it reads configuration once through `getServerConfig()` (which names a missing variable but never its value, E5), creates one `pg` pool with certificate verification against `DATABASE_CA_CERT`, chooses adapters (`AI_PROVIDER` selects `SoclaasAdapter` or `FakeAdapter`; guarded E2E mode selects synthetic adapters), and builds the service graph. Routes and pages call `getServerComposition()` and use the services from it.

**Error contract.** Every `/api/v1` error is `{ "error": { "code": "<CODE>", "message": "<fixed safe text>" } }` with `Cache-Control: no-store`. Messages never contain stack traces, SQL, provider messages, credentials, or user input. Codes are stable and recorded in "API Error Contract" in `design.md`:

| Status | Codes |
|---|---|
| 400 | `INVALID_REQUEST`, `ACCEPTANCE_CRITERIA_REQUIRED`, `REPORT_RANGE_TOO_LONG`, `REPORT_INPUT_BUDGET_EXCEEDED` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT`, `PROJECT_KEY_TAKEN`, `ALREADY_MEMBER`, `GITHUB_USERNAME_AMBIGUOUS`, `TRANSFER_TARGET_NOT_DEVELOPER`, `TRANSFER_BLOCKED_OPEN_TASKS`, `ASSIGNEE_NOT_DEVELOPER`, `CHECK_REQUIRES_COMMITS`, `INCOMPARABLE_COMMIT_TIPS`, `REPORT_INPUT_CHANGED` |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED` (with `resetsAt`) |
| 500 / 502 / 503 | `INTERNAL_ERROR`, `AUTHENTICATION_FAILED`, `AI_ERROR`, `INVALID_OUTPUT`, `AI_UNAVAILABLE`, `EVIDENCE_UNAVAILABLE` |

To add a code, record it in `design.md` in the same change that first returns it.

### Module structure

![src/server modules](images/developer-guide/server-modules.png)

Each folder in `src/server/` is a module with a public `index.ts`. Other modules import only that entry, never internal files (`AGENTS.md`, "Content coupling"). Each module owns the writes to its tables.

| Module | Responsibility | Owner |
|---|---|---|
| `config` | Reads and validates `process.env`; the only reader of environment variables | Developer A |
| `auth` | Supabase sign-in/sign-out, session to person, membership resolution, page-access outcomes | Developer A |
| `projects` | Projects, keys, members, product-manager transfer, Origin guard, "my projects" | Developer B |
| `tasks` | Task CRUD, lifecycle transitions, progress updates, validation, state names | Developer B |
| `task-board`, `review-queue`, `project-dashboard` | Read projections for the board, review queue, and dashboards | Developer B |
| `task-detail` | Read-only task detail with check history | Developer A (Group 7 exception) |
| `github-repository-link` | GitHub App setup attempts, user verification, repository snapshots, project binding | Developer A |
| `github`, `github-evidence` | GitHub App adapter (installation tokens, branches, commits, diffs) and task-scoped commit picking | Developer A |
| `ai` | LLM gateway, prompt builder, redaction, limits, SoCLaaS and fake adapters, usage port | Developer B (gateway), Developer A (security evaluation) |
| `completion-assessment` | Acceptance Criteria Check, path rules, task snapshot, submission tip lookup | Developer A |
| `progress-report` | Report input assembly, generation, cache, handlers | Developer B |
| `project-ai-usage` | Read-only per-project AI usage aggregates for the PM | Developer B |
| `repositories` | Shared repositories: people, project/task access, usage writer, provider-call permits | Shared; usage writer is Developer B |
| `logging` | Safe server failure logging (no secrets or content) | Shared |
| `test-support` | Synthetic session, GitHub, and LLM adapters, active only in guarded local E2E mode | Developer B |

Reusable UI lives in `src/components/<feature>/`. UI code never touches the database or the LLM.

### Data model

![Database schema](images/developer-guide/data-model.png)

The schema lives in the `app` schema and is created only by the migrations in `supabase/migrations/`. Key rules the database enforces:

- **Identity.** `people.auth_user_id` and `people.github_user_id` are unique. Commit authorship is checked by GitHub user ID only, never by username (D-I).
- **One product manager.** A partial unique index allows at most one `product_manager` membership per project. The creation transaction guarantees at least one (D10). A transfer swaps the two roles in one transaction and is refused while the incoming developer still has open tasks (D-C, D6).
- **Task IDs.** Every record has an opaque UUID. Each task also gets a readable key `<PROJECT KEY>-<n>`, where `n` comes from `projects.last_task_number`, incremented in the creation transaction and never reused (D-D).
- **Soft delete and history.** `app_runtime` has no `DELETE` on `tasks`; deletion sets `deleted_at` (D-E). `task_events` is append-only: `app_runtime` has only `SELECT` and `INSERT` on it (D-F).
- **Optimistic concurrency.** Mutable rows carry `version`, bumped by a trigger on every update. Writes send the version they read and fail with `VERSION_CONFLICT` if it changed.
- **Caches are data.** `check_results` is unique per (task, commit-set hash, criteria hash, path-rules hash). `reports` is unique per (project, range) and stores the input fingerprint and contract version used to decide reuse.
- **Usage and limits.** `usage_records` holds one row per gateway request. `usage_quota_days` is the per-person, per-SGT-day row locked while reserving tokens. `provider_call_permits` stores only a SHA-256 fingerprint of the provider key and a timestamp.
- **Least privilege.** `anon`, `authenticated`, and `service_role` have no privileges on `app`, and the Data API is off, so row-level security is not needed (D-J). Status values are `text` with `CHECK` constraints, not enums (D-M). Timestamps are `timestamptz` in UTC; day boundaries use SGT (UTC+08:00).

### Identity and access

![GitHub sign-in sequence](images/developer-guide/sign-in-sequence.png)

- **Sign-in** (`GET /api/v1/auth/sign-in`, `GET /api/v1/auth/callback`). The server starts Supabase's PKCE flow, and the callback exchanges the code. The GitHub user ID is taken from the verified `github` identity's `provider_id` (or legacy `id`), and the username from that identity's `identity_data`. Editable `user_metadata` and callback query values are never trusted (E2). The person row is upserted, refreshing the username.
- **Sessions.** Supabase cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. Sign-out (`POST /api/v1/auth/sign-out`) and failed callbacks call `signOut({ scope: "local" })`.
- **Redirects** are built from `APP_ORIGIN`, never from `Host` or forwarded headers (E7).
- **Authorisation** is enforced in handlers and services, never only in navigation or the Proxy. Pages map access outcomes consistently: 401 redirects to `/sign-in`, 404 calls `notFound()`, 403 shows an inline "unavailable" view without data (B10).

### Task management

![Task lifecycle](images/developer-guide/task-lifecycle.png)

- `PATCH .../tasks/{taskId}/state` takes `{state, version}` (and `feedback` when requesting changes). The service exposes separate methods (`startTask`, `submitTask`, `approveTask`, `requestChanges`) rather than one method with a flag (L3).
- Each transition writes exactly one event in the same transaction: `state_change`, `submission` (with `check_result_id` when a matching check exists), or `review_feedback` (L6).
- Submission resolves the commit history's unique tip **before** the transaction, because no transaction may stay open during a GitHub call. Inside the transaction the service re-checks that commits and criteria are unchanged; otherwise it stores the submission without a check reference (L5).
- The loser of two competing transitions receives 403 or 409, and clients treat either as "reload and retry" (L9).
- Edit (`PATCH .../tasks/{taskId}`), reassign (`PUT .../assignee`), and soft delete (`DELETE .../tasks/{taskId}`) are product-manager only and versioned.

### GitHub evidence

![Repository link sequence](images/developer-guide/repository-link-sequence.png)

- **Linking** uses a server-side setup attempt with single-use state, then a separate GitHub user authorisation that verifies the installation **before** listing repositories. The installation ID in GitHub's redirect can be spoofed, so it stays untrusted until verified. The user token is never stored. Attempts and snapshots expire after 10 minutes, and the final link re-checks App access. A failure leaves an existing link unchanged.
- **Reading** uses short-lived installation tokens scoped to the one linked repository with read-only Contents and Metadata. Tokens are never returned, logged, or stored.
- **Commit picker** (`GET .../github-evidence/branches`, `GET .../github-evidence/commits`). The developer picks commits filtered by branch, date range, and their verified GitHub user ID, with pagination (`page`, `perPage` up to 100). `POST .../attached-commits` adds commits idempotently; `PUT` replaces the whole selection. Both are allowed only while the task is In Progress, and each attached commit records its source branch.

### AI features

#### LLM gateway

![LLM gateway activity](images/developer-guide/llm-gateway-activity.png)

Every LLM call goes through [`LlmGateway`](../src/server/ai/gateway.ts); feature services receive only the gateway, never an adapter. [`tests/unit/ai/source-boundaries.test.ts`](../tests/unit/ai/source-boundaries.test.ts) keeps the `ai` module free of environment reads, logging, mutable module state, database transactions, and imports of task or project modules, and restricts which repositories may name the usage tables.

- **Prompt separation (G1).** The system message holds only fixed instructions and a preamble saying the user message is untrusted data. The user message holds one `<data name="...">` section per named segment. Each segment is redacted first, and every `<data` and `</data` in it is neutralised, so it cannot close its own section.
- **Secret redaction (6.2).** [`redaction.ts`](../src/server/ai/redaction.ts) replaces GitHub tokens, SoC keys, AWS keys, PEM private keys, JWTs, Supabase secret keys, credentialled connection URLs, bearer tokens, and literal `password=`/`token:`-style assignments with typed markers such as `[REDACTED:github-token]`. Only counts and kinds are returned, never matched text.
- **Validation.** The gateway strips one Markdown fence, parses JSON, and calls the feature's hand-written validator. Invalid output gets one correction call with safe, server-generated feedback (never the raw model output), so a request makes at most two inference calls.
- **Quotas (D-G, G5, G6).** Before calling, the gateway reserves the worst-case tokens for both possible calls in a transaction that locks the person's `usage_quota_days` row. Limits are code constants selected by `APP_ENV` (E4): 5 non-cached requests per minute per person, and 400,000 (production) or 1,000,000 (development) tokens per person per SGT day. After the call, settlement charges provider-reported usage, or the reserved maximum when none is reported.
- **Provider preflight and permits (12.3).** Before each real call, the gateway fetches the model's context window and the key's request limit (cached for at most 60 seconds). It refuses when the prompt plus output does not fit. It also acquires a database-backed permit per SHA-256 key fingerprint over a rolling 60-second window, so all server instances share the key's limit.
- **Safe failures (G3).** Expected failures return a code (`RATE_LIMITED`, `QUOTA_EXCEEDED`, `AI_UNAVAILABLE`, `AI_ERROR`, `INVALID_OUTPUT`) rather than throwing. No transaction is open during the network call. Prompt and response content are never logged or stored in usage records.
- **Adapters (6.1).** `SoclaasAdapter` makes one 60-second attempt with `reasoning_effort: "none"` and maps failures to categories without provider text. `FakeAdapter` returns scripted outcomes for tests and reports the model `fake`. Production refuses `AI_PROVIDER=fake` (E3).

#### Acceptance Criteria Check

![Acceptance Criteria Check sequence](images/developer-guide/acceptance-check-sequence.png)

`POST /api/v1/projects/{projectId}/tasks/{taskId}/acceptance-criteria-check` with body `{}` (assigned developer only; `maxDuration = 150`).

- **Inputs** come from one SQL snapshot of the task: ordered criteria, attached SHAs, and repository binding. The selected commits must have a unique descendant tip (the anchor), otherwise 409 `INCOMPARABLE_COMMIT_TIPS`.
- **Path rules.** The repository's own `.acceptance-check.json`, read at the current default-branch tip, classifies files (domain logic, API handlers, tests, UI, other) and lists lockfiles and generated prefixes to drop. Binary diffs are dropped too. Missing or invalid rules give 503 `EVIDENCE_UNAVAILABLE` before any LLM call.
- **Budget.** Whole files are added in priority order while the complete serialised prompt stays within 48,000 characters (with 1,024 reserved for correction feedback). Files that do not fit are listed in `omittedFiles`, never silently truncated. Output is capped at 2,000 tokens.
- **Compact references.** Each diff line gets an ID such as `L12`. The model returns only criterion IDs, statuses, and reference IDs. The server alone maps references back to file, commit, and hunk, builds the excerpts, and downgrades an `addressed` criterion without verified evidence to `unclear`, recording `verification.reasonCodes`.
- **Cache.** Key: task, commit-set hash, criteria hash, and a path-rules hash salted with the assessment and evidence-reference contract versions. A hit returns the stored result with `reused: true`, records a `cached` usage row, and does not count against limits.

#### Progress Report

![Progress Report sequence](images/developer-guide/progress-report-sequence.png)

`POST /api/v1/projects/{projectId}/progress-report` with `{}` (today, SGT) or `{startDate, endDate}`; product manager only.

- **Input assembly (8.1)** reads one consistent database snapshot of structured activity (state changes, submissions, progress updates, feedback, check summaries, assignment changes) plus current task context, and commit metadata through the GitHub module. It never includes diffs. The input is compact JSON measured against 72,000 characters. A range over the budget is refused rather than trimmed.
- **Citations (D2, D3).** The model returns `{statements:[{developerId, category, text, taskIds}]}`. Every statement must cite task UUIDs from that developer's input group; one bad citation rejects the whole output. The server adds task keys, range, model, and timestamps; the model cannot supply them.
- **Freshness (D4, D5).** Reuse requires the same input fingerprint, contract version, provider/model, and redaction count. After generation the input is re-assembled. If it changed, the result is discarded with 409 `REPORT_INPUT_CHANGED`. Publishing uses a version guard so an older generation cannot overwrite a newer one.
- **Partial evidence (D6).** If GitHub metadata is unavailable, the report is stored with a server-owned warning but never reused, so a later request retries.
- **Disclosure (D9).** When redaction replaced anything, the report shows "Sensitive content was redacted: N replacements."

The **AI usage panel** in Project Settings (`GET .../ai-usage`, PM only) shows settled charged tokens, pending reserved tokens, and cache hits per feature per SGT day for the current `APP_ENV`, with no per-person breakdown (8.3 D5, D6).

### Security design summary

| Threat | Control | Where |
|---|---|---|
| Cross-site request forgery | `Origin` must equal `APP_ORIGIN` and `Content-Type` must be JSON on every mutation; `SameSite=Lax` cookies | `projects/request-guard.ts`, each mutating handler |
| Unauthorised access | Session, then membership (404), then role or assignment (403) in handlers **and** services | `auth/request-access.ts`, services |
| Prompt injection in task text or diffs | Data-only user message, delimiter neutralisation, strict schema, server-verified references and citations, no tool or mutation access for AI | `ai/prompt.ts`, feature validators |
| Secret leakage to the LLM | Redaction before budgeting; evidence is verified against the redacted diff, so stored excerpts never contain secrets | `ai/redaction.ts` |
| Credential exposure | Server-only variables, never `NEXT_PUBLIC_`; tokens never stored or logged; App private key and OAuth secret only in server config | `config/`, adapters |
| SQL injection | Parameterised statements only | repositories |
| Runaway AI cost | Caching, input budgets, per-person rate and quota, shared provider-key permits | gateway, usage repository |
| Leaking internals | Fixed error messages, no stack traces or provider bodies, `no-store` on private data | Route Handlers |
| Database exposure | Least-privilege `app_runtime`, Data API off, TLS with `verify-full` | migrations, composition root |

### User interface

| Page | Route | Who |
|---|---|---|
| Sign-in | `/sign-in` | Public |
| Project Space (remembered or first project dashboard) | `/` | Signed in |
| Create project | `/projects/new` | Signed in |
| Dashboard | `/projects/{id}/dashboard` | Both roles (different views) |
| Board | `/projects/{id}/board` | Both roles (developers see their own tasks) |
| Task detail | `/projects/{id}/tasks/{taskId}` | Assigned developer, PM |
| Review queue | `/projects/{id}/review-queue` | PM |
| Reports | `/projects/{id}/reports` | PM |
| Settings (repository, members, AI usage) | `/projects/{id}/settings` | PM |

Pages are dynamic Server Components that read through services. Interactive parts are Client Components that call the API and then `router.refresh()`. Every pending action and internal navigation shows the shared trailing spinner (`components/ui/loading-spinner.tsx`, `pending-link.tsx`), which is hidden from assistive technology and respects reduced-motion settings.

## Software engineering process

### Spec-driven development

The team used [OpenSpec](https://github.com/Fission-AI/OpenSpec) (schema `spec-driven`). One active change, `project-task-management`, holds:

- `proposal.md`: why and what;
- `specs/<capability>/spec.md`: requirements written as `SHALL` statements with `WHEN`/`THEN` scenarios, which double as acceptance criteria;
- `design.md`: every architecture or behaviour decision, with who approved it and when;
- `tasks.md`: the numbered task list (groups 1 to 12) with completion evidence.

A task starts only after a human has approved its spec delta and the decisions it depends on. `AGENTS.md` forbids filling a requirement, schema, API, or design gap by inference: the agent names the missing decision, stops, and asks a human, who records the answer in `design.md`. As a result, most `design.md` entries end with an approval line, for example "Approved by thegrimbee on 2 November 2026", and conflicts between code, tests, and specs are recorded as explicit resolutions rather than silent choices.

### Multi-agent software engineering

![Multi-agent workflow](images/developer-guide/agent-workflow.png)

Work on any `tasks.md` item uses seven reusable roles. Their canonical contracts are in [`workflow/agents/`](../workflow/agents/), with thin adapters in `.claude/agents/` (and `.codex/agents/`, maintained by Lim-ZY).

| Role | Responsibility | May write | Claude model / effort / turn cap |
|---|---|---|---|
| Analyst | Explore relevant context, write a source-linked brief, draft the spec delta | `openspec/` | Sonnet / high / 20 |
| Orchestrator | Plan, assign disjoint paths and worktrees, consolidate the handoff | `workflow/plans/`, `workflow/handoffs/` | Opus / medium / 50 |
| Test-writer | Tests for approved behaviour (not Developer A's AI security fixtures) | `tests/` | Opus / medium / 90 |
| Implementer | Only the assigned source paths | assigned paths, not `tests/`, `openspec/`, `specs/`, `workflow/` | Opus / medium / 120 |
| Frontend | Read-only inspection of rendered UI changes | nothing | Sonnet / medium / none yet |
| Reviewer | Read-only check of every acceptance criterion and code quality | nothing | Sonnet / medium / 60 |
| Commit/PR | Group authorised changes into scoped commits; draft PR text | git history, only when authorised | Sonnet / low / 20 |

**Coordination rules** ([`workflow/agents/README.md`](../workflow/agents/README.md)):

- The main Claude Code session acts as orchestrator and dispatches each worker, so every human gate stays visible. Spawn depth is 1, so workers cannot start further agents.
- Concurrent writers use separate git worktrees (under `temp/worktrees/`) with non-overlapping paths. The test-writer and implementer can run in parallel.
- Implementer and reviewer form a generator-verifier loop with at most two fix rounds; after that the task escalates to the human.
- Small single-file fixes skip the sequence. The full sequence is for one `tasks.md` item or larger.
- Humans keep requirement approval, conflict decisions, commits, pushes, PRs, and merges. Each of these needs its own explicit instruction. Developer A (Lim-ZY) and Developer B (thegrimbee) each own a lane and cross-review the other's changes to shared files.

**Enforcement.** The rules are backed by checked-in controls, not just instructions:

- `.claude/settings.json` denies reading `.env*` (except `.env.example`) and `.vercel/`, asks before `git push`, `gh pr`, `git reset --hard`, `git rebase`, and `git config`, and sets the spawn depth.
- The [`guard-write-scope.mjs`](../.claude/hooks/guard-write-scope.mjs) hook blocks role writes outside the role's paths. It was verified on 6 November 2026 by blocking a deliberate test-writer write to `src/`.
- The reviewer and frontend agents are given read-only tools.

**Evidence.** Each task leaves a plan in `workflow/plans/`, one consolidated handoff in `workflow/handoffs/` (from [`agent-handoff-template.md`](../workflow/agent-handoff-template.md)), evidence in `workflow/evidence/`, and an interaction summary in `logs/`. The Task 7.3 experiment ([`task-7-3-agentic-se-analysis.md`](../workflow/experiments/task-7-3-agentic-se-analysis.md)) compared the multi-agent sequence with one agent on the same slice. Independent review and frontend QA found one P1 and eight P2 defects that implementation had passed (for example, a missing `maxDuration`, asynchronous UI races, and an authorisation race). The single agent finished in 11 minutes 11 seconds, but had only self-review. The team's conclusion was to keep specialist review for cross-layer, security-sensitive work and use one agent for small, well-specified changes.

### Context engineering

![Where agent context comes from](images/developer-guide/context-layers.png)

**In the development process**, context is split into what every agent needs up front and what it retrieves by path:

- **Up front:** `AGENTS.md` (how to work), the role contract, and the task handoff. The handoff records the goal, owner, source revision, permitted and prohibited paths, approved decisions, assumptions, open questions, and exclusions. It links source documents by path instead of copying them.
- **On demand:** the relevant `spec.md`, `design.md` sections, `specs/ui-spec.md`, code, tests, and earlier evidence.
- **Analyst first:** the analyst compresses the repository into a source-linked brief with candidate edit paths, so later roles start from a few hundred lines instead of the whole history.
- **Current, not historical:** superseded decisions in `design.md` are marked as history, so agents do not build against an old contract. In the Task 7.3 experiment, stale `501` stub assertions and a misplaced requirement showed why this matters.
- **One summary per chat session** in `logs/` lets the next session resume without replaying the conversation.

**In the product**, each AI feature receives the smallest context that can answer its question:

- The **Acceptance Criteria Check** sees only the criteria and the filtered diff of the selected commits, with lockfiles, generated files, and binaries removed, files ranked by category, and a fixed 48,000-character budget. Compact `L<n>` references keep the output small and let the server rebuild evidence.
- The **Progress Report** never sees diffs. It sees structured activity labelled with task IDs, which keeps the input small and makes every claim checkable against the project's tasks.

### Resource-aware use

**Development agents.**

- Models are matched to roles (see the table above): Opus for the writing roles (orchestrator, test-writer, implementer), Sonnet for the analyst, reviewer, frontend, and commit/PR roles. Effort is lowest for commit/PR.
- `maxTurns` caps each role at roughly twice its largest observed run.
- All agents use the default 5-minute prompt cache. A 1-hour cache was tried and removed: re-priced on past sessions it would have cost about 8% more, because it doubles every cache write and several fix-round gaps were human waits of over an hour.
- Every worker records the resource metrics the platform reports in its handoff, and writes `not available` instead of estimating.
- The local [agent usage dashboard](agent-usage-dashboard.md) (`python3 -m tools.agent_usage_dashboard generate --repo .`) builds an offline report of Claude and Codex token usage from local session files. It was used for the Task 7.3 figures. In that experiment cached input was about 98% of recorded input in both arms, and cost and tool-call counts were not available.

**Product AI** (protecting the shared SoC LLM limits of 90 requests per minute and USD 80 per day per key):

1. **Avoid the call.** Cache hits, empty report ranges, and invalid input never reach the model.
2. **Bound the call.** Fixed input budgets (48,000 and 72,000 characters) and a 2,000-token output cap.
3. **Bound the person.** 5 requests per minute and a daily token quota per person, reserved before the call so concurrent requests cannot overshoot.
4. **Bound the key.** Database-backed permits enforce the provider key's request limit across all server instances.
5. **Make use visible.** `usage_records` and the PM's AI usage panel.
6. **Separate keys.** Development and production use keys from different SoC accounts, so testing cannot exhaust production's budget.

### AI security evaluation

Task 9.1 ran prompt-injection and secret-redaction fixtures for both AI features against the live SoC LLM in development (`TASK_9_1_LIVE_EVAL=1 npx vitest run tests/unit/ai/task-9-1-live-security-evaluation.test.ts`). In both features, injected instructions stayed data, the synthetic secret was redacted and absent from output, delimiters were neutralised, and task state did not change. The tests assert outcomes, not exact model wording. See [`workflow/evidence/task-9-1-ai-security-evaluation.md`](../workflow/evidence/task-9-1-ai-security-evaluation.md). These fixtures are owned by Developer A; other agents must not edit them.

### Version control and review

- Branches: `feat/<module>-<slug>`, `fix/...`, `chore/...` (`AGENTS.md`). Feature pull requests are merged into `dev`, which deploys to the development environment; `dev` is then promoted to `master` (production) by another reviewed pull request. Every change needs a reviewed PR with green CI.
- Commits: Conventional Commits scoped to the module, for example `feat(tasks): refuse approval by developers`. Do not invent requirement IDs.
- Never commit `.env*` files (other than `.env.example`), credentials, backups, or production data. A new variable must be added to `.env.example` with a placeholder.
- Database changes are always a new migration. Never edit a shipped migration.

### Continuous integration and deployment

![CI pipeline](images/developer-guide/ci-pipeline.png)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `lint`, `typecheck`, `unit-tests`, `db-integration`, `e2e-role-journeys`, `build`, `secret-scan`, and `dependency-audit`. The workflow has a read-only token and no secrets. Actions are pinned to commit SHAs, gitleaks 8.30.1 is checksum-verified, and the audit also runs weekly. Branch protection on `master` and `dev`, set by a human, requires the checks and a reviewed PR.

Vercel deploys through its own Git integration: `dev` deploys to the Preview scope (development) and `master` to Production. CI never applies migrations and holds no Vercel or database credentials (D10, D11). [`.github/workflows/product-website.yml`](../.github/workflows/product-website.yml) builds the MarkBind site on pull requests and deploys it to GitHub Pages from `master`.

![Environments](images/developer-guide/environments.png)

## Testing

| Level | Location | Runs with | What it covers |
|---|---|---|---|
| Unit | `tests/unit/**` | `npm test` | Validation, permissions, state transitions, gateway, redaction, budgets, quotas, cache keys, route handlers with fakes, page rendering via `renderToStaticMarkup` |
| Component | `tests/component/` | `npm test` | React client behaviour against fixtures in `tests/fixtures/` |
| PostgreSQL integration | `tests/integration/db/` | `npm run test:integration` | Constraints, grants, transactions, locks, competing writes, SGT boundaries, cache round-trips |
| End-to-end | `tests/e2e/` | `npm run test:e2e` | Six Chromium journeys (developer, PM, check failure/recovery, report failure/recovery, authorisation denial, sign-out) |
| AI security | `tests/unit/ai/task-9-1-live-security-evaluation.test.ts` | opt-in flag | Live injection and redaction fixtures |
| Python tool | `tests/agent_usage_dashboard/` | `python3 -m unittest discover -s tests/agent_usage_dashboard -v` | Usage dashboard |

Guidelines:

- Use synthetic data only. The integration helper refuses Supabase hosts.
- Test the behaviour named in the spec scenario. Do not assert exact model prose.
- Use `FakeAdapter` scripts (or the E2E adapter in journeys) for AI success and failure paths.
- Record the command, revision, environment, result, and evidence path for release checks.

## Environments and configuration

The application runs in two separate environments, development and production. They share no credential. Each has its own Supabase project, GitHub OAuth app (for sign-in), GitHub App (for repository linking and reads), SoC LLM key, and database password. `.env.example` lists every variable, with a comment on its purpose and where it is set. The decisions behind this section are "Separate environments", E1 to E10, and "SoC LLM and Quota Decisions" in `design.md`.

### The two environments

| | Development | Production |
|---|---|---|
| Git branch | `dev` | `master` |
| Vercel scope | Preview, restricted to the `dev` branch | Production |
| Supabase project | development project | production project |
| GitHub OAuth app (sign-in, configured in Supabase) | development app | production app |
| GitHub App (repository link and reads) | development App | production App |
| GitHub-to-Supabase provider callback (GitHub OAuth app) | `https://<dev-project-ref>.supabase.co/auth/v1/callback` | `https://<prod-project-ref>.supabase.co/auth/v1/callback` |
| Supabase-to-app callback (Supabase Redirect URLs) | `<development APP_ORIGIN>/api/v1/auth/callback`; local: `http://localhost:3000/api/v1/auth/callback` | `<production APP_ORIGIN>/api/v1/auth/callback` |
| SoC LLM key | from thegrimbee's SoC account | from Lim-ZY's SoC account |
| `APP_ENV` | `development` | `production` |
| `APP_ORIGIN` | the stable Vercel URL of the `dev` branch | the production domain |
| `AI_PROVIDER` | `fake` or `soclaas` | `soclaas` (production refuses `fake`) |
| Per-person AI limits (code constants, E4) | 5 requests per minute, 1,000,000 tokens per day | 5 requests per minute, 400,000 tokens per day |

Local development uses the development values, except that `APP_ORIGIN` is `http://localhost:3000` and `AI_PROVIDER` is normally `fake`. CI sets no application variable (D12, D13): only its `db-integration` job sets `TEST_DATABASE_URL`, for a throwaway container, and its `e2e-role-journeys` job generates its own synthetic E2E values. Previews of branches other than `dev` get no variables, so they build but cannot sign in or reach data.

`APP_ENV` is the only way the application tells the environments apart. Do not use `NODE_ENV` or `VERCEL_ENV` for this: `NODE_ENV` is `production` in every built deployment, and `VERCEL_ENV` is not set locally (E6).

### Where each variable is set

Every variable is server-only. None may have a `NEXT_PUBLIC_` prefix, appear in a Client Component prop, be committed, or be logged.

| Variable | Purpose | Local `.env.local` | Vercel Preview (`dev`) | Vercel Production | Secret |
|---|---|---|---|---|---|
| `DATABASE_URL` | `app_runtime` through the transaction pooler (D-A, D-J) | development | development | production | yes |
| `DATABASE_CA_CERT` | Supabase root CA, PEM text (D-J) | development | development | production | no |
| `SUPABASE_URL` | Supabase project URL for sign-in (E1) | development | development | production | no |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for sign-in (E1) | development | development | production | no |
| `APP_ORIGIN` | the environment's own origin (E7) | `http://localhost:3000` | `dev` branch URL | production domain | no |
| `GITHUB_APP_ID` | GitHub App ID; signs App JWTs (E10) | development | development | production | no |
| `GITHUB_APP_SLUG` | builds the install URL `https://github.com/apps/<slug>/installations/new` (E10) | development | development | production | no |
| `GITHUB_APP_CLIENT_ID` | App OAuth client ID for repository-link verification (E10) | development | development | production | no |
| `GITHUB_APP_CLIENT_SECRET` | App OAuth client secret, sent only to GitHub's token endpoint (E10) | development | development | production | yes |
| `GITHUB_APP_PRIVATE_KEY` | App private key, PEM with line breaks written as `\n` (E10) | development | development | production | yes |
| `APP_ENV` | environment name (E6) | `development` | `development` | `production` | no |
| `AI_PROVIDER` | SoC LLM adapter, `fake` or `soclaas` (E3) | `fake` | `fake` or `soclaas` | `soclaas` | no |
| `SOCLAAS_API_KEY` | SoCLaaS API key, needed only for `soclaas` (E3) | development, only when needed | development | production | yes |
| `SOCLAAS_MODEL` | pinned model, `qwen3.6:35b` (E3) | `qwen3.6:35b` | `qwen3.6:35b` | `qwen3.6:35b` | no |
| `TEST_DATABASE_URL` | integration tests only (D-K) | the shell that runs the tests | never | never | throwaway |
| `E2E_CLUSTER_ADMIN_URL`, `E2E_SESSION_SECRET` | local browser journeys only (9.2) | the shell that runs `npm run test:e2e` | never | never | throwaway |
| `SUPABASE_DB_URL` | operator migrations and backups (E9) | the operator's shell, one session | never | never | yes |

Vercel's Development scope stays empty. Write `.env.local` by hand from `.env.example`; do not pull it from Vercel. `.gitignore` ignores `.env`, `.env.*` (except `.env.example`), and the `.vercel/` folder that the Vercel CLI creates.

`SUPABASE_DB_URL` is commented out in `.env.example`. Set it only in your shell, as shown in [Who applies migrations and how](#who-applies-migrations-and-how), never in `.env.local` or Vercel. `TEST_DATABASE_URL` is also read from the shell; see [Database integration tests](#database-integration-tests).

These are not variables, so they are not in `.env.example`, Vercel, or the repository:

- The sign-in GitHub OAuth app's client ID and client secret. They are entered only in each environment's Supabase project (E2).
- A Supabase secret or `service_role` key. The application never uses one; application data goes through `DATABASE_URL` (E1).
- AI quotas and rate limits. They are code constants selected by `APP_ENV` in `src/server/ai/limits.ts`; changing one is a reviewed code change (E4).
- The SoC LLM gateway base URL, `https://soclaas-api.comp.nus.edu.sg`. It is a code constant (E3).

The server-only configuration module `src/server/config/` is the only reader of `process.env`. It validates values when first called, not at import or build time, so `next build` needs no variables (D12). It reports a missing or invalid variable by name, never by value (E5), and a unit test checks that every variable it reads is listed in `.env.example`.

> The earlier encrypted-token design used `GITHUB_TOKEN_ENCRYPTION_KEY`. Task 5.1 retired it when the GitHub App replaced personal access tokens; do not set it.

### Setting up the environments

These steps are for the human developers. Agents do not perform or verify them. Do them in the order below, because later steps need values from earlier ones. Do every step once for **development** and once for **production**, unless it says otherwise. Record what you confirm with the release checks.

Dashboard menu names change from time to time. If a label below does not match exactly, look for the nearest equivalent.

#### Worksheet

Keep a private note of these non-secret values as you go. Do not commit it. Secrets (passwords, keys, client secrets) go straight into Supabase, Vercel, or `.env.local`, never into the note.

| Value | Development | Production | Found in step |
|---|---|---|---|
| Supabase project reference `<project-ref>` | | | 1 |
| `SUPABASE_URL` (`https://<project-ref>.supabase.co`) | | | 1 |
| Session pooler host (for migrations) | | | 1 |
| Transaction pooler host (for `DATABASE_URL`) | | | 4 |
| CA certificate file path | | | 1 |
| `APP_ORIGIN` | `dev` branch URL | production URL | 6 |
| Sign-in OAuth app client ID (not secret) | | | 7 |
| GitHub App ID, slug, client ID (not secret) | | | 9 |

#### 0. Prerequisites

- Node.js 24 and `npm ci` already run in your clone. The Supabase CLI is a pinned development dependency, so `npx supabase` needs no global install.
- PostgreSQL 17 client tools (`psql`, `pg_dump`) on your `PATH`, for the privilege check and backups.
  - Windows: run the PostgreSQL 17 installer from postgresql.org and select only **Command Line Tools**. Then add `C:\Program Files\PostgreSQL\17\bin` to `PATH` and open a new terminal. `psql --version` should print 17.x.
  - macOS: `brew install postgresql@17`.
- Admin access to both Supabase projects, a Vercel account, and owner access to the GitHub organisation, or someone who has it. Installing the Vercel GitHub app and creating organisation OAuth apps and GitHub Apps needs an organisation owner.
- A password manager, for generating and storing passwords.

#### 1. Supabase project basics

In the [Supabase dashboard](https://supabase.com/dashboard), open the project and:

1. **Project reference.** Open **Project Settings → General**. Copy **Project ID** into the worksheet; this is `<project-ref>`. `SUPABASE_URL` is `https://<project-ref>.supabase.co`.
2. **Region and version.** On the same page, confirm the region is Singapore (`ap-southeast-1`). Under **Project Settings → Infrastructure**, confirm PostgreSQL 17.
3. **Data API off.** Open **Project Settings → Data API** (in some dashboards, **Integrations → Data API**). Turn **Enable Data API** off and save (D-J).
4. **Database password.** This is the `postgres` password used for migrations only. If nobody has it, open **Project Settings → Database → Reset database password**, generate a long password in your password manager, and save it there. Use only letters and digits (turn symbols off), so it never needs percent-encoding in a URL.
5. **CA certificate.** Open **Project Settings → Database → SSL Configuration → Download certificate**. Save it outside the repository with the environment in its name, for example:
   - macOS/Linux: `~/.config/mp4/supabase-dev-ca.crt`
   - Windows: `C:/Users/<you>/.config/mp4/supabase-dev-ca.crt` (use forward slashes; they work in connection strings)
6. **Session pooler host.** Click **Connect** at the top of the project page. Under **Connection string**, choose type **URI** and method **Session pooler**. The string looks like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@<pooler-host>:5432/postgres`. Copy `<pooler-host>` (for example `aws-0-ap-southeast-1.pooler.supabase.com`) into the worksheet.

#### 2. Apply the migrations

Do development first. Only when everything below works there, repeat for production.

1. Put the session pooler URL into your shell without writing it to history. See [Who applies migrations and how](#who-applies-migrations-and-how) for the Bash and PowerShell commands. The value is:

   ```
   postgresql://postgres.<project-ref>:<db-password>@<session-pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=<path-to-ca>
   ```

2. Preview, then apply:

   ```bash
   npx supabase migration list --db-url "$SUPABASE_DB_URL"
   npx supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
   npx supabase db push --db-url "$SUPABASE_DB_URL"
   ```

   In PowerShell, write `$env:SUPABASE_DB_URL` instead of `"$SUPABASE_DB_URL"`. On an empty project the dry run lists every file in `supabase/migrations/`, starting with `20261030144500_create_app_schema.sql`. The first migration needs no backup; later ones do (see [Backup before a migration](#backup-before-a-migration)).
3. Run the privilege check in [Check privileges after the first push](#check-privileges-after-the-first-push) and note the result for the release checks.

#### 3. Create the `dev` branch

Do this once. Create `dev` from the latest `master` and push it:

```bash
git switch master
git pull
git switch -c dev
git push -u origin dev
```

A human then configures branch protection on `dev`, like `master`: require the CI checks and a reviewed pull request. Agents do not change branch protection (D7). On GitHub, open **Settings → Branches** (or **Settings → Rules → Rulesets**) for the repository and add a rule for `dev` with the same required checks as `master`.

#### 4. Enable the runtime role and build `DATABASE_URL`

1. Follow [After the first migration: enable the runtime role](#after-the-first-migration-enable-the-runtime-role) to give `app_runtime` a password. Generate it in your password manager, letters and digits only, at least 32 characters, different per environment.
2. Click **Connect** again and choose method **Transaction pooler**. The string looks like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@<pooler-host>:6543/postgres`. Copy the host into the worksheet.
3. Build `DATABASE_URL` from it: change the user from `postgres.<project-ref>` to `app_runtime.<project-ref>`, put in the `app_runtime` password, keep port `6543`, and add `?sslmode=verify-full`:

   ```
   postgresql://app_runtime.<project-ref>:<app-runtime-password>@<transaction-pooler-host>:6543/postgres?sslmode=verify-full
   ```

4. Check it works (it should print `app_runtime`):

   ```bash
   psql "postgresql://app_runtime.<project-ref>:<app-runtime-password>@<transaction-pooler-host>:6543/postgres?sslmode=verify-full&sslrootcert=<path-to-ca>" -c "select current_user"
   ```

   This puts the password in your shell history. Afterwards clear it (`history -d <n>` in Bash; in PowerShell, `Clear-History` and delete the line from `(Get-PSReadLineOption).HistorySavePath`), or set the URL with the hidden-prompt method from step 2 first.
5. Keep `DATABASE_URL` in your password manager until step 11.

#### 5. Create the Vercel project

Do this once; one project serves both environments (E8).

1. In [Vercel](https://vercel.com), click **Add New… → Project**.
2. Under **Import Git Repository**, choose GitHub. If the organisation's repository is not listed, click **Adjust GitHub App Permissions** (or **Install**), choose the `CS3227-2610-MP4-project-x` organisation, and give the Vercel app access to this repository only. An organisation owner may have to approve this.
3. **Hobby check (E8).** If Vercel refuses to import an organisation-owned repository on the Hobby plan, stop here and record it: a different setup needs a new recorded decision.
4. On the configure screen:
   - **Project Name:** choose a name, for example `mp4-task-board`. It becomes part of every URL.
   - **Framework Preset:** Next.js (detected automatically).
   - **Root Directory:** leave as `./`.
   - **Build and Output Settings:** leave the defaults (`npm run build`).
   - **Environment Variables:** add none yet. The build needs none (D12).
5. Click **Deploy**. The first deployment builds without variables and should succeed.
6. Open **Settings → Environments → Production** (in older dashboards **Settings → Git**) and check that the production branch (**Branch Tracking**) is `master`.

#### 6. Find the two app URLs (`APP_ORIGIN`)

1. **Production.** Open **Settings → Domains**. The default production domain is `https://<project-name>.vercel.app`; Vercel may add a suffix if the name is taken. Copy the exact value, with `https://` and no trailing slash, into the worksheet as production `APP_ORIGIN`. If you later add a custom domain, `APP_ORIGIN`, the Supabase Site URL, the sign-in OAuth app's homepage URL, and the GitHub App's URLs must all change to it.
2. **Development.** Pushing `dev` in step 3 triggers a preview deployment; if it did not, push any commit to `dev`. Open **Deployments**, filter by branch `dev`, and open the latest one. Under **Domains** it lists a branch URL of the form `https://<project-name>-git-dev-<scope>.vercel.app`. This URL stays the same for every `dev` deployment. Copy it into the worksheet as development `APP_ORIGIN`. Do not use the per-deployment URL with a random hash; it changes on every push.
3. **Deployment Protection.** By default Vercel protects preview URLs, so only people logged in to your Vercel account can open the `dev` URL, and anyone else signing in there is stopped by a Vercel login page. Whether to turn this off for `dev` (**Settings → Deployment Protection**) is a team decision; record it with the release checks.

#### 7. Create the sign-in GitHub OAuth apps

Create two OAuth apps, one per environment. Create them under the organisation, so that they do not depend on one person's account: open the organisation's **Settings → Developer settings → OAuth Apps → New OAuth App**. (A personal account's **Settings → Developer settings → OAuth Apps** also works.)

Fill in the form:

| Field | Development app | Production app |
|---|---|---|
| Application name | `MP4 Task Board (development)` | `MP4 Task Board` |
| Homepage URL | development `APP_ORIGIN` (the `dev` branch URL) | production `APP_ORIGIN` |
| Application description | optional | optional |
| Authorization callback URL | `https://<dev-project-ref>.supabase.co/auth/v1/callback` | `https://<prod-project-ref>.supabase.co/auth/v1/callback` |
| Enable Device Flow | leave unticked | leave unticked |

The **Authorization callback URL** is always the Supabase project's own callback, never the app's URL. GitHub sends the user back to Supabase, and Supabase then sends them to the app (E2). You can copy the exact callback URL from the Supabase GitHub provider page in step 8.

Then:

1. Click **Register application**.
2. Copy the **Client ID** into the worksheet. It is not secret.
3. Click **Generate a new client secret**. GitHub shows it only once. Paste it straight into the matching Supabase project in step 8. Do not put it in `.env.local`, Vercel, the repository, the worksheet, or a chat.

#### 8. Configure Supabase Auth

In each Supabase project:

1. **GitHub provider.** Open **Authentication → Sign In / Providers → GitHub**.
   - Check that **Callback URL (for OAuth)** shown there equals the OAuth app's Authorization callback URL from step 7.
   - Turn **Enable Sign in with GitHub** on.
   - Paste that environment's **Client ID** and **Client Secret**, then **Save**.
2. **Site URL.** Open **Authentication → URL Configuration**. Set **Site URL** to that environment's `APP_ORIGIN`: the `dev` branch URL for development, the production URL for production. Do not use `http://localhost:3000` here, even in development.
3. **Redirect URLs.** These are the app URLs that Supabase may send people back to after sign-in. The callback route is `GET /api/v1/auth/callback`; add only these exact URLs, with no wildcards:
   - Development project: `https://<dev-stable-vercel-domain>/api/v1/auth/callback` and `http://localhost:3000/api/v1/auth/callback`.
   - Production project: `https://<production-domain>/api/v1/auth/callback`.

   Replace each host placeholder with the exact `APP_ORIGIN` from step 6, without a trailing slash. Do not add the Supabase provider callback (`https://<project-ref>.supabase.co/auth/v1/callback`) here; that URL belongs only in the OAuth app's **Authorization callback URL** in step 7.
4. **Other sign-in providers.** The Email provider is on by default in new Supabase projects. The specs only define GitHub sign-in; record the team's decision on the other providers with the release checks.
5. **API key.** Open **Project Settings → API Keys**. Under **Publishable key**, copy the key that starts with `sb_publishable_`. If the page has only legacy `anon` and `service_role` keys, create the new keys there first. This is `SUPABASE_PUBLISHABLE_KEY`. Do not copy the secret or `service_role` keys anywhere (E1).

#### 9. Create the GitHub Apps

Create one GitHub App per environment under the organisation (**Settings → Developer settings → GitHub Apps → New GitHub App**), so the two environments never share App credentials (E10).

| Field | Value |
|---|---|
| GitHub App name | for example `NoPressure (development)` / `NoPressure`. The URL-safe name becomes `GITHUB_APP_SLUG` |
| Homepage URL | that environment's `APP_ORIGIN` |
| Callback URL (user authorisation) | `<APP_ORIGIN>/api/v1/auth/github-app/callback` |
| Setup URL | `<APP_ORIGIN>/api/v1/auth/github-app/setup-callback` |
| Request user authorization (OAuth) during installation | leave unticked; GitHub disables the Setup URL when it is ticked, and the app starts user authorisation itself after setup |
| Redirect on update | tick, so that adding repositories to an existing installation also returns to the app |
| Webhook | untick **Active**; the app uses no webhooks |
| Repository permissions | **Contents: Read-only**, **Metadata: Read-only**; nothing else |
| Where can this GitHub App be installed? | the accounts whose repositories projects will link. This choice is not recorded in `design.md`; record it with the release checks |

Then:

1. Copy the **App ID** and **Client ID** into the worksheet.
2. Click **Generate a new client secret** and paste it straight into Vercel (step 11) or `.env.local` (step 12) as `GITHUB_APP_CLIENT_SECRET`.
3. Under **Private keys**, click **Generate a private key**. GitHub downloads a `.pem` file. Paste its contents as `GITHUB_APP_PRIVATE_KEY`, with each line break written as `\n`, then delete the downloaded file.
4. A product manager installs the App from the project's Settings page; see the [User Guide](user-guide.md).

#### 10. Generate the remaining per-environment secrets

Generate each of these separately for development and production, and never reuse a value across them. Local `.env.local` uses the development values.

- **`app_runtime` password and `DATABASE_URL`.** From step 4.
- **SoC LLM key.** Issued in the SoCLaaS portal, `https://soclaas-portal.comp.nus.edu.sg`. Development uses a key from thegrimbee's SoC account and production one from Lim-ZY's ("Keys per environment"). The key owner uses the key only for this application, or warns the team before replacing it. Rotating a key disables the old one at once ("SoC LLM Facts"). Before setting `AI_PROVIDER` to `soclaas`, check that the key can use the pinned model. Bash:

  ```bash
  read -rs SOCLAAS_API_KEY && export SOCLAAS_API_KEY
  curl -s -H "Authorization: Bearer $SOCLAAS_API_KEY" https://soclaas-api.comp.nus.edu.sg/v1/models | grep -o '"qwen3.6:35b"'
  ```

  PowerShell:

  ```powershell
  $key = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'SoCLaaS key')).Password
  (Invoke-RestMethod -Uri https://soclaas-api.comp.nus.edu.sg/v1/models -Headers @{ Authorization = "Bearer $key" }).data.id -contains 'qwen3.6:35b'
  ```

  The first prints `"qwen3.6:35b"` and the second prints `True` if the key can use the model. Locally, keep `AI_PROVIDER=fake` and use the development key only when needed.

#### 11. Set the Vercel environment variables

Open the Vercel project's **Settings → Environment Variables**. Add each variable with **Add Environment Variable** (or **Add New**): fill in **Key** and **Value**, tick the environment, and save. Turn on **Sensitive** for every variable marked secret, so that its value cannot be read back from the dashboard.

**Production values**: tick **Production** only.

| Key | Value | Sensitive |
|---|---|---|
| `DATABASE_URL` | production `DATABASE_URL` from step 4 | yes |
| `DATABASE_CA_CERT` | production CA file contents, from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`, pasted as several lines, without quotes | no |
| `SUPABASE_URL` | `https://<prod-project-ref>.supabase.co` | no |
| `SUPABASE_PUBLISHABLE_KEY` | production publishable key | no |
| `APP_ORIGIN` | production `APP_ORIGIN` | no |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID` | production App values from step 9 | no |
| `GITHUB_APP_CLIENT_SECRET` | production App client secret | yes |
| `GITHUB_APP_PRIVATE_KEY` | production App private key | yes |
| `APP_ENV` | `production` | no |
| `AI_PROVIDER` | `soclaas` | no |
| `SOCLAAS_API_KEY` | production SoC key (Lim-ZY's account) | yes |
| `SOCLAAS_MODEL` | `qwen3.6:35b` | no |

**Development values**: tick **Preview** only, then choose **Select a custom Preview branch** (or **Specific branch**) and enter `dev`. Use the same keys with the development values: development database and CA, `https://<dev-project-ref>.supabase.co`, the development publishable key, the `dev` branch URL as `APP_ORIGIN`, the development GitHub App values, `APP_ENV=development`, `AI_PROVIDER=fake` until you need the real model (then `soclaas`), the development SoC key (thegrimbee's account), and `SOCLAAS_MODEL=qwen3.6:35b`.

Then:

1. Leave **Development** empty, and add nothing for **Preview** on all branches (E8).
2. **Hobby check (E8).** If Vercel does not let you restrict Preview variables to the `dev` branch, stop and record it: a different setup needs a new recorded decision.
3. Check the list. Every key should appear twice (Production, and Preview for `dev`) with different values, except `SOCLAAS_MODEL`. No key starts with `NEXT_PUBLIC_`.
4. Variable changes only apply to new deployments. Open **Deployments**, and choose **⋯ → Redeploy** on the latest `master` deployment and on the latest `dev` deployment.
5. Never run `vercel env pull` into this repository. The Development scope is empty, and real values must not land in files.

#### 12. Set up your local `.env.local`

1. Copy the template. Bash: `cp .env.example .env.local`. PowerShell: `Copy-Item .env.example .env.local`.
2. Fill in the development values, except `APP_ORIGIN=http://localhost:3000` and `AI_PROVIDER=fake`. Keep the quotes around `DATABASE_CA_CERT` so that its line breaks survive. Leave `SUPABASE_DB_URL` commented out, and leave `TEST_DATABASE_URL` and the `E2E_*` lines as placeholders (they are read from the shell).
3. Repository linking only works locally if the development GitHub App's URLs point at `http://localhost:3000`. Otherwise test linking on the `dev` deployment.
4. Use `.env.local`, not `.env`. Both are ignored by git, but this repository's convention is `.env.local`.
5. Run `git status` and check that `.env.local` is not listed.

#### 13. Verify

- [x] Both Supabase projects: Singapore, PostgreSQL 17, Data API off, migrations applied, privilege check recorded (steps 1 and 2).
- [x] `select current_user` as `app_runtime` returns `app_runtime` through the transaction pooler (step 4).
- [x] The `master` and `dev` deployments both succeed after the redeploy (step 11).
- [x] The two environments share no database password, OAuth client secret, GitHub App key, or SoC LLM key. Compare them in your password manager, not in a file.
- [x] The Hobby checks (steps 5 and 11) and the Deployment Protection and sign-in-provider decisions (steps 6 and 8) are recorded.
- [x] Task 9.4 signs in on each deployed environment and records that it returns to that environment's own URL. CI cannot check this.
- [x] Task 9.4 makes one real SoC LLM call from each environment, after the `GET /v1/models` check, and records it with the release checks.

## Database migrations

### Where migrations live

- The schema lives in the `app` schema. It is created only by the plain SQL migrations in `supabase/migrations/`.
- Each migration is named `<UTC timestamp>_<name>.sql`, for example `20261030144500_create_app_schema.sql`.
- Never edit a migration that has been applied to any Supabase project. To change the schema, add a new migration.
- The running application never creates or alters schema objects. It connects as `app_runtime`, which can only read and write rows.

| Migration | Change |
|---|---|
| `20261030144500_create_app_schema` | Schema, tables, `app_runtime` role, grants, version triggers |
| `20261102120000_usage_environment_check` | `usage_records.charged_tokens`; `environment` and `feature` checks |
| `20261103120000_replace_github_pat_with_app_binding` | GitHub App installation and repository IDs replace encrypted PAT columns |
| `20261103150000_github_evidence_setup_snapshots` | Setup attempts, repository snapshots |
| `20261107032110_add_check_result_path_rules_hash` | `check_results.path_rules_hash` and new reuse keys |
| `20261109120000_report_cache_fingerprint` | Report input fingerprint, contract version, provider model |
| `20261110090000_report_redaction_count` | `reports.redaction_replacement_count` |
| `20261110120000_add_attached_commit_source_branch` | `attached_commits.source_branch` |
| `20261112120000_provider_call_limit` | `provider_call_permits` |

### Who applies migrations and how

Migrations are a controlled release step. An operator runs them by hand, never CI and never the application (CI decision D10). The operator connects as the Supabase `postgres` role through the **session pooler**, using the pinned Supabase CLI from this repository (`npx supabase`). Apply to the development project first, then production.

The session pooler connection string is on the project's **Connect** page in the Supabase dashboard. Use port `5432` and the user `postgres.<project-ref>`. Keep it out of the repository and out of shell history files where you can, for example by pasting it into a variable at a prompt:

Bash:

```bash
read -rs SUPABASE_DB_URL   # paste: postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=<path-to-ca>
export SUPABASE_DB_URL
```

PowerShell (the value is typed at a hidden prompt and lives only in this terminal session):

```powershell
$env:SUPABASE_DB_URL = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'Paste SUPABASE_DB_URL')).Password
```

In PowerShell, write `$env:SUPABASE_DB_URL` wherever the commands below say `"$SUPABASE_DB_URL"`, for example `npx supabase db push --db-url $env:SUPABASE_DB_URL --dry-run`. Close the terminal when you are done, so that the value is gone.

The Supabase CLI requires the connection string to be percent-encoded. Encode any special characters in the password, or use a password with only letters and digits so that none need encoding.

Before running any migration, check what it will apply:

```bash
npx supabase migration list --db-url "$SUPABASE_DB_URL"
npx supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
```

Then take a backup (see [Backup before a migration](#backup-before-a-migration)), except for the first migration, and apply:

```bash
npx supabase db push --db-url "$SUPABASE_DB_URL"
```

`supabase db push` records each applied version in `supabase_migrations.schema_migrations`.

### Check privileges after the first push

After the first push to each Supabase project, connect as `postgres` with `psql "$SUPABASE_DB_URL"` and run:

```sql
\dn+ app
\dp app.*
```

Confirm that the only grantee listed, apart from the owner, is `app_runtime`, and that `anon`, `authenticated`, and `service_role` appear nowhere. `app_runtime` should have `arwd` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on each table, except `arw` on `tasks` and `ar` on `task_events`. Later migrations narrow some new tables further (for example `provider_call_permits`). Record the result with the release checks.

### Verifying the server certificate

Every connection to Supabase uses `sslmode=verify-full` and checks the server certificate against the Supabase root CA. Never turn certificate verification off (`sslmode=require`, `disable`, or `no-verify`).

1. In the Supabase dashboard, open **Database settings → SSL Configuration** and download the CA certificate. Save it outside the repository, for example at `~/.config/mp4/supabase-<env>-ca.crt`. The certificate is public and is not a secret.
2. For `psql`, `pg_dump`, and the Supabase CLI, add `sslmode=verify-full&sslrootcert=<path-to-ca>` to the connection string.
3. For the application, put the PEM text of the same certificate in the server-only environment variable `DATABASE_CA_CERT`, in `.env.local` locally and in the Vercel project settings for deployments. See `.env.example`. Never give it a `NEXT_PUBLIC_` name.

### After the first migration: enable the runtime role

The first migration creates `app_runtime` with no login and no credential, because no credential may be stored in the repository (D-J). In each Supabase project, after the first migration has been applied, the operator:

1. Generates a strong random credential in a password manager. Use a different one for each environment.
2. Connects as `postgres` with `psql "$SUPABASE_DB_URL"` and runs:

   ```sql
   ALTER ROLE app_runtime LOGIN;
   \password app_runtime
   ```

   `\password` prompts for the value and sends only its hash, so it does not reach the shell history or the `psql` history.
3. Stores the runtime connection string as `DATABASE_URL`, in `.env.local` and in the Vercel project settings for that environment. It uses the **transaction pooler** (port `6543`), the user `app_runtime.<project-ref>`, and `sslmode=verify-full`. See `.env.example` for the format.

## Backup and restore

### First migration: rollback

The first migration (`20261030144500_create_app_schema.sql`) runs against empty databases, so it needs no backup (D-L). To undo it, the operator connects as `postgres` and runs:

```sql
DROP SCHEMA app CASCADE;
DROP ROLE app_runtime;
```

Then mark the migration as reverted, so a later `db push` applies it again:

```bash
npx supabase migration repair --db-url "$SUPABASE_DB_URL" --status reverted 20261030144500
```

### Backup before a migration

Before **every later migration**, the operator takes a plain-SQL `pg_dump` of the `app` schema and stores it **outside the repository**. A backup holds personal data, so keep it in access-controlled storage and delete it when it is no longer needed.

1. Stop application writes for the release window, so that no write made after the backup is lost if you have to restore.
2. Take the backup with the PostgreSQL 17 client tools. `pg_dump` must be the same major version as the server, or newer.

   ```bash
   pg_dump "$SUPABASE_DB_URL" \
     --schema=app \
     --format=plain \
     --file="<backup-dir-outside-repo>/<env>-app-<UTC timestamp>-before-<migration version>.sql"
   ```

3. Check that the file exists, is not empty, and contains `CREATE TABLE app.` statements.
4. Apply the migration (see [Who applies migrations and how](#who-applies-migrations-and-how)).

The dump contains the `app` schema, its objects, data, and grants. It does not contain roles, so `app_runtime` must still exist when you restore.

### Restore with psql

If a later migration fails or has to be undone, restore the backup taken just before it. The drop and the restore run as one transaction, so a failed restore leaves the database unchanged:

```bash
psql "$SUPABASE_DB_URL" \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA app CASCADE' \
  -f "<backup-dir-outside-repo>/<env>-app-<UTC timestamp>-before-<migration version>.sql"
```

Then mark the undone migration as reverted, and resume application writes:

```bash
npx supabase migration repair --db-url "$SUPABASE_DB_URL" --status reverted <migration version>
```

## Database integration tests

The tests in `tests/integration/db/` apply `supabase/migrations/*.sql` to a **disposable** PostgreSQL 17 and check the schema, constraints, and grants (D-K). They create and drop databases and the `app_runtime` role, so `TEST_DATABASE_URL` must point at a throwaway container, never a Supabase database. The test helper refuses Supabase hosts. `npm test` runs unit tests only and never needs a database.

Bash:

```bash
docker run -d --rm --name mp4-it-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres
npm run test:integration
docker stop mp4-it-pg
```

PowerShell:

```powershell
docker run -d --rm --name mp4-it-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:54329/postgres"
npm run test:integration
docker stop mp4-it-pg
```

Set `TEST_DATABASE_URL` in the shell that runs the tests, as shown above. The tests read it from the process environment, and Vitest does not load `.env.local` into it, so a value placed there is ignored.

The container's `postgres` credential is a throwaway value, used only inside that local container. When `TEST_DATABASE_URL` is unset, the integration suites are skipped with a message. CI runs the same tests in the `db-integration` job, against a `postgres:17` service container.

## Browser role journeys

Task 9.2 runs six Chromium journeys against a fresh, synthetic PostgreSQL database: the developer workflow, PM create/review/report workflow, acceptance-check failure and recovery, report failure and recovery, direct authorization denial, and synthetic sign-out. The launcher creates a uniquely named database, applies the checked-in migrations, and runs Next.js in development mode as `app_runtime`. Authentication, GitHub evidence, and AI responses use guarded synthetic test adapters (`src/server/test-support/`), which refuse to start outside an explicit loopback E2E mode; project membership, authorization, request handlers, repositories, and task transitions remain real. This does not verify deployed OAuth or deployed-provider behavior; those checks belong to task 9.4.

Use a dedicated local PostgreSQL cluster bound to loopback. Do not point `E2E_CLUSTER_ADMIN_URL` at Supabase, the integration-test cluster, or another shared database. For Windows, choose a new temporary directory and a port unused on your machine. The example below uses PostgreSQL 18 tools; adjust `PG_BIN` to the installed PostgreSQL `bin` directory.

```powershell
$e2eData = Join-Path $env:TEMP "mp4-e2e-9-2"
$PG_BIN = "C:\Program Files\PostgreSQL\18\bin"
if (Test-Path -LiteralPath $e2eData) { throw "Choose a fresh E2E directory; this command will not overwrite or delete existing data." }
New-Item -ItemType Directory -Path $e2eData | Out-Null
& (Join-Path $PG_BIN "initdb.exe") -D (Join-Path $e2eData "pgdata") -U e2e_operator -A trust --no-locale
& (Join-Path $PG_BIN "pg_ctl.exe") -D (Join-Path $e2eData "pgdata") -l (Join-Path $e2eData "postgres.log") -o "-h 127.0.0.1 -p 55492" start
$env:E2E_CLUSTER_ADMIN_URL = "postgresql://e2e_operator@127.0.0.1:55492/postgres"
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:E2E_SESSION_SECRET = [Convert]::ToHexString($bytes)
npm.cmd run test:e2e
& (Join-Path $PG_BIN "pg_ctl.exe") -D (Join-Path $e2eData "pgdata") stop
```

If a command fails, stop the cluster with `pg_ctl.exe ... stop` before retrying. The launcher fails if the admin URL is missing or does not use loopback. It creates a fresh database per run and keeps it inside the disposable cluster; stopping that cluster ends its availability. Playwright trace capture is disabled. CI retains only failure screenshots and `error-context.md` files under `test-results/`; trace archives are not uploaded.

CI runs the same browser command in the separate `e2e-role-journeys` job against its own PostgreSQL service. It uses synthetic signing material generated per run and no production database, Supabase Auth, GitHub OAuth, or SoC LLM credentials. CI retains bounded Playwright failure artifacts for 14 days.

## Documentation and diagrams

- `docs/` is the single source for the user guide, this guide, and the reflections. The MarkBind site in `product-website/` does **not** keep its own copies: `product-website/scripts/run-markbind.mjs` copies the `docs/` pages and `docs/images/` into the site at build time, and each site page (for example `product-website/developer-guide.md`) only adds front matter and includes the copied file. Edit `docs/`, never the generated copies.
- Preview the site with `cd product-website && npm ci && npm run serve`. Restart it after editing `docs/`, because the files are copied at startup.
- Diagrams are PlantUML sources in [`docs/diagrams/`](diagrams/), sharing [`style.puml`](diagrams/style.puml), and are committed as PNGs in `docs/images/developer-guide/`, so they render both on GitHub and on the site without Mermaid. Reference them with a path that starts `images/`. To regenerate after editing a `.puml` file (Java 11 or later; the PlantUML jar ships with MarkBind):

  ```bash
  cd docs/diagrams
  java -jar ../../product-website/node_modules/@markbind/core/src/plugins/default/plantuml.jar \
    -tpng -o ../images/developer-guide <name>.puml
  ```

  Diagrams that are not sequence or activity diagrams use `!pragma layout smetana`, so Graphviz is not needed.

## Acknowledgements

**Libraries and tools.** The application is built on [Next.js](https://nextjs.org/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [Supabase](https://supabase.com/) (`@supabase/ssr`, `@supabase/supabase-js`, and the Supabase CLI), and [node-postgres](https://node-postgres.com/). It is tested with [Vitest](https://vitest.dev/) and [Playwright](https://playwright.dev/), and linted with [ESLint](https://eslint.org/) and `eslint-config-next`. Exact versions are pinned in `package.json`. Third-party code enters the application only through these pinned packages.

**Infrastructure.** [Vercel](https://vercel.com/) hosts the application, [Supabase](https://supabase.com/) hosts PostgreSQL and authentication, and [GitHub Actions](https://github.com/features/actions) runs CI using the official `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/upload-pages-artifact`, and `actions/deploy-pages` actions. [gitleaks](https://github.com/gitleaks/gitleaks) scans for secrets. The SoC LLM service ([SoCLaaS](https://soclaas-portal.comp.nus.edu.sg)) is provided by the NUS School of Computing.

**Documentation and diagrams.** The product website is built with [MarkBind](https://markbind.org/). Diagrams are drawn with [PlantUML](https://plantuml.com/), using the copy bundled with MarkBind. The product website's navigation took the team's earlier FreshApples MP3 product site as a reference.

**Process.** Specifications follow [OpenSpec](https://github.com/Fission-AI/OpenSpec); the OpenSpec skills and commands under `.claude/skills/` and `.claude/commands/opsx/` come from OpenSpec. The agent role setup uses [Claude Code](https://docs.claude.com/en/docs/claude-code) subagents, hooks, and settings, and Codex agent profiles.

**Reused information.** The SoCLaaS API, model, limit, and error facts in `design.md` come from the SoC DocHub SoCLaaS guides, as saved and checked in the team's CS3227-2610-MP3 project. The GitHub App setup controls follow GitHub Docs: [About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-github-apps/about-the-setup-url) and [Sharing your GitHub App](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app). The GitHub REST API (version `2026-03-10`) and Supabase Auth server-side (PKCE) documentation describe the integrations used.

**AI assistance.** Much of the code, tests, specifications, and documentation, including this guide and its diagrams, was drafted with AI coding agents (Claude Code and Codex) under the workflow described in [Multi-agent software engineering](#multi-agent-software-engineering), and reviewed by the human developers. Each chat session that changed files has a human-verified summary in [`logs/`](../logs/).
