# Developer Guide

This guide is for developers and operators. So far it covers only the database: how migrations are applied, how to back up and restore before a migration, and how to run the database integration tests. The decisions behind it are D-A, D-J, D-K, and D-L in `openspec/changes/project-task-management/design.md`.

Never commit connection strings, database credentials, the `app_runtime` credential, backups, or production data. Every value in angle brackets below (`<...>`) is a placeholder.

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
