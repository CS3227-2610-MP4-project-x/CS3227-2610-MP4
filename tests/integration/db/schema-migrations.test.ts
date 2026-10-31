/**
 * Requirement "Schema is created by versioned migrations" and
 * "Runtime access is least-privilege and server-only" (runtime role part).
 * AC1: Empty database is migrated. AC2: Application does not migrate (D-B, D-J).
 * Table privileges follow design.md "Task 2.4 review decisions": no DELETE on tasks
 * (history is never hard-deleted) and only SELECT/INSERT on task_events (append-only).
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import { ENTITY_TABLES, QUOTA_TABLE, ROLES, SCHEMA, runtimeTablePrivileges } from "./support/fixtures";
import {
  dbDescribe,
  expectPrivilegeRejection,
  listMigrationFiles,
  readMigration,
  useMigratedDatabase,
} from "./support/harness";

dbDescribe("schema is created by versioned migrations", () => {
  const db = useMigratedDatabase();

  it("keeps migrations as Supabase CLI files named <UTC timestamp>_<name>.sql (D-B)", () => {
    const files = db().migrationFiles;
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it("AC1: migrates an empty database into schema app with all eleven entity tables", async () => {
    expect(db().preMigration.appSchemaExisted).toBe(false);

    const { rows } = await db().admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      [SCHEMA],
    );
    const tables = rows.map((row) => row.table_name);
    for (const table of Object.values(ENTITY_TABLES)) {
      expect(tables, `missing table ${SCHEMA}.${table}`).toContain(table);
    }
    expect(tables, `missing quota lock-row table ${SCHEMA}.${QUOTA_TABLE}`).toContain(QUOTA_TABLE);
  });

  it("AC1: does not put application tables in schema public", async () => {
    const { rows } = await db().admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [Object.values(ENTITY_TABLES)],
    );
    expect(rows).toEqual([]);
  });
});

dbDescribe("application does not migrate: app_runtime is least-privilege (D-J)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("AC2: the migrations create app_runtime without a password", () => {
    expect(db().postMigration.runtimeRoleExists).toBe(true);
    expect(db().postMigration.runtimeRoleHasPassword).toBe(false);
  });

  it("AC2 (static): no migration file sets a password", () => {
    for (const file of listMigrationFiles()) {
      expect(readMigration(file), `${file} must not contain a password`).not.toMatch(/\bPASSWORD\b/i);
    }
  });

  it("AC2: app_runtime has no cluster-level powers", async () => {
    const { rows } = await db().admin.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
         FROM pg_roles WHERE rolname = $1`,
      [ROLES.runtime],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      rolreplication: false,
    });
  });

  it("AC2: app_runtime cannot CREATE in the database", async () => {
    await expectPrivilegeRejection(runtime.query("CREATE SCHEMA runtime_should_not_create"));
  });

  it("AC2: app_runtime cannot CREATE objects in schema app", async () => {
    await expectPrivilegeRejection(runtime.query(`CREATE TABLE ${SCHEMA}.runtime_should_not_create (id int)`));
    await expectPrivilegeRejection(runtime.query(`CREATE VIEW ${SCHEMA}.runtime_should_not_create AS SELECT 1`));
  });

  it("AC2: app_runtime cannot ALTER, DROP or TRUNCATE app tables", async () => {
    await expectPrivilegeRejection(
      runtime.query(`ALTER TABLE ${SCHEMA}.${ENTITY_TABLES.tasks} ADD COLUMN runtime_should_not_add int`),
    );
    await expectPrivilegeRejection(runtime.query(`DROP TABLE ${SCHEMA}.${ENTITY_TABLES.usageRecords}`));
    await expectPrivilegeRejection(runtime.query(`TRUNCATE ${SCHEMA}.${ENTITY_TABLES.people}`));
  });

  it("AC2: app_runtime owns no schema or object in app", async () => {
    const schemaOwner = await db().admin.query<{ owner: string }>(
      "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1",
      [SCHEMA],
    );
    expect(schemaOwner.rows[0].owner).not.toBe(ROLES.runtime);

    const owned = await db().admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND pg_get_userbyid(c.relowner) = $2`,
      [SCHEMA, ROLES.runtime],
    );
    expect(owned.rows).toEqual([]);
  });

  it("AC2: app_runtime has exactly SELECT, INSERT, UPDATE, DELETE on every app table except tasks (no DELETE) and task_events (SELECT, INSERT)", async () => {
    const { rows } = await db().admin.query<{
      table_name: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
      trunc: boolean;
      refs: boolean;
      trig: boolean;
    }>(
      `SELECT c.relname AS table_name,
              has_table_privilege($2, c.oid, 'SELECT') AS sel,
              has_table_privilege($2, c.oid, 'INSERT') AS ins,
              has_table_privilege($2, c.oid, 'UPDATE') AS upd,
              has_table_privilege($2, c.oid, 'DELETE') AS del,
              has_table_privilege($2, c.oid, 'TRUNCATE') AS trunc,
              has_table_privilege($2, c.oid, 'REFERENCES') AS refs,
              has_table_privilege($2, c.oid, 'TRIGGER') AS trig
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`,
      [SCHEMA, ROLES.runtime],
    );
    expect(rows.length).toBeGreaterThanOrEqual(Object.keys(ENTITY_TABLES).length);
    const names = rows.map((row) => row.table_name);
    expect(names).toContain(ENTITY_TABLES.tasks);
    expect(names).toContain(ENTITY_TABLES.taskEvents);
    for (const row of rows) {
      const expected = runtimeTablePrivileges(row.table_name);
      expect(row, `privileges on ${row.table_name}`).toEqual({
        table_name: row.table_name,
        sel: expected.includes("SELECT"),
        ins: expected.includes("INSERT"),
        upd: expected.includes("UPDATE"),
        del: expected.includes("DELETE"),
        trunc: false,
        refs: false,
        trig: false,
      });
    }
  });

  it("AC2: app_runtime holds no column-level UPDATE on task_events", async () => {
    const { rows } = await db().admin.query<{ attname: string }>(
      `SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege($2, a.attrelid, a.attnum, 'UPDATE')`,
      [`${SCHEMA}.${ENTITY_TABLES.taskEvents}`, ROLES.runtime],
    );
    expect(rows).toEqual([]);
  });

  it("AC2: app_runtime has USAGE on schema app and on every app sequence, but not CREATE", async () => {
    const schema = await db().admin.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege($2, $1, 'USAGE') AS usage, has_schema_privilege($2, $1, 'CREATE') AS create`,
      [SCHEMA, ROLES.runtime],
    );
    expect(schema.rows[0]).toEqual({ usage: true, create: false });

    const sequences = await db().admin.query<{ relname: string; usage: boolean }>(
      `SELECT c.relname, has_sequence_privilege($2, c.oid, 'USAGE') AS usage
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'S'`,
      [SCHEMA, ROLES.runtime],
    );
    for (const row of sequences.rows) {
      expect(row.usage, `USAGE on sequence ${row.relname}`).toBe(true);
    }
  });

  it("AC2: app_runtime can read and write through its grants", async () => {
    const result = await runtime.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.${ENTITY_TABLES.people}`);
    expect(result.rows[0].n).toBe(0);
  });
});
