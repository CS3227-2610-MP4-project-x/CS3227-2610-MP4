import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_DETAIL, ids } from "./support";

// Task 4.4 (OpenSpec change project-task-management). No requirement IDs exist; requirements
// are cited by title: task-management "Board status menu applies only permitted transitions",
// "Task detail actions follow the role" and "Review queue actions and access"; design.md
// "Board, Detail and Review Queue Decisions (4.4)" B2, B8, B9, L1, L3, L5, L9 (a 403 or 409 from a
// competing transition means "reload and retry").
//
// Node-only hook harness, as tests/unit/home.test.tsx and
// tests/unit/completion-assessment/check-panel.test.tsx: each component function is called
// directly with synthetic hooks, its element tree (including nested function components) is
// materialised, and event handlers are invoked. No DOM library is added (B12).
//
// Seams chosen by the test-writer (reported in the 4.4 handoff). All are Client Components under
// src/components/tasks/ that call only the existing routes and then router.refresh():
//   board-status-menu.tsx        BoardStatusMenu({ projectId, taskId, taskKey, version, state })
//   submit-for-review-button.tsx SubmitForReviewButton({ projectId, taskId, taskKey, version })
//   progress-update-form.tsx     ProgressUpdateForm({ projectId, taskId })
//   review-actions.tsx           ReviewActions({ projectId, taskId, taskKey, version })
// UI fixes approved by thegrimbee after the frontend check (handoff change log); seams chosen by
// the test-writer:
//   F4  src/components/tasks/task-status.tsx exports TaskStatusProvider({ children }) and
//       useTaskStatus(): (message: string) => void. The provider is placed at page level and owns
//       one role="status" region, so an outcome message survives the card unmounting after
//       router.refresh(). The menu, Submit for review and review actions announce through it:
//       success "Moved WEB-3 to In Progress", "Submitted WEB-3 for review", "Approved WEB-3",
//       "Requested changes on WEB-3"; 403/409 a reload message. Here the hook is replaced by a
//       spy; the provider itself is tested in task-status.test.tsx.
//   F10 the board menu's In Progress action is labelled "Submit for review".
//   F12 Request-changes validation messages are shown with role="alert".
// Interaction shape the tests rely on:
//   - every action is a <button> with an onClick handler, or a form's onSubmit;
//   - menu options are present in the first render (a native <details> menu is fine; a
//     state-gated toggle is not);
//   - text input is a controlled <textarea> (value + onChange);
//   - hooks used are among useState, useRef, useMemo, useCallback, useEffect, useId,
//     useTransition and next/navigation's useRouter.
// The state route is PATCH /api/v1/projects/{projectId}/tasks/{taskId}/state with a JSON body
// { state, version } (plus feedback for Request changes); progress updates are
// POST .../progress-updates with { body }.

