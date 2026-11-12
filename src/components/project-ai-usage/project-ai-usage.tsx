"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ProjectAiUsageDto, ProjectAiUsageEnvironment } from "@/server/project-ai-usage";

export type ProjectAiUsageProps = Readonly<{
  projectId: string;
  initialStartDate: string;
  initialEndDate: string;
  environment: ProjectAiUsageEnvironment;
}>;

export function ProjectAiUsage({ projectId, initialStartDate, initialEndDate, environment }: ProjectAiUsageProps) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [result, setResult] = useState<ProjectAiUsageDto | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const loadRange = useCallback(async (requestedRange: { startDate: string; endDate: string }) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = ++requestSequence.current;
    try {
      const query = new URLSearchParams(requestedRange);
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/ai-usage?${query}`, {
        method: "GET", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        let message = "Usage is unavailable. Try again.";
        try {
          const body = await response.json() as { error?: { message?: unknown } };
          if (typeof body.error?.message === "string") message = body.error.message;
        } catch { /* Keep the fixed safe fallback. */ }
        throw new Error(message);
      }
      const data = await response.json() as ProjectAiUsageDto;
      if (sequence !== requestSequence.current) return;
      setResult(data);
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Usage is unavailable. Try again.");
    } finally {
      if (sequence === requestSequence.current) {
        setPending(false);
        activeController.current = null;
      }
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRange({ startDate: initialStartDate, endDate: initialEndDate }); }, 0);
    return () => {
      window.clearTimeout(timer);
      activeController.current?.abort();
    };
  }, [initialEndDate, initialStartDate, loadRange]);

  function changeRange(nextStart: string, nextEnd: string) {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setResult(null);
    setError(null);
    requestSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setPending(false);
  }

  async function loadUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedRange = { startDate, endDate };
    setResult(null);
    setPending(true);
    setError(null);
    await loadRange(requestedRange);
  }

  return <section aria-labelledby="project-ai-usage-heading" className="rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
    <div>
      <h2 id="project-ai-usage-heading" className="text-2xl font-semibold tracking-tight">AI usage</h2>
      <p className="mt-2 text-sm text-neutral-400">Daily project totals · SGT · {environment}</p>
    </div>
    <form onSubmit={loadUsage} className="mt-6 flex flex-wrap items-end gap-4">
      <label className="grid gap-2 text-sm text-neutral-300">Start date (SGT)
        <input className="rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-neutral-100" type="date" required value={startDate}
          onChange={(event) => changeRange(event.currentTarget.value, endDate)} />
      </label>
      <label className="grid gap-2 text-sm text-neutral-300">End date (SGT)
        <input className="rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-neutral-100" type="date" required value={endDate}
          onChange={(event) => changeRange(startDate, event.currentTarget.value)} />
      </label>
      <button type="submit" disabled={pending} className="rounded-full bg-[#2a2a2a] px-5 py-2.5 text-sm font-medium text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_5px_14px_rgba(0,0,0,0.24)] disabled:cursor-wait disabled:opacity-60">
        {pending ? "Loading usage…" : error ? "Retry usage" : "Load usage"}
      </button>
    </form>
    {pending && <p role="status" className="mt-5 text-sm text-neutral-300">Loading project usage…</p>}
    {error && <p role="alert" className="mt-5 text-sm text-amber-200">{error}</p>}
    {result && <div className="mt-6 overflow-x-auto">
      {result.rows.every((row) => row.chargedTokens === 0 && row.pendingReservedTokens === 0 && row.cacheHits === 0)
        ? <p role="status" className="mb-4 text-sm text-neutral-300">No AI usage in this range.</p> : null}
      <table className="w-full min-w-[38rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">AI usage by day and feature for {result.range.startDate} through {result.range.endDate} SGT</caption>
        <thead className="text-xs uppercase tracking-wide text-neutral-400"><tr>
          <th scope="col" className="px-3 py-2">SGT date</th><th scope="col" className="px-3 py-2">Feature</th>
          <th scope="col" className="px-3 py-2">Charged tokens</th><th scope="col" className="px-3 py-2">Pending reserved tokens</th><th scope="col" className="px-3 py-2">Cache hits</th>
        </tr></thead>
        <tbody>{result.rows.map((row) => <tr key={`${row.date}/${row.feature}`} className="bg-[#1a1a1a] text-neutral-200">
          <td className="rounded-l-xl px-3 py-3">{row.date}</td>
          <td className="px-3 py-3">{row.feature === "acceptance_check" ? "Acceptance Criteria Check" : "Progress Report"}</td>
          <td className="px-3 py-3 tabular-nums">{row.chargedTokens.toLocaleString()}</td>
          <td className="px-3 py-3 tabular-nums">{row.pendingReservedTokens.toLocaleString()}</td>
          <td className="rounded-r-xl px-3 py-3 tabular-nums">{row.cacheHits.toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
