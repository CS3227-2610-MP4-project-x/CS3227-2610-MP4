"use client";

import { useState } from "react";
import { CheckHistory, type CheckHistoryEntry } from "./check-history";

export type DeveloperCheckPanelProps = Readonly<{
  projectId: string;
  taskId: string;
  checkHistory: readonly CheckHistoryEntry[];
}>;

type ApiError = Readonly<{ error?: { code?: unknown } }>;
type CheckResponse = Readonly<{ check: CheckHistoryEntry; reused: boolean }>;
type PanelState = Readonly<{
  projectId: string;
  taskId: string;
  identityGeneration: number;
  requestToken: symbol | null;
  entries: readonly CheckHistoryEntry[];
  loading: boolean;
  error: string;
  notice: string;
}>;

const SAFE_ERRORS: Readonly<Record<string, string>> = {
  CHECK_REQUIRES_COMMITS: "Attach commits to this task before running a check.",
  INCOMPARABLE_COMMIT_TIPS: "Select commits with one common descendant tip, then try again.",
  EVIDENCE_UNAVAILABLE: "Repository evidence or path rules are unavailable. Try again later.",
  RATE_LIMITED: "The check request limit was reached. Try again later.",
  QUOTA_EXCEEDED: "The project AI quota was reached. Try again later.",
  AI_UNAVAILABLE: "The assessment service is unavailable. Try again later.",
  AI_ERROR: "The check could not be completed. Try again.",
  INVALID_OUTPUT: "The check returned an invalid result. Try again.",
  FORBIDDEN: "You do not have permission to run this check.",
  UNAUTHENTICATED: "Your session has expired. Sign in and try again.",
};

function isCheckResponse(value: unknown): value is CheckResponse {
  if (!isRecord(value) || typeof value.reused !== "boolean" || !isRecord(value.check)) return false;
  const check = value.check;
  if (typeof check.id !== "string" || check.id.length === 0 ||
      typeof check.createdAt !== "string" || Number.isNaN(Date.parse(check.createdAt)) ||
      typeof check.anchorSha !== "string" || check.anchorSha.length === 0 ||
      typeof check.redacted !== "boolean" || !isCheckPayload(check.payload)) return false;
  return check.anchorSha === check.payload.anchorSha;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCheckPayload(value: unknown): value is CheckHistoryEntry["payload"] {
  if (!isRecord(value) || typeof value.anchorSha !== "string" || value.anchorSha.length === 0 ||
      !Array.isArray(value.criteria) || !isStringArray(value.possibleGaps) || !isStringArray(value.omittedFiles)) return false;
  const criterionIds = new Set<string>();
  for (const criterion of value.criteria) {
    if (!isRecord(criterion) || typeof criterion.criterionId !== "string" || criterion.criterionId.length === 0 ||
        criterionIds.has(criterion.criterionId) || typeof criterion.criterion !== "string" ||
        typeof criterion.status !== "string" || !["addressed", "not_addressed", "unclear"].includes(criterion.status) ||
        !isStringArray(criterion.evidence)) return false;
    criterionIds.add(criterion.criterionId);
  }
  return true;
}

export function DeveloperCheckPanel({ projectId, taskId, checkHistory }: DeveloperCheckPanelProps) {
  const [state, setState] = useState<PanelState>({
    projectId,
    taskId,
    identityGeneration: 0,
    requestToken: null,
    entries: checkHistory,
    loading: false,
    error: "",
    notice: "",
  });

  const hasMatchingIdentity = state.projectId === projectId && state.taskId === taskId;
  if (!hasMatchingIdentity) {
    // Reset mounted local state when the panel is reused for another task or
    // project. React retries this render with the state owned by the new props.
    setState({
      projectId,
      taskId,
      identityGeneration: state.identityGeneration + 1,
      requestToken: null,
      entries: checkHistory,
      loading: false,
      error: "",
      notice: "",
    });
  }
  const history = hasMatchingIdentity
    ? mergeHistory(state.entries, checkHistory)
    : checkHistory;
  const loading = hasMatchingIdentity && state.loading;
  const error = hasMatchingIdentity ? state.error : "";
  const notice = hasMatchingIdentity ? state.notice : "";

  async function runCheck() {
    const generation = state.identityGeneration;
    const requestToken = Symbol("acceptance-check-request");
    setState((current) => current.projectId === projectId && current.taskId === taskId && current.identityGeneration === generation
      ? { ...current, requestToken, loading: true, error: "", notice: "" }
      : current);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}/acceptance-criteria-check`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      let body: unknown;
      try { body = await response.json(); }
      catch { body = null; }
      if (!response.ok) {
        const code = typeof body === "object" && body !== null && "error" in body
          ? (body as ApiError).error?.code : undefined;
        updateRequestState(setState, projectId, taskId, generation, requestToken, (current) => ({
          ...current,
          error: typeof code === "string" ? SAFE_ERRORS[code] ?? "The check could not be completed. Try again." : "The check could not be completed. Try again.",
        }));
        return;
      }
      if (!isCheckResponse(body)) {
        updateRequestState(setState, projectId, taskId, generation, requestToken, (current) => ({
          ...current,
          error: "The check returned an invalid result. Try again.",
        }));
        return;
      }
      updateRequestState(setState, projectId, taskId, generation, requestToken, (current) => ({
        ...current,
        entries: mergeHistory([body.check], current.entries),
        notice: body.reused ? "This commit set and criteria were already checked. The existing result is shown." : "",
      }));
    } catch {
      updateRequestState(setState, projectId, taskId, generation, requestToken, (current) => ({
        ...current,
        error: "The check could not be reached. Check your connection and try again.",
      }));
    } finally {
      updateRequestState(setState, projectId, taskId, generation, requestToken, (current) => ({ ...current, loading: false }));
    }
  }

  return (
    <section aria-labelledby="acceptance-check-heading" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="acceptance-check-heading" className="text-xl font-semibold tracking-tight text-neutral-100">Acceptance Criteria Check</h2>
          <p className="mt-1 text-sm text-neutral-400">Advisory result for the task’s attached commits.</p>
        </div>
        <button type="button" onClick={runCheck} disabled={loading}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-[#08200f] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
          {loading ? "Checking…" : "Run check"}
        </button>
      </header>
      {loading && <p role="status" aria-live="polite" className="text-sm text-neutral-400">Running the check against the attached commits…</p>}
      {notice && <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[.07] px-4 py-3 text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-4 py-3 text-sm text-amber-200">{error}</p>}
      <CheckHistory checkHistory={history} />
    </section>
  );
}

function updateRequestState(
  setState: (update: (current: PanelState) => PanelState) => void,
  projectId: string,
  taskId: string,
  generation: number,
  requestToken: symbol,
  update: (current: PanelState) => PanelState,
): void {
  setState((current) => current.projectId === projectId && current.taskId === taskId &&
    current.identityGeneration === generation && current.requestToken === requestToken
    ? update(current)
    : current);
}

function mergeHistory(...groups: readonly (readonly CheckHistoryEntry[])[]): readonly CheckHistoryEntry[] {
  const byId = new Map<string, CheckHistoryEntry>();
  for (const group of groups) {
    for (const entry of group) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return byTime || right.id.localeCompare(left.id);
  });
}
