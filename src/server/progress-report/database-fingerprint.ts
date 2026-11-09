import "server-only";
import { createHash } from "node:crypto";
import type { ReportRange } from "./types";

type FingerprintQuery = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

/** Stable MVCC token for all database rows that can affect the assembled report. */
export async function readReportDatabaseFingerprint(query: FingerprintQuery, projectId: string, range: ReportRange): Promise<string> {
  const result = await query.query<{ entity: string; id: string; revision: string }>(
    `SELECT entity, id, revision FROM (
       SELECT 'project'::text AS entity, p.id::text AS id, p.xmin::text AS revision FROM app.projects p WHERE p.id = $1::uuid
       UNION ALL
       SELECT 'membership', m.person_id::text, m.xmin::text FROM app.memberships m WHERE m.project_id = $1::uuid
       UNION ALL
       SELECT 'task', t.id::text, t.xmin::text FROM app.tasks t WHERE t.project_id = $1::uuid
       UNION ALL
       SELECT 'event', e.id::text, e.xmin::text FROM app.task_events e JOIN app.tasks t ON t.id = e.task_id
         WHERE t.project_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz
       UNION ALL
       SELECT 'progress', u.id::text, u.xmin::text FROM app.progress_updates u JOIN app.tasks t ON t.id = u.task_id
         WHERE t.project_id = $1::uuid AND u.created_at >= $2::timestamptz AND u.created_at < $3::timestamptz
       UNION ALL
       SELECT 'check', c.id::text, c.xmin::text FROM app.check_results c JOIN app.tasks t ON t.id = c.task_id
         WHERE t.project_id = $1::uuid AND c.created_at >= $2::timestamptz AND c.created_at < $3::timestamptz
       UNION ALL
       SELECT 'attachment', a.task_id::text || ':' || a.commit_sha, a.xmin::text FROM app.attached_commits a
         JOIN app.tasks t ON t.id = a.task_id WHERE t.project_id = $1::uuid
       UNION ALL
       SELECT 'person', pe.id::text, pe.xmin::text FROM app.people pe
         WHERE pe.id IN (SELECT m.person_id FROM app.memberships m WHERE m.project_id = $1::uuid)
            OR pe.id IN (SELECT e.actor_id FROM app.task_events e JOIN app.tasks t ON t.id = e.task_id
                          WHERE t.project_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz)
            OR pe.id IN (SELECT u.author_id FROM app.progress_updates u JOIN app.tasks t ON t.id = u.task_id
                          WHERE t.project_id = $1::uuid AND u.created_at >= $2::timestamptz AND u.created_at < $3::timestamptz)
     ) AS evidence_rows ORDER BY entity, id`, [projectId, range.startUtc, range.endUtcExclusive]);
  return createHash("sha256").update(JSON.stringify(result.rows), "utf8").digest("hex");
}
