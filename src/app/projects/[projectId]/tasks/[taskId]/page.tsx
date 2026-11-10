import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CheckHistory } from "@/components/completion-assessment/check-history";
import { DeveloperCheckPanel } from "@/components/completion-assessment/developer-check-panel";
import { ProgressUpdateForm } from "@/components/tasks/progress-update-form";
import { SubmitForReviewButton } from "@/components/tasks/submit-for-review-button";
import { TaskCommitPicker } from "@/components/tasks/task-commit-picker";
import { TaskStatusProvider } from "@/components/tasks/task-status";
import { TaskManager } from "@/components/tasks/task-manager";
import type { ProjectMemberView } from "@/server/projects";
import {
  AttachedCommitList, ReadFailureNotice, StateBadge, TaskPageShell, UnavailableNotice, formatDueDate, formatTimestamp,
} from "@/components/tasks/task-page-parts";
import { requirePagePathId, requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import { TaskDetailServiceError, type TaskDetailView } from "@/server/task-detail";
import { taskStateName } from "@/server/task-board";

export const dynamic = "force-dynamic";

type DetailOutcome =
  | Readonly<{ kind: "detail"; detail: TaskDetailView }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "failed" }>;

// task-management "Task detail page" and "Task detail actions follow the role"; design.md B2, B9,
// B10. The 5.3 host page, expanded: it reads through the unchanged task-detail read.
export default async function TaskDetailPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const { projectId, taskId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  requirePagePathId(taskId);
  let outcome: DetailOutcome;
  try {
    outcome = { kind: "detail", detail: await composition.taskDetailService.getTaskDetail(projectId, taskId, access) };
  } catch (error) {
    const code = error instanceof TaskDetailServiceError ? error.code : "INTERNAL_ERROR";
    outcome = code === "FORBIDDEN" ? { kind: "unavailable" } : code === "NOT_FOUND" ? { kind: "not-found" } : { kind: "failed" };
  }
  if (outcome.kind === "not-found") notFound();

  if (outcome.kind === "unavailable") {
    return <TaskPageShell crumb="Task"><UnavailableNotice>This task is unavailable: you are not its assigned developer.</UnavailableNotice></TaskPageShell>;
  }
  if (outcome.kind === "failed") {
    return <TaskPageShell crumb="Task"><ReadFailureNotice>The task could not be loaded. Reload the page to try again.</ReadFailureNotice></TaskPageShell>;
  }

  const { task, attachedCommits, progressUpdates, reviewFeedback, checkHistory } = outcome.detail;
  const isAssignedDeveloper = access.role === "developer";
  const state = taskStateName(task.status);
  let members: readonly ProjectMemberView[] | null = null;
  if (access.role === "product_manager") {
    try { members = await composition.projectService.listMembers(projectId, access.personId); }
    catch { /* Edit and delete remain available without assignee choices. */ }
  }

  return (
    <TaskPageShell crumb={task.taskKey} projectBreadcrumb={{ projectId, taskKey: task.taskKey }} wide={isAssignedDeveloper}>
      <TaskStatusProvider>
      {isAssignedDeveloper ? (
        <>
          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
            <article className="rounded-2xl border border-white/10 bg-[#222] p-6 sm:p-8">
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-neutral-400">{task.taskKey}</span>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight">{task.title}</h1>
                </div>
                {task.status === "in_progress" && (
                  <div className="ml-auto shrink-0"><SubmitForReviewButton projectId={projectId} taskId={task.id} taskKey={task.taskKey} version={task.version} /></div>
                )}
              </header>
              <section className="mt-8">
                <h2 className="mb-3 text-lg font-semibold text-neutral-100">Description</h2>
                <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{task.description}</p>
              </section>
              <section className="mt-8">
                <h2 className="mb-3 text-lg font-semibold text-neutral-100">Acceptance criteria</h2>
                <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-neutral-200">
                  {task.acceptanceCriteria.map((criterion) => <li key={criterion.id}>{criterion.description}</li>)}
                </ol>
              </section>
              <section className="mt-8 border-t border-white/10 pt-6">
                <h2 className="mb-3 text-lg font-semibold text-neutral-100">Post a progress update</h2>
                <ProgressUpdateForm projectId={projectId} taskId={task.id} />
              </section>
            </article>

            <aside className="grid gap-6">
              <Panel title="Details">
                <dl className="grid gap-4 text-sm">
                  <div><dt className="text-neutral-400">Assignee</dt><dd className="mt-1 text-neutral-100">{task.assignee.githubUsername}</dd></div>
                  <div><dt className="text-neutral-400">Branch</dt><dd className="mt-1 break-all font-mono text-neutral-100">{task.branchName ?? "No branch recorded"}</dd></div>
                  <div><dt className="text-neutral-400">Status</dt><dd className="mt-1"><StateBadge state={state} /></dd></div>
                  <div><dt className="text-neutral-400">Due date</dt><dd className="mt-1 text-neutral-100"><time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time></dd></div>
                </dl>
              </Panel>

              <Panel title="Progress updates">
                <DeveloperProgressTimeline updates={[...progressUpdates].reverse()} />
              </Panel>

              <Panel title="Attached commits">
                <AttachedCommitList commits={attachedCommits} />
                <div className="mt-5"><TaskCommitPicker projectId={projectId} taskId={task.id} /></div>
              </Panel>
            </aside>
          </div>

          <div className="mt-6 grid gap-6">
            <Panel title="Review feedback"><ReviewFeedback feedback={reviewFeedback} /></Panel>
            <section className="rounded-2xl border border-white/10 bg-[#222] p-6">
              <DeveloperCheckPanel projectId={projectId} taskId={task.id} checkHistory={checkHistory} />
            </section>
          </div>
        </>
      ) : (
        <>
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-neutral-400">{task.taskKey}</span>
              <StateBadge state={state} />
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{task.title}</h1>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-neutral-400">Assignee</dt><dd className="text-neutral-100">{task.assignee.githubUsername}</dd></div>
              <div><dt className="text-neutral-400">Due date</dt><dd className="text-neutral-100"><time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time></dd></div>
              <div><dt className="text-neutral-400">Branch</dt><dd className="break-all font-mono text-neutral-100">{task.branchName ?? "No branch recorded"}</dd></div>
            </dl>
          </header>
          <TaskManager projectId={projectId} task={task} members={members} />

          <div className="mt-8 grid gap-6">
            <Panel title="Description">
              <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{task.description}</p>
            </Panel>
            <Panel title="Acceptance criteria">
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-neutral-200">
                {task.acceptanceCriteria.map((criterion) => <li key={criterion.id}>{criterion.description}</li>)}
              </ol>
            </Panel>
            <Panel title="Attached commits"><AttachedCommitList commits={attachedCommits} /></Panel>
            <Panel title="Progress updates">
              <ProgressUpdates updates={progressUpdates} />
            </Panel>
            <Panel title="Review feedback"><ReviewFeedback feedback={reviewFeedback} /></Panel>
            <section className="rounded-2xl border border-white/10 bg-[#222] p-6">
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-neutral-100">Acceptance Criteria Check</h2>
              <CheckHistory checkHistory={checkHistory} />
            </section>
          </div>
        </>
      )}
      </TaskStatusProvider>
    </TaskPageShell>
  );
}

