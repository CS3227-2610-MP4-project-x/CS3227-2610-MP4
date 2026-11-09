"use client";

import { PendingLink } from "@/components/ui/pending-link";
import { useSelectedLayoutSegment } from "next/navigation";

export type ProjectNavigationProps = Readonly<{ projectId: string; role: "product_manager" | "developer" }>;

type Tab = Readonly<{ label: string; segment: string | null; managerOnly: boolean }>;

// design.md B4 (O1-a), ui-spec "Top Navigation": Dashboard is shown but disabled while the
// dashboard is deferred; Board is shown to every member; Review Queue, Reports (disabled until
// task 8.3) and Settings are shown to the product manager only. A null segment is a disabled tab.
// Hiding a tab is never the protection: each page checks access on the server (B2).
const TABS: readonly Tab[] = [
  { label: "Dashboard", segment: null, managerOnly: false },
  { label: "Board", segment: "board", managerOnly: false },
  { label: "Review Queue", segment: "review-queue", managerOnly: true },
  { label: "Reports", segment: null, managerOnly: true },
  { label: "Settings", segment: "settings", managerOnly: true },
];

// F5: a task-detail page belongs to the Board tab.
function tabSegmentOf(segment: string | null): string | null {
  return segment === "tasks" ? "board" : segment;
}

export function ProjectNavigation({ projectId, role }: ProjectNavigationProps) {
  const active = tabSegmentOf(useSelectedLayoutSegment());
  const tabs = TABS.filter((tab) => role === "product_manager" || !tab.managerOnly);
  return (
    <>
      <div className="mb-3">
        <PendingLink className="workspace-project-link" href="/">Back to Project Space</PendingLink>
      </div>
      <nav className="workspace-nav project-nav" aria-label="Project navigation">
        {tabs.map((tab) => tab.segment === null
          // F6: a disabled tab looks distinct from an inactive one and says why it cannot be used.
          ? <span key={tab.label} className="workspace-nav-link project-nav-link-disabled" aria-disabled="true" title="Coming soon">
              {tab.label}<span className="sr-only"> (coming soon)</span>
            </span>
          : <PendingLink key={tab.label}
              className={tab.segment === active ? "workspace-nav-link workspace-nav-link-active" : "workspace-nav-link"}
              href={`/projects/${encodeURIComponent(projectId)}/${tab.segment}`}
              aria-current={tab.segment === active ? "page" : undefined}>
              {tab.label}
            </PendingLink>)}
      </nav>
    </>
  );
}
