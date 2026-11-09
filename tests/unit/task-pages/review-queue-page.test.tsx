import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_DETAIL, articles, checkEntry, ids, stubs, usernames, uuid, visibleText } from "./support";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Product manager reads the review queue" and "Review
// queue actions and access"; design.md "Board, Detail and Review Queue Decisions (4.4)" B2, B5,
// B7, B8, B10, B12. ui-spec "Review queue": commits, the result referenced by the submission and
// distinct check history, read-only check access.
//
// Seams chosen by the test-writer (reported in the 4.4 handoff):
//   - Page: src/app/projects/[projectId]/review-queue/page.tsx, default export
//     ReviewQueuePage({ params: Promise<{ projectId }> }), `export const dynamic = "force-dynamic"`.
//   - Composition key `reviewQueueService` with getReviewQueue(projectId, { personId, role })
//     returning { entries } (see tests/unit/review-queue/review-queue-service.test.ts) and
//     throwing ReviewQueueServiceError("FORBIDDEN") for a developer.
//   - Client component src/components/tasks/review-actions.tsx exporting
//     ReviewActions({ projectId, taskId, version }), stubbed here; its behaviour is tested in
//     task-actions.test.tsx.
//   - Check results render through the existing CheckHistory component (real here).
//   - With no referenced result the entry states it, matching /no (check )?result (is )?referenced/i.
// UI fixes approved by thegrimbee after the frontend check (handoff change log):
//   - F1: the referenced result renders through CheckResultCard (no second history caption or
//     landmark per entry), and the history card it references reads "Referenced by the
//     submission" (CheckHistory referencedResultId); see check-result-card.test.tsx.
//   - F4: ReviewActions also receives taskKey, and the page is wrapped in TaskStatusProvider, so
//     it has a page-level role="status" region; see task-status.test.tsx.

