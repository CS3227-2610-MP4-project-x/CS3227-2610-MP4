/**
 * D-H / task 5.1: stored records exclude secrets and AI content; repository bindings
 * contain installation/repository IDs and owner/name together, with positive IDs.
 */
import type pg from "pg";
import { beforeAll, expect, it } from "vitest";

import {
  ENTITY_TABLES,
  GITHUB_BINDING_COLUMNS,
  RETIRED_GITHUB_TOKEN_COLUMNS,
  SCHEMA,
  columnNames,
  createProject,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, useMigratedDatabase } from "./support/harness";

const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;
type RepositoryBinding = Record<(typeof GITHUB_BINDING_COLUMNS)[number], string | null>;

function syntheticBinding(overrides: Partial<RepositoryBinding> = {}): RepositoryBinding {
  return {
    github_installation_id: "12345",
    github_repository_id: "67890",
    github_repository_owner: "synthetic-owner",
    github_repository_name: "synthetic-repository",
    ...overrides,
  };
}

// Singular token matches credential fields, while allowing usage token counts.
const SECRET_COLUMN_NAME = /(^|_)(token|credential|credentials|secret|password|pat|api_key|private_key)(_|$)/;
const AI_CONTENT_NAME = /(prompt|response|completion|content|message|body|diff|text|input_text|output_text)/;

// Every nonempty, incomplete subset of the four binding fields.
const INCOMPLETE_BINDINGS = Array.from({ length: 14 }, (_, index) => {
  const mask = index + 1;
  const full = syntheticBinding();
  return {
    label: GITHUB_BINDING_COLUMNS.filter((_, bit) => mask & (1 << bit)).join(", "),
    values: Object.fromEntries(
      GITHUB_BINDING_COLUMNS.map((column, bit) => [column, mask & (1 << bit) ? full[column] : null]),
    ) as RepositoryBinding,
  };
});

function emptyBinding(): RepositoryBinding {
  return Object.fromEntries(GITHUB_BINDING_COLUMNS.map((column) => [column, null])) as RepositoryBinding;
}

dbDescribe("GitHub App bindings persist identifiers without credentials (D-H)", () => {
  const db = useMigratedDatabase();

  it("replaces retired PAT storage with installation and repository binding fields", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.projects);
    for (const column of RETIRED_GITHUB_TOKEN_COLUMNS) {
      expect(columns, `retired projects.${column}`).not.toContain(column);
    }
    for (const column of GITHUB_BINDING_COLUMNS) {
      expect(columns, `projects.${column}`).toContain(column);
    }
  });

  it("has no credential storage columns anywhere in schema app", async () => {
    const { rows } = await db().admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1`,
      [SCHEMA],
    );
    expect(rows.filter((row) => SECRET_COLUMN_NAME.test(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`)).toEqual([]);
  });

  it("has no prompt or response content column in usage_records", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.usageRecords);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((column) => AI_CONTENT_NAME.test(column))).toEqual([]);
  });
});

dbDescribe("repository binding completeness and positive identifiers (D-H)", () => {
  const db = useMigratedDatabase();
  let runtime: pg.Client;

  beforeAll(async () => {
    runtime = await db().connectAsRuntime();
  });

  function storeBinding(projectId: string, binding: RepositoryBinding) {
    return runtime.query(
      `UPDATE ${PROJECTS}
          SET github_installation_id = $2, github_repository_id = $3,
              github_repository_owner = $4, github_repository_name = $5
        WHERE id = $1`,
      [projectId, ...GITHUB_BINDING_COLUMNS.map((column) => binding[column])],
    );
  }

  async function readBinding(projectId: string): Promise<RepositoryBinding> {
    const { rows } = await runtime.query<RepositoryBinding>(
      `SELECT ${GITHUB_BINDING_COLUMNS.join(", ")} FROM ${PROJECTS} WHERE id = $1`,
      [projectId],
    );
    return rows[0];
  }

  it("starts unlinked and round-trips a complete binding on update", async () => {
    const project = await createProject(runtime);
    expect(await readBinding(project.id)).toEqual(emptyBinding());
    const binding = syntheticBinding();
    expect((await storeBinding(project.id, binding)).rowCount).toBe(1);
    expect(await readBinding(project.id)).toEqual(binding);
  });

  it("accepts a complete binding on insert and clearing all fields on update", async () => {
    const project = await createProject(runtime, syntheticBinding());
    expect(await readBinding(project.id)).toEqual(syntheticBinding());
    expect((await storeBinding(project.id, emptyBinding())).rowCount).toBe(1);
    expect(await readBinding(project.id)).toEqual(emptyBinding());
  });

  it("allows multiple projects to reuse one installation and repository", async () => {
    const binding = syntheticBinding();
    const first = await createProject(runtime, binding);
    const second = await createProject(runtime, binding);
    expect(first.id).not.toBe(second.id);
    expect(await readBinding(first.id)).toEqual(binding);
    expect(await readBinding(second.id)).toEqual(binding);
  });

  it.each(INCOMPLETE_BINDINGS)("rejects an insert with only $label present", async ({ values }) => {
    await expectIntegrityRejection(createProject(runtime, values));
  });

  it.each(INCOMPLETE_BINDINGS)("rejects an update with only $label present", async ({ values }) => {
    const binding = syntheticBinding();
    const project = await createProject(runtime, binding);
    await expectIntegrityRejection(storeBinding(project.id, values));
    expect(await readBinding(project.id)).toEqual(binding);
  });

  it.each([
    ["github_installation_id", "0"],
    ["github_installation_id", "-1"],
    ["github_repository_id", "0"],
    ["github_repository_id", "-1"],
  ] as const)("rejects non-positive %s=%s on insert and update", async (column, value) => {
    const invalid = syntheticBinding({ [column]: value });
    await expectIntegrityRejection(createProject(runtime, invalid));
    const binding = syntheticBinding();
    const project = await createProject(runtime, binding);
    await expectIntegrityRejection(storeBinding(project.id, invalid));
    expect(await readBinding(project.id)).toEqual(binding);
  });

  it("accepts the smallest positive installation and repository IDs", async () => {
    const binding = syntheticBinding({ github_installation_id: "1", github_repository_id: "1" });
    const project = await createProject(runtime, binding);
    expect(await readBinding(project.id)).toEqual(binding);
    expect((await storeBinding(project.id, binding)).rowCount).toBe(1);
  });
});
