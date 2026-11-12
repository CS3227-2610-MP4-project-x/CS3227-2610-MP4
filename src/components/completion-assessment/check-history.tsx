export type CheckStatus = "addressed" | "not_addressed" | "unclear";

export type CheckLine = Readonly<{ reference: string; text: string }>;
export type CheckEvidenceExcerpt = Readonly<{ hunkId: string; lines: readonly CheckLine[] }>;
export type CheckEvidenceFile = Readonly<{
  path: string;
  commitSha: string;
  excerpts: readonly CheckEvidenceExcerpt[];
}>;
export type VerificationReason = "unknown_reference" | "missing_evidence";
export type CheckCriterionV1 = Readonly<{
  criterionId: string;
  criterion: string;
  status: CheckStatus;
  evidence: readonly string[];
}>;
export type CheckCriterionV2 = Readonly<{
  criterionId: string;
  criterion: string;
  status: CheckStatus;
  evidence: readonly [];
  evidenceFiles: readonly CheckEvidenceFile[];
  modelStatus: CheckStatus;
  verification: Readonly<{
    state: "verified" | "downgraded";
    reasonCodes: readonly VerificationReason[];
  }>;
}>;
export type CheckPayloadV1 = Readonly<{
  anchorSha: string;
  criteria: readonly CheckCriterionV1[];
  possibleGaps: readonly string[];
  omittedFiles: readonly string[];
}>;
export type CheckPayloadV2 = Readonly<{
  assessmentVersion: 2;
  anchorSha: string;
  criteria: readonly CheckCriterionV2[];
  possibleGaps: readonly string[];
  omittedFiles: readonly string[];
}>;
export type CheckPayload = CheckPayloadV1 | CheckPayloadV2;

export type CheckHistoryEntry = Readonly<{
  id: string;
  anchorSha: string;
  createdAt: string;
  redacted: boolean;
  payload: CheckPayload;
}>;

export type CheckHistoryProps = Readonly<{
  checkHistory: readonly CheckHistoryEntry[];
  /** Task 4.4 F1: the stored result the task's latest submission references, marked in the list. */
  referencedResultId?: string | null;
}>;

const STATUS: Readonly<Record<CheckStatus, { label: string; styles: string }>> = {
  addressed: { label: "Addressed", styles: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  unclear: { label: "Unclear", styles: "border-white/10 bg-white/5 text-neutral-300" },
  not_addressed: { label: "Not addressed", styles: "border-white/10 bg-white/5 text-neutral-300" },
};

const VERIFICATION_REASON: Readonly<Record<VerificationReason, string>> = {
  unknown_reference: "Some evidence references could not be verified against the assessed changes.",
  missing_evidence: "The model marked this criterion as addressed without verifiable evidence.",
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });
}

function EvidenceExcerpt({ excerpt }: { excerpt: CheckEvidenceExcerpt }) {
  return (
    <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all border-t border-white/[.07] px-4 py-3 font-mono text-xs leading-5 text-neutral-300"><code>{excerpt.lines.map((line) => line.text).join("\n")}</code></pre>
  );
}

