import { randomBytes } from "node:crypto";
/** Task 5.1 / D-H: upgrading populated PAT-era projects leaves them unlinked. */
import { expect, it } from "vitest";

import {
  ENTITY_TABLES,
  GITHUB_BINDING_COLUMNS,
  RETIRED_GITHUB_TOKEN_COLUMNS,
  SCHEMA,
  columnNames,
  createPerson, createProject,
  insertRow,
} from "./support/fixtures";
import { dbDescribe, expectIntegrityRejection, expectPrivilegeRejection, useMigratedDatabase } from "./support/harness";

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

// Concrete setup/snapshot migration constraints. These run only against the
// harness's isolated disposable PostgreSQL database, never a Supabase instance.
dbDescribe("GitHub setup attempt and repository snapshot integrity (task 5.3)", () => {
  const db = useMigratedDatabase();
  async function attempt(overrides: Record<string, unknown> = {}) {
    return insertRow(db().admin, "github_repository_setup_attempts", {
      project_id: await createProject(db().admin), person_id: await createPerson(db().admin),
      expected_github_user_id: 424242, state_hash: randomBytes(32),
      status: "setup_pending", created_at: "2026-11-03T00:00:00Z", expires_at: "2026-11-03T00:10:00Z", ...overrides,
    });
  }
  async function snapshot() {
    const a = await attempt({ status: "verified", installation_id: 123 });
    return insertRow(db().admin, "github_repository_snapshots", {
      attempt_id: a.id, project_id: a.project_id, person_id: a.person_id, installation_id: 123,
      created_at: "2026-11-03T00:00:00Z", expires_at: "2026-11-03T00:10:00Z",
    });
  }
  it("stores state hashes and safe repository metadata without credential columns", async () => {
    for (const table of ["github_repository_setup_attempts", "github_repository_snapshots", "github_repository_snapshot_repositories"]) {
      const columns = await columnNames(db().admin, table);
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.filter((column) => /token|secret|private_key/i.test(column))).toEqual([]);
    }
    expect((await attempt()).state_hash).toHaveLength(32);
  });
  it("rejects duplicate states, nonpositive identities, malformed hashes and invalid expiries", async () => {
    const a = await attempt();
    await expectIntegrityRejection(attempt({ state_hash: a.state_hash }));
    await expectIntegrityRejection(attempt({ expected_github_user_id: 0 }));
    await expectIntegrityRejection(attempt({ state_hash: Buffer.alloc(31) }));
    await expectIntegrityRejection(attempt({ status: "unknown" }));
    await expectIntegrityRejection(attempt({ installation_id: -1 }));
    await expectIntegrityRejection(attempt({ expires_at: "2026-11-03T00:00:00Z" }));
  });
  it("allows one snapshot per attempt and requires positive installation IDs and expiry", async () => {
    const s = await snapshot();
    const base = { attempt_id: s.attempt_id, project_id: s.project_id, person_id: s.person_id,
      installation_id: 123, created_at: s.created_at, expires_at: s.expires_at };
    await expectIntegrityRejection(insertRow(db().admin, "github_repository_snapshots", base));
    await expectIntegrityRejection(insertRow(db().admin, "github_repository_snapshots", { ...base, attempt_id: (await attempt()).id, installation_id: 0 }));
    await expectIntegrityRejection(insertRow(db().admin, "github_repository_snapshots", { ...base, attempt_id: (await attempt()).id, expires_at: s.created_at }));
  });
  it("requires unique repository IDs and positions, valid IDs and nonempty coordinates", async () => {
    const s = await snapshot();
    const base = { snapshot_id: s.id, repository_id: 456, owner: "synthetic-owner", name: "synthetic-repository", is_private: true, default_branch: "main", position: 0 };
    await insertRow(db().admin, "github_repository_snapshot_repositories", base);
    for (const patch of [{ position: 1 }, { repository_id: 457 }, { repository_id: 0, position: 1 },
      { repository_id: 458, position: -1 }, { repository_id: 459, position: 2, owner: "" }, { repository_id: 460, position: 3, name: "" }]) {
      await expectIntegrityRejection(insertRow(db().admin, "github_repository_snapshot_repositories", { ...base, ...patch }));
    }
  });
  it("grants app_runtime row access without table administration privileges", async () => {
    const runtime = await db().connectAsRuntime();
    for (const table of ["github_repository_setup_attempts", "github_repository_snapshots", "github_repository_snapshot_repositories"]) {
      for (const privilege of table === "github_repository_setup_attempts" ? ["SELECT", "INSERT", "UPDATE"] : ["SELECT", "INSERT"]) {
        const { rows } = await runtime.query<{ allowed: boolean }>(
          "SELECT has_table_privilege(current_user, $1, $2) AS allowed", [`app.${table}`, privilege],
        );
        expect(rows[0].allowed, `app_runtime ${privilege} on app.${table}`).toBe(true);
      }
      for (const privilege of table === "github_repository_setup_attempts" ? ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] : ["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const { rows } = await runtime.query<{ allowed: boolean }>(
          "SELECT has_table_privilege(current_user, $1, $2) AS allowed", [`app.${table}`, privilege],
        );
        expect(rows[0].allowed, `app_runtime must lack ${privilege} on app.${table}`).toBe(false);
      }
      await expect(runtime.query(`SELECT * FROM app.${table} LIMIT 1`)).resolves.toHaveProperty("rows");
    }
  });
  it("denies Supabase Data API roles access to setup and snapshot data", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db().admin.query(`SET ROLE ${role}`);
      try { await expectPrivilegeRejection(db().admin.query("SELECT * FROM app.github_repository_setup_attempts")); }
      finally { await db().admin.query("RESET ROLE"); }
    }
  });
});
