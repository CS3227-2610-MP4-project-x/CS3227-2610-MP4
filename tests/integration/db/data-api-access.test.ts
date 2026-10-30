/**
 * Requirement "Runtime access is least-privilege and server-only".
 * AC13 / scenario "Data API access" (D-J), tested as: the Supabase baseline roles `anon`,
 * `authenticated` and `service_role` have no privileges on schema `app` or anything in it,
 * and row-level security is not used because the schema is not exposed.
 *
 * service_role: design.md "Task 2.4 review decisions" / "Other Supabase roles": the
 * migration revokes all privileges on `app` and its objects from `service_role` when that
 * role exists. The harness always creates it (NOLOGIN), as Supabase projects have it.
 *
 * Trigger functions: nobody but the schema owner may EXECUTE the functions in `app`
 * (reviewer test-adequacy gap; the migration revokes EXECUTE from PUBLIC).
 */
import type pg from "pg";
import { expect, it } from "vitest";

import { ENTITY_TABLES, ROLES, SCHEMA } from "./support/fixtures";
import { dbDescribe, expectPrivilegeRejection, useMigratedDatabase } from "./support/harness";

type TestDatabaseAccessor = ReturnType<typeof useMigratedDatabase>;

async function privilegedObjects(admin: pg.Client, role: string): Promise<string[]> {
  const relations = await admin.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND CASE WHEN c.relkind = 'S'
                 THEN has_sequence_privilege($2, c.oid, 'USAGE,SELECT,UPDATE')
                 ELSE has_table_privilege($2, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            END`,
    [SCHEMA, role],
  );
  const columns = await admin.query<{ name: string }>(
    `SELECT c.relname || '.' || a.attname AS name
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege($2, c.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')`,
    [SCHEMA, role],
  );
  const functions = await admin.query<{ name: string }>(
    `SELECT p.proname || '()' AS name
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND has_function_privilege($2, p.oid, 'EXECUTE')`,
    [SCHEMA, role],
  );
  return [...relations.rows, ...columns.rows, ...functions.rows].map((row) => row.name);
}

function registerNoAccessTests(db: TestDatabaseAccessor): void {
  for (const role of ROLES.withoutAppAccess) {
    it(`${role} has no USAGE or CREATE on schema app`, async () => {
      const { rows } = await db().admin.query<{ usage: boolean; create: boolean }>(
        `SELECT has_schema_privilege($2, $1, 'USAGE') AS usage, has_schema_privilege($2, $1, 'CREATE') AS create`,
        [SCHEMA, role],
      );
      expect(rows[0]).toEqual({ usage: false, create: false });
    });

    it(`${role} has no privilege on any table, column, view, sequence or function in app`, async () => {
      const { rows } = await db().admin.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`,
        [SCHEMA],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(await privilegedObjects(db().admin, role)).toEqual([]);
    });
  }
}

dbDescribe("Supabase baseline roles cannot reach schema app (AC13)", () => {
  const db = useMigratedDatabase();

  registerNoAccessTests(db);

  for (const role of ROLES.withoutAppAccess) {
    it(`${role} is refused when it queries an application table`, async () => {
      const client = db().admin;
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        await expectPrivilegeRejection(client.query(`SELECT * FROM ${SCHEMA}.${ENTITY_TABLES.tasks}`));
      } finally {
        await client.query("ROLLBACK");
      }
    });
  }

  it("app_runtime cannot EXECUTE any function in schema app (trigger functions included)", async () => {
    const { rows } = await db().admin.query<{ proname: string; executable: boolean }>(
      `SELECT p.proname, has_function_privilege($2, p.oid, 'EXECUTE') AS executable
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1`,
      [SCHEMA, ROLES.runtime],
    );
    // The schema has trigger functions (version bump, immutability, assignee checks).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.executable).map((row) => row.proname)).toEqual([]);
  });

  it("does not enable row-level security on app tables (schema is not exposed, D-J)", async () => {
    const { rows } = await db().admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND c.relrowsecurity`,
      [SCHEMA],
    );
    expect(rows).toEqual([]);
  });
});

/**
 * Worst case for "Other Supabase roles": before the migrations run, the migrating role is
 * given default privileges that grant ALL on every new schema, table, sequence and function
 * to anon, authenticated and service_role. The migration's revocations must still leave
 * those roles with nothing in schema app.
 */
dbDescribe("Supabase baseline roles get nothing in app even with permissive default privileges", () => {
  const db = useMigratedDatabase({
    async beforeMigrations(admin) {
      // Role names come from constants, never from input.
      const grantees = ROLES.withoutAppAccess.join(", ");
      for (const objects of ["SCHEMAS", "TABLES", "SEQUENCES", "FUNCTIONS"]) {
        await admin.query(`ALTER DEFAULT PRIVILEGES GRANT ALL ON ${objects} TO ${grantees}`);
      }
    },
  });

  registerNoAccessTests(db);
});
