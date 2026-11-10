"use client";

import { useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PendingReloadButton } from "@/components/ui/pending-reload-button";

type Repository = Readonly<{ repositoryId: number; owner: string; name: string; private: boolean; defaultBranch: string }>;
type BindingState = Readonly<{ kind: "linked"; binding: Readonly<{ owner: string; name: string }> }> | Readonly<{ kind: "unlinked" | "unavailable" }>;

export function ProjectRepositorySettings({ projectId, snapshotId, initialBindingState }: {
  projectId: string; snapshotId?: string; initialBindingState: BindingState;
}) {
  const [bindingState, setBindingState] = useState(initialBindingState);
  const binding = bindingState.kind === "linked" ? bindingState.binding : null;
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"setup" | "link" | null>(null);
  const [loadedSnapshotId, setLoadedSnapshotId] = useState<string | undefined>();
  const loadingSnapshot = Boolean(snapshotId) && loadedSnapshotId !== snapshotId;
  const root = `/api/v1/projects/${encodeURIComponent(projectId)}/github-repository`;

  useEffect(() => {
    if (!snapshotId) return;
    let cancelled = false;
    fetch(`${root}/snapshots/${encodeURIComponent(snapshotId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error("This repository list expired or is unavailable. Start setup again.");
        return body.repositories as Repository[];
      })
      .then((value) => { if (!cancelled) { setLoadedSnapshotId(snapshotId); setRepositories(value); setMessage(value.length ? "Choose a repository available to the verified installation." : "No repositories are available to this installation. Configure access in GitHub and retry."); } })
      .catch((error: unknown) => { if (!cancelled) { setLoadedSnapshotId(snapshotId); setMessage(error instanceof Error ? error.message : "Repository setup is unavailable. Try again."); } });
    return () => { cancelled = true; };
  }, [root, snapshotId]);

  async function startSetup() {
    setBusy(true); setPendingAction("setup"); setMessage("");
    try {
      const response = await fetch(`${root}/setup-url`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || typeof body.setupUrl !== "string") throw new Error("Could not start GitHub setup. Check your project access and retry.");
      window.location.assign(body.setupUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start GitHub setup."); setBusy(false); setPendingAction(null); }
  }

  async function linkRepository() {
    if (selected === null || !snapshotId) return;
    setBusy(true); setPendingAction("link"); setMessage("");
    try {
      const response = await fetch(root, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId, repositoryId: selected }) });
      if (!response.ok) throw new Error("The repository could not be linked. Your current repository remains unchanged.");
      const repo = repositories.find((item) => item.repositoryId === selected);
      if (repo) setBindingState({ kind: "linked", binding: { owner: repo.owner, name: repo.name } });
      setRepositories([]); setMessage("Repository linked to this project.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Repository setup is unavailable."); }
    finally { setBusy(false); setPendingAction(null); }
  }

  const unavailable = bindingState.kind === "unavailable";
  return <section aria-labelledby="github-repository-heading" className="w-full rounded-2xl border border-white/10 bg-[#222] p-6 shadow-xl sm:p-9">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-neutral-400">Project settings</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">GitHub repository</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Connect one repository through the GitHub App so developers can attach commits to their tasks.</p></div>
      <span className={`rounded-full border px-3 py-1.5 text-xs ${binding ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : unavailable ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-white/10 bg-white/5 text-neutral-300"}`}>
        <span aria-hidden="true">● </span>{binding ? "Repository linked" : unavailable ? "Status unavailable" : "Not linked"}</span>
    </div>
    <div className="mt-8 rounded-xl border border-white/10 bg-[#1d1d1d] p-5 sm:p-6">
      <div className="flex items-start gap-4"><span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">⌘</span>
        <div className="min-w-0 flex-1"><h3 id="github-repository-heading" className="font-semibold">{binding ? "Connected repository" : unavailable ? "Repository status could not be loaded" : "Install or configure GitHub App"}</h3>
          <p className="mt-2 text-sm leading-6 text-neutral-400">{binding ? "The repository is available for commit evidence." : unavailable ? "We could not verify this project's current repository link. Reload Project Settings to try again." : "GitHub will ask you to choose an account or organization and grant the App repository access. We verify that access before showing repositories here."}</p>
          {binding && <p className="mt-4 break-all rounded-lg bg-white/5 px-4 py-3 font-mono text-sm text-neutral-100">{binding.owner}/{binding.name}</p>}
          {unavailable ? <PendingReloadButton className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg border border-white/10 px-4 text-sm font-semibold hover:bg-white/5">Reload status</PendingReloadButton> : <button type="button" disabled={busy || loadingSnapshot} aria-busy={pendingAction === "setup"} onClick={startSetup} className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">{binding ? "Change repository" : "Install or configure GitHub App"}{pendingAction === "setup" && <LoadingSpinner />}</button>}
        </div></div>
    </div>
    {loadingSnapshot && <p role="status" className="mt-5 text-sm text-neutral-400">Loading verified repositories…</p>}
    {repositories.length > 0 && !loadingSnapshot && <div className="mt-6 rounded-xl border border-white/10 bg-[#1d1d1d] p-5 sm:p-6">
      <h2 className="font-semibold">Choose a repository</h2><p className="mt-1 text-sm text-neutral-400">Only repositories returned by the verified setup are listed.</p>
      <div className="mt-4 divide-y divide-white/10">{repositories.map((repo) => <label key={repo.repositoryId} className="flex cursor-pointer items-center gap-3 py-4">
        <input type="radio" name="repository" checked={selected === repo.repositoryId} onChange={() => setSelected(repo.repositoryId)} className="accent-emerald-400" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{repo.owner}/{repo.name}</span><span className="mt-1 block text-xs text-neutral-400">{repo.private ? "Private" : "Public"} · default branch {repo.defaultBranch || "not set"}</span></span>
      </label>)}</div>
      <button type="button" disabled={busy || selected === null} aria-busy={pendingAction === "link"} onClick={linkRepository} className="mt-4 min-h-10 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-black disabled:opacity-50">Link selected repository{pendingAction === "link" && <LoadingSpinner />}</button>
    </div>}
    {message && <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">{message}</p>}
  </section>;
}
