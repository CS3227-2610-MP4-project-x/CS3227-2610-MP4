import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAiUsage } from '@/components/project-ai-usage';

afterEach(() => vi.unstubAllGlobals());
describe('Product manager project usage panel — initial presentation', () => {
  it('labels SGT controls and configured environment with server-provided date defaults', () => {
    const html = renderToStaticMarkup(<ProjectAiUsage projectId="11111111-1111-4111-8111-111111111111" initialStartDate="2026-11-09" initialEndDate="2026-11-09" environment="production" />);
    expect(html).toMatch(/SGT/i);
    expect(html).toMatch(/production/i);
    expect(html).toMatch(/start/i);
    expect(html).toMatch(/end/i);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html.match(/value="2026-11-09"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<select[^>]*[^>]*name="environment"/i);
  });
});