function ProgressUpdates({ updates }: Readonly<{ updates: TaskDetailView["progressUpdates"] }>) {
  return updates.length === 0
    ? <p className="text-sm text-neutral-400">No progress updates yet.</p>
    : <ol className="space-y-3">{updates.map((update) => (
        <li key={update.id} className="rounded-xl border border-white/[.07] bg-black/20 p-3">
          <ProgressUpdateEntry update={update} />
        </li>
      ))}</ol>;
}

function DeveloperProgressTimeline({ updates }: Readonly<{ updates: TaskDetailView["progressUpdates"] }>) {
  return updates.length === 0
    ? <p className="text-sm text-neutral-400">No progress updates yet.</p>
    : <ol className="ml-2 space-y-4 border-l border-white/15 pl-5">{updates.map((update) => (
        <li key={update.id} className="relative py-1">
          <span aria-hidden="true" className="absolute -left-[1.56rem] top-1.5 size-3 rounded-full border-[3px] border-[#222] bg-emerald-400" />
          <ProgressUpdateEntry update={update} />
        </li>
      ))}</ol>;
}

function ProgressUpdateEntry({ update }: Readonly<{ update: TaskDetailView["progressUpdates"][number] }>) {
  return <>
    <p className="text-xs text-neutral-400">{update.author.githubUsername} · <time dateTime={update.createdAt}>{formatTimestamp(update.createdAt)}</time></p>
    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-200">{update.body}</p>
  </>;
}

function ReviewFeedback({ feedback }: Readonly<{ feedback: TaskDetailView["reviewFeedback"] }>) {
  return feedback.length === 0
    ? <p className="text-sm text-neutral-400">No review feedback yet.</p>
    : <ol className="space-y-3">{feedback.map((item) => (
        <li key={item.id} className="rounded-xl border border-white/[.07] bg-black/20 p-3">
          <p className="text-xs text-neutral-400">{item.author.githubUsername} · <time dateTime={item.createdAt}>{formatTimestamp(item.createdAt)}</time></p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-200">{item.feedback}</p>
        </li>
      ))}</ol>;
}

function Panel({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#222] p-6">
      <h2 className="mb-3 text-lg font-semibold text-neutral-100">{title}</h2>
      {children}
    </section>
  );
}
