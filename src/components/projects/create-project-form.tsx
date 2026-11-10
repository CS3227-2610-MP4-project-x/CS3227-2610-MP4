"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { createProject } from "./project-actions";

function createFailureMessage(response: Response): string {
  if (response.status === 409) return "That project key is already in use. Choose another key.";
  if (response.status === 400) return "Check the project key and name, then try again.";
  if (response.status === 401) return "Your session has expired. Sign in again before creating a project.";
  return "The project could not be created. Try again.";
}

export function CreateProjectForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await createProject({ key, name });
      if (!response.ok) {
        setMessage(createFailureMessage(response));
        if (response.status === 401) router.refresh();
        return;
      }
      const project = await response.json() as { id?: unknown };
      if (typeof project.id !== "string" || !project.id) {
        setMessage("The project was created, but its board could not be opened. Reload your workspace.");
        router.refresh();
        return;
      }
      router.push(`/projects/${encodeURIComponent(project.id)}/board`);
      router.refresh();
    } catch {
      setMessage("The project could not be created. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-[#222] p-6 shadow-xl sm:p-9">
      <div className="grid gap-5">
        <label htmlFor="project-key" className="grid gap-2 text-sm font-medium text-neutral-200">
          Project key
          <input id="project-key" name="key" value={key} onChange={(event) => setKey(event.target.value)} maxLength={10} autoComplete="off" required
            aria-describedby="project-key-help" className="min-h-11 rounded-lg border border-white/15 bg-[#1a1a1a] px-3 text-neutral-100 outline-none focus:border-emerald-400" />
        </label>
        <p id="project-key-help" className="-mt-4 text-xs text-neutral-400">Use 2–10 uppercase letters and digits, starting with a letter. Lowercase keys are not changed automatically.</p>
        <label htmlFor="project-name" className="grid gap-2 text-sm font-medium text-neutral-200">
          Project name
          <input id="project-name" name="name" value={name} onChange={(event) => setName(event.target.value)} required
            className="min-h-11 rounded-lg border border-white/15 bg-[#1a1a1a] px-3 text-neutral-100 outline-none focus:border-emerald-400" />
        </label>
      </div>
      {message && <p role="alert" aria-live="polite" className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/[.06] px-4 py-3 text-sm text-amber-200">{message}</p>}
      <button type="submit" disabled={pending} aria-busy={pending} className="mt-7 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
        {pending ? "Creating project…" : "Create project"}
        {pending && <LoadingSpinner />}
      </button>
    </form>
  );
}
