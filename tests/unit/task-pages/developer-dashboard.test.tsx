import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DeveloperDashboard } from "@/components/project-dashboard/developer-dashboard";
import { developerDashboard, developerProjectId, developerTasks } from "../../fixtures/developer-dashboard";
import { visibleText } from "./support";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState(initial: unknown) {
    if (!h.active) return actual.useState(initial);
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(h.slots[i]) : next; }];
  } };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => { h.slots = []; h.cursor = 0; h.active = false; });
const props = () => ({ projectId: developerProjectId, dashboard: developerDashboard(), tasks: developerTasks() });
type Props = { children?: ReactNode; onClick?: () => void };
function nodes(node: ReactNode): Array<{ type: unknown; props: Props }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [{ type: node.type, props: node.props }, ...nodes(node.props.children)];
}
it("shows project-wide progress plus own-task cards and full plain-text row metadata", () => {
  const input = props(); input.tasks[0].description = "Synthetic <script>text</script>";
  const html = renderToStaticMarkup(<DeveloperDashboard {...input} />); const text = visibleText(html);
  for (const label of ["Project progress", "Task summary", "My tasks"]) expect(text.toLowerCase()).toContain(label.toLowerCase());
  expect(text).toMatch(/50\s*%/);
  for (const task of input.tasks) {
    expect(text).toContain(task.title);
    expect(html).toContain(`/projects/${developerProjectId}/tasks/${task.id}`);
    if (task.branchName) expect(text).toContain(task.branchName);
  }
  expect(text).toMatch(/2 updates/); expect(text).toMatch(/3 commits/);
  expect(html).toContain("&lt;script&gt;text&lt;/script&gt;"); expect(html).not.toContain("<script>text</script>");
  for (const label of ["Recent activity", "Check ready", "Task Allocation", "New Task", "Review Queue"]) expect(text).not.toContain(label);
  expect(html).not.toMatch(/type="checkbox"|type="search"/);
});
it("filters only My tasks while keeping project progress and the full own-task summary", () => {
  const input = props(); let tree: ReactNode;
  function render() { h.active = true; h.cursor = 0; tree = DeveloperDashboard(input); h.active = false; return renderToStaticMarkup(tree); }
  function choose(label: string) {
    const button = nodes(tree).find(n => n.type === "button" && new RegExp(`^${label}(?:\\s|$)`).test(visibleText(renderToStaticMarkup(n.props.children))));
    expect(button, `filter ${label}`).toBeDefined(); button!.props.onClick!();
  }
  let html = render(); for (const task of input.tasks) expect(html).toContain(task.title);
  choose("In Review"); html = render();
  expect(html).toContain("Synthetic In Review task"); expect(html).not.toContain("Synthetic To Do task");
  expect(visibleText(html)).toMatch(/50\s*%/);
  const summary = html.slice(html.toLowerCase().indexOf("task summary"), html.toLowerCase().indexOf("my tasks"));
  for (const label of ["To Do", "In Progress", "In Review", "Done"]) expect(visibleText(summary)).toContain(label);
  choose("All"); html = render(); for (const task of input.tasks) expect(html).toContain(task.title);
});
it("distinguishes a successful empty assignment list without invalid percentages", () => {
  const html = renderToStaticMarkup(<DeveloperDashboard {...props()} tasks={[]} />);
  expect(visibleText(html)).toMatch(/no .*tasks|no tasks/i); expect(html).not.toMatch(/NaN|Infinity/);
  expect(visibleText(html)).toMatch(/50\s*%/);
});

it("retains the developer role label without duplicating the shared account control", () => {
  const html = renderToStaticMarkup(<DeveloperDashboard {...props()} />);
  expect(visibleText(html)).toMatch(/Developer/);
  expect(html).not.toMatch(/class="account-control"/);
  expect(visibleText(html)).not.toMatch(/Sign out/);
});
