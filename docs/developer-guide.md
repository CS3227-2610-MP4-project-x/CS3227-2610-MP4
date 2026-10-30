# Developer Guide

This guide is for developers and operators. So far it covers the development and production environments and their configuration, and the database: how migrations are applied, how to back up and restore before a migration, and how to run the database integration tests. The decisions behind it are "Separate environments", E1 to E9, D-A, D-J, D-K, and D-L in `openspec/changes/project-task-management/design.md`.

Never commit connection strings, database credentials, the `app_runtime` credential, backups, or production data. Every value in angle brackets below (`<...>`) is a placeholder.

## Environments and configuration

The application runs in two separate environments, development and production. They share no credential. Each has its own Supabase project, GitHub OAuth app, and SoC LLM key, and its own database password and encryption key. `.env.example` lists every variable, with a comment on its purpose and where it is set. The decisions behind this section are "Separate environments", E1 to E9, and "SoC LLM and Quota Decisions" in `openspec/changes/project-task-management/design.md`.

### The two environments

| | Development | Production |
|---|---|---|
| Git branch | `dev` | `master` |
| Vercel scope | Preview, restricted to the `dev` branch | Production |
| Supabase project | development project | production project |
| GitHub OAuth app | development app | production app |
| OAuth callback URL | `https://<dev-project-ref>.supabase.co/auth/v1/callback` | `https://<prod-project-ref>.supabase.co/auth/v1/callback` |
| SoC LLM key | from thegrimbee's SoC account | from Lim-ZY's SoC account |
| `APP_ENV` | `development` | `production` |
| `APP_ORIGIN` | the stable Vercel URL of the `dev` branch | the production domain |
| `AI_PROVIDER` | `fake` or `soclaas` | `soclaas` (production refuses `fake`) |
| Per-person AI limits (code constants, E4) | 5 requests per minute, 1,000,000 tokens per day | 5 requests per minute, 400,000 tokens per day |

Local development uses the development values, except that `APP_ORIGIN` is `http://localhost:3000` and `AI_PROVIDER` is normally `fake`. CI sets no application variable (D12, D13); only its `db-integration` job sets `TEST_DATABASE_URL`, for a throwaway container. Previews of branches other than `dev` get no variables, so they build but cannot sign in or reach data.

`APP_ENV` is the only way the application tells the environments apart. Do not use `NODE_ENV` or `VERCEL_ENV` for this: `NODE_ENV` is `production` in every built deployment, and `VERCEL_ENV` is not set locally (E6).

### Where each variable is set

Every variable is server-only. None may have a `NEXT_PUBLIC_` prefix, appear in a Client Component prop, be committed, or be logged.

| Variable | Purpose | Local `.env.local` | Vercel Preview (`dev`) | Vercel Production | Secret |
|---|---|---|---|---|---|
| `DATABASE_URL` | `app_runtime` through the transaction pooler (D-A, D-J) | development | development | production | yes |
| `DATABASE_CA_CERT` | Supabase root CA, PEM text (D-J) | development | development | production | no |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | encrypts stored GitHub tokens (D-H) | development | development | production | yes |
| `SUPABASE_URL` | Supabase project URL for sign-in (E1) | development | development | production | no |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for sign-in (E1) | development | development | production | no |
| `APP_ORIGIN` | the environment's own origin (E7) | `http://localhost:3000` | `dev` branch URL | production domain | no |
| `APP_ENV` | environment name (E6) | `development` | `development` | `production` | no |
| `AI_PROVIDER` | SoC LLM adapter, `fake` or `soclaas` (E3) | `fake` | `fake` or `soclaas` | `soclaas` | no |
| `SOCLAAS_API_KEY` | SoCLaaS API key, needed only for `soclaas` (E3) | development, only when needed | development | production | yes |
| `SOCLAAS_MODEL` | pinned model, `qwen3.6:35b` (E3) | `qwen3.6:35b` | `qwen3.6:35b` | `qwen3.6:35b` | no |
| `TEST_DATABASE_URL` | integration tests only (D-K) | the shell that runs the tests | never | never | throwaway |
| `SUPABASE_DB_URL` | operator migrations and backups (E9) | the operator's shell, one session | never | never | yes |

Vercel's Development scope stays empty. Write `.env.local` by hand from `.env.example` (`cp .env.example .env.local`, or `Copy-Item .env.example .env.local` in PowerShell); do not pull it from Vercel. `.gitignore` ignores `.env`, `.env.*` (except `.env.example`), and the `.vercel/` folder that the Vercel CLI creates.

