"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { changeTaskState, staleMessage, type StateChange } from "./task-requests";
import { useTaskStatus } from "./task-status";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export type ReviewActionsProps = Readonly<{ projectId: string; taskId: string; taskKey: string; version: number }>;

// task-management "Review queue actions and access", design.md L3: Request changes needs feedback
// that trims to 1 to 5,000 characters; nothing is sent otherwise.
const FEEDBACK_MAX = 5_000;

export function ReviewActions({ projectId, taskId, taskKey, version }: ReviewActionsProps) {
  const router = useRouter();
  const announce = useTaskStatus();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<"approve" | "request_changes" | null>(null);
  const [error, setError] = useState("");
  const [refreshing, startTransition] = useTransition();
  const fieldId = useId();

  async function apply(change: StateChange, success: string, action: "approve" | "request_changes") {
    setBusy(true);
    setActiveAction(action);
    setError("");
    const outcome = await changeTaskState(projectId, taskId, change);
    setBusy(false);
    if (outcome === "failed") {
      setActiveAction(null);
      setError("Could not record the review. Try again.");
      return;
    }
    // F4: the entry leaves the queue after the refresh, so the outcome goes to the page-level region.
    if (outcome === "ok") setFeedback("");
    announce(outcome === "ok" ? success : staleMessage(taskKey));
    startTransition(() => {
      setActiveAction(null);
      router.refresh();
    });
  }

  async function approve() {
    if (busy) return;
    await apply({ state: "Done", version }, `Approved ${taskKey}`, "approve");
  }

  async function requestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = feedback.trim();
    if (text.length === 0) {
      setError("Enter feedback for the developer before requesting changes.");
      return;
    }
    if (text.length > FEEDBACK_MAX) {
      setError("Feedback must be 5,000 characters or fewer.");
      return;
    }
    await apply({ state: "In Progress", version, feedback: text }, `Requested changes on ${taskKey}`, "request_changes");
  }

  const disabled = busy || refreshing;
  return (
    <div className="space-y-3">
      <button type="button" onClick={approve} disabled={disabled} aria-busy={activeAction === "approve"}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-[#08200f] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
        Approve
        {activeAction === "approve" && <LoadingSpinner />}
      </button>
      <form onSubmit={requestChanges} className="space-y-2">
        <label htmlFor={fieldId} className="block text-sm font-medium text-neutral-200">Feedback for the developer</label>
        <textarea id={fieldId} value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3}
          className="w-full rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-400/60 focus:outline-none"
          placeholder="Required when requesting changes" />
        <button type="submit" disabled={disabled} aria-busy={activeAction === "request_changes"}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 text-sm font-semibold text-neutral-100 transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-60">
          Request changes
          {activeAction === "request_changes" && <LoadingSpinner />}
        </button>
      </form>
      {/* F12: validation and failure messages are alerts next to the form. */}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </div>
  );
}
