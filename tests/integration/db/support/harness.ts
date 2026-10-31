/**
 * PostgreSQL integration-test harness for the `app` schema (task 2.4, design D-K).
 *
 * - Reads `TEST_DATABASE_URL`: a superuser connection to a DISPOSABLE PostgreSQL
 *   (local Docker container or the CI service container). Never a Supabase database.
 *   When it is unset, every suite is skipped with an explanatory name.
 * - Each test file gets its own fresh database (created from `template0`), so files do
 *   not depend on each other or on run order.
 * - Roles are cluster-wide, so files are serialized with a session advisory lock held on
 *   the maintenance connection for the whole file, and `app_runtime` is dropped after each
 *   file so the next file's migrations create it again from scratch.
 * - Creates the Supabase baseline roles `anon`, `authenticated` and `service_role`
 *   (NOLOGIN) when missing, so the grant tests run on plain PostgreSQL.
 * - Optionally runs a caller-supplied setup step on the fresh database before the
 *   migrations (for example, Supabase-like default privileges for those roles).
 * - Applies `supabase/migrations/*.sql` in filename order with `pg`, as the superuser.
 * - Gives `app_runtime` a random, test-only password (and LOGIN) inside the disposable
 *   cluster only, then connects as `app_runtime`. No password is stored anywhere.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { ROLES, SCHEMA } from "./fixtures";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

const TEST_DB_PREFIX = "mp4_it_";
/** Arbitrary constant key for the cluster-wide advisory lock that serializes test files. */
const FILE_LOCK_KEY = 32_270_224;
const SETUP_TIMEOUT_MS = 300_000;

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;

export const hasTestDatabase = testDatabaseUrl !== undefined;

/**
 * `describe` that is skipped, with a clear reason in its name, when `TEST_DATABASE_URL`
 * is not set. `npm test` (unit tests) never needs a database.
 */
export function dbDescribe(name: string, fn: () => void): void {
  if (hasTestDatabase) {
    describe(name, fn);
  } else {
    describe.skip(
      `${name} [skipped: TEST_DATABASE_URL is not set; point it at a disposable PostgreSQL superuser URL]`,
      fn,
    );
  }
}

function requireTestDatabaseUrl(): URL {
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is not set");
  }
  const url = new URL(testDatabaseUrl);
  if (/supabase\.(co|com)$/i.test(url.hostname)) {
    throw new Error(
      "TEST_DATABASE_URL points at a Supabase host. Integration tests create and drop " +
        "databases and roles; use a disposable local or CI PostgreSQL container only.",
    );
  }
  return url;
}

function urlFor(base: URL, database: string, credentials?: { user: string; password: string }): string {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  if (credentials) {
    url.username = encodeURIComponent(credentials.user);
    url.password = encodeURIComponent(credentials.password);
  }
  return url.toString();
}

/** Migration files in the order they are applied (filename order, D-B). */
export function listMigrationFiles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

export function readMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