`SUPABASE_DB_URL` is commented out in `.env.example`. Set it only in your shell, as shown in [Who applies migrations and how](#who-applies-migrations-and-how), never in `.env.local` or Vercel. `TEST_DATABASE_URL` is also read from the shell; see [Database integration tests](#database-integration-tests).

These are not variables, so they are not in `.env.example`, Vercel, or the repository:

- The GitHub OAuth app client ID and client secret. They are entered only in each environment's Supabase project (E2).
- A Supabase secret or `service_role` key. The application never uses one; application data goes through `DATABASE_URL` (E1).
- AI quotas and rate limits. They are code constants selected by `APP_ENV`; changing one is a reviewed code change (E4).
- The SoC LLM gateway base URL, `https://soclaas-api.comp.nus.edu.sg`. It is a code constant (E3).

No application code reads these variables yet. The first of tasks 3.1, 5.1, and 6.1 adds one server-only configuration module in `src/server/config/`, which validates the variables when it is first called and reports a missing or invalid variable by name, never by value (E5).

### Setting up the environments

These steps are for the human developers. Agents do not perform or verify them. Record what you confirm with the release checks.

#### 1. Confirm the Supabase projects

Confirm that the development and production Supabase projects both exist and are separate: PostgreSQL 17, Singapore region, Data API turned off. Note each project's reference (`<project-ref>`); it appears in the project URL `https://<project-ref>.supabase.co`. Apply the migrations and enable `app_runtime` in each, as described in [Database migrations](#database-migrations).

#### 2. Create the GitHub OAuth apps

Create two GitHub OAuth apps, one per environment (GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**). For each:

1. Set **Authorization callback URL** to that environment's Supabase callback, `https://<project-ref>.supabase.co/auth/v1/callback`, using that environment's project reference.
2. Generate a client secret.
3. Copy the client ID and client secret straight into the matching Supabase project (step 3). Do not put them in `.env.local`, Vercel, the repository, or a chat.

#### 3. Configure Supabase Auth

In each Supabase project:

1. Under **Authentication → Sign In / Providers → GitHub**, enable the provider and enter that environment's OAuth client ID and client secret.
2. Under **Authentication → URL Configuration**, set **Site URL** to that environment's `APP_ORIGIN`.
3. Set **Redirect URLs** to only the exact sign-in callback URL of that environment's app. The development project also allows the same path on `http://localhost:3000`. The list holds only exact callback URLs, with no wildcards. Task 3.1 defines the callback path, so the entry is added once that task is done.
4. Under **Project Settings → API Keys**, find the project's publishable key. It becomes `SUPABASE_PUBLISHABLE_KEY`, and the project URL becomes `SUPABASE_URL`. Do not copy the secret or `service_role` keys anywhere.

#### 4. Create the `dev` branch

Create `dev` from the latest `master` and push it:

```bash
git switch master
git pull
git switch -c dev
git push -u origin dev
```

A human then configures branch protection on `dev`, like `master`: require the CI checks and a reviewed pull request. Agents do not change branch protection (D7).

#### 5. Create the Vercel project

1. Create **one** Vercel project from this repository, with `master` as the production branch.
2. Confirm that the Hobby plan can deploy this organisation-owned repository and offers branch-specific Preview variables. Record the result with the release checks (E8). A different setup would need a new recorded decision.
3. Note the stable URL Vercel gives the `dev` branch. It is development's `APP_ORIGIN` and the development Supabase project's Site URL (step 3).
4. Under **Settings → Environment Variables**:
   - **Production**: the production values.
   - **Preview**, restricted to the `dev` branch: the development values.
   - **Development**: nothing.
   - Add no variable for previews of other branches. You may turn off their deployments.

#### 6. Generate the per-environment secrets

Generate each of these separately for development and production, and never reuse a value across them. Local `.env.local` uses the development values.

- **`app_runtime` password.** See [After the first migration: enable the runtime role](#after-the-first-migration-enable-the-runtime-role).
- **`GITHUB_TOKEN_ENCRYPTION_KEY`.** 32 random bytes, base64-encoded:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  Paste the output straight into Vercel or `.env.local`; do not save it anywhere else. Replacing the key after GitHub tokens are stored makes them unreadable. Rotation uses the key version in D-H and is implemented by task 5.1.
- **SoC LLM key.** Issued in the SoCLaaS portal, `https://soclaas-portal.comp.nus.edu.sg`. Development uses a key from thegrimbee's SoC account and production one from Lim-ZY's ("Keys per environment"). The key owner uses the key only for this application, or warns the team before replacing it ("Keys per environment"). Rotating a key disables the old one at once ("SoC LLM Facts"). Before setting `AI_PROVIDER` to `soclaas`, check that `GET /v1/models` with the key lists `qwen3.6:35b`. Locally, keep `AI_PROVIDER=fake` and use the development key only when needed.

#### 7. Verify

- Compare the two environments' values and confirm that they share no database password, OAuth client secret, SoC LLM key, or encryption key.
- Task 9.4 signs in on each deployed environment and records the result. CI cannot check this.
- After the first deployment with the real SoC LLM adapter, each environment makes one real call, recorded with the release checks.

## Database migrations

### Where migrations live

- The schema lives in the `app` schema. It is created only by the plain SQL migrations in `supabase/migrations/`.
- Each migration is named `<UTC timestamp>_<name>.sql`, for example `20261030144500_create_app_schema.sql`.
- Never edit a migration that has been applied to any Supabase project. To change the schema, add a new migration.
- The running application never creates or alters schema objects. It connects as `app_runtime`, which can only read and write rows.

### Who applies migrations and how

Migrations are a controlled release step. An operator runs them by hand, never CI and never the application (CI decision D10). The operator connects as the Supabase `postgres` role through the **session pooler**, using the pinned Supabase CLI from this repository (`npx supabase`). Apply to the development project first, then production.

The session pooler connection string is on the project's **Connect** page in the Supabase dashboard. Use port `5432` and the user `postgres.<project-ref>`. Keep it out of the repository and out of shell history files where you can, for example by pasting it into a variable at a prompt:

```bash
read -rs SUPABASE_DB_URL   # paste: postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=<path-to-ca>
export SUPABASE_DB_URL
```

The Supabase CLI requires the connection string to be percent-encoded. Encode any special characters in the password.

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

Confirm that the only grantee listed, apart from the owner, is `app_runtime`, and that `anon`, `authenticated`, and `service_role` appear nowhere. `app_runtime` should have `arwd` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on each table, except `arw` on `tasks` and `ar` on `task_events`. Record the result with the release checks.

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

Before **every later migration**, the operator takes a plain-SQL `pg_dump` of the `app` schema and stores it **outside the repository**. A backup holds personal data and encrypted credentials, so keep it in access-controlled storage and delete it when it is no longer needed.

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
