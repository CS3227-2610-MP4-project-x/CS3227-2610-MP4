import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createProjectAiUsageService, ProjectAiUsageError } from '@/server/project-ai-usage';

const projectId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
function setup() {
  const readDaily = vi.fn().mockResolvedValue([]);
  const authorizeProductManager = vi.fn().mockResolvedValue(undefined);
  const readCurrentSgtDate = vi.fn().mockResolvedValue('2026-11-09');
  const service = createProjectAiUsageService({ repository: { readDaily }, authorizeProductManager, readCurrentSgtDate, environment: 'production' });
  return { service, readDaily, authorizeProductManager, readCurrentSgtDate };
}

describe('Product manager project usage read — service', () => {
  it('defaults to database SGT day with exclusive UTC boundaries and configured environment', async () => {
    const s = setup();
    const result = await s.service.readProjectUsage({ projectId, actorId, range: {} });
    expect(s.authorizeProductManager).toHaveBeenCalledWith({ projectId, actorId });
    expect(s.readDaily).toHaveBeenCalledWith({ projectId, environment: 'production', startUtc: '2026-11-08T16:00:00.000Z', endUtcExclusive: '2026-11-09T16:00:00.000Z' });
    expect(result).toEqual({ range: { startDate: '2026-11-09', endDate: '2026-11-09' }, environment: 'production', rows: [
      { date: '2026-11-09', feature: 'acceptance_check', chargedTokens: 0, pendingReservedTokens: 0, cacheHits: 0 },
      { date: '2026-11-09', feature: 'progress_report', chargedTokens: 0, pendingReservedTokens: 0, cacheHits: 0 },
    ] });
  });
  it.each(['NOT_FOUND', 'FORBIDDEN'] as const)('rechecks current PM and refuses %s before any data read', async code => {
    const s = setup();
    s.authorizeProductManager.mockRejectedValue(new ProjectAiUsageError(code));
    await expect(s.service.readProjectUsage({ projectId, actorId, range: {} })).rejects.toMatchObject({ code });
    expect(s.readDaily).not.toHaveBeenCalled();
    expect(s.readCurrentSgtDate).not.toHaveBeenCalled();
  });
  it.each([
    { startDate: '2026-11-09' }, { endDate: '2026-11-09' }, { startDate: '', endDate: '' },
    { startDate: '2026-2-01', endDate: '2026-02-01' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-11-31', endDate: '2026-12-01' },
    { startDate: '2026-11-10', endDate: '2026-11-09' },
    { startDate: '2026-11-02', endDate: '2026-11-09' },
    { startDate: '2026-11-09T00:00:00Z', endDate: '2026-11-09' },
  ])('rejects invalid range %j before aggregates', async range => {
    const s = setup();
    await expect(s.service.readProjectUsage({ projectId, actorId, range })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(s.readDaily).not.toHaveBeenCalled();
  });
  it('accepts seven future days and fills/orders sparse rows without private fields', async () => {
    const s = setup();
    s.readDaily.mockResolvedValue([{ date: '2030-01-01', feature: 'progress_report', chargedTokens: 53, pendingReservedTokens: 4000, cacheHits: 2 }]);
    const result = await s.service.readProjectUsage({ projectId, actorId, range: { startDate: '2030-01-01', endDate: '2030-01-07' } });
    expect(s.readCurrentSgtDate).not.toHaveBeenCalled();
    expect(result.rows).toHaveLength(14);
    expect(result.rows.map(({ date, feature }) => `${date}/${feature}`)).toEqual(
      ['07', '06', '05', '04', '03', '02', '01'].flatMap(day => ['acceptance_check', 'progress_report'].map(feature => `2030-01-${day}/${feature}`)),
    );
    expect(result.rows[13]).toEqual({ date: '2030-01-01', feature: 'progress_report', chargedTokens: 53, pendingReservedTokens: 4000, cacheHits: 2 });
    expect(Object.keys(result).sort()).toEqual(['environment', 'range', 'rows']);
    for (const row of result.rows) expect(Object.keys(row).sort()).toEqual(['cacheHits', 'chargedTokens', 'date', 'feature', 'pendingReservedTokens']);
  });
  it('exposes the injected database date resolver for pages', async () => {
    const s = setup();
    await expect(s.service.readCurrentSgtDate()).resolves.toBe('2026-11-09');
    expect(s.readCurrentSgtDate).toHaveBeenCalledOnce();
  });
});
