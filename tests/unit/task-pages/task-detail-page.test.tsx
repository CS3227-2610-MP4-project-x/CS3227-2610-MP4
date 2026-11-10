import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_DETAIL, checkEntry, ids, outcome, stubs, usernames, uuid, visibleText } from "./support";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Task detail page" and "Task detail actions follow the
// role"; design.md "Board, Detail and Review Queue Decisions (4.4)" B2, B5, B9, B10, B12 and
// L5 (submission without a reference is allowed).
//
// The page is rendered with renderToStaticMarkup (B12). Session, membership and the task-detail
// read are synthetic; the real page-access helper and the real Group 7 components
// (DeveloperCheckPanel, CheckHistory, CommitPicker) render unchanged.
//
// Seams chosen by the test-writer (reported in the 4.4 handoff):
//   - Page: src/app/projects/[projectId]/tasks/[taskId]/page.tsx (the 5.3 host page, expanded),
//     default export TaskDetailPage({ params: Promise<{ projectId, taskId }> }),
//     `export const dynamic = "force-dynamic"`. It reads through the existing
//     composition.taskDetailService.getTaskDetail(projectId, taskId, { personId, role }) and
//     maps TaskDetailServiceError: FORBIDDEN -> inline unavailable view, NOT_FOUND -> notFound().
//   - Client components (stubbed here so the page's props are observable):
//       src/components/tasks/progress-update-form.tsx  ProgressUpdateForm({ projectId, taskId })
//       src/components/tasks/submit-for-review-button.tsx
//         SubmitForReviewButton({ projectId, taskId, taskKey, version })  (taskKey added by F4)
//   - F4 (approved UI fix): the page is wrapped in TaskStatusProvider (page-level role="status").

const f = vi.hoisted(() => ({
  composition: {} as Record<string, unknown>,
  getUser: vi.fn(),
  findPerson: vi.fn(),
  projectExists: vi.fn(),
  findRole: vi.fn(),
  getTaskDetail: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`REDIRECT:${destination}`); }),
  notFound: vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); }),
  refresh: vi.fn(),
  fetch: vi.fn(),
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
vi.mock("@/components/tasks/progress-update-form", async () => {
  const { createElement } = await import("react");
  return {
    ProgressUpdateForm: (props: { projectId: string; taskId: string }) => createElement("output", {
      "data-stub": "progress-update-form", "data-project-id": props.projectId, "data-task-id": props.taskId,
    }),
  };
});
vi.mock("@/components/tasks/submit-for-review-button", async () => {
  const { createElement } = await import("react");
  return {
    SubmitForReviewButton: (props: { projectId: string; taskId: string; taskKey: string; version: number; disabled?: boolean }) => createElement("output", {
      "data-stub": "submit-for-review", "data-project-id": props.projectId, "data-task-id": props.taskId,
      "data-task-key": props.taskKey,
      "data-version": String(props.version), "data-disabled": String(Boolean(props.disabled)),
    }),
  };
});

import { TaskDetailServiceError } from "@/server/task-detail";

const projectId = ids.project;
const taskId = ids.task;
const PAGE = "../../../src/app/projects/[projectId]/tasks/[taskId]/page";
const developer = { id: ids.developer, githubUsername: usernames.developer };
const pm = { id: ids.pm, githubUsername: usernames.pm };

