import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createProjectAiUsageRepository, createProjectAiUsageService } from '@/server/project-ai-usage';
import { dbDescribe, useMigratedDatabase } from './support/harness';
import { createProjectWithTeam, insertPendingUsageRecord } from './support/fixtures';

dbDescribe('Product manager project usage read — PostgreSQL aggregates', () => {
  const database = useMigratedDatabase();
  it('aggregates actual charges, failures, cache hits and reservations using SGT boundaries and project/environment isolation', async () => {
    const db = database();
    const team = await createProjectWithTeam(db.admin);
    const other = await createProjectWithTeam(db.admin);
    // Each fixture starts pending; settle it before inserting the next one.
    async function settled(projectId: string, personId: string, timestamp: string, charge: number, outcome: string, environment = 'development', feature = 'acceptance_check') {
      await insertPendingUsageRecord(db.admin, { projectId, personId });
      await db.admin.query(`UPDATE app.usage_records SET created_at=$3::timestamptz, charged_tokens=$4, input_tokens=CASE WHEN $8 THEN 0 ELSE 1 END, output_tokens=CASE WHEN $8 THEN 0 ELSE 2 END, reserved_tokens=CASE WHEN $8 THEN 0 ELSE 4000 END, outcome=$5, environment=$6, feature=$7, cached=$8 WHERE project_id=$1 AND person_id=$2 AND outcome='pending'`, [projectId, personId, timestamp, charge, outcome, environment, feature, outcome === 'cached']);
    }
    await settled(team.projectId, team.developerId, '2026-11-08T16:00:00.000Z', 17, 'succeeded');
    await settled(team.projectId, team.productManagerId, '2026-11-09T15:59:59.999Z', 4000, 'provider_error');
    await settled(team.projectId, team.developerId, '2026-11-09T12:00:00.000Z', 31, 'invalid_output');
    await settled(team.projectId, team.developerId, '2026-11-09T12:00:00.000Z', 0, 'cached');
    await settled(team.projectId, team.developerId, '2026-11-09T12:00:00.000Z', 23, 'succeeded', 'development', 'progress_report');
    await settled(team.projectId, team.developerId, '2026-11-08T15:59:59.999Z', 900, 'succeeded');
    await settled(team.projectId, team.developerId, '2026-11-09T16:00:00.000Z', 900, 'succeeded');
    await settled(team.projectId, team.developerId, '2026-11-09T12:00:00.000Z', 900, 'succeeded', 'production');
    await settled(other.projectId, other.developerId, '2026-11-09T12:00:00.000Z', 900, 'succeeded');
    await insertPendingUsageRecord(db.admin, { projectId: team.projectId, personId: team.developerId });
    await db.admin.query(`UPDATE app.usage_records SET created_at=$2::timestamptz WHERE project_id=$1 AND outcome='pending'`, [team.projectId, '2026-11-09T12:00:00.000Z']);
    const runtime = await db.connectAsRuntime();
    try {
      const repository = createProjectAiUsageRepository({ query: async <Row,>(text: string, values?: readonly unknown[]) => {
        const result = await runtime.query(text, values ? [...values] : []);
        return { rows: result.rows as Row[] };
      } });
      const service = createProjectAiUsageService({ repository, authorizeProductManager: async () => {}, readCurrentSgtDate: async () => '2026-11-09', environment: 'development' });
      const result = await service.readProjectUsage({ projectId: team.projectId, actorId: team.productManagerId, range: { startDate: '2026-11-09', endDate: '2026-11-10' } });
      expect(result.rows).toEqual([
        { date: '2026-11-10', feature: 'acceptance_check', chargedTokens: 900, pendingReservedTokens: 0, cacheHits: 0 },
        { date: '2026-11-10', feature: 'progress_report', chargedTokens: 0, pendingReservedTokens: 0, cacheHits: 0 },
        { date: '2026-11-09', feature: 'acceptance_check', chargedTokens: 4048, pendingReservedTokens: 4000, cacheHits: 1 },
        { date: '2026-11-09', feature: 'progress_report', chargedTokens: 23, pendingReservedTokens: 0, cacheHits: 0 },
      ]);
      const singleDay = await service.readProjectUsage({ projectId: team.projectId, actorId: team.productManagerId, range: {} });
      expect(singleDay.rows).toEqual(result.rows.slice(2));
    } finally {
      await runtime.end();
    }
  });
});
