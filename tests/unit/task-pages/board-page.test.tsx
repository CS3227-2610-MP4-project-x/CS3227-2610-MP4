import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRIVATE_DETAIL, articleWith, articles, headingIndex, ids, stubs, usernames, uuid, visibleText,
  type StateName,
} from "./support";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Project members read the task board", "Board cards and
// board reads" and "Board status menu applies only permitted transitions"; design.md "Board,
// Detail and Review Queue Decisions (4.4)" B2, B4, B7, B8, B10, B12.
//
// The page is rendered with the existing Node renderToStaticMarkup approach (B12). The session,
// membership and board read are synthetic; the real page-access helper runs over them.
//
// Seams chosen by the test-writer (reported in the 4.4 handoff):
//   - Page: src/app/projects/[projectId]/board/page.tsx, default export
//     BoardPage({ params: Promise<{ projectId }> }), `export const dynamic = "force-dynamic"`.
//   - Composition key `taskBoardService` with getBoard(projectId, { personId, role }).
//   - Client component src/components/tasks/board-status-menu.tsx exporting
//     BoardStatusMenu({ projectId, taskId, version, state }). Here it is replaced by a stub that
//     renders its props, so the page's choices are observable; its own behaviour is tested in
//     task-actions.test.tsx.
//   - Each card is one <article>; each column has an h2–h4 heading whose text starts with the
//     state name (a count may follow).
// UI fixes approved by thegrimbee after the frontend check (handoff change log):
//   - F4: BoardStatusMenu also receives taskKey; the page is wrapped in TaskStatusProvider, so a
//     role="status" region exists outside every card.
//   - F8: the product manager's In Review card link is not green (no emerald/green class).
//   - F9: cards carry no StateBadge (no `task-state-badge` class) and show due dates as
//     "1 Dec 2026" (en-SG day, short month, year) with the ISO date kept in <time dateTime>.
//     The approved requirement "Board cards and board reads" still says each card shows its
//     state name, so the state-name assertion below is kept (for example as visually hidden
//     text); this F9/requirement tension is reported to the human.

const f = vi.hoisted(() => ({
  composition: {} as Record<string, unknown>,
  getUser: vi.fn(),
  findPerson: vi.fn(),
  projectExists: vi.fn(),
  findRole: vi.fn(),
  getBoard: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
  notFound: vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); }),
  refresh: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: f.redirect,
  notFound: f.notFound,
  useRouter: () => ({ refresh: f.refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/server/composition", () => ({ getServerComposition: () => f.composition }));
vi.mock("@/server/auth/supabase-auth", () => ({
  createRequestSupabaseClient: async () => ({ auth: { getUser: f.getUser } }),
}));
vi.mock("@/components/tasks/board-status-menu", async () => {
  const { createElement } = await import("react");
  return {
    BoardStatusMenu: (props: { projectId: string; taskId: string; taskKey: string; version: number; state: string }) => createElement("output", {
      "data-stub": "board-status-menu", "data-project-id": props.projectId, "data-task-id": props.taskId,
      "data-task-key": props.taskKey, "data-version": String(props.version), "data-state": props.state,
    }),
  };
});

const projectId = ids.project;
const PAGE = "../../../src/app/projects/[projectId]/board/page";

type Assignee = { id: string; githubUsername: string };
const alpha: Assignee = { id: ids.developer, githubUsername: usernames.developer };
const beta: Assignee = { id: ids.otherDeveloper, githubUsername: usernames.otherDeveloper };

function card(n: number, state: StateName, assignee: Assignee, title = `Synthetic board task ${n}`) {
  return { id: uuid(100 + n), taskKey: `WEB-${n}`, title, assignee, dueDate: `2026-12-${String(n).padStart(2, "0")}`, state, version: n + 40 };
}

function board(cards: ReturnType<typeof card>[]) {
  const order: StateName[] = ["To Do", "In Progress", "In Review", "Done"];
  return { columns: order.map((state) => ({ state, cards: cards.filter((item) => item.state === state) })) };
}

const pmCards = [
  card(1, "To Do", alpha),
  card(3, "To Do", beta, "Escape <b>markup</b> in titles"),
  card(2, "In Progress", beta),
  card(4, "In Review", alpha),
  card(5, "Done", beta),
];
const developerCards = [card(1, "To Do", alpha), card(2, "In Progress", alpha), card(4, "In Review", alpha), card(5, "Done", alpha)];

beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: ids.authUser } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(ids.pm);
  f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("product_manager");
  f.getBoard.mockReset().mockResolvedValue(board(pmCards));
  f.composition = {
    config: {},
    peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    taskBoardService: { getBoard: f.getBoard },
  };
});

