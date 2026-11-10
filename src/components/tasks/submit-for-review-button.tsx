"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeTaskState, staleMessage } from "./task-requests";
import { useTaskStatus } from "./task-status";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export type SubmitForReviewButtonProps = Readonly<{ projectId: string; taskId: string; taskKey: string; version: number }>;

// design.md B9: the assigned developer submits while In Progress. It is not blocked when there are
// no attached commits or no matching check (L5), and it runs no check itself.
export function SubmitForReviewButton({ projectId, taskId, taskKey, version }: SubmitForReviewButtonProps) {
  const router = useRouter();
  const announce = useTaskStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, startTransition] = useTransition();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    const outcome = await changeTaskState(projectId, taskId, { state: "In Review", version });
    setBusy(false);
    if (outcome === "failed") {
      setError("Could not submit the task for review. Try again.");
      return;
    }
    // F4: the button disappears after the refresh, so the outcome goes to the page-level region.
    announce(outcome === "ok" ? `Submitted ${taskKey} for review` : staleMessage(taskKey));
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={submit} disabled={busy || refreshing} aria-busy={busy || refreshing}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-[#08200f] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
        {busy ? "Submitting…" : "Submit for review"}
        {(busy || refreshing) && <LoadingSpinner />}
      </button>
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </div>
  );
}
