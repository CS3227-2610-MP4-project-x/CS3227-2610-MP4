import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ access: vi.fn(), date: vi.fn(), members: vi.fn(), report: vi.fn() }));
vi.mock('@/server/auth', () => ({ requireProjectPageAccess: mocks.access }));
vi.mock('@/server/composition', () => ({ getServerComposition: () => ({ projectAiUsageService: { readCurrentSgtDate: mocks.date }, projectService: { listMembers: mocks.members }, config: { appEnvironment: 'production' } }) }));
vi.mock('@/components/progress-report', () => ({ ProgressReport: (props: unknown) => { mocks.report(props); return null; } }));
import ReportsPage from '@/app/projects/[projectId]/reports/page';

const projectId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ personId, role: 'product_manager' });
  mocks.date.mockResolvedValue('2026-11-09');
  mocks.members.mockResolvedValue([]);
});
describe('Product manager report page — server access and defaults', () => {
  it('passes authorized member data and server SGT defaults to the report component', async () => {
    const members = [{ personId, githubUsername: 'synthetic-user', role: 'developer' }];
    mocks.members.mockResolvedValue(members);
    renderToStaticMarkup(await ReportsPage({ params: Promise.resolve({ projectId }) }));
    expect(mocks.members).toHaveBeenCalledWith(projectId, personId);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ projectId, members, initialStartDate: '2026-11-09', initialEndDate: '2026-11-09' }));
  });
  it('renders PM-only unavailability for developers without member or usage reads', async () => {
    mocks.access.mockResolvedValue({ personId, role: 'developer' });
    const html = renderToStaticMarkup(await ReportsPage({ params: Promise.resolve({ projectId }) }));
    expect(html).toMatch(/product manager|PM.only/i);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.date).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(['sign-in redirect', 'safe not-found'])('preserves %s from the page access boundary', async message => {
    const refusal = new Error(message);
    mocks.access.mockRejectedValue(refusal);
    await expect(ReportsPage({ params: Promise.resolve({ projectId }) })).rejects.toBe(refusal);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.date).not.toHaveBeenCalled();
  });
});
