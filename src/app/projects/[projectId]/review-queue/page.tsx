import Link from "next/link";
import { CheckHistory, CheckResultCard } from "@/components/completion-assessment/check-history";
import { ReviewActions } from "@/components/tasks/review-actions";
import { AttachedCommitList, ReadFailureNotice, TaskPageShell, UnavailableNotice, formatDueDate } from "@/components/tasks/task-page-parts";
import { TaskStatusProvider } from "@/components/tasks/task-status";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { ReviewQueueServiceError, type ReviewQueueEntry, type ReviewQueueView } from "@/server/review-queue";

export const dynamic = "force-dynamic";

type QueueOutcome =
  | Readonly<{ kind: "queue"; view: ReviewQueueView }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "failed" }>;

// task-management "Product manager reads the review queue" and "Review queue actions and access";
// design.md B2, B5, B7, B8, B10. The page starts no check; actions use the task state route only.
export default async function ReviewQueuePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  let outcome: QueueOutcome;
  try {
    outcome = { kind: "queue", view: await composition.reviewQueueService.getReviewQueue(projectId, access) };
  } catch (error) {
    outcome = error instanceof ReviewQueueServiceError && error.code === "FORBIDDEN" ? { kind: "unavailable" } : { kind: "failed" };
  }

  return (
    <TaskPageShell crumb="Review queue">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Review queue</h1>
        {outcome.kind === "queue" && <p className="mt-2 text-sm text-neutral-400">Tasks submitted for review, by task number.</p>}
      </header>
      {outcome.kind === "unavailable" && <UnavailableNotice>The review queue is unavailable: only the project&apos;s product manager can review tasks.</UnavailableNotice>}
      {outcome.kind === "failed" && <ReadFailureNotice>The review queue could not be loaded. Reload the page to try again.</ReadFailureNotice>}
      {outcome.kind === "queue" && (outcome.view.entries.length === 0
        ? <p className="rounded-2xl border border-white/10 bg-[#202020] px-5 py-6 text-sm text-neutral-400">No tasks are waiting for review.</p>
        : <TaskStatusProvider>
            <div className="space-y-6">{outcome.view.entries.map((entry) => <QueueEntry key={entry.id} projectId={projectId} entry={entry} />)}</div>
          </TaskStatusProvider>)}
    </TaskPageShell>
  );
}

function QueueEntry({ projectId, entry }: Readonly<{ projectId: string; entry: ReviewQueueEntry }>) {
  const headingId = `review-entry-${entry.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-white/10 bg-[#222] p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="font-mono text-sm text-neutral-400">{entry.taskKey}</span>
          <h2 id={headingId} className="mt-1 text-xl font-semibold tracking-tight text-neutral-100">
            <Link href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(entry.id)}`} className="hover:underline">{entry.title}</Link>
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {entry.assignee.githubUsername} · due <time dateTime={entry.dueDate}>{formatDueDate(entry.dueDate)}</time>
          </p>
        </div>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-100">Attached commits</h3>
            <AttachedCommitList commits={entry.attachedCommits} />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-100">Result referenced by the submission</h3>
            {entry.referencedResult
              ? <CheckResultCard result={entry.referencedResult} />
              : <p className="text-sm text-neutral-400">No check result is referenced by the latest submission.</p>}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-100">Check history</h3>
            <CheckHistory checkHistory={entry.checkHistory} referencedResultId={entry.referencedResult?.id ?? null} />
          </section>
        </div>

        <aside aria-label={`Review ${entry.taskKey}`}>
          <ReviewActions projectId={projectId} taskId={entry.id} taskKey={entry.taskKey} version={entry.version} />
        </aside>
      </div>
    </section>
  );
}
