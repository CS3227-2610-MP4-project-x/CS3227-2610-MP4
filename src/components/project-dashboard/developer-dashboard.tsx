"use client";

import { useState } from "react";
import { PendingLink } from "@/components/ui/pending-link";
import { formatDueDate } from "@/components/tasks/task-page-parts";
import type { ProjectDashboardView } from "@/server/project-dashboard";
import type { DashboardTaskCard } from "@/server/task-board";

type State = DashboardTaskCard["state"];
type Filter = "All" | State;
type Props = Readonly<{
  projectId: string;
  dashboard: ProjectDashboardView;
  tasks: readonly DashboardTaskCard[];
}>;

const FILTERS: readonly Filter[] = ["All", "To Do", "In Progress", "In Review", "Done"];
const TASK_STATES: readonly State[] = ["To Do", "In Progress", "In Review", "Done"];
const STATE_CLASS: Readonly<Record<State, string>> = {
  "To Do": "developer-state developer-state-todo",
  "In Progress": "developer-state developer-state-progress",
  "In Review": "developer-state developer-state-review",
  Done: "developer-state developer-state-done",
};

function Status({ state }: Readonly<{ state: State }>) {
  return <span className={STATE_CLASS[state]}>{state}</span>;
}

export function DeveloperDashboard({ projectId, dashboard, tasks }: Props) {
  const [filter, setFilter] = useState<Filter>("All");
  const stateCounts = Object.fromEntries(
    TASK_STATES.map((state) => [state, tasks.filter((task) => task.state === state).length]),
  ) as Record<State, number>;
  const filteredTasks = filter === "All" ? tasks : tasks.filter((task) => task.state === filter);
  const taskHref = (taskId: string) => `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;

  return <main className="px-5 pb-16 pt-6 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="developer-dashboard-header">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your workspace</h1>
          <p className="mt-2 text-sm text-neutral-400"><span className="developer-role-label">Developer</span> · Assigned work across this project</p>
        </div>
        <div className="developer-dashboard-actions">
          <PendingLink className="workspace-project-link" href={`/projects/${encodeURIComponent(projectId)}/board`}>
            Open board<span className="developer-open-board-chevron" aria-hidden="true">›</span>
          </PendingLink>
        </div>
      </header>

      <div className="developer-dashboard-overview">
        <section aria-labelledby="developer-progress-heading" className="dashboard-card">
          <h2 id="developer-progress-heading" className="text-lg font-semibold">Project progress</h2>
          <p className="mt-1 text-sm text-neutral-400">{dashboard.completedTasks} of {dashboard.totalTasks} tasks complete</p>
          <p className="developer-progress-value">{dashboard.progressPercent}<span> %</span></p>
          <div className="dashboard-progress-track" role="progressbar" aria-label="Project progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dashboard.progressPercent}>
            <span style={{ width: `${dashboard.progressPercent}%` }} />
          </div>
        </section>

        <section aria-labelledby="developer-summary-heading" className="dashboard-card">
          <h2 id="developer-summary-heading" className="text-lg font-semibold">Task summary</h2>
          <div className="developer-summary-grid">
            {TASK_STATES.map((state) => <div className="developer-summary-state" key={state}>
              <span className={`developer-summary-dot ${STATE_CLASS[state]}`} aria-hidden="true" />
              <span>{state}</span>
              <strong>{stateCounts[state]}</strong>
            </div>)}
          </div>
          <p className="mt-3 text-xs text-neutral-500">Counts include all of your assigned tasks.</p>
        </section>
      </div>

      <section aria-labelledby="my-tasks-heading" className="dashboard-card mt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="my-tasks-heading" className="text-xl font-semibold">My tasks</h2>
            <p className="mt-1 text-sm text-neutral-400">Your live assignments in this project</p>
          </div>
        </div>

        <div className="developer-task-filters" role="group" aria-label="Filter my tasks by status">
          {FILTERS.map((state) => {
            const count = state === "All" ? tasks.length : stateCounts[state as State];
            return <button key={state} type="button" aria-pressed={filter === state}
              className="dashboard-filter" onClick={() => setFilter(state)}>
              {state}<span className="developer-filter-count">{count}</span>
            </button>;
          })}
        </div>

        {filteredTasks.length === 0
          ? <p className="developer-task-empty" role="status">{tasks.length === 0 ? "No tasks are assigned to you in this project yet." : "No tasks match this status."}</p>
          : <ul className="developer-task-list">
            {filteredTasks.map((task) => <li key={task.id} className="developer-task-row">
              <div className="developer-task-main">
                <h3><PendingLink href={taskHref(task.id)}>{task.title}</PendingLink></h3>
                <p className="developer-task-description">{task.description}</p>
                <div className="developer-task-meta">
                  <span className="developer-task-key">{task.taskKey}</span>
                  {task.branchName && <span className="developer-task-branch">{task.branchName}</span>}
                  <span>{task.progressUpdateCount} {task.progressUpdateCount === 1 ? "update" : "updates"}</span>
                  <span>{task.attachedCommitCount} {task.attachedCommitCount === 1 ? "commit" : "commits"}</span>
                </div>
              </div>
              <div className="developer-task-side">
                <Status state={task.state} />
                <span className="developer-task-due"><span aria-hidden="true">▦</span><time dateTime={task.dueDate}>Due {formatDueDate(task.dueDate)}</time></span>
                <PendingLink className="workspace-project-link" href={taskHref(task.id)}>View task</PendingLink>
              </div>
            </li>)}
          </ul>}
      </section>
    </div>
  </main>;
}
