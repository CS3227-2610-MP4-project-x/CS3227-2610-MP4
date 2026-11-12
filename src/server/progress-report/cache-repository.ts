import "server-only";

import type { ReportStatement } from "./output";
import type { ReportQueryPool } from "./repository";
import { readReportDatabaseFingerprint } from "./database-fingerprint";
import type { ReportRange } from "./types";

export type ReportCacheKey = Readonly<{
  projectId: string;
  rangeStart: string;
  rangeEnd: string;
  inputFingerprint: string;
  generationContractVersion: string;
  providerModel: string;
  redactionReplacementCount: number;
}>;
export type StoredProgressReport = Readonly<{
  id: string;
  projectId: string;
  rangeStart: string;
  rangeEnd: string;
  statements: readonly ReportStatement[];
  model: string;
  createdAt: string;
  githubUnavailable: boolean;
  version: number;
  inputFingerprint: string | null;
  generationContractVersion: string | null;
  providerModel: string | null;
  redactionReplacementCount: number | null;
}>;
export type ReportCacheRepository = Readonly<{
  read(input: { projectId: string; rangeStart: string; rangeEnd: string }): Promise<StoredProgressReport | null>;
  publish(input: {
    key: ReportCacheKey;
    statements: readonly ReportStatement[];
    model: string;
    githubUnavailable: boolean;
    latestActivityAt: string;
    expectedVersion: number | null;
    personId: string;
    range?: ReportRange;
    expectedDatabaseFingerprint?: string;
  }): Promise<{ kind: "stored" | "winner"; report: StoredProgressReport } | { kind: "conflict" }>;
}>;

type Row = Record<string, unknown> & {
  id: string; project_id: string; range_start: unknown; range_end: unknown; model: string; statements: unknown;
  github_evidence_unavailable: boolean; version: number; created_at: unknown;
  input_fingerprint: string | null; generation_contract_version: string | null; provider_model: string | null;
  redaction_replacement_count: number | null;
};
type Query = Readonly<{ query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }> }>;
type Connection = Query & Readonly<{ release(): void }>;
const SELECT_COLUMNS = `id::text AS id, project_id::text AS project_id,
  to_char(range_start, 'YYYY-MM-DD') AS range_start, to_char(range_end, 'YYYY-MM-DD') AS range_end,
  model, statements, github_evidence_unavailable, version, created_at,
  input_fingerprint, generation_contract_version, provider_model, redaction_replacement_count`;

