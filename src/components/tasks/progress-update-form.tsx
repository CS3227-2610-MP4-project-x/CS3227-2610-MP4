"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { postProgressUpdate } from "./task-requests";

export type ProgressUpdateFormProps = Readonly<{ projectId: string; taskId: string }>;

// task-management "Progress updates" (design.md L4): 1 to 2,000 characters after trimming.
const PROGRESS_UPDATE_MAX = 2_000;
const REFUSED_MESSAGE = "This task has changed or you can no longer post updates on it. The page was refreshed; check the latest state.";

export function ProgressUpdateForm({ projectId, taskId }: ProgressUpdateFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, startTransition] = useTransition();
  const fieldId = useId();

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = body.trim();
    if (text.length === 0) {
      setMessage("Write an update before posting.");
      return;
    }
    if (text.length > PROGRESS_UPDATE_MAX) {
      setMessage("An update must be 2,000 characters or fewer.");
      return;
    }
    setBusy(true);
    setMessage("");
    const outcome = await postProgressUpdate(projectId, taskId, text);
    setBusy(false);
    if (outcome === "failed") {
      setMessage("Could not post the update. Try again.");
      return;
    }
    if (outcome === "stale") setMessage(REFUSED_MESSAGE);
    else setBody("");
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={post} className="space-y-3">
      <label htmlFor={fieldId} className="block text-sm font-medium text-neutral-200">Progress update</label>
      <textarea id={fieldId} value={body} onChange={(event) => setBody(event.target.value)} rows={3}
        className="w-full rounded-xl border border-white/10 bg-[#1b1b1b] px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-400/60 focus:outline-none"
        placeholder="What changed since your last update?" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || refreshing}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 text-sm font-semibold text-neutral-100 transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-60">
          {busy ? "Posting…" : "Post update"}
        </button>
        {message && <p role="status" aria-live="polite" className="text-sm text-amber-200">{message}</p>}
      </div>
    </form>
  );
}