async function ensureBaselineRoles(client: pg.Client): Promise<void> {
  for (const role of ROLES.withoutAppAccess) {
    // Role names come from constants, never from input.
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
           CREATE ROLE ${role} NOLOGIN;
         END IF;
       END $$;`,
    );
  }
}

async function dropDatabase(maintenance: pg.Client, name: string): Promise<void> {
  await maintenance.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [name],
  );
  await maintenance.query(`DROP DATABASE IF EXISTS "${name}"`);
}

async function dropRuntimeRole(maintenance: pg.Client): Promise<void> {
  try {
    await maintenance.query(`DROP ROLE IF EXISTS ${ROLES.runtime}`);
  } catch (error) {
    throw new Error(
      `Could not drop role ${ROLES.runtime} on the TEST_DATABASE_URL cluster. It probably ` +
        "owns objects or holds privileges in a database the tests did not create. Use a " +
        `dedicated disposable PostgreSQL container. Cause: ${(error as Error).message}`,
    );
  }
}

async function removeLeftovers(maintenance: pg.Client): Promise<void> {
  const { rows } = await maintenance.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE starts_with(datname, $1)",
    [TEST_DB_PREFIX],
  );
  for (const { datname } of rows) {
    await dropDatabase(maintenance, datname);
  }
  await dropRuntimeRole(maintenance);
}

export interface PreMigrationSnapshot {
  /** Whether schema `app` existed in the fresh database before any migration ran. */
  appSchemaExisted: boolean;
}

export interface PostMigrationSnapshot {
  /** Whether role `app_runtime` exists right after the migrations ran. */
  runtimeRoleExists: boolean;
  /** Whether the migrations left `app_runtime` with a password (must be false, D-J). */
  runtimeRoleHasPassword: boolean;
}

export interface TestDatabase {
  readonly name: string;
  /** Superuser client connected to this file's test database. */
  readonly admin: pg.Client;
  readonly migrationFiles: readonly string[];
  readonly preMigration: PreMigrationSnapshot;
  readonly postMigration: PostMigrationSnapshot;
  /** Opens a new client connected as `app_runtime`; closed automatically after the file. */
  connectAsRuntime(): Promise<pg.Client>;
}

export interface MigratedDatabaseOptions {
  /** Runs as the superuser on the fresh, empty database before any migration is applied. */
  beforeMigrations?: (admin: pg.Client) => Promise<void>;
}

/**
 * Registers `beforeAll`/`afterAll` hooks that create a fresh, migrated database for the
 * current test file and returns an accessor for it.
 */
export function useMigratedDatabase(options: MigratedDatabaseOptions = {}): () => TestDatabase {
  let maintenance: pg.Client | undefined;
  let admin: pg.Client | undefined;
  let state: TestDatabase | undefined;
  const runtimeClients: pg.Client[] = [];
  let runtimePassword: string | undefined;

  beforeAll(async () => {
    const baseUrl = requireTestDatabaseUrl();
    maintenance = new pg.Client({ connectionString: baseUrl.toString() });
    await maintenance.connect();
    await maintenance.query("SELECT pg_advisory_lock($1)", [FILE_LOCK_KEY]);

    await removeLeftovers(maintenance);
    await ensureBaselineRoles(maintenance);

    const name = `${TEST_DB_PREFIX}${randomBytes(6).toString("hex")}`;
    await maintenance.query(`CREATE DATABASE "${name}" TEMPLATE template0`);

    const adminClient = new pg.Client({ connectionString: urlFor(baseUrl, name) });
    admin = adminClient;
    await adminClient.connect();

    const preMigration: PreMigrationSnapshot = {
      appSchemaExisted:
        (await adminClient.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [SCHEMA])).rowCount !== 0,
    };

    await options.beforeMigrations?.(adminClient);

    const migrationFiles = listMigrationFiles();
    for (const file of migrationFiles) {
      try {
        await adminClient.query(readMigration(file));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    const role = await adminClient.query<{ has_password: boolean }>(
      "SELECT rolpassword IS NOT NULL AS has_password FROM pg_authid WHERE rolname = $1",
      [ROLES.runtime],
    );
    const postMigration: PostMigrationSnapshot = {
      runtimeRoleExists: role.rowCount === 1,
      runtimeRoleHasPassword: role.rows[0]?.has_password ?? false,
    };

    state = {
      name,
      admin: adminClient,
      migrationFiles,
      preMigration,
      postMigration,
      async connectAsRuntime() {
        if (!postMigration.runtimeRoleExists) {
          throw new Error(`Role ${ROLES.runtime} was not created by the migrations`);
        }
        if (runtimePassword === undefined) {
          // Test-only random password, valid only inside this disposable cluster and
          // removed with the role in afterAll. Hex characters, so literal-safe.
          const password = randomBytes(24).toString("hex");
          await adminClient.query(`ALTER ROLE ${ROLES.runtime} WITH LOGIN PASSWORD '${password}'`);
          runtimePassword = password;
        }
        const client = new pg.Client({
          connectionString: urlFor(baseUrl, name, { user: ROLES.runtime, password: runtimePassword }),
        });
        await client.connect();
        runtimeClients.push(client);
        return client;
      },
    };
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    for (const client of runtimeClients) {
      await client.end().catch(() => undefined);
    }
    await admin?.end().catch(() => undefined);
    if (maintenance) {
      try {
        if (state) {
          await dropDatabase(maintenance, state.name);
        }
        await dropRuntimeRole(maintenance);
      } finally {
        await maintenance.query("SELECT pg_advisory_unlock($1)", [FILE_LOCK_KEY]).catch(() => undefined);
        await maintenance.end().catch(() => undefined);
      }
    }
  }, SETUP_TIMEOUT_MS);

  return () => {
    if (!state) {
      throw new Error("Test database is not ready; did beforeAll fail?");
    }
    return state;
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * Asserts that a write was refused by an integrity rule: SQLSTATE class 23 (integrity
 * constraint violation) or P0 (raised by a trigger). Errors such as an undefined column
 * (42703) do NOT count, so a misnamed fixture cannot make a negative test pass.
 */
export async function expectIntegrityRejection(write: Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await write;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database to reject the write").toBeDefined();
  const code = errorCode(caught);
  expect(code, `unexpected error: ${(caught as Error).message}`).toMatch(/^(23|P0)/);
  return code as string;
}

/** Asserts that a statement failed with insufficient_privilege (42501). */
export async function expectPrivilegeRejection(statement: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await statement;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the statement to be refused").toBeDefined();
  expect(errorCode(caught), `unexpected error: ${(caught as Error).message}`).toBe("42501");
}

/** Returns the SQLSTATE of a failed statement, or undefined if it succeeded. */
export async function sqlStateOf(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (error) {
    return errorCode(error) ?? "unknown";
  }
}