const h = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  slots: [] as unknown[],
  ids: 0,
  fetch: vi.fn(),
  refresh: vi.fn(),
  announce: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const slot = <T,>(make: () => T): T => {
    const index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = make();
    return h.slots[index] as T;
  };
  return {
    ...actual,
    useState(initial: unknown) {
      if (!h.active) return actual.useState(initial);
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [h.slots[index], (next: unknown) => {
        h.slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(h.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      if (!h.active) return actual.useRef(initial);
      return slot(() => ({ current: initial }));
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      if (!h.active) return actual.useMemo(factory, deps);
      h.cursor++;
      return factory();
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      if (!h.active) return actual.useCallback(callback as () => void, deps);
      h.cursor++;
      return callback;
    },
    useEffect(effect: () => void, deps?: readonly unknown[]) {
      if (!h.active) return actual.useEffect(effect, deps);
      h.cursor++;
    },
    useId() {
      if (!h.active) return actual.useId();
      return slot(() => `synthetic-id-${h.ids++}`);
    },
    useTransition() {
      if (!h.active) return actual.useTransition();
      h.cursor++;
      return [false, (callback: () => unknown) => { void callback(); }];
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
// The Group 7 picker is replaced by a stub that reports one attach through its onAttached prop.
vi.mock("@/components/github-evidence/commit-picker", async () => {
  const { createElement } = await import("react");
  return {
    CommitPicker: (props: { onAttached?: (shas: readonly string[]) => void }) =>
      createElement("button", { type: "button", onClick: () => props.onAttached?.(["a".repeat(40)]) }, "synthetic-attach"),
  };
});
vi.mock("@/components/tasks/task-status", () => ({
  TaskStatusProvider: ({ children }: { children?: unknown }) => children,
  useTaskStatus: () => h.announce,
}));

const projectId = ids.project;
const taskId = ids.task;
const STATE_URL = `/api/v1/projects/${projectId}/tasks/${taskId}/state`;
const PROGRESS_URL = `/api/v1/projects/${projectId}/tasks/${taskId}/progress-updates`;
const RELOAD = /reload|refresh/i;
const taskKey = "WEB-3";

/** Every message sent to the page-level status region (F4). */
function announced(): string {
  return h.announce.mock.calls.map((args) => String(args[0])).join("\n");
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Props = Record<string, unknown> & { children?: ReactNode };
type Host = { type: unknown; props: Props };

/** Replaces function components with their output, once per render, so hook order is stable. */
function materialize(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.map(materialize);
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function") return materialize((node.type as (props: Props) => ReactNode)(node.props));
  const props = node.props ?? {};
  return { type: node.type, props: { ...props, children: materialize(props.children as ReactNode) } };
}

function isHost(node: unknown): node is Host {
  return typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node && "props" in node;
}

function hosts(node: unknown): Host[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isHost(node)) return [];
  return [node, ...hosts(node.props.children)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isHost(node)) return "";
  const label = typeof node.props["aria-label"] === "string" ? ` ${node.props["aria-label"]} ` : "";
  return label + text(node.props.children);
}

function event(value = "") {
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    target: { value },
    currentTarget: { value },
  };
}

/** The form with an onSubmit handler that contains `target`, if any. */
function formOf(tree: unknown, target: Host): Host | undefined {
  return hosts(tree).find((node) => node.type === "form" && typeof node.props.onSubmit === "function" && hosts(node).includes(target));
}

/** A <button> without type="button" inside a form submits it, as in a browser. */
function submitsForm(tree: unknown, target: Host): boolean {
  return target.props.type !== "button" && target.props.type !== "reset" && formOf(tree, target) !== undefined;
}

type Component = (props: Record<string, unknown>) => ReactNode;

// Literal imports so the `@/` alias resolves (and type-checks) like every other test.
const MODULES = {
  menu: () => import("@/components/tasks/board-status-menu"),
  submit: () => import("@/components/tasks/submit-for-review-button"),
  progress: () => import("@/components/tasks/progress-update-form"),
  review: () => import("@/components/tasks/review-actions"),
  picker: () => import("@/components/tasks/task-commit-picker"),
} as const;

async function harness(name: keyof typeof MODULES, exportName: string, props: Record<string, unknown>) {
  const loaded = (await MODULES[name]()) as unknown as Record<string, Component>;
  const component = loaded[exportName];
  expect(component, `${name} exports ${exportName}`).toBeTypeOf("function");
  h.active = true;
  const render = () => {
    h.cursor = 0;
    return materialize(component(props));
  };
  const buttons = (tree = render()) => hosts(tree).filter((node) => node.type === "button");
  const actionable = (tree = render()) => buttons(tree).filter((node) => typeof node.props.onClick === "function" || submitsForm(tree, node));
  /** Clicks the action whose text matches, then submits its form unless the click prevented it. */
  const activate = async (pattern: RegExp, tree = render()) => {
    const candidates = actionable(tree).filter((node) => pattern.test(text(node)));
    const target = candidates[candidates.length - 1];
    expect(target, `an action matching ${pattern}`).toBeDefined();
    const click = event();
    if (typeof target.props.onClick === "function") await (target.props.onClick as (e: unknown) => unknown)(click);
    const form = formOf(tree, target);
    if (form && submitsForm(tree, target) && !click.defaultPrevented) await (form.props.onSubmit as (e: unknown) => unknown)(event());
  };
  const type = async (value: string, tree = render()) => {
    const area = hosts(tree).find((node) => node.type === "textarea");
    expect(area, "a controlled textarea").toBeDefined();
    expect(typeof area!.props.onChange).toBe("function");
    await (area!.props.onChange as (e: unknown) => unknown)(event(value));
  };
  /** Text the person can see: the component's own text plus the page-level status region. */
  const seen = () => `${text(render())}\n${announced()}`;
  const alerts = () => hosts(render()).filter((node) => node.props.role === "alert").map((node) => text(node)).join("\n");
  return { render, buttons, actionable, activate, type, seen, alerts, text: () => text(render()) };
}

function response(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function stateFailure(status: 403 | 409) {
  const code = status === 403 ? "FORBIDDEN" : "VERSION_CONFLICT";
  return response(status, { error: { code, message: PRIVATE_DETAIL } });
}

function call(index = 0) {
  const [url, init] = h.fetch.mock.calls[index] as [string, RequestInit | undefined];
  return {
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    contentType: new Headers(init?.headers).get("content-type") ?? "",
    body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  };
}

beforeEach(() => {
  h.active = false;
  h.cursor = 0;
  h.slots = [];
  h.ids = 0;
  h.fetch.mockReset();
  h.refresh.mockReset();
  h.announce.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => { h.active = false; vi.unstubAllGlobals(); });


// ---------------------------------------------------------------------------
// Board status menu
// ---------------------------------------------------------------------------

describe("Board status menu applies only permitted transitions", () => {
  const menu = (state: string, version = 41) => harness("menu", "BoardStatusMenu", { projectId, taskId, taskKey, version, state });

  it("offers only In Progress from To Do", async () => {
    const view = await menu("To Do");

    const labels = view.actionable().map((node) => text(node));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/In Progress/);
  });

  it("offers only Submit for review from In Progress (F10)", async () => {
    const view = await menu("In Progress");

    const labels = view.actionable().map((node) => text(node));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/submit for review/i);
    expect(labels[0]).not.toMatch(/to In Review|Done|To Do/i);
  });

  it.each(["In Review", "Done"])("offers no move from %s", async (state) => {
    const view = await menu(state);

    expect(view.actionable()).toEqual([]);
  });

  it("starts a task through the state route with the task's version, then reloads the board and announces it", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "In Progress", version: 42 }));
    const view = await menu("To Do", 41);

    await view.activate(/In Progress/);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(call()).toEqual({ url: STATE_URL, method: "PATCH", contentType: expect.stringMatching(/application\/json/i), body: { state: "In Progress", version: 41 } });
    expect(announced()).toMatch(/Moved WEB-3 to In Progress/i);
  });

  it("submits from In Progress with { state: In Review, version } and announces it", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "In Review", version: 8 }));
    const view = await menu("In Progress", 7);

    await view.activate(/submit for review/i);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(call().body).toEqual({ state: "In Review", version: 7 });
    expect(announced()).toMatch(/Submitted WEB-3 for review/i);
  });

  it.each([403, 409] as const)("asks the person to reload in the page-level status region and reloads the board after a %i", async (status) => {
    h.fetch.mockResolvedValue(stateFailure(status));
    const view = await menu("To Do");

    await view.activate(/In Progress/);

    await vi.waitFor(() => expect(announced()).toMatch(RELOAD));
    expect(h.refresh).toHaveBeenCalled();
    expect(view.seen()).not.toContain(PRIVATE_DETAIL);
  });

  it.each(["server", "network"])("shows a safe message on a %s failure", async (failure) => {
    if (failure === "network") h.fetch.mockRejectedValue(new Error(PRIVATE_DETAIL));
    else h.fetch.mockResolvedValue(response(500, { error: { code: "INTERNAL_ERROR", message: PRIVATE_DETAIL } }));
    const view = await menu("To Do");

    await view.activate(/In Progress/);

    await vi.waitFor(() => expect(view.seen()).toMatch(/try again|could not|failed|reload/i));
    expect(view.seen()).not.toContain(PRIVATE_DETAIL);
  });
});