function FileEvidence({ file }: { file: CheckEvidenceFile }) {
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-white/[.07]">
      <header className="min-w-0 max-w-full border-b border-white/[.07] bg-white/[.025] px-4 py-2">
        <p className="break-all font-mono text-xs text-neutral-200">{file.path}</p>
        <p className="mt-1 text-[11px] text-neutral-400">Commit <span className="break-all font-mono">{file.commitSha.slice(0, 12)}</span></p>
      </header>
      <div className="min-w-0 max-w-full divide-y divide-white/[.07]">
        {file.excerpts.map((excerpt, index) => (
          <div className="min-w-0 max-w-full" key={`${excerpt.hunkId}-${index}`}>
            {file.excerpts.length > 1 && <p className="break-all px-4 pt-2 font-mono text-[11px] text-neutral-500">Excerpt {index + 1}</p>}
            <EvidenceExcerpt excerpt={excerpt} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CriterionEvidence({ criterion }: { criterion: CheckCriterionV1 | CheckCriterionV2 }) {
  if ("evidenceFiles" in criterion) {
    if (criterion.evidenceFiles.length === 0) return <p className="ml-5 mt-2 min-w-0 text-xs text-neutral-400">No relevant changes were found in the assessed commits.</p>;
    return (
      <details className="ml-5 mt-3 min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[.08] bg-black/20">
        <summary className="cursor-pointer break-words px-4 py-3 text-xs font-medium text-neutral-300 hover:text-white">Evidence by file ({criterion.evidenceFiles.length})</summary>
        <div className="min-w-0 max-w-full space-y-3 border-t border-white/[.07] p-3">
          {criterion.evidenceFiles.map((file, index) => <FileEvidence key={`${file.commitSha}-${file.path}-${index}`} file={file} />)}
        </div>
      </details>
    );
  }

  if (criterion.evidence.length === 0) return <p className="ml-5 mt-2 min-w-0 text-xs text-neutral-400">No relevant changes were found in the assessed commits.</p>;
  return (
    <details className="ml-5 mt-3 min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[.08] bg-black/20">
      <summary className="cursor-pointer break-words px-4 py-3 text-xs font-medium text-neutral-300 hover:text-white">Evidence (diff excerpt)</summary>
      <p className="border-t border-white/[.07] px-4 py-2 text-xs text-neutral-400">File provenance unavailable for this historical result.</p>
      <pre className="min-w-0 max-w-full whitespace-pre-wrap break-all border-t border-white/[.07] px-4 py-3 font-mono text-xs leading-5 text-neutral-300"><code>{criterion.evidence.join("\n")}</code></pre>
    </details>
  );
}

function VerificationNote({ criterion }: { criterion: CheckCriterionV2 }) {
  if (criterion.verification.state !== "downgraded") return null;
  const reasons = criterion.verification.reasonCodes.map((reason) => VERIFICATION_REASON[reason]);
  return (
    <div className="ml-5 mt-3 min-w-0 max-w-full rounded-lg border border-amber-500/20 bg-amber-500/[.06] px-3 py-2 text-xs text-amber-100">
      <p className="font-medium">The final status was changed to Unclear because evidence could not be fully verified.</p>
      <p className="mt-1">Model status: <span className="font-semibold">{STATUS[criterion.modelStatus].label}</span></p>
      {reasons.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    </div>
  );
}

function CheckResult({ result, note }: { result: CheckHistoryEntry; note?: string }) {
  return (
    <article className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#202020] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
      <p className="flex min-w-0 max-w-full flex-wrap items-center gap-2 px-5 pt-4 text-xs font-medium uppercase tracking-[.14em] text-neutral-400">
        Check result
        {note && <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 normal-case tracking-normal text-neutral-200">{note}</span>}
      </p>
      <details className="group min-w-0 max-w-full">
        <summary className="flex min-w-0 max-w-full cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-2 marker:hidden hover:bg-white/[.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="break-all font-mono text-sm text-neutral-200">{result.anchorSha.slice(0, 12)}</span>
          </span>
          <time dateTime={result.createdAt} className="text-xs text-neutral-400">{formatTimestamp(result.createdAt)}</time>
          <span aria-hidden="true" className="ml-1 text-neutral-400 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="min-w-0 max-w-full border-t border-white/[.07]">
          <div className="min-w-0 max-w-full divide-y divide-white/[.07]">
            {result.payload.criteria.map((criterion) => {
              const status = STATUS[criterion.status];
              return (
                <section key={criterion.criterionId} className="min-w-0 max-w-full px-5 py-4">
                  <div className="flex min-w-0 max-w-full flex-wrap items-start gap-3">
                    <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${criterion.status === "addressed" ? "bg-emerald-400" : "bg-neutral-500"}`} />
                    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${status.styles}`}>{status.label}</span>
                    <h3 className="min-w-0 max-w-full flex-1 break-words text-sm font-medium leading-6 text-neutral-100">{criterion.criterion}</h3>
                  </div>
                  <CriterionEvidence criterion={criterion} />
                  {"verification" in criterion && <VerificationNote criterion={criterion} />}
                  {criterion.status === "unclear" && criterion.evidence.length > 0 && !("verification" in criterion && criterion.verification.state === "downgraded") && <p className="ml-5 mt-2 min-w-0 text-xs text-neutral-400">Evidence is incomplete. This criterion may need additional changes or context.</p>}
                </section>
              );
            })}
          </div>
          {result.redacted && <p className="min-w-0 max-w-full border-t border-white/[.07] px-5 py-3 text-xs text-neutral-400">Secrets were redacted before assessment.</p>}
          {result.payload.possibleGaps.length > 0 && (
            <section className="min-w-0 max-w-full border-t border-white/[.07] px-5 py-4">
              <h3 className="text-sm font-semibold text-neutral-100">Possible gaps</h3>
              <ul className="mt-2 list-disc space-y-1 break-words pl-5 text-sm text-neutral-300">{result.payload.possibleGaps.map((gap, index) => <li key={`${index}-${gap}`}>{gap}</li>)}</ul>
            </section>
          )}
          {result.payload.omittedFiles.length > 0 && (
            <details className="min-w-0 max-w-full border-t border-white/[.07] px-5 py-3">
              <summary className="cursor-pointer break-words text-sm font-medium text-neutral-300">Files not assessed ({result.payload.omittedFiles.length})</summary>
              <ul className="mt-3 min-w-0 max-w-full space-y-1 font-mono text-xs text-neutral-400">{result.payload.omittedFiles.map((path) => <li key={path} className="break-all">{path}</li>)}</ul>
            </details>
          )}
        </div>
      </details>
    </article>
  );
}

/** Task 4.4 F1: one stored result as its card, without the history caption or landmark. */
export function CheckResultCard({ result }: Readonly<{ result: CheckHistoryEntry }>) {
  return <CheckResult result={result} />;
}

export function CheckHistory({ checkHistory, referencedResultId }: CheckHistoryProps) {
  if (checkHistory.length === 0) {
    return <p className="min-w-0 max-w-full rounded-2xl border border-white/10 bg-[#202020] px-5 py-6 text-sm text-neutral-400">No acceptance criteria checks have been run yet.</p>;
  }

  return (
    <section aria-label="Acceptance criteria check history" className="min-w-0 max-w-full space-y-3">
      <p className="text-xs text-neutral-400">Advisory results · newest checks first</p>
      {checkHistory.map((result) => (
        <CheckResult key={result.id} result={result} note={result.id === referencedResultId ? "Referenced by the submission" : undefined} />
      ))}
    </section>
  );
}
