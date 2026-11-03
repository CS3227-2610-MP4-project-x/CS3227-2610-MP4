/** Task 5.1 / D-H: upgrading populated PAT-era projects leaves them unlinked. */
import { expect, it } from "vitest";

import {
  ENTITY_TABLES,
  GITHUB_BINDING_COLUMNS,
  RETIRED_GITHUB_TOKEN_COLUMNS,
  SCHEMA,
  columnNames,
  insertRow,
} from "./support/fixtures";
import { dbDescribe, useMigratedDatabase } from "./support/harness";

const LEGACY_SCHEMA_MIGRATION = "20261030144500_create_app_schema.sql";
const PROJECTS = `${SCHEMA}.${ENTITY_TABLES.projects}`;

dbDescribe("GitHub App binding migration upgrades populated legacy projects (D-H)", () => {
  const legacyProjects: { id: string; key: string; name: string; last_task_number: number; created_at: Date }[] = [];
  const db = useMigratedDatabase({
    async afterMigration(file, admin) {
      if (file !== LEGACY_SCHEMA_MIGRATION) return;

      // Both forms are valid in the shipped schema: coordinates with and without a PAT.
      for (const [index, hasPat] of [true, false].entries()) {
        const row = await insertRow(admin, ENTITY_TABLES.projects, {
          key: `LEGACY${index}`,
          name: `Synthetic legacy project ${index}`,
          last_task_number: 7 + index,
          created_at: "2026-10-30T10:00:00Z",
          github_repository_owner: "synthetic-legacy-owner",
          github_repository_name: `synthetic-legacy-repository-${index}`,
          ...(hasPat ? {
            github_token_key_version: 1,
            github_token_iv: Buffer.alloc(12, 1),
            github_token_ciphertext: Buffer.from("synthetic-ciphertext"),
            github_token_auth_tag: Buffer.alloc(16, 2),
          } : {}),
        });
        legacyProjects.push({
          id: row.id as string,
          key: row.key as string,
          name: row.name as string,
          last_task_number: row.last_task_number as number,
          created_at: row.created_at as Date,
        });
      }
    },
  });

  it("preserves each legacy project and unrelated project data while clearing its binding", async () => {
    expect(legacyProjects).toHaveLength(2);
    expect(db().migrationFiles.indexOf(LEGACY_SCHEMA_MIGRATION)).toBeLessThan(db().migrationFiles.length - 1);

    for (const legacy of legacyProjects) {
      const { rows } = await db().admin.query(
        `SELECT id, key, name, last_task_number, created_at,
                ${GITHUB_BINDING_COLUMNS.join(", ")}
           FROM ${PROJECTS} WHERE id = $1`,
        [legacy.id],
      );
      expect(rows).toEqual([{
        ...legacy,
        github_installation_id: null,
        github_repository_id: null,
        github_repository_owner: null,
        github_repository_name: null,
      }]);
    }
  });

  it("removes retired PAT fields after upgrading projects that contained ciphertext", async () => {
    const columns = await columnNames(db().admin, ENTITY_TABLES.projects);
    for (const column of RETIRED_GITHUB_TOKEN_COLUMNS) {
      expect(columns, `retired projects.${column}`).not.toContain(column);
    }
  });
});
