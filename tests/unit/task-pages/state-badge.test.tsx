import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { visibleText } from "./support";

// Task 4.4 UI fix F8, approved by thegrimbee after the frontend check (handoff change log), and
// ui-spec "Status colors on the board follow the Color System: monochrome for To Do, In
// Progress, and In Review, and the green accent only for Done".
//
// Seam chosen by the test-writer: StateBadge({ state }) in
// src/components/tasks/task-page-parts.tsx renders one element whose class list contains
// `task-state-badge`, plus `task-state-badge-done` for Done only. The colours live in those
// classes (globals.css, additive per A5); only the class names are asserted here.

async function badge(state: string): Promise<{ html: string; classes: string[] }> {
  const { StateBadge } = await import("@/components/tasks/task-page-parts");
  const html = renderToStaticMarkup(<StateBadge state={state} />);
  const classes = (/\bclass="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
  return { html, classes };
}

describe("state badge colours (F8)", () => {
  it("gives Done the accent class", async () => {
    const { html, classes } = await badge("Done");

    expect(visibleText(html)).toBe("Done");
    expect(classes).toContain("task-state-badge");
    expect(classes).toContain("task-state-badge-done");
  });

  it.each(["To Do", "In Progress", "In Review"])("keeps %s monochrome", async (state) => {
    const { html, classes } = await badge(state);

    expect(visibleText(html)).toBe(state);
    expect(classes).toContain("task-state-badge");
    expect(classes).not.toContain("task-state-badge-done");
    expect(classes.join(" ")).not.toMatch(/emerald|green/);
  });
});