function date(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function instant(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function parseStatements(value: unknown): readonly ReportStatement[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("Invalid report statements");
  return parsed as readonly ReportStatement[];
}
function fromRow(row: Row): StoredProgressReport {
  return {
    id: String(row.id), projectId: String(row.project_id), rangeStart: date(row.range_start), rangeEnd: date(row.range_end),
    statements: parseStatements(row.statements), model: String(row.model), createdAt: instant(row.created_at),
    githubUnavailable: Boolean(row.github_evidence_unavailable), version: Number(row.version),
    inputFingerprint: row.input_fingerprint === null ? null : String(row.input_fingerprint),
    generationContractVersion: row.generation_contract_version === null ? null : String(row.generation_contract_version),
    providerModel: row.provider_model === null ? null : String(row.provider_model),
    redactionReplacementCount: row.redaction_replacement_count === null ? null : Number(row.redaction_replacement_count),
  };
}
function sameKey(report: StoredProgressReport, key: ReportCacheKey): boolean {
  return report.redactionReplacementCount !== null &&
    report.redactionReplacementCount === key.redactionReplacementCount &&
    report.inputFingerprint === key.inputFingerprint && report.generationContractVersion === key.generationContractVersion && report.providerModel === key.providerModel;
}
function reusableWinner(report: StoredProgressReport, key: ReportCacheKey): boolean {
  return sameKey(report, key) && !report.githubUnavailable;
}
function coded(code: "FORBIDDEN" | "NOT_FOUND"): Error { return Object.assign(new Error(code), { code }); }

export function createReportCacheRepository(pool: ReportQueryPool): ReportCacheRepository {
  return {
    async read(input) {
      const result = await pool.connect();
      try {
        const found = await result.query<Row>(`SELECT ${SELECT_COLUMNS} FROM app.reports WHERE project_id = $1::uuid AND range_start = $2::date AND range_end = $3::date`, [input.projectId, input.rangeStart, input.rangeEnd]);
        return found.rows[0] ? fromRow(found.rows[0]) : null;
      } finally { result.release(); }
    },
    async publish(input) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        try {
          const access = await connection.query<{ role: string }>(
            `SELECT m.role FROM app.projects p JOIN app.memberships m ON m.project_id = p.id
              WHERE p.id = $1::uuid AND m.person_id = $2::uuid FOR SHARE OF m`, [input.key.projectId, input.personId]);
          if (!access.rows.length) {
            const exists = await connection.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM app.projects WHERE id = $1::uuid) AS exists", [input.key.projectId]);
            if (!exists.rows[0]?.exists) throw coded("NOT_FOUND");
            throw coded("NOT_FOUND");
          }
          if (access.rows[0].role !== "product_manager") throw coded("FORBIDDEN");

          const existing = await connection.query<Row>(
            `SELECT ${SELECT_COLUMNS} FROM app.reports WHERE project_id = $1::uuid AND range_start = $2::date AND range_end = $3::date FOR UPDATE`,
            [input.key.projectId, input.key.rangeStart, input.key.rangeEnd]);
          const row = existing.rows[0];
          if (input.range && input.expectedDatabaseFingerprint) {
            const currentFingerprint = await readReportDatabaseFingerprint(connection, input.key.projectId, input.range);
            if (currentFingerprint !== input.expectedDatabaseFingerprint) {
              await connection.query("COMMIT");
              return { kind: "conflict" };
            }
          }
          if (row) {
            const current = fromRow(row);
            if (reusableWinner(current, input.key)) {
              await connection.query("COMMIT");
              return { kind: "winner", report: current };
            }
            if (input.expectedVersion === null || current.version !== input.expectedVersion) {
              await connection.query("COMMIT");
              return { kind: "conflict" };
            }
            const updated = await connection.query<Row>(
              `UPDATE app.reports SET model = $2, latest_activity_at = $3::timestamptz, statements = $4::jsonb,
                 github_evidence_unavailable = $5, input_fingerprint = $6, generation_contract_version = $7,
                 provider_model = $8, redaction_replacement_count = $9 WHERE id = $1::uuid AND version = $10 RETURNING ${SELECT_COLUMNS}`,
              [current.id, input.model, input.latestActivityAt, JSON.stringify(input.statements), input.githubUnavailable,
                input.key.inputFingerprint, input.key.generationContractVersion, input.key.providerModel,
                input.key.redactionReplacementCount, input.expectedVersion]);
            await connection.query("COMMIT");
            return updated.rows[0] ? { kind: "stored", report: fromRow(updated.rows[0]) } : { kind: "conflict" };
          }
          if (input.expectedVersion !== null) {
            await connection.query("COMMIT");
            return { kind: "conflict" };
          }
          const inserted = await connection.query<Row>(
            `INSERT INTO app.reports (project_id, range_start, range_end, model, latest_activity_at, statements,
                github_evidence_unavailable, input_fingerprint, generation_contract_version, provider_model, redaction_replacement_count)
             VALUES ($1::uuid, $2::date, $3::date, $4, $5::timestamptz, $6::jsonb, $7, $8, $9, $10, $11)
             ON CONFLICT (project_id, range_start, range_end) DO NOTHING RETURNING ${SELECT_COLUMNS}`,
            [input.key.projectId, input.key.rangeStart, input.key.rangeEnd, input.model, input.latestActivityAt,
              JSON.stringify(input.statements), input.githubUnavailable, input.key.inputFingerprint,
              input.key.generationContractVersion, input.key.providerModel, input.key.redactionReplacementCount]);
          if (inserted.rows[0]) {
            if (input.range && input.expectedDatabaseFingerprint) {
              const currentFingerprint = await readReportDatabaseFingerprint(connection, input.key.projectId, input.range);
              if (currentFingerprint !== input.expectedDatabaseFingerprint) {
                await connection.query("ROLLBACK");
                return { kind: "conflict" };
              }
            }
            await connection.query("COMMIT");
            return { kind: "stored", report: fromRow(inserted.rows[0]) };
          }
          if (input.range && input.expectedDatabaseFingerprint) {
            const currentFingerprint = await readReportDatabaseFingerprint(connection, input.key.projectId, input.range);
            if (currentFingerprint !== input.expectedDatabaseFingerprint) {
              await connection.query("ROLLBACK");
              return { kind: "conflict" };
            }
          }
          const winner = await connection.query<Row>(
            `SELECT ${SELECT_COLUMNS} FROM app.reports WHERE project_id = $1::uuid AND range_start = $2::date AND range_end = $3::date`,
            [input.key.projectId, input.key.rangeStart, input.key.rangeEnd]);
          await connection.query("COMMIT");
          if (winner.rows[0] && reusableWinner(fromRow(winner.rows[0]), input.key)) return { kind: "winner", report: fromRow(winner.rows[0]) };
          return { kind: "conflict" };
        } catch (error) {
          await connection.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      } finally { connection.release(); }
    },
  };
}
