import { PendingLink } from "@/components/ui/pending-link";
import type { ReactNode } from "react";

// Presentational pieces shared by the board, task-detail and review-queue pages. No data access.

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });
}

/** A `YYYY-MM-DD` due date as en-SG day, month and year, for example "1 Dec 2026" (F9). */
export function formatDueDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-SG", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

export function TaskPageShell({ crumb, children }: Readonly<{ crumb: string; children: ReactNode }>) {
  return (
    <main className="px-5 pb-16 pt-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-neutral-400">
          <PendingLink href="/" className="hover:text-white">Workspace</PendingLink><span aria-hidden="true"> / </span><span>{crumb}</span>
        </nav>
        {children}
      </div>
    </main>
  );
}

/** design.md B10: the safe inline view for a role refusal, with no task or check data. */
export function UnavailableNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <p role="status" className="max-w-xl rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-neutral-300">{children}</p>;
}

/** A safe message for a failed read; it never carries the failure's detail. */
export function ReadFailureNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <p role="alert" className="max-w-xl rounded-lg border border-amber-500/20 bg-amber-500/[.06] p-4 text-sm text-amber-200">{children}</p>;
}

// F8, ui-spec "Color System": monochrome for To Do, In Progress and In Review; the green accent
// only for Done. The colours live in the globals.css classes.
export function StateBadge({ state }: Readonly<{ state: string }>) {
  return <span className={state === "Done" ? "task-state-badge task-state-badge-done" : "task-state-badge"}>{state}</span>;
}

type AttachedCommit = Readonly<{ id: string; sha: string; attachedBy: Readonly<{ githubUsername: string }>; attachedAt: string }>;

/** Attached commits with their short SHA, who attached them and when (task detail and review queue). */
export function AttachedCommitList({ commits }: Readonly<{ commits: readonly AttachedCommit[] }>) {
  if (commits.length === 0) return <p className="text-sm text-neutral-400">No commits are attached yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {commits.map((commit) => (
        <li key={commit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <code className="font-mono text-neutral-100">{commit.sha.slice(0, 7)}</code>
          <span className="text-neutral-400">attached by {commit.attachedBy.githubUsername}</span>
          <time dateTime={commit.attachedAt} className="text-xs text-neutral-500">{formatTimestamp(commit.attachedAt)}</time>
        </li>
      ))}
    </ul>
  );
}
