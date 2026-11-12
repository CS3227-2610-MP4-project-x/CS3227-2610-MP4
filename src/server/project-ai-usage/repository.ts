import "server-only";

import type { ProjectAiUsageRepository, ProjectAiUsageRow, ProjectAiUsageReadInput } from "./types";

export interface ProjectAiUsageQueryExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<Readonly<{ rows: readonly Row[] }>>;
}

type AggregateRecord = Readonly<{
  date: string;
  feature: "acceptance_check" | "progress_report";
  charged_tokens: string | number;
  pending_reserved_tokens: string | number;
  cache_hits: string | number;
}>;

const READ_DAILY = `
  SELECT (created_at AT TIME ZONE 'Asia/Singapore')::date::text AS date,
         feature,
         COALESCE(SUM(CASE WHEN outcome <> 'pending' AND outcome <> 'cached' AND cached = false
                           THEN charged_tokens ELSE 0 END), 0)::text AS charged_tokens,
         COALESCE(SUM(CASE WHEN outcome = 'pending' AND cached = false
                           THEN reserved_tokens ELSE 0 END), 0)::text AS pending_reserved_tokens,
         COUNT(*) FILTER (WHERE cached = true)::text AS cache_hits
    FROM app.usage_records
   WHERE project_id = $1::uuid
     AND environment = $2
     AND created_at >= $3::timestamptz
     AND created_at < $4::timestamptz
     AND feature IN ('acceptance_check', 'progress_report')
   GROUP BY (created_at AT TIME ZONE 'Asia/Singapore')::date, feature`;

function integer(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Usage aggregate is outside the supported range.");
  return parsed;
}

export function createProjectAiUsageRepository(executor: ProjectAiUsageQueryExecutor): ProjectAiUsageRepository {
  return {
    async readDaily(input: ProjectAiUsageReadInput): Promise<readonly ProjectAiUsageRow[]> {
      const result = await executor.query<AggregateRecord>(READ_DAILY, [
        input.projectId,
        input.environment,
        input.startUtc,
        input.endUtcExclusive,
      ]);
      return result.rows.map((row) => ({
        date: row.date,
        feature: row.feature,
        chargedTokens: integer(row.charged_tokens),
        pendingReservedTokens: integer(row.pending_reserved_tokens),
        cacheHits: integer(row.cache_hits),
      }));
    },
  };
}
