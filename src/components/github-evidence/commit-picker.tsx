"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type Branches = Readonly<{ defaultBranch: string; branches: readonly { name: string }[] }>;
type Commit = Readonly<{ sha: string; shortSha: string; message: string; authoredAt: string; mentionsTaskId: boolean }>;
type CommitPage = Readonly<{ since: string; until: string; branch: string; page: number; perPage: number; nextPage: number | null; commits: readonly Commit[] }>;

function sgtToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function sgtStart(date: string): string { return new Date(`${date}T00:00:00+08:00`).toISOString(); }
function sgtNext(date: string): string {
  const start = new Date(`${date}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

export function CommitPicker({ projectId, taskId, onAttached }: { projectId: string; taskId: string; onAttached?: (shas: readonly string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [branchData, setBranchData] = useState<Branches | null>(null);
  const [branch, setBranch] = useState("");
  const [startDate, setStartDate] = useState(sgtToday);
  const [endDate, setEndDate] = useState(sgtToday);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CommitPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loadingPage, setLoadingPage] = useState<"previous" | "next" | null>(null);
  const [message, setMessage] = useState("");
  const seenCommits = useRef<Set<string>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const api = `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
  const dateRangeValid = Boolean(startDate && endDate && startDate <= endDate);
  const query = useMemo(() => new URLSearchParams({
    ...(dateRangeValid ? { since: sgtStart(startDate), until: sgtNext(endDate) } : {}),
    page: String(page), perPage: "50", ...(branch ? { branch } : {}),
  }), [startDate, endDate, page, branch, dateRangeValid]);

  function closeDialog() {
    setOpen(false);
    setLoadingPage(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])");
    firstFocusable?.focus();
  }, [open]);

  function trapDialogKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  useEffect(() => {
    if (!open || !dateRangeValid) return;
    let cancelled = false;
    Promise.all([
      branchData ? Promise.resolve(branchData) : fetch(`${api}/github-evidence/branches`, { cache: "no-store" }).then(async (response) => {
        const value = await response.json(); if (!response.ok) throw new Error("Repository evidence is unavailable. Check the project link and retry."); return value as Branches;
      }),
      fetch(`${api}/github-evidence/commits?${query.toString()}`, { cache: "no-store" }).then(async (response) => {
        const value = await response.json(); if (!response.ok) throw new Error("Could not load commits. Check repository access and retry."); return value as CommitPage;
      }),
    ]).then(([branchResult, commitResult]) => {
      if (cancelled) return;
      setBranchData(branchResult);
      const nextBranch = branch || commitResult.branch || branchResult.defaultBranch;
      if (!branch && nextBranch !== branch) {
        setBranch(nextBranch);
        setData(null);
      } else setData(commitResult);
      setSelected((current) => {
        const next = new Set(current);
        for (const commit of commitResult.commits) {
          if (!seenCommits.current.has(commit.sha) && commit.mentionsTaskId) next.add(commit.sha);
          seenCommits.current.add(commit.sha);
        }
        return next;
      });
    }).catch((error: unknown) => { if (!cancelled) { setData(null); setMessage(error instanceof Error ? error.message : "Repository evidence is unavailable."); } })
      .finally(() => { if (!cancelled) { setBusy(false); setLoadingPage(null); } });
    return () => { cancelled = true; };
  }, [open, api, query, branch, branchData, dateRangeValid]);

  function changeFilter(update: () => void) { update(); setLoadingPage(null); setPage(1); setData(null); setMessage(""); }
  function changePage(nextPage: number) { setLoadingPage(nextPage < page ? "previous" : "next"); setPage(nextPage); setMessage(""); }
  const loading = busy || loadingPage !== null || (open && dateRangeValid && data === null && message === "");
  async function attach() {
    setBusy(true); setMessage("");
    try {
      const shas = [...selected];
      const response = await fetch(`${api}/attached-commits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commitShas: shas }) });
      const body = await response.json();
      if (!response.ok) throw new Error("Selected commits could not be attached. Verify each commit is yours and retry.");
      onAttached?.(shas); setMessage(`${body.attachedCommits.length} commit${body.attachedCommits.length === 1 ? "" : "s"} attached.`); closeDialog();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not attach commits."); }
    finally { setBusy(false); }
  }

  return <>
    <button ref={triggerRef} type="button" onClick={() => { seenCommits.current.clear(); setSelected(new Set()); setData(null); setMessage(""); setOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-neutral-100 hover:bg-white/10">＋ Add commits</button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="commit-picker-title" tabIndex={-1} onKeyDown={trapDialogKeys} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-[#222] p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-5"><div><h2 id="commit-picker-title" className="text-xl font-semibold">Select your commits</h2><p className="mt-1 text-sm text-neutral-400">Only commits authored by your verified GitHub account are shown.</p></div>
          <button type="button" aria-label="Close commit picker" onClick={closeDialog} className="rounded-md px-2 py-1 text-xl text-neutral-400 hover:bg-white/10">×</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-400">From (SGT)<input type="date" value={startDate} onChange={(event) => changeFilter(() => setStartDate(event.target.value))} className="mt-1 block min-h-10 w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 text-sm text-neutral-100" /></label>
          <label className="text-xs text-neutral-400">Through (SGT)<input type="date" value={endDate} onChange={(event) => changeFilter(() => setEndDate(event.target.value))} className="mt-1 block min-h-10 w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 text-sm text-neutral-100" /></label>
          <label className="text-xs text-neutral-400">Branch<select value={branch || branchData?.defaultBranch || ""} onChange={(event) => changeFilter(() => setBranch(event.target.value))} className="mt-1 block min-h-10 w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 text-sm text-neutral-100">{branchData?.branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label></div>
        {!dateRangeValid && <p role="alert" className="mt-4 text-sm text-amber-300">Choose an end date on or after the start date.</p>}
        {loading && <p role="status" className="mt-5 text-sm text-neutral-400">Loading repository evidence…</p>}
        {!loading && data?.commits.length === 0 && <p className="mt-5 rounded-lg bg-white/5 p-4 text-sm text-neutral-300">No commits found for this date and branch.</p>}
        {data && !loading && data.commits.length > 0 && <div className="mt-5 divide-y divide-white/10 rounded-lg border border-white/10">{data.commits.map((commit) => <label key={commit.sha} className="flex cursor-pointer items-start gap-3 p-4 hover:bg-white/[.03]">
          <input type="checkbox" checked={selected.has(commit.sha)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(commit.sha); else next.delete(commit.sha); return next; })} className="mt-1 accent-emerald-400" />
          <span className="min-w-0 flex-1"><span className="block text-sm leading-5 text-neutral-100">{commit.message}</span><span className="mt-2 flex flex-wrap gap-x-3 text-xs text-neutral-400"><span className="font-mono">{commit.shortSha}</span><time dateTime={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}</time>{commit.mentionsTaskId && <span className="text-emerald-300">Matches this task</span>}</span></span>
        </label>)}</div>}
        {data && <div className="mt-4 flex items-center justify-between"><button type="button" disabled={page <= 1 || loading} aria-busy={loadingPage === "previous"} onClick={() => changePage(page - 1)} className="rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-40">Previous{loadingPage === "previous" && <LoadingSpinner />}</button><span className="text-xs text-neutral-400">Page {page} · {selected.size} selected</span><button type="button" disabled={!data.nextPage || loading} aria-busy={loadingPage === "next"} onClick={() => changePage(data.nextPage!)} className="rounded-md border border-white/10 px-3 py-2 text-sm disabled:opacity-40">Next{loadingPage === "next" && <LoadingSpinner />}</button></div>}
        {message && <p role="status" aria-live="polite" className="mt-4 rounded-md bg-white/5 p-3 text-sm text-neutral-300">{message}</p>}
        <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-5"><button type="button" onClick={closeDialog} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button><button type="button" disabled={busy || selected.size === 0} aria-busy={busy} onClick={attach} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">Attach commits{busy && <LoadingSpinner />}</button></div>
      </section>
    </div>}
  </>;
}
