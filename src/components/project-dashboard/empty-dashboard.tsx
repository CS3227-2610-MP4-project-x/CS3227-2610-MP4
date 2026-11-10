import { AccountControl } from "@/components/auth/account-control";
import { PendingLink } from "@/components/ui/pending-link";

type Props = Readonly<{ identity: Readonly<{ githubUsername: string; avatarUrl: string | null }> }>;

export function EmptyDashboard({ identity }: Props) {
  return <main className="px-5 pb-16 pt-6 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="developer-dashboard-header">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your workspace</h1>
          <p className="mt-2 text-sm text-neutral-400">Your project work will appear here.</p>
        </div>
        <AccountControl githubUsername={identity.githubUsername} avatarUrl={identity.avatarUrl} />
      </header>

      <div className="developer-dashboard-overview mt-7">
        <section aria-labelledby="empty-progress-heading" className="dashboard-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="empty-progress-heading" className="text-lg font-semibold">Project progress</h2>
              <p className="mt-1 text-sm text-neutral-400">0 of 0 tasks complete</p>
            </div>
            <PendingLink className="workspace-project-link workspace-project-link-primary" href="/projects/new">Create project</PendingLink>
          </div>
          <p className="developer-progress-value">0<span>%</span></p>
          <div className="dashboard-progress-track" role="progressbar" aria-label="Project progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span style={{ width: "0%" }} /></div>
        </section>
        <section aria-labelledby="empty-summary-heading" className="dashboard-card">
          <h2 id="empty-summary-heading" className="text-lg font-semibold">Task summary</h2>
          <div className="developer-summary-grid">
            {(["To Do", "In Progress", "In Review", "Done"] as const).map((state) => <div className="developer-summary-state" key={state}>
              <span className={`developer-summary-dot ${state === "Done" ? "developer-state-done" : "developer-state-muted"}`} aria-hidden="true" />
              <span>{state}</span><strong>0</strong>
            </div>)}
          </div>
        </section>
      </div>
      <section aria-labelledby="empty-my-tasks-heading" className="dashboard-card mt-5">
        <h2 id="empty-my-tasks-heading" className="text-xl font-semibold">My tasks</h2>
        <p className="mt-4 text-sm text-neutral-400">There are no tasks to show until you join a project.</p>
        <PendingLink className="workspace-project-link workspace-project-link-primary mt-5" href="/projects/new">Create project</PendingLink>
      </section>
    </div>
  </main>;
}