type Options = { status?: string; empty?: boolean };
function detail({ status = "in_progress", empty = false }: Options = {}) {
  return {
    task: {
      id: taskId, projectKey: "WEB", taskKey: "WEB-12", title: "Synthetic detail title",
      description: "Synthetic detail description <script>not-run</script>", status, version: 7,
      assignee: developer, dueDate: "2026-11-30", branchName: "feature/synthetic-branch",
      acceptanceCriteria: [
        { id: uuid(1), position: 1, description: "Synthetic criterion one" },
        { id: uuid(2), position: 2, description: "Synthetic criterion two" },
      ],
    },
    attachedCommits: empty ? [] : [
      { id: uuid(11), sha: "1".repeat(40), sourceBranch: "feat/selected", attachedBy: developer, attachedAt: "2026-11-05T01:00:00.000Z" },
      { id: uuid(12), sha: "2".repeat(40), sourceBranch: "feat/selected", attachedBy: developer, attachedAt: "2026-11-05T02:00:00.000Z" },
    ],
    progressUpdates: [
      { id: uuid(21), author: developer, body: "Synthetic update earlier", createdAt: "2026-11-04T01:00:00.000Z" },
      { id: uuid(22), author: developer, body: "Synthetic update later", createdAt: "2026-11-06T01:00:00.000Z" },
    ],
    reviewFeedback: [{ id: uuid(31), author: pm, feedback: "Synthetic review feedback", createdAt: "2026-11-05T05:00:00.000Z" }],
    checkHistory: empty ? [] : [checkEntry(2, "b", "2026-11-06T04:00:00.000Z"), checkEntry(1, "a", "2026-11-05T04:00:00.000Z")],
  };
}

beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: ids.authUser } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(ids.developer);
  f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("developer");
  f.getTaskDetail.mockReset().mockResolvedValue(detail());
  f.fetch.mockReset();
  vi.stubGlobal("fetch", f.fetch);
  f.composition = {
    config: {},
    peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    taskDetailService: { getTaskDetail: f.getTaskDetail },
  };
});

function asProductManager() {
  f.findPerson.mockResolvedValue(ids.pm);
  f.findRole.mockResolvedValue("product_manager");
}

async function render(): Promise<string> {
  const { default: TaskDetailPage } = await import(PAGE);
  return renderToStaticMarkup(await TaskDetailPage({ params: Promise.resolve({ projectId, taskId }) }));
}

function expectDetailFields(html: string) {
  const text = visibleText(html);
  const value = detail();
  expect(text).toContain(value.task.title);
  expect(html).toContain("Synthetic detail description &lt;script&gt;not-run&lt;/script&gt;");
  expect(html).not.toContain("<script>not-run");
  for (const criterion of value.task.acceptanceCriteria) expect(text).toContain(criterion.description);
  expect(text).toContain(developer.githubUsername);
  expect(html).toContain("2026-11-30");
  expect(text).toContain("feat/selected");
  for (const commit of value.attachedCommits) expect(html).toContain(commit.sha.slice(0, 7));
  expect(text).toContain("Synthetic review feedback");
  for (const entry of value.checkHistory) expect(html).toContain(entry.anchorSha.slice(0, 7));
  expect(text).toContain("In Progress");
  expect(html).not.toMatch(/\bin_progress\b/);
}

