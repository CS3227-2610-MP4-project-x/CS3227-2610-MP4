import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressReport } from '@/components/progress-report';

afterEach(() => vi.unstubAllGlobals());
describe('Product manager report page — explicit generation', () => {
  it('renders SGT date controls and Generate action without fetching a report on render', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(<ProgressReport projectId="11111111-1111-4111-8111-111111111111" initialStartDate="2026-11-09" initialEndDate="2026-11-09" members={[]} />);
    expect(html).toMatch(/SGT/i);
    expect(html).toMatch(/Generate report/i);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html.match(/value="2026-11-09"/g)).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(html).not.toMatch(/No activity/i);
    expect(html).not.toMatch(/Sensitive content was redacted|0 replacements/i);
  });
});