function asDeveloper() {
  f.findPerson.mockResolvedValue(ids.developer);
  f.findRole.mockResolvedValue("developer");
  f.getBoard.mockResolvedValue(board(developerCards));
}

async function render(): Promise<string> {
  const { default: BoardPage } = await import(PAGE);
  return renderToStaticMarkup(await BoardPage({ params: Promise.resolve({ projectId }) }));
}

function expectInColumn(html: string, taskKey: string, state: StateName) {
  const order: StateName[] = ["To Do", "In Progress", "In Review", "Done"];
  const start = headingIndex(html, state);
  const next = order.slice(order.indexOf(state) + 1).map((name) => headingIndex(html, name)).find((index) => index >= 0) ?? html.length;
  const position = html.indexOf(articleWith(html, taskKey));
  expect(start, `${state} column heading`).toBeGreaterThanOrEqual(0);
  expect(position, `${taskKey} is in the ${state} column`).toBeGreaterThan(start);
  expect(position, `${taskKey} is in the ${state} column`).toBeLessThan(next);
}

describe("Project members read the task board", () => {
  it("shows the four columns in order", async () => {
    const html = await render();

    const positions = (["To Do", "In Progress", "In Review", "Done"] as const).map((state) => headingIndex(html, state));
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("shows the product manager every task once, in the column for its state", async () => {
    const html = await render();

    expect(f.getBoard).toHaveBeenCalledWith(projectId, { personId: ids.pm, role: "product_manager" });
    expect(articles(html)).toHaveLength(pmCards.length);
    for (const item of pmCards) expectInColumn(html, item.taskKey, item.state);
  });

  it("keeps task-number order inside a column", async () => {
    const html = await render();

    expect(html.indexOf(articleWith(html, "WEB-1"))).toBeLessThan(html.indexOf(articleWith(html, "WEB-3")));
  });

  it("reads a developer's board through the service as that developer", async () => {
    asDeveloper();

    const html = await render();

    expect(f.getBoard).toHaveBeenCalledWith(projectId, { personId: ids.developer, role: "developer" });
    expect(articles(html)).toHaveLength(developerCards.length);
    expect(html).not.toContain(usernames.otherDeveloper);
  });
});

describe("Board cards and board reads", () => {
  it("shows the key, title, assignee, due date and state name on each card, and carries its id", async () => {
    const html = await render();

    for (const item of pmCards.filter((value) => value.taskKey !== "WEB-3")) {
      const article = articleWith(html, item.taskKey);
      const text = visibleText(article);
      expect(text).toContain(item.title);
      expect(text).toContain(item.assignee.githubUsername);
      expect(article).toContain(item.dueDate);
      expect(text).toContain(item.state);
      expect(article).toContain(item.id);
    }
  });

  it("shows due dates in the en-SG day-month-year form and keeps the ISO date (F9)", async () => {
    const html = await render();

    for (const item of pmCards) {
      const article = articleWith(html, item.taskKey);
      const day = Number(item.dueDate.slice(-2));
      expect(visibleText(article)).toContain(`${day} Dec 2026`);
      expect(article).toMatch(new RegExp(`<time\\b[^>]*dateTime="${item.dueDate}"`));
    }
  });

  it("drops the state badge from cards (F9)", async () => {
    const html = await render();

    for (const article of articles(html)) expect(article).not.toMatch(/\btask-state-badge\b/);
  });

  it("has a page-level status region outside every card (F4)", async () => {
    asDeveloper();

    const html = await render();

    const regions = [...html.matchAll(/role="status"/g)].map((match) => match.index ?? -1);
    const spans = articles(html).map((article) => {
      const start = html.indexOf(article);
      return [start, start + article.length] as const;
    });
    expect(regions.some((index) => spans.every(([start, end]) => index < start || index > end))).toBe(true);
  });

  it("labels a task stored as in_review with the state name In Review", async () => {
    const html = await render();

    expectInColumn(html, "WEB-4", "In Review");
    expect(visibleText(articleWith(html, "WEB-4"))).toContain("In Review");
    expect(html).not.toMatch(/\b(?:to_do|in_progress|in_review)\b/);
  });

  it("renders task text as plain text", async () => {
    const html = await render();

    expect(html).not.toContain("<b>markup</b>");
    expect(html).toContain("&lt;b&gt;markup&lt;/b&gt;");
  });

  it("shows a nonmember the safe not-found result without project contents", async () => {
    f.findRole.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getBoard).not.toHaveBeenCalled();
  });

  it("shows the safe not-found result for a missing project", async () => {
    f.projectExists.mockResolvedValue(false);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getBoard).not.toHaveBeenCalled();
  });

  it("redirects a request without a valid session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(render()).rejects.toThrow("REDIRECT:/sign-in");
    expect(f.getBoard).not.toHaveBeenCalled();
  });

  it("shows a safe failure notice, without the detail, when the board read fails (reviewer round 1)", async () => {
    f.getBoard.mockRejectedValue(new Error(PRIVATE_DETAIL));

    const html = await render();

    expect(html).not.toContain(PRIVATE_DETAIL);
    expect(articles(html)).toHaveLength(0);
    const alerts = [...html.matchAll(/<(\w+)\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map((match) => visibleText(match[2]));
    expect(alerts.some((value) => /could not|couldn.t|unable|unavailable|try again/i.test(value))).toBe(true);
  });

  it("shows the safe not-found result for a project ID that is not a UUID (reviewer round 1)", async () => {
    const { default: BoardPage } = await import(PAGE);

    await expect(BoardPage({ params: Promise.resolve({ projectId: "not-a-uuid" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getBoard).not.toHaveBeenCalled();
    expect(f.findRole).not.toHaveBeenCalled();
  });

  it("is rendered dynamically, never cached", async () => {
    const page = await import(PAGE);

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("adds no /api/v1 route for the board or the review queue", () => {
    const root = fileURLToPath(new URL("../../../src/app/api", import.meta.url));
    const routes = (readdirSync(root, { recursive: true }) as string[])
      .map((entry) => entry.split(path.sep).join("/"))
      .filter((entry) => /(?:^|\/)route\.tsx?$/.test(entry));

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((entry) => /board|review/i.test(entry))).toEqual([]);
  });
});

describe("Board status menu applies only permitted transitions", () => {
  it("gives the product manager no status menu and links an In Review card to the review queue", async () => {
    const html = await render();

    expect(stubs(html, "board-status-menu")).toEqual([]);
    expect(articleWith(html, "WEB-4")).toContain(`href="/projects/${projectId}/review-queue"`);
  });

  it("does not colour the In Review card's review-queue link green (F8)", async () => {
    const html = await render();

    const link = [...articleWith(html, "WEB-4").matchAll(/<a\b[^>]*>/g)]
      .map((match) => match[0])
      .find((anchor) => anchor.includes(`href="/projects/${projectId}/review-queue"`));
    expect(link).toBeDefined();
    expect(/\bclass="([^"]*)"/.exec(link!)?.[1] ?? "").not.toMatch(/emerald|green/);
  });

  it("gives the assigned developer a menu with the task's id and current version on To Do and In Progress cards", async () => {
    asDeveloper();

    const html = await render();

    for (const item of developerCards.filter((value) => value.state === "To Do" || value.state === "In Progress")) {
      const menus = stubs(articleWith(html, item.taskKey), "board-status-menu");
      expect(menus).toHaveLength(1);
      expect(menus[0]).toMatchObject({
        "data-project-id": projectId, "data-task-id": item.id, "data-task-key": item.taskKey,
        "data-version": String(item.version), "data-state": item.state,
      });
    }
  });

  it("offers a developer no move from In Review or Done", async () => {
    asDeveloper();

    const html = await render();

    // Either no menu, or a menu given that state (which offers no option; see task-actions.test.tsx).
    for (const key of ["WEB-4", "WEB-5"]) {
      const item = developerCards.find((value) => value.taskKey === key)!;
      for (const menu of stubs(articleWith(html, key), "board-status-menu")) expect(menu["data-state"]).toBe(item.state);
    }
  });
});
