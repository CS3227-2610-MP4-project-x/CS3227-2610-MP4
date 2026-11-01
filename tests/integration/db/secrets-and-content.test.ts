/**
 * Requirement "Stored records exclude secrets and AI content" (D-H).
 * AC12: "Credential at rest": the repository credential is held only as key version, IV,
 * ciphertext and authentication tag; no column holds it in plaintext. Usage records have
 * no prompt or response content column.
 * The four encrypted parts are set together or not at all, with a 12-byte (96-bit) IV and a
 * 16-byte (128-bit) authentication tag (D-H; reviewer test-adequacy gap).
 */
import { randomBytes } from "node:crypto";

import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import { ENCRYPTED_TOKEN_COLUMNS, ENTITY_TABLES, SCHEMA, columnNames, createProject } from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;

type EncryptedToken = Record<(typeof ENCRYPTED_TOKEN_COLUMNS)[number], number | Buffer | null>;

/** Synthetic AES-256-GCM parts: random bytes only, never a real token or key. */
function syntheticEncryptedToken(overrides: Partial<EncryptedToken> = {}): EncryptedToken {
  return {
    github_token_key_version: 1,
    github_token_iv: randomBytes(12),
    github_token_ciphertext: randomBytes(40),
    github_token_auth_tag: randomBytes(16),
    ...overrides,
  };
}

/** Column names that would suggest a plaintext secret (e.g. github_token, access_token, password). */
const PLAINTEXT_SECRET_NAME = /(^|_)(token|access_token|credential|credentials|secret|password|pat|api_key)$/;

/** Column names that would suggest stored prompt or response content. */
const AI_CONTENT_NAME = /(prompt|response|completion|content|message|body|diff|text|input_text|output_text)/;

dbDescribe("no plaintext secrets or AI content are stored (AC12)", () => {
  const db = useMigratedDatabase();

  it("stores the repository credential as key version, IV, ciphertext and auth tag", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.projects);
    for (const column of ENCRYPTED_TOKEN_COLUMNS) {
      expect(columns, `projects.${column}`).toContain(column);
    }
  });

  it("Credential at rest: no column in schema app is named like a plaintext credential", async () => {
    const { rows } = await db().admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1`,
      [SCHEMA],
    );
    const suspicious = rows
      .filter((row) => PLAINTEXT_SECRET_NAME.test(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`);
    expect(suspicious).toEqual([]);
  });

  it("keeps every credential-related column in projects to the four encrypted parts", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.projects);
    const credentialColumns = columns.filter((column) => /token|credential|secret/.test(column));
    expect(credentialColumns.sort()).toEqual([...ENCRYPTED_TOKEN_COLUMNS].sort());
  });

  it("has no prompt or response content column in usage_records", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.usageRecords);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((column) => AI_CONTENT_NAME.test(column))).toEqual([]);
  });
});

dbDescribe("encrypted repository credential parts are complete and well-sized (D-H)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  function storeToken(projectId: string, token: EncryptedToken) {
    return runtime.query(
      `UPDATE ${PROJECTS}
          SET github_token_key_version = $2, github_token_iv = $3,
              github_token_ciphertext = $4, github_token_auth_tag = $5
        WHERE id = $1`,
      [
        projectId,
        token.github_token_key_version,
        token.github_token_iv,
        token.github_token_ciphertext,
        token.github_token_auth_tag,
      ],
    );
  }

  it("starts with no credential and accepts all four parts set together (control)", async () => {
    const project = await createProject(runtime);
    const { rows } = await runtime.query(
      `SELECT num_nulls(${ENCRYPTED_TOKEN_COLUMNS.join(", ")}) AS missing FROM ${PROJECTS} WHERE id = $1`,
      [project.id],
    );
    expect(rows[0].missing).toBe(ENCRYPTED_TOKEN_COLUMNS.length);

    const result = await storeToken(project.id, syntheticEncryptedToken());
    expect(result.rowCount).toBe(1);
  });

  it("accepts removing the credential by clearing all four parts (control)", async () => {
    const project = await createProject(runtime);
    await storeToken(project.id, syntheticEncryptedToken());
    const cleared = await storeToken(project.id, {
      github_token_key_version: null,
      github_token_iv: null,
      github_token_ciphertext: null,
      github_token_auth_tag: null,
    });
    expect(cleared.rowCount).toBe(1);
  });

  it.each(ENCRYPTED_TOKEN_COLUMNS.map((column) => [column]))(
    "rejects a credential with %s missing while the other parts are set",
    async (column) => {
      const project = await createProject(runtime);
      await expectIntegrityRejection(storeToken(project.id, syntheticEncryptedToken({ [column]: null })));
    },
  );

  it.each(ENCRYPTED_TOKEN_COLUMNS.map((column) => [column]))(
    "rejects a credential with only %s set",
    async (column) => {
      const project = await createProject(runtime);
      const full = syntheticEncryptedToken();
      const onlyOne = Object.fromEntries(
        ENCRYPTED_TOKEN_COLUMNS.map((name) => [name, name === column ? full[name] : null]),
      ) as EncryptedToken;
      await expectIntegrityRejection(storeToken(project.id, onlyOne));
    },
  );

  it.each([0, 11, 13, 16])("rejects an IV of %i bytes (must be 12)", async (length) => {
    const project = await createProject(runtime);
    await expectIntegrityRejection(storeToken(project.id, syntheticEncryptedToken({ github_token_iv: randomBytes(length) })));
  });

  it.each([0, 12, 15, 17])("rejects an authentication tag of %i bytes (must be 16)", async (length) => {
    const project = await createProject(runtime);
    await expectIntegrityRejection(
      storeToken(project.id, syntheticEncryptedToken({ github_token_auth_tag: randomBytes(length) })),
    );
  });

  it("rejects a credential on project insert when a part is missing", async () => {
    const token = syntheticEncryptedToken({ github_token_auth_tag: null });
    await expectIntegrityRejection(createProject(runtime, token));
  });
});