const f = vi.hoisted(() => ({
  composition: {} as Record<string, unknown>,
  getUser: vi.fn(),
  findPerson: vi.fn(),
  projectExists: vi.fn(),
  findRole: vi.fn(),
  getReviewQueue: vi.fn(),
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
vi.mock("@/components/tasks/review-actions", async () => {
  const { createElement } = await import("react");
  return {
    ReviewActions: (props: { projectId: string; taskId: string; taskKey: string; version: number }) => createElement("output", {
      "data-stub": "review-actions", "data-project-id": props.projectId, "data-task-id": props.taskId,
      "data-task-key": props.taskKey, "data-version": String(props.version),
    }),
  };
});

import { ReviewQueueServiceError } from "@/server/review-queue";

const projectId = ids.project;
const PAGE = "../../../src/app/projects/[projectId]/review-queue/page";
const developer = { id: ids.developer, githubUsername: usernames.developer };
const NO_REFERENCE = /no (?:check )?result (?:is )?referenced/i;

function entry(n: number, options: { referenced: "older" | "none"; commitChar: string; olderChar: string; newerChar: string }) {
  const older = checkEntry(n * 10 + 1, options.olderChar, "2026-11-05T04:00:00.000Z");
  const newer = checkEntry(n * 10 + 2, options.newerChar, "2026-11-06T04:00:00.000Z");
  return {
    id: uuid(100 + n), taskKey: `WEB-${n}`, title: `Synthetic review task ${n}`, version: n + 60,
    assignee: developer, dueDate: "2026-11-30",
    attachedCommits: [{ id: uuid(300 + n), sha: options.commitChar.repeat(40), attachedBy: developer, attachedAt: "2026-11-05T01:00:00.000Z" }],
    checkHistory: [newer, older],
    referencedResult: options.referenced === "older" ? older : null,
  };
}

const referencedEntry = entry(3, { referenced: "older", commitChar: "c", olderChar: "a", newerChar: "b" });
const unreferencedEntry = entry(8, { referenced: "none", commitChar: "f", olderChar: "d", newerChar: "e" });

beforeEach(() => {
  f.getUser.mockReset().mockResolvedValue({ data: { user: { id: ids.authUser } }, error: null });
  f.findPerson.mockReset().mockResolvedValue(ids.pm);
  f.projectExists.mockReset().mockResolvedValue(true);
  f.findRole.mockReset().mockResolvedValue("product_manager");
  f.getReviewQueue.mockReset().mockImplementation(async (_projectId: string, access: { role: string }) => {
    if (access.role !== "product_manager") throw new ReviewQueueServiceError("FORBIDDEN");
    return { entries: [referencedEntry, unreferencedEntry] };
  });
  f.fetch.mockReset();
  vi.stubGlobal("fetch", f.fetch);
  f.composition = {
    config: {},
    peopleRepository: { findPersonIdByAuthUserId: f.findPerson },
    projectAccessRepository: { projectExists: f.projectExists, findProjectRole: f.findRole },
    reviewQueueService: { getReviewQueue: f.getReviewQueue },
  };
});

function only(value: ReturnType<typeof entry>) {
  f.getReviewQueue.mockResolvedValue({ entries: [value] });
}

async function render(): Promise<string> {
  const { default: ReviewQueuePage } = await import(PAGE);
  return renderToStaticMarkup(await ReviewQueuePage({ params: Promise.resolve({ projectId }) }));
}

function occurrences(html: string, value: string): number {
  return html.split(value).length - 1;
}

describe("Product manager reads the review queue", () => {
  it("reads the queue through the service as the product manager", async () => {
    await render();

    expect(f.getReviewQueue).toHaveBeenCalledWith(projectId, { personId: ids.pm, role: "product_manager" });
  });

  it("shows each entry's key, title, assignee and attached commits, in the service's order", async () => {
    const html = await render();
    const text = visibleText(html);

    for (const value of [referencedEntry, unreferencedEntry]) {
      expect(text).toContain(value.taskKey);
      expect(text).toContain(value.title);
      expect(html).toContain(value.attachedCommits[0].sha.slice(0, 7));
    }
    expect(text).toContain(usernames.developer);
    expect(html.indexOf("WEB-3")).toBeLessThan(html.indexOf("WEB-8"));
  });

  it("presents the referenced result and keeps the distinct check history available", async () => {
    only(referencedEntry);

    const html = await render();

    const [newer, older] = referencedEntry.checkHistory;
    expect(html).toContain(newer.anchorSha.slice(0, 7));
    // The referenced result appears in its own place and again in the history.
    expect(occurrences(html, older.anchorSha.slice(0, 7))).toBeGreaterThanOrEqual(2);
    expect(visibleText(html)).toMatch(/referenced/i);
    expect(visibleText(html)).not.toMatch(NO_REFERENCE);
  });

  it("shows the referenced result as a single card and marks it in the history (F1)", async () => {
    only(referencedEntry);

    const html = await render();

    const [newer, older] = referencedEntry.checkHistory;
    expect(html.split('aria-label="Acceptance criteria check history"')).toHaveLength(2);
    expect(html.split("newest checks first")).toHaveLength(2);
    const marked = articles(html).filter((card) => /referenced by the submission/i.test(card));
    expect(marked.length).toBeGreaterThanOrEqual(1);
    for (const card of marked) expect(card).toContain(older.anchorSha.slice(0, 7));
    for (const card of articles(html).filter((value) => value.includes(newer.anchorSha.slice(0, 7)))) {
      expect(card).not.toMatch(/referenced by the submission/i);
    }
  });

  it("marks no history card when no result is referenced (F1)", async () => {
    only(unreferencedEntry);

    const html = await render();

    expect(articles(html).filter((card) => /referenced by the submission/i.test(card))).toEqual([]);
  });

  it("has a page-level status region for action outcomes (F4)", async () => {
    const html = await render();

    expect(html).toMatch(/role="status"/);
  });

  it("states that no result is referenced, while still showing commits and check history", async () => {
    only(unreferencedEntry);

    const html = await render();

    expect(visibleText(html)).toMatch(NO_REFERENCE);
    expect(html).toContain(unreferencedEntry.attachedCommits[0].sha.slice(0, 7));
    for (const check of unreferencedEntry.checkHistory) expect(html).toContain(check.anchorSha.slice(0, 7));
  });

  it("shows an empty queue without actions", async () => {
    f.getReviewQueue.mockResolvedValue({ entries: [] });

    const html = await render();

    expect(stubs(html, "review-actions")).toEqual([]);
    expect(visibleText(html)).toMatch(/no tasks|nothing|empty|no submissions/i);
  });
});

describe("Review queue actions and access", () => {
  it("offers Approve and Request changes on each entry with its task id and current version", async () => {
    const html = await render();

    expect(stubs(html, "review-actions")).toEqual([
      expect.objectContaining({ "data-project-id": projectId, "data-task-id": referencedEntry.id, "data-task-key": referencedEntry.taskKey, "data-version": String(referencedEntry.version) }),
      expect.objectContaining({ "data-project-id": projectId, "data-task-id": unreferencedEntry.id, "data-task-key": unreferencedEntry.taskKey, "data-version": String(unreferencedEntry.version) }),
    ]);
  });

  it("shows a developer a safe unavailable view and exposes no entries", async () => {
    f.findPerson.mockResolvedValue(ids.developer);
    f.findRole.mockResolvedValue("developer");

    const html = await render();

    expect(visibleText(html)).toMatch(/unavailable|not available|permission|product manager/i);
    expect(html).not.toContain("WEB-3");
    expect(html).not.toContain("Synthetic review task");
    expect(stubs(html, "review-actions")).toEqual([]);
    expect(f.notFound).not.toHaveBeenCalled();
  });

  it("shows a nonmember the safe not-found result", async () => {
    f.findRole.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getReviewQueue).not.toHaveBeenCalled();
  });

  it("redirects a request without a valid session to /sign-in", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(render()).rejects.toThrow("REDIRECT:/sign-in");
    expect(f.getReviewQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["an internal service error", () => new ReviewQueueServiceError("INTERNAL_ERROR")],
    ["an unexpected error", () => new Error(PRIVATE_DETAIL)],
  ])("shows a safe failure notice, without the detail, on %s (reviewer round 1)", async (_name, failure) => {
    f.getReviewQueue.mockRejectedValue(failure());

    const html = await render();

    expect(html).not.toContain(PRIVATE_DETAIL);
    expect(stubs(html, "review-actions")).toEqual([]);
    expect(html).not.toContain("Synthetic review task");
    const alerts = [...html.matchAll(/<(\w+)\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/\1>/g)].map((match) => visibleText(match[2]));
    expect(alerts.some((value) => /could not|couldn.t|unable|unavailable|try again/i.test(value))).toBe(true);
  });

  it("shows the safe not-found result for a project ID that is not a UUID (reviewer round 1)", async () => {
    const { default: ReviewQueuePage } = await import(PAGE);

    await expect(ReviewQueuePage({ params: Promise.resolve({ projectId: "not-a-uuid" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f.getReviewQueue).not.toHaveBeenCalled();
    expect(f.findRole).not.toHaveBeenCalled();
  });

  it("starts no check and calls no API while rendering", async () => {
    await render();

    expect(f.fetch).not.toHaveBeenCalled();
    expect(visibleText(await render())).not.toContain("Run check");
  });

  it("is rendered dynamically, never cached", async () => {
    const page = await import(PAGE);

    expect(page.dynamic).toBe("force-dynamic");
  });
});