// ---------------------------------------------------------------------------
// Submit for review (task detail)
// ---------------------------------------------------------------------------

describe("Task detail actions follow the role: Submit for review", () => {
  const submit = (version = 7) => harness("submit", "SubmitForReviewButton", { projectId, taskId, taskKey, version });

  it("is an enabled Submit for review action", async () => {
    const view = await submit();

    const button = view.actionable().find((node) => /submit for review/i.test(text(node)));
    expect(button).toBeDefined();
    expect(button!.props.disabled).toBeFalsy();
  });

  it("moves the task to In Review through the state route without running a check", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "In Review", version: 8 }));
    const view = await submit(7);

    await view.activate(/submit for review/i);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(call()).toEqual({ url: STATE_URL, method: "PATCH", contentType: expect.stringMatching(/application\/json/i), body: { state: "In Review", version: 7 } });
    expect(view.seen()).not.toMatch(/check (?:completed|passed|succeeded)/i);
    expect(announced()).toMatch(/Submitted WEB-3 for review/i);
  });

  it.each([403, 409] as const)("asks the developer to reload in the page-level status region after a %i", async (status) => {
    h.fetch.mockResolvedValue(stateFailure(status));
    const view = await submit();

    await view.activate(/submit for review/i);

    await vi.waitFor(() => expect(announced()).toMatch(RELOAD));
    expect(h.refresh).toHaveBeenCalled();
    expect(view.seen()).not.toContain(PRIVATE_DETAIL);
  });
});

