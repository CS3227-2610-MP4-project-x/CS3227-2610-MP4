"use client";

import Link from "next/link";
import Image from "next/image";
import { AccountSettingsControl } from "@/components/auth/account-control";
import { TaskManager } from "@/components/tasks/task-manager";
import type { ProjectMemberView } from "@/server/projects";
import type { ProjectDashboardView } from "@/server/project-dashboard";
import { TaskAllocation } from "./task-allocation";

type Props = Readonly<{
  projectId: string; role: "developer" | "product_manager";
  identity: Readonly<{ githubUsername: string; avatarUrl: string | null }>;
  dashboard: ProjectDashboardView; members?: readonly ProjectMemberView[] | null;
}>;

function ProgressBar({ value, label }: Readonly<{ value: number; label: string }>) {
  return <div className="dashboard-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span style={{ width: `${value}%` }} />
  </div>;
}

export function ProjectDashboard({ projectId, role, identity, dashboard, members }: Props) {
  const manager = role === "product_manager";
  return <main className="px-5 pb-16 pt-6 sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="dashboard-header">
      <div><p className="workspace-kicker">PROJECT DASHBOARD</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Project Overview</h1>
        <p className="mt-2 text-sm text-neutral-400">{manager ? "Project activity and progress" : "Project activity and progress · Your board shows your tasks"}</p>
      </div>
      <div className="dashboard-account-area">
        <div className="dashboard-identity">
          {identity.avatarUrl ? <Image className="dashboard-avatar" src={identity.avatarUrl} alt="" width={40} height={40} unoptimized />
            : <span className="dashboard-avatar dashboard-avatar-fallback" aria-hidden="true">{identity.githubUsername.slice(0, 1).toUpperCase()}</span>}
          <div><span className="dashboard-username">@{identity.githubUsername}</span><span className="dashboard-role">{manager ? "Product manager" : "Developer"}</span></div>
        </div>
        <AccountSettingsControl githubUsername={identity.githubUsername} />
      </div>
    </header>
    {manager && <div className="mt-7"><h2 className="sr-only">Project actions</h2><div className="dashboard-actions">
      <TaskManager projectId={projectId} members={members ?? null} className="dashboard-action dashboard-create-action"
        expandedClassName="dashboard-create-action-expanded" />
      <Link className="dashboard-action" href={`/projects/${encodeURIComponent(projectId)}/review-queue`}><span aria-hidden="true">◷</span><span>Review Queue</span></Link>
      <Link className="dashboard-action" href={`/projects/${encodeURIComponent(projectId)}/reports`}><span aria-hidden="true">▤</span><span>Progress Report</span></Link>
    </div></div>}
    <section aria-labelledby="project-progress-heading" className="dashboard-card mt-8">
      <h2 id="project-progress-heading" className="workspace-kicker">Project Progress</h2>
      <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">{dashboard.progressPercent}% <span className="text-xl font-medium text-neutral-400">complete</span></p>
      <ProgressBar value={dashboard.progressPercent} label="Project progress" />
    </section>
    <section aria-labelledby="task-summary-heading" className="dashboard-card mt-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="task-summary-heading" className="text-lg font-semibold">Task Summary</h2>
        <p className="mt-3 text-2xl font-semibold tabular-nums">{dashboard.completedTasks} <span className="text-neutral-500">/ {dashboard.totalTasks}</span></p>
        <p className="text-sm text-neutral-400">tasks complete</p></div>
        <Link href={`/projects/${encodeURIComponent(projectId)}/board`} className="workspace-project-link">View all</Link></div>
      <ProgressBar value={dashboard.progressPercent} label="Task summary progress" />
      <div className="mt-5 flex flex-wrap gap-3"><span className="dashboard-chip">{dashboard.memberCount} team members</span><span className="dashboard-chip">{dashboard.completedTasks} completed tasks</span></div>
      {dashboard.totalTasks === 0 && <p className="mt-4 text-sm text-neutral-400">No live tasks in this project yet.</p>}
    </section>
    <div className="mt-5"><TaskAllocation allocation={dashboard.allocation} completedToday={dashboard.completedToday} /></div>
  </div></main>;
}
