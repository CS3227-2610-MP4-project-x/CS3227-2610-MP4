// Synthetic browser fixture: real React DOM/hooks, controlled router and server snapshots.
// No application credentials, sessions, database, or provider calls are used.
import { Suspense, use, useState } from "react";
import { createRoot } from "react-dom/client";
import { TaskManager, type ManagedTask } from "../../../src/components/tasks/task-manager";
import { TaskManagerRouterContext } from "./router";

type Snapshot = { role: "product_manager" | "developer"; version: number };
declare global {
  interface Window {
    completeTaskRefresh(snapshot: Snapshot): void;
    taskRefreshCount: number;
  }
}

function SnapshotView({ snapshot }: { snapshot: Snapshot | Promise<Snapshot> }) {
  const current = snapshot instanceof Promise ? use(snapshot) : snapshot;
  const task: ManagedTask = {
    id: "synthetic-task", taskKey: "WEB-3", version: current.version,
    title: "Synthetic title", description: "Synthetic description", dueDate: "2026-12-01",
    branchName: null, assignee: { id: "synthetic-dev", githubUsername: "synthetic-dev" },
    acceptanceCriteria: [{ id: "synthetic-criterion", description: "Works" }],
  };
  // Mirrors the page's role gate; actual page gating has separate page-rendering tests.
  return <><output aria-label="Server version">{current.version}</output>
    {current.role === "product_manager"
      ? <TaskManager projectId="synthetic-project" task={task} members={[{ personId: "synthetic-dev", githubUsername: "synthetic-dev", role: "developer" }]} />
      : <p>Developer task detail</p>}
  </>;
}

function Host() {
  const [snapshot, setSnapshot] = useState<Snapshot | Promise<Snapshot>>({ role: "product_manager", version: 7 });
  const router = {
    refresh() {
      window.taskRefreshCount += 1;
      const pending = new Promise<Snapshot>(resolve => { window.completeTaskRefresh = resolve; });
      setSnapshot(pending);
    },
    push() { throw new Error("This fixture tests refresh, not navigation"); },
  };
  return <TaskManagerRouterContext value={router}><Suspense fallback={<p>Loading snapshot</p>}><SnapshotView snapshot={snapshot} /></Suspense></TaskManagerRouterContext>;
}

window.taskRefreshCount = 0;
createRoot(document.getElementById("root")!).render(<Host />);