// ---------------------------------------------------------------------------
// Progress update form (task detail)
// ---------------------------------------------------------------------------

describe("Task detail actions follow the role: progress update", () => {
  const form = () => harness("progress", "ProgressUpdateForm", { projectId, taskId });
  const SEND = /post|add|send|save|submit|update/i;

  it("posts the update to the progress-updates route, then refreshes the page", async () => {
    h.fetch.mockResolvedValue(response(201, { id: "synthetic", body: "Synthetic progress note" }));
    const view = await form();

    await view.type("Synthetic progress note");
    await view.activate(SEND);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    const sent = call();
    expect(sent.url).toBe(PROGRESS_URL);
    expect(sent.method).toBe("POST");
    expect(sent.contentType).toMatch(/application\/json/i);
    expect(Object.keys(sent.body ?? {})).toEqual(["body"]);
    expect(String(sent.body?.body).trim()).toBe("Synthetic progress note");
  });

  it.each(["server", "network"])("shows a safe message on a %s failure", async (failure) => {
    if (failure === "network") h.fetch.mockRejectedValue(new Error(PRIVATE_DETAIL));
    else h.fetch.mockResolvedValue(response(500, { error: { code: "INTERNAL_ERROR", message: PRIVATE_DETAIL } }));
    const view = await form();

    await view.type("Synthetic progress note");
    await view.activate(SEND);

    await vi.waitFor(() => expect(view.text()).toMatch(/try again|could not|failed|reload/i));
    expect(view.text()).not.toContain(PRIVATE_DETAIL);
  });
});

// ---------------------------------------------------------------------------
// Commit picker host (task detail)
// ---------------------------------------------------------------------------

