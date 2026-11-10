import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { dashboardIds as ids, dashboardView } from "../../fixtures/project-dashboard";
import { visibleText } from "../task-pages/support";
import { ProjectDashboard, TaskAllocation } from "@/components/project-dashboard";

// Task 4.7 D4-D8. Public component seams are documented in the worker report.
// Node-only interaction harness follows existing task-manager tests: state is opaque;
// only rendered controls and their public event handlers are exercised.
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState(initial: unknown) {
    if (!h.active) return actual.useState(initial);
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(h.slots[i]) : next; }];
  } };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => { h.slots = []; h.cursor = 0; h.active = false; });
function view(role: "developer" | "product_manager" = "product_manager", dashboard = dashboardView()) {
  return renderToStaticMarkup(<ProjectDashboard projectId={ids.project} role={role} dashboard={dashboard} members={role === "product_manager" ? [] : undefined} />);
}
type Element = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Element["props"]>(node)) return [];
  return [{ type: node.type, props: node.props }, ...nodes(node.props.children)];
}
let allocation: ReactNode;
function renderAllocation() {
  h.active = true; h.cursor = 0;
  allocation = TaskAllocation({ allocation: dashboardView().allocation, completedToday: 1 });
  h.active = false;
  return renderToStaticMarkup(allocation);
}
function toggle(label: string) {
  const control = nodes(allocation).find(n => (n.type === "button" && renderToStaticMarkup(n.props.children).includes(label)) || (n.type === "input" && (n.props["aria-label"] === label || n.props.name === label)));
  expect(control, `accessible state control ${label}`).toBeDefined();
  if (control!.type === "button") (control!.props.onClick as () => void)();
  else (control!.props.onChange as (e: unknown) => void)({ target: { checked: !control!.props.checked } });
}
it("shows the four dashboard sections, matching progress, members and the existing board link", () => {
  const html = view(); const text = visibleText(html);
  for (const label of ["Project Progress", "Task Summary", "Task Allocation"]) expect(text).toContain(label);
  expect(text).toMatch(/33\s*%/); expect(text).toMatch(/1\s*(?:of|\/)\s*3/);
  expect(text).toMatch(/4\s*(?:team\s*)?members/i);
  expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="33"|aria-valuenow="33"[^>]*role="progressbar"/);
  expect(html).toContain(`href="/projects/${ids.project}/board"`);

});
it("links the PM Progress Report action after the D9 readiness gate", () => {
  const html = view("product_manager"); const text = visibleText(html);
  expect(text).toContain("New Task"); expect(text).toContain("Review Queue"); expect(text).toContain("Progress Report");
  expect(html).toContain(`href="/projects/${ids.project}/review-queue"`);
  const reportLink = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]).find(anchor => visibleText(anchor).includes('Progress Report'));
  expect(reportLink, 'ready Progress Report action link').toBeDefined();
  expect(reportLink ?? '').toContain(`href="/projects/${ids.project}/reports"`);
  expect(reportLink).not.toMatch(/aria-disabled="true"|coming soon/i);
});
it("excludes all PM actions for developers and retains the developer role label", () => {
  const html = view("developer");
  for (const label of ["New Task", "Review Queue", "Progress Report"]) expect(visibleText(html)).not.toContain(label);
  expect(html).not.toMatch(/class="account-control"/);
  expect(visibleText(html)).toMatch(/developer/i);
});
it.each([
  ["developer", "Developer"], ["product_manager", "Product manager"],
] as const)("keeps the %s role label while the layout owns the only account menu", (role, label) => {
  const html = view(role);
  expect(visibleText(html)).toContain(label);
  expect(html).not.toMatch(/class="account-control"|class="dashboard-username"|class="dashboard-avatar/);
  expect(visibleText(html)).not.toMatch(/Sign out/);
});
it("renders username markup as text", () => {
  const dashboard = dashboardView(); dashboard.allocation[0].githubUsername = "<b>synthetic</b>";
  const html = view("product_manager", dashboard);
  expect(html).toContain("&lt;b&gt;synthetic&lt;/b&gt;"); expect(html).not.toContain("<b>synthetic</b>");
});
it("shows a successful empty state with 0% and no NaN", () => {
  const dashboard = dashboardView(); Object.assign(dashboard, { totalTasks: 0, completedTasks: 0, progressPercent: 0, completedToday: 0 });
  const html = view("product_manager", dashboard);
  expect(visibleText(html)).toMatch(/no tasks|no live tasks/i); expect(html).not.toMatch(/NaN|Infinity/);
});
it("defaults all four states on and changes allocation through the state controls", () => {
  let html = renderAllocation();
  expect(visibleText(html)).toContain("67%"); expect(visibleText(html)).toContain("33%");
  const controls = nodes(allocation).filter(n => n.props["aria-pressed"] === true || n.props.checked === true);
  expect(controls).toHaveLength(4);
  toggle("To Do"); html = renderAllocation(); toggle("Done"); html = renderAllocation();
  expect(visibleText(html)).toContain("100%"); expect(visibleText(html)).not.toContain("67%");
  expect(visibleText(html)).toMatch(/1\s*(?:tasks?\s*)?completed today|completed today\s*1/i);
  toggle("In Progress"); renderAllocation(); toggle("In Review"); html = renderAllocation();
  expect(visibleText(html)).toMatch(/no tasks match/i); expect(html).not.toMatch(/NaN|Infinity/);
  expect(visibleText(html)).toContain("alpha"); expect(visibleText(html)).toContain("zero");
});
