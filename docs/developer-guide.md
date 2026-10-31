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
| GitHub OAuth app client ID (not secret) | | | 7 |

#### 0. Prerequisites

- Node.js 24 and `npm ci` already run in your clone. The Supabase CLI is a pinned development dependency, so `npx supabase` needs no global install.
- PostgreSQL 17 client tools (`psql`, `pg_dump`) on your `PATH`, for the privilege check and backups.
  - Windows: run the PostgreSQL 17 installer from postgresql.org and select only **Command Line Tools**. Then add `C:\Program Files\PostgreSQL\17\bin` to `PATH` and open a new terminal. `psql --version` should print 17.x.
  - macOS: `brew install postgresql@17`.
- Admin access to both Supabase projects, a Vercel account, and owner access to the GitHub organisation, or someone who has it. Installing the Vercel GitHub app and creating organisation OAuth apps needs an organisation owner.
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

   In PowerShell, write `$env:SUPABASE_DB_URL` instead of `"$SUPABASE_DB_URL"`. The dry run should list `20261030144500_create_app_schema.sql`. The first migration needs no backup; later ones do (see [Backup before a migration](#backup-before-a-migration)).
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
5. Keep `DATABASE_URL` in your password manager until step 9.

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
5. Click **Deploy**. The first deployment builds the home page only and should succeed.
6. Open **Settings → Environments → Production** (in older dashboards **Settings → Git**) and check that the production branch (**Branch Tracking**) is `master`.

#### 6. Find the two app URLs (`APP_ORIGIN`)

1. **Production.** Open **Settings → Domains**. The default production domain is `https://<project-name>.vercel.app`; Vercel may add a suffix if the name is taken. Copy the exact value, with `https://` and no trailing slash, into the worksheet as production `APP_ORIGIN`. If you later add a custom domain, `APP_ORIGIN`, the Supabase Site URL, and the GitHub OAuth app's homepage URL must all change to it.
2. **Development.** Pushing `dev` in step 3 triggers a preview deployment; if it did not, push any commit to `dev`. Open **Deployments**, filter by branch `dev`, and open the latest one. Under **Domains** it lists a branch URL of the form `https://<project-name>-git-dev-<scope>.vercel.app`. This URL stays the same for every `dev` deployment. Copy it into the worksheet as development `APP_ORIGIN`. Do not use the per-deployment URL with a random hash; it changes on every push.
3. **Deployment Protection.** By default Vercel protects preview URLs, so only people logged in to your Vercel account can open the `dev` URL, and anyone else signing in there is stopped by a Vercel login page. Whether to turn this off for `dev` (**Settings → Deployment Protection**) is not decided yet. Ask the team before changing it, and record the decision.

#### 7. Create the GitHub OAuth apps

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
3. **Redirect URLs.** These are the app pages that Supabase may send people back to after sign-in. The list holds only exact URLs, with no wildcards. Task 3.1 defines the callback path, so the entries are added once that task is done. They will be:
   - Development project: `<development APP_ORIGIN><callback path>` and `http://localhost:3000<callback path>`.
   - Production project: `<production APP_ORIGIN><callback path>` only.
4. **Other sign-in providers.** The Email provider is on by default in new Supabase projects. The specs only define GitHub sign-in, but whether to turn the others off is not recorded. Ask the team, and record the decision.
5. **API key.** Open **Project Settings → API Keys**. Under **Publishable key**, copy the key that starts with `sb_publishable_`. If the page has only legacy `anon` and `service_role` keys, create the new keys there first. This is `SUPABASE_PUBLISHABLE_KEY`. Do not copy the secret or `service_role` keys anywhere (E1).

#### 9. Generate the per-environment secrets

Generate each of these separately for development and production, and never reuse a value across them. Local `.env.local` uses the development values.

- **`app_runtime` password and `DATABASE_URL`.** From step 4.
- **`GITHUB_TOKEN_ENCRYPTION_KEY`.** 32 random bytes, base64-encoded. Run this once per environment:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  Paste the output straight into Vercel (step 10) or `.env.local` (step 11); do not save it anywhere else. Replacing the key after GitHub tokens are stored makes them unreadable. Rotation uses the key version in D-H and is implemented by task 5.1.
- **SoC LLM key.** Issued in the SoCLaaS portal, `https://soclaas-portal.comp.nus.edu.sg`. Development uses a key from thegrimbee's SoC account and production one from Lim-ZY's ("Keys per environment"). The key owner uses the key only for this application, or warns the team before replacing it ("Keys per environment"). Rotating a key disables the old one at once ("SoC LLM Facts"). Before setting `AI_PROVIDER` to `soclaas`, check that the key can use the pinned model. Bash:

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

#### 10. Set the Vercel environment variables

Open the Vercel project's **Settings → Environment Variables**. Add each variable with **Add Environment Variable** (or **Add New**): fill in **Key** and **Value**, tick the environment, and save. Turn on **Sensitive** for every variable marked secret, so that its value cannot be read back from the dashboard.

**Production values**: tick **Production** only.

| Key | Value | Sensitive |
|---|---|---|
| `DATABASE_URL` | production `DATABASE_URL` from step 4 | yes |
| `DATABASE_CA_CERT` | production CA file contents, from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`, pasted as several lines, without quotes | no |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | a new production key from step 9 | yes |
| `SUPABASE_URL` | `https://<prod-project-ref>.supabase.co` | no |
| `SUPABASE_PUBLISHABLE_KEY` | production publishable key | no |
| `APP_ORIGIN` | production `APP_ORIGIN` | no |
| `APP_ENV` | `production` | no |
| `AI_PROVIDER` | `soclaas` | no |
| `SOCLAAS_API_KEY` | production SoC key (Lim-ZY's account) | yes |
| `SOCLAAS_MODEL` | `qwen3.6:35b` | no |

**Development values**: tick **Preview** only, then choose **Select a custom Preview branch** (or **Specific branch**) and enter `dev`.

| Key | Value | Sensitive |
|---|---|---|
| `DATABASE_URL` | development `DATABASE_URL` from step 4 | yes |
| `DATABASE_CA_CERT` | development CA file contents, as above | no |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | a new development key from step 9 | yes |
| `SUPABASE_URL` | `https://<dev-project-ref>.supabase.co` | no |
| `SUPABASE_PUBLISHABLE_KEY` | development publishable key | no |
| `APP_ORIGIN` | development `APP_ORIGIN` (the `dev` branch URL) | no |
| `APP_ENV` | `development` | no |
| `AI_PROVIDER` | `fake` until you need the real model, then `soclaas` | no |
| `SOCLAAS_API_KEY` | development SoC key (thegrimbee's account) | yes |
| `SOCLAAS_MODEL` | `qwen3.6:35b` | no |

Then:

1. Leave **Development** empty, and add nothing for **Preview** on all branches (E8).
2. **Hobby check (E8).** If Vercel does not let you restrict Preview variables to the `dev` branch, stop and record it: a different setup needs a new recorded decision.
3. Check the list. Every key should appear twice (Production, and Preview for `dev`) with different values, except `SOCLAAS_MODEL`. No key starts with `NEXT_PUBLIC_`.
4. Variable changes only apply to new deployments. Open **Deployments**, and choose **⋯ → Redeploy** on the latest `master` deployment and on the latest `dev` deployment.
5. Never run `vercel env pull` into this repository. The Development scope is empty, and real values must not land in files.

#### 11. Set up your local `.env.local`

1. Copy the template. Bash: `cp .env.example .env.local`. PowerShell: `Copy-Item .env.example .env.local`.
2. Fill in the development values, except `APP_ORIGIN=http://localhost:3000` and `AI_PROVIDER=fake`. Keep the quotes around `DATABASE_CA_CERT` so that its line breaks survive. Leave `SUPABASE_DB_URL` commented out and `TEST_DATABASE_URL` as it is.
3. Use `.env.local`, not `.env`. Both are ignored by git, but this repository's convention is `.env.local`.
4. Run `git status` and check that `.env.local` is not listed.

#### 12. Verify

- [ ] Both Supabase projects: Singapore, PostgreSQL 17, Data API off, migrations applied, privilege check recorded (steps 1 and 2).
- [ ] `select current_user` as `app_runtime` returns `app_runtime` through the transaction pooler (step 4).
- [ ] The `master` and `dev` deployments both succeed after the redeploy (step 10).
- [ ] The two environments share no database password, OAuth client secret, SoC LLM key, or encryption key. Compare them in your password manager, not in a file.
- [ ] The Hobby checks (steps 5 and 10) and the Deployment Protection and sign-in-provider decisions (steps 6 and 8) are recorded.
- [ ] After task 3.1: the Redirect URLs are added (step 8), and task 9.4 signs in on each deployed environment and records the result. CI cannot check this.
- [ ] After the first deployment with the real SoC LLM adapter, each environment makes one real call, recorded with the release checks.

## Database migrations

### Where migrations live

- The schema lives in the `app` schema. It is created only by the plain SQL migrations in `supabase/migrations/`.
- Each migration is named `<UTC timestamp>_<name>.sql`, for example `20261030144500_create_app_schema.sql`.
- Never edit a migration that has been applied to any Supabase project. To change the schema, add a new migration.
- The running application never creates or alters schema objects. It connects as `app_runtime`, which can only read and write rows.

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
