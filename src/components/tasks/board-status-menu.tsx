"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeTaskState, staleMessage } from "./task-requests";
import type { TaskState } from "@/server/tasks";
import { developerBoardMove } from "./board-moves";
import { useTaskStatus } from "./task-status";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export type BoardStatusMenuProps = Readonly<{ projectId: string; taskId: string; taskKey: string; version: number; state: TaskState }>;

export function BoardStatusMenu({ projectId, taskId, taskKey, version, state }: BoardStatusMenuProps) {
  const router = useRouter();
  const announce = useTaskStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, startTransition] = useTransition();
  // design.md B8: only the developer's own permitted move from this state; otherwise nothing.
  const move = developerBoardMove(state);
  if (!move) return null;
  const nextMove = move;

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError("");
    const outcome = await changeTaskState(projectId, taskId, { state: nextMove.state, version });
    setBusy(false);
    if (outcome === "failed") {
      setError("Could not change the status. Try again.");
      return;
    }
    // F4: announced in the page-level region, which survives this card moving after the refresh.
    announce(outcome === "ok" ? nextMove.announcement(taskKey) : staleMessage(taskKey));
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-3">
      <details className="group relative">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-neutral-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 [&::-webkit-details-marker]:hidden">
          Change status <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-2 rounded-lg border border-white/10 bg-[#2a2a2a] p-1">
          <button type="button" onClick={apply} disabled={busy || refreshing} aria-busy={busy || refreshing}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-neutral-100 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60">
            {move.label}
            {(busy || refreshing) && <LoadingSpinner />}
          </button>
        </div>
      </details>
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-amber-200">{error}</p>}
    </div>
  );
}
