import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProjectSwitcher } from "@/components/project-navigation/project-switcher";
const context = vi.hoisted(() => ({ section: "board" as string | null }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => context.section, usePathname: () => "/projects/source/board", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const projects = [
  { id: "49000000-0000-4000-8000-000000000001", key: "ALP", name: "Synthetic Alpha", role: "developer" as const },
  { id: "49000000-0000-4000-8000-000000000002", key: "BET", name: "Synthetic <b>Beta</b>", role: "product_manager" as const },
];
it("lists accessible projects and names the current selection without interpreting project markup", () => {
  const html = renderToStaticMarkup(<ProjectSwitcher projectId={projects[0].id} projects={projects} accountId="synthetic-account" />);
  expect(html).toContain("Synthetic Alpha"); expect(html).toContain("Synthetic &lt;b&gt;Beta&lt;/b&gt;");
  expect(html).not.toContain("<b>Beta</b>");
  expect(html).toMatch(/<(?:summary|button|select)\b/);
});

it("separates Create project after the project list and gives its plus icon decorative semantics", () => {
  const html = renderToStaticMarkup(<ProjectSwitcher projectId={projects[0].id} projects={projects} accountId="synthetic-account" />);
  const create = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]).find(anchor => anchor.includes('href="/projects/new"'));
  expect(create).toBeDefined();
  expect(html.indexOf(create!)).toBeGreaterThan(html.indexOf("</ul>"));
  // The dedicated create class provides the divider styling; the plus is decorative.
  expect(create).toContain("project-switcher-create");
  expect(create).toMatch(/<(?:span|svg)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?(?:\+|<path|<line)/);
  expect(create).toContain("Create project");
});
