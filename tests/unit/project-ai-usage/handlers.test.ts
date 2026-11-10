import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createProjectAiUsageHandler, ProjectAiUsageError } from '@/server/project-ai-usage';

const projectId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const dto = { range: { startDate: '2026-11-09', endDate: '2026-11-09' }, environment: 'production', rows: [] };
function setup() {
  const readProjectUsage = vi.fn().mockResolvedValue(dto);
  const resolveAccess = vi.fn().mockResolvedValue({ personId, role: 'product_manager' });
  const handler = createProjectAiUsageHandler({ appOrigin: 'https://app.example.test', resolveAccess, service: { readProjectUsage, readCurrentSgtDate: vi.fn() } });
  const request = (query = '') => handler(new Request(`https://app.example.test/api/v1/projects/${projectId}/ai-usage${query}`), projectId);
  return { handler, request, resolveAccess, readProjectUsage };
}
async function expectSafeError(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const json = await response.json();
  expect(Object.keys(json)).toEqual(['error']);
  expect(json.error).toEqual(expect.objectContaining({ code: code ?? expect.any(String), message: expect.any(String) }));
  expect(JSON.stringify(json)).not.toContain('synthetic-private-detail');
  expect(JSON.stringify(json)).not.toContain('stack');
}
describe('Product manager project usage read — HTTP', () => {
  it('allows a read-only GET without Origin and delegates actor and nested range', async () => {
    const s = setup();
    const response = await s.request('?startDate=2030-01-01&endDate=2030-01-07');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(s.readProjectUsage).toHaveBeenCalledWith({ projectId, actorId: personId, range: { startDate: '2030-01-01', endDate: '2030-01-07' } });
    expect(await response.json()).toEqual(dto);
  });
  it('passes an omitted range to the service rather than choosing a browser date', async () => {
    const s = setup();
    await s.request();
    expect(s.readProjectUsage).toHaveBeenCalledWith({ projectId, actorId: personId, range: {} });
  });
  it.each([401, 404])('preserves access refusal %i before service reads', async status => {
    const s = setup();
    s.resolveAccess.mockResolvedValue(Response.json({ error: { code: status === 401 ? 'UNAUTHENTICATED' : 'NOT_FOUND', message: 'Unavailable.' } }, { status, headers: { 'Cache-Control': 'no-store' } }));
    await expectSafeError(await s.request(), status);
    expect(s.readProjectUsage).not.toHaveBeenCalled();
  });
  it('refuses developers before service reads', async () => {
    const s = setup();
    s.resolveAccess.mockResolvedValue({ personId, role: 'developer' });
    await expectSafeError(await s.request(), 403, 'FORBIDDEN');
    expect(s.readProjectUsage).not.toHaveBeenCalled();
  });
  it.each([
    '?startDate=2026-11-09', '?endDate=2026-11-09', '?unknown=value',
    '?startDate=2026-11-09&endDate=2026-11-09&environment=development',
    '?startDate=2026-11-09&startDate=2026-11-09&endDate=2026-11-09',
    '?startDate=2026-11-09&endDate=2026-11-09&endDate=2026-11-09',
  ])('rejects strict query shape %s without reading usage', async query => {
    const s = setup();
    await expectSafeError(await s.request(query), 400, 'INVALID_REQUEST');
    expect(s.readProjectUsage).not.toHaveBeenCalled();
  });
  it.each([['INVALID_REQUEST', 400], ['FORBIDDEN', 403], ['NOT_FOUND', 404]] as const)('maps domain %s safely', async (code, status) => {
    const s = setup();
    s.readProjectUsage.mockRejectedValue(new ProjectAiUsageError(code));
    await expectSafeError(await s.request(), status, code);
  });
  it('conceals arbitrary dependency errors even when they mimic a domain code', async () => {
    const s = setup();
    s.readProjectUsage.mockRejectedValue(Object.assign(new Error('synthetic-private-detail'), { code: 'FORBIDDEN' }));
    await expectSafeError(await s.request(), 500, 'INTERNAL_ERROR');
  });
});
