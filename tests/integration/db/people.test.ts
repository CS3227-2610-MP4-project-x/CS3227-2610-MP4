/**
 * Design D-I (AC16): `people` has its own UUID, a unique `auth_user_id` with no foreign key
 * into the `auth` schema, a unique GitHub user ID, and a GitHub username refreshed on sign-in.
 * Developer A (identity and access) cross-reviews this file.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import { ENTITY_TABLES, SCHEMA, columnNames, createPerson } from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const PEOPLE = `${SCHEMA}.${ENTITY_TABLES.people}`;

dbDescribe("people identity columns (AC16)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  it("has auth_user_id, github_user_id and github_username columns", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.people);
    expect(columns).toEqual(expect.arrayContaining(["id", "auth_user_id", "github_user_id", "github_username"]));
  });

  it("gives each person its own generated UUID, distinct from the Supabase Auth user ID", async () => {
    const authUserId = randomUUID();
    const id = await createPerson(runtime, { auth_user_id: authUserId });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toBe(authUserId);
  });

  it("rejects a second person with the same auth_user_id", async () => {
    const authUserId = randomUUID();
    await createPerson(runtime, { auth_user_id: authUserId });
    await expectIntegrityRejection(createPerson(runtime, { auth_user_id: authUserId }));
  });

  it("rejects a second person with the same GitHub user ID", async () => {
    await createPerson(runtime, { github_user_id: "424242" });
    await expectIntegrityRejection(createPerson(runtime, { github_user_id: "424242" }));
  });

  it.each(["auth_user_id", "github_user_id", "github_username"])("requires %s", async (column) => {
    await expectIntegrityRejection(createPerson(runtime, { [column]: null }));
  });

  it("refreshes the GitHub username in place on a later sign-in", async () => {
    const id = await createPerson(runtime);
    const result = await runtime.query(
      `UPDATE ${PEOPLE} SET github_username = $2, version = version + 1 WHERE id = $1 RETURNING github_username`,
      [id, "synthetic-renamed-user"],
    );
    expect(result.rows).toEqual([{ github_username: "synthetic-renamed-user" }]);
  });

  it("has no foreign key from people to a table outside schema app (no FK into auth)", async () => {
    const { rows } = await db().admin.query<{ conname: string; target_schema: string }>(
      `SELECT k.conname, tn.nspname AS target_schema
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class t ON t.oid = k.confrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace
        WHERE k.contype = 'f' AND n.nspname = $1 AND c.relname = $2`,
      [SCHEMA, ENTITY_TABLES.people],
    );
    expect(rows.filter((row) => row.target_schema !== SCHEMA)).toEqual([]);
  });

  it("has no foreign key anywhere in schema app that points into an auth schema", async () => {
    const { rows } = await db().admin.query(
      `SELECT k.conname
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class t ON t.oid = k.confrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace
        WHERE k.contype = 'f' AND n.nspname = $1 AND tn.nspname = 'auth'`,
      [SCHEMA],
    );
    expect(rows).toEqual([]);
  });
});