describe("Task detail page", () => {
  it("shows the assigned developer every detail field, with the stored status as its state name", async () => {
    const html = await render();

    expect(f.getTaskDetail).toHaveBeenCalledWith(projectId, taskId, { personId: ids.developer, role: "developer" });
    expectDetailFields(html);
  });

  it("shows the product manager the same detail and check history", async () => {
    asProductManager();

    const html = await render();

    expect(f.getTaskDetail).toHaveBeenCalledWith(projectId, taskId, { personId: ids.pm, role: "product_manager" });
    expectDetailFields(html);
  });

  it("presents developer updates newest first without mutating the ascending service collection", async () => {
    const value = detail();
    const originalOrder = value.progressUpdates.map((update) => update.id);
    Object.freeze(value.progressUpdates);
    f.getTaskDetail.mockResolvedValue(value);

    const html = await render();

    expect(html.indexOf("Synthetic update later")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Synthetic update later")).toBeLessThan(html.indexOf("Synthetic update earlier"));
    expect(value.progressUpdates.map((update) => update.id)).toEqual(originalOrder);
    for (const update of value.progressUpdates) {
      expect(html).toContain(`dateTime="${update.createdAt}"`);
    }
  });

  it("shows an unassigned developer a safe unavailable view with no task or check data", async () => {
    f.getTaskDetail.mockRejectedValue(new TaskDetailServiceError("FORBIDDEN"));

    const html = await render();

    expect(visibleText(html)).toMatch(/unavailable|not available|not assigned|permission/i);
    expect(html).not.toContain("Synthetic detail title");
    expect(html).not.toContain("a".repeat(7));
    expect(stubs(html, "progress-update-form")).toEqual([]);
    expect(stubs(html, "submit-for-review")).toEqual([]);
    expect(visibleText(html)).not.toMatch(/Run check|Add commits/);
    expect(f.notFound).not.toHaveBeenCalled();
  });

  it("shows a nonmember the safe not-found result without reading the task", async () => {
    f.findRole.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getTaskDetail).not.toHaveBeenCalled();
  });

  it("shows the safe not-found result for a missing or deleted task", async () => {
    f.getTaskDetail.mockRejectedValue(new TaskDetailServiceError("NOT_FOUND"));

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["project", { projectId: "not-a-uuid", taskId }],
    ["task", { projectId, taskId: "not-a-uuid" }],
  ] as const)("shows the safe not-found result for a %s ID that is not a UUID (reviewer round 1)", async (_name, params) => {
    const { default: TaskDetailPage } = await import(PAGE);

    await expect(TaskDetailPage({ params: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getTaskDetail).not.toHaveBeenCalled();
  });

  it("redirects a request without a valid session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(render()).rejects.toThrow("REDIRECT:/sign-in");
    expect(f.getTaskDetail).not.toHaveBeenCalled();
  });

  it("does not reveal an internal read failure's detail", async () => {
    f.getTaskDetail.mockRejectedValue(new TaskDetailServiceError("INTERNAL_ERROR"));
    const result = await outcome(render);
    if ("html" in result) {
      expect(result.html).not.toContain("Synthetic detail title");
    } else {
      expect(String((result.error as Error)?.message)).not.toContain(PRIVATE_DETAIL);
    }

    f.getTaskDetail.mockRejectedValue(new Error(PRIVATE_DETAIL));
    const raw = await outcome(render);
    if ("html" in raw) expect(raw.html).not.toContain(PRIVATE_DETAIL);
    else expect(String((raw.error as Error)?.message)).not.toContain(PRIVATE_DETAIL);
  });

  it("is rendered dynamically, never cached", async () => {
    const page = await import(PAGE);

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("starts no check and calls no API while rendering", async () => {
    await render();
    asProductManager();
    await render();

    expect(f.fetch).not.toHaveBeenCalled();
  });
});

describe("Task detail actions follow the role", () => {
  it("gives the assigned developer Run check, the commit picker, the progress form and Submit for review while In Progress", async () => {
    const html = await render();

    expect(visibleText(html)).toContain("Run check");
    expect(visibleText(html)).toContain("Edit commits");
    expect(stubs(html, "progress-update-form")).toEqual([
      expect.objectContaining({ "data-project-id": projectId, "data-task-id": taskId }),
    ]);
    expect(stubs(html, "submit-for-review")).toEqual([
      expect.objectContaining({ "data-project-id": projectId, "data-task-id": taskId, "data-task-key": "WEB-12", "data-version": "7" }),
    ]);
  });

  it("has a page-level status region for the submit outcome (F4)", async () => {
    const html = await render();

    expect(html).toMatch(/role="status"/);
  });

  it("gives the product manager no run, attach, progress-update or submit action", async () => {
    asProductManager();

    const html = await render();

    expect(visibleText(html)).not.toContain("Run check");
    expect(visibleText(html)).not.toContain("Add commits");
    expect(stubs(html, "progress-update-form")).toEqual([]);
    expect(stubs(html, "submit-for-review")).toEqual([]);
  });

  it.each(["to_do", "in_review", "done"])("offers no Submit for review while the task is %s", async (status) => {
    f.getTaskDetail.mockResolvedValue(detail({ status }));

    const html = await render();

    expect(stubs(html, "submit-for-review")).toEqual([]);
  });

  it("does not block Submit for review when there are no commits or checks, and claims no completed check", async () => {
    f.getTaskDetail.mockResolvedValue(detail({ empty: true }));

    const html = await render();

    expect(stubs(html, "submit-for-review")).toEqual([
      expect.objectContaining({ "data-version": "7", "data-disabled": "false" }),
    ]);
    expect(visibleText(html)).not.toMatch(/check (?:completed|passed|succeeded)|all criteria (?:met|addressed)/i);
  });
});

// Task 4.6 approved PM task controls.
it("offers edit/reassign/delete only to the PM without developer member reads", async () => {
  const listMembers = vi.fn().mockResolvedValue([{ personId: ids.developer, githubUsername: usernames.developer, role: "developer" }]);
  f.composition.projectService = { listMembers };
  const { default: Page } = await import(PAGE);
  const devHtml = renderToStaticMarkup(await Page({ params: Promise.resolve({ projectId, taskId }) }));
  expect(devHtml).not.toContain(">Edit<"); expect(listMembers).not.toHaveBeenCalled();
  f.findPerson.mockResolvedValue(ids.pm); f.findRole.mockResolvedValue("product_manager");
  const pmHtml = renderToStaticMarkup(await Page({ params: Promise.resolve({ projectId, taskId }) }));
  expect(pmHtml).toContain(">Edit<"); expect(pmHtml).toContain(">Reassign<"); expect(pmHtml).toContain(">Delete<");
  expect(listMembers).toHaveBeenCalledWith(projectId, ids.pm);
});

// Approved unnumbered task-detail UI follow-up. These assertions use content containment
// and semantic reading order, leaving actual desktop/mobile geometry to browser QA.
function markupContainers(html: string): string[] {
  const stack: { tag: string; start: number }[] = [];
  const containers: string[] = [];
  for (const token of html.matchAll(/<\/?(article|section|aside|header|nav|div|hgroup)\b[^>]*>/g)) {
    const tag = token[1];
    if (token[0].startsWith("</")) {
      const opened = stack.pop();
      if (!opened || opened.tag !== tag) throw new Error("Unbalanced semantic task-page markup");
      containers.push(html.slice(opened.start, token.index + token[0].length));
    } else {
      stack.push({ tag, start: token.index });
    }
  }
  return containers;
}

function smallestContainer(html: string, marker: string, tags = "article|section"): string {
  const matches = markupContainers(html)
    .filter((container) => new RegExp(`^<(?:${tags})\\b`).test(container) && container.includes(marker))
    .sort((a, b) => a.length - b.length);
  expect(matches.length, `semantic container for ${marker}`).toBeGreaterThan(0);
  return matches[0];
}

function namedCard(html: string, heading: string): string {
  const marker = [...html.matchAll(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/g)]
    .find((match) => visibleText(match[0]) === heading)?.[0];
  expect(marker, `heading for ${heading}`).toBeDefined();
  return smallestContainer(html, marker!);
}

function expectReadingOrder(html: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const current = html.indexOf(marker);
    expect(current, `${marker} follows the previous content`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe("Approved task-detail UI follow-up", () => {
  it.each(["developer", "product_manager"])("links the %s breadcrumb to the current project's dashboard and board", async (role) => {
    if (role === "product_manager") asProductManager();
    const html = await render();
    const breadcrumb = smallestContainer(html, 'aria-label="Breadcrumb"', "nav");
    const links = [...breadcrumb.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .map((match) => ({ href: match[1].match(/href="([^"]*)"/)?.[1], text: visibleText(match[2]) }));

    expect(links).toEqual([
      { href: `/projects/${projectId}/dashboard`, text: "Project Dashboard" },
      { href: `/projects/${projectId}/board`, text: "Board" },
    ]);
    expect(visibleText(breadcrumb)).toBe("Project Dashboard / Board / WEB-12");
    expect(visibleText(breadcrumb.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, ""))).toContain("WEB-12");
  });

  it("groups developer content in the main card before Details, timeline and attached commits", async () => {
    const html = await render();
    const main = smallestContainer(html, "Synthetic detail title");
    const details = namedCard(html, "Details");
    const timeline = namedCard(html, "Progress updates");
    const commits = namedCard(html, "Attached commits");

    for (const marker of ["WEB-12", "Synthetic detail title", "Synthetic detail description", "Synthetic criterion one", "Synthetic criterion two", 'data-stub="progress-update-form"']) {
      expect(main).toContain(marker);
    }
    expectReadingOrder(main, ["Synthetic criterion one", "Synthetic criterion two"]);
    expect(main).not.toContain("Synthetic update later");
    expect(main).not.toContain("1".repeat(7));
    expect(main).not.toContain(details);
    for (const marker of ["Assignee", usernames.developer, "Source branches", "feat/selected", "Status", "In Progress", "Due date", "2026-11-30"]) {
      expect(details).toContain(marker);
    }
    expect(timeline).toContain("Synthetic update later");
    expect(timeline).toContain(usernames.developer);
    expect(timeline).not.toContain('data-stub="progress-update-form"');
    expect(commits).toContain("1".repeat(7));
    expect(commits).toContain("Edit commits");
    expect(commits).not.toContain("Run check");
    expectReadingOrder(html, [main, details, timeline, commits]);
  });

  it("connects every developer progress event to a shared vertical timeline guide", async () => {
    const html = await render();
    const timeline = namedCard(html, "Progress updates");
    const list = timeline.match(/<ol\b[^>]*>[\s\S]*?<\/ol>/)?.[0];
    expect(list, "the timeline preserves ordered event semantics").toBeDefined();
    const listClasses = list!.match(/^<ol\b[^>]*class="([^"]*)"/)?.[1] ?? "";
    const decorativeGuide = [...list!.matchAll(/<(?:span|div)\b[^>]*>/g)].some(([element]) => {
      const classes = element.match(/class="([^"]*)"/)?.[1] ?? "";
      return element.includes('aria-hidden="true"') && /(?:^|\s)(?:w-px|border-l|border-s)(?:\s|$)/.test(classes)
        && /(?:^|\s)(?:h-full|inset-y-0)(?:\s|$)/.test(classes);
    });
    expect(/(?:^|\s)border-(?:l|s)(?:-\d+)?(?:\s|$)/.test(listClasses) || decorativeGuide,
      "all events share one connected vertical guide").toBe(true);
    const events = [...list!.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(([event]) => event);
    expect(events).toHaveLength(detail().progressUpdates.length);
    for (const event of events) {
      const markers = [...event.matchAll(/<(?:span|div)\b[^>]*>/g)].filter(([element]) =>
        element.includes('aria-hidden="true"') && /class="[^"]*\brounded-full\b/.test(element));
      expect(markers, "each event has exactly one decorative circular marker").toHaveLength(1);
      expect(event).toContain(usernames.developer);
      expect(event).toContain("<time ");
    }
    expectReadingOrder(list!, ["Synthetic update later", "Synthetic update earlier"]);
  });

  it("keeps Submit for review near the task heading and review/check panels below the developer task content", async () => {
    const html = await render();
    const header = smallestContainer(html, "Synthetic detail title", "header");
    const feedback = namedCard(html, "Review feedback");
    const checks = namedCard(html, "Acceptance Criteria Check");
    const commits = namedCard(html, "Attached commits");

    expect(header).toContain('data-stub="submit-for-review"');
    expect(feedback).toContain("Synthetic review feedback");
    expect(checks).toContain("Run check");
    for (const entry of detail().checkHistory) expect(checks).toContain(entry.anchorSha.slice(0, 7));
    expectReadingOrder(html, [commits, feedback, checks]);
  });

  it("groups the developer title and task key opposite the submit action in the main-card header", async () => {
    const html = await render();
    const main = smallestContainer(html, "Synthetic detail title");
    const header = smallestContainer(main, "Synthetic detail title", "header");
    const titleGroup = smallestContainer(header, "Synthetic detail title", "div|hgroup");

    expect(titleGroup).toContain("WEB-12");
    expect(titleGroup).not.toContain('data-stub="submit-for-review"');
    expect(stubs(header, "submit-for-review")).toHaveLength(1);
    // The heading and separate action share the top header; frontend QA checks
    // the action's top-right coordinates at desktop and narrow viewports.
    expectReadingOrder(header, [titleGroup, 'data-stub="submit-for-review"']);
  });

  it("preserves the PM header, panel order, ascending history and management controls", async () => {
    asProductManager();
    const html = await render();
    const header = smallestContainer(html, "Synthetic detail title", "header");
    for (const marker of ["Assignee", usernames.developer, "Due date", "2026-11-30", "Branch", "feature/synthetic-branch"]) {
      expect(header).toContain(marker);
    }
    expect(visibleText(html)).not.toMatch(/\bDetails\b/);
    expectReadingOrder(html, [
      "Synthetic detail title", ">Edit<", namedCard(html, "Description"),
      namedCard(html, "Acceptance criteria"), namedCard(html, "Attached commits"),
      namedCard(html, "Progress updates"), namedCard(html, "Review feedback"),
      namedCard(html, "Acceptance Criteria Check"),
    ]);
    expect(html.indexOf("Synthetic update earlier")).toBeLessThan(html.indexOf("Synthetic update later"));
    expect(html).toContain(">Reassign<");
    expect(html).toContain(">Delete<");
    expect(visibleText(html)).not.toMatch(/Run check|Add commits/);
    expect(stubs(html, "progress-update-form")).toEqual([]);
    expect(stubs(html, "submit-for-review")).toEqual([]);
  });

  it("keeps supporting cards and actions usable with empty histories and no recorded branch", async () => {
    const value = detail({ empty: true });
    value.progressUpdates = [];
    f.getTaskDetail.mockResolvedValue({ ...value, task: { ...value.task, branchName: null } });
    const html = await render();

    expect(namedCard(html, "Details")).toContain("No attached commits yet.");
    expect(namedCard(html, "Progress updates")).toContain("No progress updates yet.");
    const commits = namedCard(html, "Attached commits");
    expect(commits).toContain("No commits are attached yet.");
    expect(commits).toContain("Add commits");
    expect(namedCard(html, "Acceptance Criteria Check")).toContain("Run check");
    expect(stubs(html, "progress-update-form")).toHaveLength(1);
    expect(stubs(html, "submit-for-review")).toHaveLength(1);
  });
});


describe("attached commit source branches", () => {
  it("summarizes source branches and counts in developer Details without using the configured branch", async () => {
    const value = detail();
    value.attachedCommits.push({ ...value.attachedCommits[0], id: uuid(13), sha: "3".repeat(40), sourceBranch: "feat/another" });
    f.getTaskDetail.mockResolvedValue(value);
    const html = await render();
    const details = visibleText(namedCard(html, "Details"));
    expect(details).toMatch(/feat\/selected\s*(?:[·:—(]\s*)?2/);
    expect(details).toMatch(/feat\/another\s*(?:[·:—(]\s*)?1/);
    expect(details).not.toContain("feature/synthetic-branch");
  });
  it.each(["developer", "product_manager"])("shows each commit's branch and legacy fallback for %s", async (role) => {
    if (role === "product_manager") asProductManager();
    const value = detail();
    const commits = value.attachedCommits as { sourceBranch: string | null }[];
    commits[1].sourceBranch = null;
    f.getTaskDetail.mockResolvedValue(value);
    const html = await render();
    const card = namedCard(html, "Attached commits");
    expect(card).toContain("feat/selected"); expect(card).toContain("Branch not recorded");
    if (role === "developer") expect(namedCard(html, "Details")).toContain("Branch not recorded");
    else expect(smallestContainer(html, "Synthetic detail title", "header")).toContain("feature/synthetic-branch");
  });
  it.each(["to_do", "in_review", "done"])("keeps attachments and check history visible but offers no commit edit while %s", async (status) => {
    f.getTaskDetail.mockResolvedValue(detail({ status }));
    const html = await render();
    expect(namedCard(html, "Attached commits")).toContain("feat/selected");
    expect(visibleText(html)).not.toMatch(/Add commits|Save commits|Edit commits/);
    for (const entry of detail().checkHistory) expect(html).toContain(entry.anchorSha.slice(0, 7));
  });
});