describe("Task detail actions follow the role: attached commits refresh (reviewer round 1)", () => {
  // Seam already built: src/components/tasks/task-commit-picker.tsx
  // TaskCommitPicker({ projectId, taskId }) hosts the unchanged CommitPicker.
  it("refreshes the page after commits are attached", async () => {
    const view = await harness("picker", "TaskCommitPicker", { projectId, taskId });

    expect(h.refresh).not.toHaveBeenCalled();
    await view.activate(/synthetic-attach/);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Review queue actions
// ---------------------------------------------------------------------------

describe("Review queue actions and access", () => {
  const actions = (version = 63) => harness("review", "ReviewActions", { projectId, taskId, taskKey, version });

  async function requestChanges(view: Awaited<ReturnType<typeof actions>>, feedback: string) {
    let tree = view.render();
    if (!hosts(tree).some((node) => node.type === "textarea")) {
      await view.activate(/request changes/i, tree);
      tree = view.render();
    }
    await view.type(feedback, tree);
    await view.activate(/request changes|send|submit/i);
  }

  it("offers Approve and Request changes", async () => {
    const view = await actions();

    const labels = view.actionable().map((node) => text(node));
    expect(labels.some((label) => /approve/i.test(label))).toBe(true);
    expect(labels.some((label) => /request changes/i.test(label))).toBe(true);
  });

  it("approves through the state route with the entry's version, then reloads the queue", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "Done", version: 64 }));
    const view = await actions(63);

    await view.activate(/approve/i);

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(call()).toEqual({ url: STATE_URL, method: "PATCH", contentType: expect.stringMatching(/application\/json/i), body: { state: "Done", version: 63 } });
    expect(announced()).toMatch(/Approved WEB-3/i);
  });

  it.each(["", "   ", "\n\t "])("requires non-blank feedback before sending (%j)", async (feedback) => {
    const view = await actions();

    await requestChanges(view, feedback);

    expect(h.fetch).not.toHaveBeenCalled();
    expect(view.alerts()).toMatch(/feedback/i);
  });

  it("sends trimmed feedback with { state: In Progress, version }", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "In Progress", version: 64 }));
    const view = await actions(63);

    await requestChanges(view, "  Synthetic feedback: add the edge cases  \n");

    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(call()).toEqual({
      url: STATE_URL, method: "PATCH", contentType: expect.stringMatching(/application\/json/i),
      body: { state: "In Progress", version: 63, feedback: "Synthetic feedback: add the edge cases" },
    });
    expect(announced()).toMatch(/WEB-3/);
    expect(announced()).toMatch(/changes/i);
  });

  it("accepts feedback that trims to exactly 5,000 characters", async () => {
    h.fetch.mockResolvedValue(response(200, { id: taskId, state: "In Progress", version: 64 }));
    const view = await actions();
    const exact = "f".repeat(5_000);

    await requestChanges(view, `   ${exact}   `);

    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    expect(call().body?.feedback).toBe(exact);
  });

  it("does not send feedback that trims to more than 5,000 characters", async () => {
    const view = await actions();

    await requestChanges(view, "f".repeat(5_001));

    expect(h.fetch).not.toHaveBeenCalled();
    expect(view.alerts()).toMatch(/5,?000|too long|feedback/i);
  });

  it.each([
    ["approve", 403], ["approve", 409], ["request changes", 403], ["request changes", 409],
  ] as const)("tells the product manager to reload and reloads the queue when %s returns %i", async (action, status) => {
    h.fetch.mockResolvedValue(stateFailure(status));
    const view = await actions();

    if (action === "approve") await view.activate(/approve/i);
    else await requestChanges(view, "Synthetic feedback");

    await vi.waitFor(() => expect(announced()).toMatch(RELOAD));
    expect(h.refresh).toHaveBeenCalled();
    expect(view.seen()).not.toContain(PRIVATE_DETAIL);
  });

  it("starts no check: every request goes to the state route", async () => {
    h.fetch.mockResolvedValue(response(200, {}));
    const view = await actions();

    await view.activate(/approve/i);
    await requestChanges(view, "Synthetic feedback");

    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    for (const index of [0, 1]) expect(call(index).url).toBe(STATE_URL);
  });
});
