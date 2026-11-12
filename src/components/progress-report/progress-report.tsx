"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { ProjectMemberView } from "@/server/projects";
import type { GenerateReportResult, ReportDto } from "@/server/progress-report";

export type ProgressReportProps = Readonly<{
  projectId: string;
  initialStartDate: string;
  initialEndDate: string;
  members: readonly ProjectMemberView[];
}>;

const CATEGORY_LABELS = {
  completed: "Completed",
  submitted: "Submitted for review",
  in_progress: "In progress",
  overdue: "Overdue",
  repeated_changes: "Repeated changes requested",
} as const;

function fixedErrorMessage(code: string | undefined): string {
  switch (code) {
    case "REPORT_RANGE_TOO_LONG": return "Choose a range of seven days or fewer.";
    case "REPORT_INPUT_BUDGET_EXCEEDED": return "Choose a shorter range to fit the report input limit.";
    case "REPORT_INPUT_CHANGED": return "Project activity changed during generation. Try again.";
    case "QUOTA_EXCEEDED": return "AI usage quota exceeded. Try again after the daily reset.";
    case "RATE_LIMITED": return "Too many AI requests. Wait briefly and try again.";
    case "AI_UNAVAILABLE": return "The AI service is unavailable. Try again later.";
    default: return "The report could not be generated. Try again.";
  }
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) return undefined;
  const error = value.error;
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function reportResult(value: unknown): GenerateReportResult | null {
  if (typeof value !== "object" || value === null || !("report" in value) || !("reused" in value)) return null;
  const candidate = value as { report: ReportDto; reused: unknown };
  if (typeof candidate.reused !== "boolean" || !candidate.report || (candidate.report.kind !== "generated" && candidate.report.kind !== "empty")) return null;
  return { report: candidate.report, reused: candidate.reused };
}

export function ProgressReport({ projectId, initialStartDate, initialEndDate, members }: ProgressReportProps) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [result, setResult] = useState<GenerateReportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

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

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = ++requestSequence.current;
    const requestedRange = { startDate, endDate };
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/progress-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestedRange),
        signal: controller.signal,
      });
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) throw new Error(fixedErrorMessage(errorCode(body)));
      const next = reportResult(body);
      if (!next) throw new Error("The report response was not available. Try again.");
      if (sequence !== requestSequence.current || startDate !== requestedRange.startDate || endDate !== requestedRange.endDate) return;
      setResult(next);
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "The report could not be generated. Try again.");
    } finally {
      if (sequence === requestSequence.current) {
        setPending(false);
        activeController.current = null;
      }
    }
  }

  const membersById = new Map(members.map((member) => [member.personId, member.githubUsername]));
  const groups = result?.report.kind === "generated"
    ? [...new Set(result.report.statements.map((statement) => statement.developerId))]
      .sort((left, right) => (membersById.get(left) ?? left).localeCompare(membersById.get(right) ?? right) || left.localeCompare(right))
    : [];

  return <main className="min-h-screen bg-[#1a1a1a] px-5 py-10 text-neutral-100 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-sm text-neutral-400">Progress Report · SGT</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Project progress</h1>
        <p className="mt-2 text-sm text-neutral-400">Choose up to seven inclusive dates. Generating a report uses the project AI feature.</p>
      </header>
      <section aria-labelledby="progress-report-controls" className="rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
        <h2 id="progress-report-controls" className="text-lg font-medium">Report date range</h2>
        <form onSubmit={generate} className="mt-5 flex flex-wrap items-end gap-4">
          <label className="grid gap-2 text-sm text-neutral-300">Start date (SGT)
            <input className="rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-neutral-100" type="date" required value={startDate}
              onChange={(event) => changeRange(event.currentTarget.value, endDate)} />
          </label>
          <label className="grid gap-2 text-sm text-neutral-300">End date (SGT)
            <input className="rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-neutral-100" type="date" required value={endDate}
              onChange={(event) => changeRange(startDate, event.currentTarget.value)} />
          </label>
          <button type="submit" disabled={pending} className="rounded-full bg-[#2a2a2a] px-5 py-2.5 text-sm font-medium text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_5px_14px_rgba(0,0,0,0.24)] disabled:cursor-wait disabled:opacity-60">
            {pending ? "Generating report…" : "Generate report"}
          </button>
        </form>
        {pending && <p role="status" className="mt-5 text-sm text-neutral-300">Generating the report…</p>}
        {error && <p role="alert" className="mt-5 text-sm text-amber-200">{error}</p>}
      </section>
      {result && <section aria-labelledby="progress-report-result" className="mt-6 rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="progress-report-result" className="text-xl font-semibold">Report · {result.report.range.startDate} to {result.report.range.endDate} SGT</h2>
          {result.reused && <p className="text-sm text-neutral-400">Showing a report reused because project activity has not changed.</p>}
        </div>
        {result.report.kind === "empty"
          ? <p role="status" className="mt-5 text-sm text-neutral-300">No activity was recorded for this date range.</p>
          : <>
            <p className="mt-3 text-xs text-[#949494]">Generated {new Date(result.report.createdAt).toLocaleString()}</p>
            {result.report.githubUnavailable && <p role="status" className="mt-4 rounded-xl bg-[#1a1a1a] p-4 text-sm text-amber-100">Some GitHub evidence was unavailable. This report may not include all commit activity.</p>}
            {result.report.redaction.occurred && result.report.redaction.replacementCount > 0 && <p role="status" className="mt-4 rounded-xl bg-[#1a1a1a] p-4 text-sm text-neutral-200">Sensitive content was redacted: {result.report.redaction.replacementCount.toLocaleString()} {result.report.redaction.replacementCount === 1 ? "replacement" : "replacements"}.</p>}
            {groups.length === 0
              ? <p role="status" className="mt-5 text-sm text-neutral-300">No report statements were available.</p>
              : <div className="mt-6 space-y-6">{groups.map((developerId) => <section key={developerId} aria-labelledby={`report-developer-${developerId}`}>
                <h3 id={`report-developer-${developerId}`} className="text-base font-medium">{membersById.get(developerId) ?? developerId}</h3>
                <ul className="mt-3 space-y-3">{result.report.kind === "generated" && result.report.statements.filter((statement) => statement.developerId === developerId).map((statement, index) => <li key={`${statement.category}/${index}`} className="rounded-xl bg-[#1a1a1a] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{CATEGORY_LABELS[statement.category]}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-200">{statement.text}</p>
                  <ul aria-label="Cited tasks" className="mt-3 flex flex-wrap gap-2">{statement.tasks.map((task) => <li key={task.taskId}>
                    <Link className="rounded-full bg-[#2a2a2a] px-3 py-1.5 text-xs text-neutral-300 hover:text-white" href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.taskId)}`}>{task.taskKey}</Link>
                  </li>)}</ul>
                </li>)}</ul>
              </section>)}</div>}
          </>}
      </section>}
    </div>
  </main>;
}
