import type { ReactNode } from "react";
import { PendingLink } from "@/components/ui/pending-link";
import { developerBoardMove } from "@/components/tasks/board-moves";
import { BoardStatusMenu } from "@/components/tasks/board-status-menu";
import { ReadFailureNotice, TaskPageShell, formatDueDate } from "@/components/tasks/task-page-parts";
import { TaskStatusProvider } from "@/components/tasks/task-status";
import { TaskManager } from "@/components/tasks/task-manager";
import type { ProjectMemberView } from "@/server/projects";
import { requireProjectPageAccess } from "@/server/auth";
import { getServerComposition } from "@/server/composition";
import type { BoardCard, TaskBoardView } from "@/server/task-board";

export const dynamic = "force-dynamic";

type CardAction = (projectId: string, card: BoardCard) => ReactNode;

// design.md B8: the product manager has no board menu; an In Review card links to the review queue.
function managerCardAction(projectId: string, card: BoardCard): ReactNode {
  if (card.state !== "In Review") return null;
  return (
    <PendingLink href={`/projects/${encodeURIComponent(projectId)}/review-queue`} className="mt-3 inline-block text-xs font-medium text-neutral-200 underline decoration-white/30 underline-offset-4 hover:text-white">
      Review in the queue →
    </PendingLink>
  );
}

// design.md B8: the developer's own permitted move only (the board service sends only own tasks).
function developerCardAction(projectId: string, card: BoardCard): ReactNode {
  if (!developerBoardMove(card.state)) return null;
  return <BoardStatusMenu projectId={projectId} taskId={card.id} taskKey={card.taskKey} version={card.version} state={card.state} />;
}

// task-management "Project members read the task board", "Board cards and board reads" and
// "Board status menu applies only permitted transitions"; design.md B2, B7, B8, B10.
export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const composition = getServerComposition();
  const access = await requireProjectPageAccess(composition, projectId);
  let board: TaskBoardView | null = null;
  try { board = await composition.taskBoardService.getBoard(projectId, access); }
  catch { board = null; }
  const isManager = access.role === "product_manager";
  let members: readonly ProjectMemberView[] | null = null;
  if (isManager) {
    try { members = await composition.projectService.listMembers(projectId, access.personId); }
    catch { /* Task creation stays disabled when member choices cannot be read. */ }
  }
  const cardAction: CardAction = isManager ? managerCardAction : developerCardAction;

  return (
    <TaskPageShell crumb="Board" backLink={{
      href: `/projects/${encodeURIComponent(projectId)}/dashboard`,
      label: "Back to Project Dashboard",
    }}>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Board</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {isManager ? "Every task in this project, by state." : "Your tasks in this project, by state."}
        </p>
      </header>
      {isManager && <TaskManager projectId={projectId} members={members} />}
      {board ? (
        <TaskStatusProvider>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {board.columns.map((column, index) => (
              <section key={column.state} aria-labelledby={`board-column-${index}`} className="rounded-2xl border border-white/10 bg-[#202020] p-4">
                <h2 id={`board-column-${index}`} className="flex items-center justify-between text-sm font-semibold text-neutral-100">
                  {column.state} <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-neutral-300">{column.cards.length}</span>
                </h2>
                {column.cards.length === 0
                  ? <p className="mt-4 text-sm text-neutral-500">No tasks</p>
                  : <div className="mt-4 space-y-3">{column.cards.map((card) => (
                      <TaskCard key={card.id} projectId={projectId} card={card}>{cardAction(projectId, card)}</TaskCard>
                    ))}</div>}
              </section>
            ))}
          </div>
        </TaskStatusProvider>
      ) : <ReadFailureNotice>The board could not be loaded. Reload the page to try again.</ReadFailureNotice>}
    </TaskPageShell>
  );
}

/** One board card; the role-specific action, if any, is passed as its children. */
function TaskCard({ projectId, card, children }: Readonly<{ projectId: string; card: BoardCard; children?: ReactNode }>) {
  const detailHref = `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(card.id)}`;
  return (
    <article className="rounded-xl border border-white/10 bg-[#262626] p-4">
      {/* F9: the column heading shows the state; the card keeps it for assistive technology. */}
      <span className="font-mono text-xs text-neutral-400">{card.taskKey}</span>
      <span className="sr-only">State: {card.state}</span>
      <h3 className="mt-2 text-sm font-medium leading-6 text-neutral-100">
        <PendingLink href={detailHref} className="hover:underline">{card.title}</PendingLink>
      </h3>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-400">
        <dt>Assignee</dt><dd className="text-neutral-200">{card.assignee.githubUsername}</dd>
        <dt>Due</dt><dd className="text-neutral-200"><time dateTime={card.dueDate}>{formatDueDate(card.dueDate)}</time></dd>
      </dl>
      {children}
    </article>
  );
}
