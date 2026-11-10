import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ access: vi.fn(), date: vi.fn(), members: vi.fn(), usage: vi.fn() }));
vi.mock('@/server/auth', () => ({ requireProjectPageAccess: mocks.access }));
vi.mock('@/server/auth/supabase-auth', () => ({ createRequestSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) }));
vi.mock('@/components/github-repository/project-repository-settings', () => ({ ProjectRepositorySettings: () => null }));
vi.mock('@/components/projects', () => ({ MembersSettings: () => null }));
vi.mock('@/server/composition', () => ({ getServerComposition: () => ({ projectAiUsageService: { readCurrentSgtDate: mocks.date }, projectService: { listMembers: mocks.members }, config: { appEnvironment: 'production' } }) }));
vi.mock('@/components/project-ai-usage', () => ({ ProjectAiUsage: (props: unknown) => { mocks.usage(props); return null; } }));
import SettingsPage from '@/app/projects/[projectId]/settings/page';

const projectId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => vi.clearAllMocks());
describe('Product manager project usage — Settings privacy', () => {
  it('inserts the PM panel with database SGT dates and configured environment', async () => {
    mocks.access.mockResolvedValue({ personId: '22222222-2222-4222-8222-222222222222', role: 'product_manager' });
    mocks.members.mockResolvedValue([]);
    mocks.date.mockResolvedValue('2030-01-02');
    renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({}) }));
    expect(mocks.date).toHaveBeenCalledOnce();
    expect(mocks.usage).toHaveBeenCalledOnce();
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ projectId, initialStartDate: '2030-01-02', initialEndDate: '2030-01-02', environment: 'production' }));
  });
  it('omits the panel and usage data for a developer', async () => {
    mocks.access.mockResolvedValue({ personId: '22222222-2222-4222-8222-222222222222', role: 'developer' });
    const html = renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({}) }));
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.date).not.toHaveBeenCalled();
    expect(html).not.toMatch(/charged tokens|pending reserved tokens|cache hits/i);
  });
  it.each(['sign-in redirect', 'safe not-found'])('preserves %s before usage reads', async message => {
    const refusal = new Error(message);
    mocks.access.mockRejectedValue(refusal);
    await expect(SettingsPage({ params: Promise.resolve({ projectId }), searchParams: Promise.resolve({}) })).rejects.toBe(refusal);
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.date).not.toHaveBeenCalled();
  });
});
