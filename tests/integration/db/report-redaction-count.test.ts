import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createReportCacheRepository } from '@/server/progress-report';
import { dbDescribe, useMigratedDatabase } from './support/harness';
import { createProjectWithTeam, insertReport, runtimePool } from './support/fixtures';

dbDescribe('D9 report redaction-count migration and repository', () => {
  const database = useMigratedDatabase({ afterMigration: async (file, admin) => {
    if (file.endsWith('20261109120000_report_cache_fingerprint.sql')) {
      const team = await createProjectWithTeam(admin);
      await insertReport(admin, team.projectId, { start: '2026-11-09', end: '2026-11-09' });
    }
  } });
  it('upgrades a real pre-D9 row as unknown and adds a nullable integer without a zero backfill', async () => {
    const { admin } = database();
    const column = await admin.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='app' AND table_name='reports' AND column_name='redaction_replacement_count'");
    expect(column.rows).toEqual([{ data_type: 'integer', is_nullable: 'YES', column_default: null }]);
    const rows = await admin.query('SELECT redaction_replacement_count FROM app.reports');
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every(row => row.redaction_replacement_count === null)).toBe(true);
  });
  it('permits unknown, zero and positive counts but rejects negative persisted counts', async () => {
    const { admin } = database();
    const team = await createProjectWithTeam(admin);
    await insertReport(admin, team.projectId, { start: '2026-11-09', end: '2026-11-09' });
    for (const count of [null, 0, 3]) {
      await admin.query('UPDATE app.reports SET redaction_replacement_count=$2 WHERE project_id=$1', [team.projectId, count]);
      expect((await admin.query('SELECT redaction_replacement_count FROM app.reports WHERE project_id=$1', [team.projectId])).rows[0].redaction_replacement_count).toBe(count);
    }
    await expect(admin.query('UPDATE app.reports SET redaction_replacement_count=$2 WHERE project_id=$1', [team.projectId, -1])).rejects.toMatchObject({ code: '23514' });
  });
  it.each([0, 3])('publishes and reads verified count %i through the runtime repository using only key metadata', async count => {
    const db = database();
    const team = await createProjectWithTeam(db.admin);
    const repository = createReportCacheRepository(runtimePool(db.connectAsRuntime));
    const key = { projectId: team.projectId, rangeStart: '2026-11-09', rangeEnd: '2026-11-09', inputFingerprint: 'a'.repeat(64), generationContractVersion: 'progress-report-v2', providerModel: 'fake:fake', redactionReplacementCount: count };
    const result = await repository.publish({ key, personId: team.productManagerId, statements: [], model: 'fake', githubUnavailable: false, latestActivityAt: '2026-11-09T01:00:00.000Z', expectedVersion: null });
    expect(result.kind).toBe('stored');
    expect(await repository.read(key)).toMatchObject({ redactionReplacementCount: count });
    expect((await db.admin.query('SELECT redaction_replacement_count FROM app.reports WHERE project_id=$1', [team.projectId])).rows[0].redaction_replacement_count).toBe(count);
  });
  it('preserves a positive key count for both concurrent publication outcomes with one stored row', async () => {
    const db = database();
    const team = await createProjectWithTeam(db.admin);
    const repository = createReportCacheRepository(runtimePool(db.connectAsRuntime));
    const key = { projectId: team.projectId, rangeStart: '2026-11-09', rangeEnd: '2026-11-09', inputFingerprint: 'b'.repeat(64), generationContractVersion: 'progress-report-v2', providerModel: 'fake:fake', redactionReplacementCount: 3 };
    const publication = { key, personId: team.productManagerId, statements: [], model: 'fake', githubUnavailable: false, latestActivityAt: '2026-11-09T01:00:00.000Z', expectedVersion: null };
    const results = await Promise.all([repository.publish(publication), repository.publish(publication)]);
    expect(results.map(result => result.kind).sort()).toEqual(['stored', 'winner']);
    const rows = await db.admin.query('SELECT id,redaction_replacement_count FROM app.reports WHERE project_id=$1', [team.projectId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].redaction_replacement_count).toBe(3);
    for (const result of results) {
      if (result.kind === 'conflict') throw new Error('Identical publication must return the verified winner');
      expect(result.report).toMatchObject({ id: rows.rows[0].id, redactionReplacementCount: 3 });
    }
  });
});
