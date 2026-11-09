"use client";

import { useState } from "react";
import type { DashboardMember, DashboardState } from "@/server/project-dashboard";

type AllocationRow = Readonly<{
  personId: string; githubUsername: string; role: DashboardMember["role"]; count: number; percentage: number;
}>;
const STATES: readonly Readonly<{ value: DashboardState; label: string }>[] = [
  { value: "to_do", label: "To Do" }, { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" }, { value: "done", label: "Done" },
];

export function calculateAllocation(allocation: readonly DashboardMember[], selected: readonly DashboardState[] | DashboardState | undefined): AllocationRow[] {
  const selectedStates = selected === undefined ? [] : typeof selected === "string" ? [selected] : selected;
  const denominator = allocation.reduce((sum, member) => sum + selectedStates.reduce((count, state) => count + member.stateCounts[state], 0), 0);
  return allocation.map(member => {
    const count = selectedStates.reduce((sum, state) => sum + member.stateCounts[state], 0);
    return { personId: member.personId, githubUsername: member.githubUsername, role: member.role, count,
      percentage: denominator === 0 ? 0 : Math.round(count / denominator * 100) };
  }).filter(row => row.role !== "product_manager" || row.count > 0);
}

export function TaskAllocation({ allocation, completedToday }: Readonly<{
  allocation: readonly DashboardMember[]; completedToday: number;
}>) {
  const [selectedStates, setSelectedStates] = useState<readonly DashboardState[]>(STATES.map(state => state.value));
  const rows = calculateAllocation(allocation, selectedStates);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  function toggle(state: DashboardState) {
    setSelectedStates(current => current.includes(state) ? current.filter(value => value !== state) : [...current, state]);
  }
  return <section aria-labelledby="allocation-heading" className="dashboard-card">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="allocation-heading" className="text-lg font-semibold">Task Allocation</h2>
      <p className="text-sm text-neutral-400"><strong className="text-neutral-100">{completedToday}</strong> tasks completed today</p>
    </div>
    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Task states included in allocation">
      {STATES.map(state => <button key={state.value} type="button" aria-pressed={selectedStates.includes(state.value)}
        onClick={() => toggle(state.value)} className="dashboard-filter">{state.label}</button>)}
    </div>
    {total === 0 && <p className="mt-5 text-sm text-neutral-400">No tasks match the selected states.</p>}
    <ul className="mt-5 space-y-4" aria-label="Task allocation by member">
      {rows.map(row => <li key={row.personId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
        <span className="dashboard-allocation-person"><span className="dashboard-allocation-dot" aria-hidden="true" />
          <span className="truncate text-sm text-neutral-200">{row.githubUsername}{row.role === "product_manager" && <span className="ml-2 text-xs text-neutral-500">Product manager</span>}</span>
        </span>
        <span className="text-sm tabular-nums text-neutral-300">{row.count} · {row.percentage}%</span>
        <span className="dashboard-allocation-track col-span-2" aria-hidden="true"><span style={{ width: `${row.percentage}%` }} /></span>
      </li>)}
    </ul>
  </section>;
}
