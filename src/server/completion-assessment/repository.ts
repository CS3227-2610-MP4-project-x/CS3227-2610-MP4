import "server-only";

import type { CheckResultPayload } from "./service";

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

export type CheckCacheKey = Readonly<{
  taskId: string;
  commitSetHash: string;
  criteriaHash: string;
  pathRulesHash: string;
}>;
export type StoredCheckResult = Readonly<{
  id: string;
  anchorSha: string;
  createdAt: string;
  redacted: boolean;
  payload: CheckResultPayload;
}>;
export type CheckHistoryEntry = StoredCheckResult;
export type SaveCheckInput = CheckCacheKey & Readonly<{
  payload: CheckResultPayload;
  model: string;
  redacted: boolean;
}>;

type CheckRow = Record<string, unknown> & {
  id: string;
  created_at: Date | string;
  redacted: boolean;
  result: unknown;
};

function checkFromRow(row: CheckRow): StoredCheckResult {
  const payload = typeof row.result === "string" ? JSON.parse(row.result) as CheckResultPayload : row.result as CheckResultPayload;
  return { id: String(row.id), anchorSha: payload.anchorSha,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    redacted: Boolean(row.redacted), payload };
}

export class CompletionAssessmentRepository {
  constructor(private readonly database: Query) {}

  async findReusable(key: CheckCacheKey): Promise<StoredCheckResult | null> {
    const result = await this.database.query<CheckRow>(
      `SELECT id::text AS id, created_at, redacted, result
         FROM app.check_results
        WHERE task_id = $1::uuid AND commit_set_hash = $2 AND criteria_hash = $3 AND path_rules_hash = $4`,
      [key.taskId, key.commitSetHash, key.criteriaHash, key.pathRulesHash],
    );
    return result.rows[0] ? checkFromRow(result.rows[0]) : null;
  }

  async listHistory(taskId: string): Promise<readonly CheckHistoryEntry[]> {
    const result = await this.database.query<CheckRow>(
      `SELECT id::text AS id, created_at, redacted, result
         FROM app.check_results
        WHERE task_id = $1::uuid
        ORDER BY created_at DESC, id DESC`,
      [taskId],
    );
    return result.rows.map(checkFromRow);
  }

  async save(input: SaveCheckInput): Promise<{ check: StoredCheckResult; created: boolean }> {
    const inserted = await this.database.query<CheckRow>(
      `INSERT INTO app.check_results (task_id, commit_set_hash, criteria_hash, path_rules_hash, model, redacted, result)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (task_id, commit_set_hash, criteria_hash, path_rules_hash) WHERE path_rules_hash IS NOT NULL DO NOTHING
       RETURNING id::text AS id, created_at, redacted, result`,
      [input.taskId, input.commitSetHash, input.criteriaHash, input.pathRulesHash, input.model, input.redacted,
        JSON.stringify(input.payload)],
    );
    if (inserted.rows[0]) return { check: checkFromRow(inserted.rows[0]), created: true };
    const existing = await this.findReusable(input);
    if (!existing) throw new Error("Unable to resolve check result conflict.");
    return { check: existing, created: false };
  }
}
