import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task 11.1, github-evidence "Commit picker reflects persisted attachments".
// Node hook harness follows existing task-pages tests; no DOM dependency is added.
const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], fetch: vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  return { ...actual,
    useState(initial: unknown) {
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === "function" ? (value as (v: unknown) => unknown)(h.slots[index]) : value; }];
    },
    useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const i = h.cursor++; const previous = h.slots[i] as { deps: readonly unknown[]; value: unknown } | undefined;
      if (!previous || !same(previous.deps, deps)) h.slots[i] = { deps, value: factory() };
      return (h.slots[i] as { value: unknown }).value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const i = h.cursor++; const previous = h.slots[i] as { deps?: readonly unknown[]; cleanup?: () => void } | undefined;
      if (previous && same(previous.deps, deps)) return;
      h.effects.push(() => { previous?.cleanup?.(); h.slots[i] = { deps, cleanup: effect() }; });
    },
  };
});

const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
const attached = [{ sha: shaA, sourceBranch: "feat/original" }];
type Host = { type: string; props: Record<string, unknown> & { children?: ReactNode } };
function hosts(node: unknown): Host[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return [];
  return [...(typeof node.type === "string" ? [node as unknown as Host] : []), ...hosts(node.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function response(body: unknown) { return { ok: true, status: 200, json: async () => body }; }
function mutations() { return h.fetch.mock.calls.filter(([, init]) => init?.method === "PUT" || init?.method === "POST"); }
async function view(initial = attached) {
  const { CommitPicker } = await import("@/components/github-evidence/commit-picker");
  const onSaved = vi.fn();
  let tree: unknown;
  function render() { h.cursor = 0; tree = CommitPicker({ projectId: "synthetic-project", taskId: "synthetic-task", attachedCommits: initial, onSaved }); return tree; }
  async function flush() {
    // Effects settle the two-step default branch fetch and queued promise handlers.
    for (let i = 0; i < 8; i++) { render(); for (const effect of h.effects.splice(0)) effect(); await Promise.resolve(); await Promise.resolve(); }
    render();
  }
  async function click(pattern: RegExp) {
    const button = hosts(render()).find((item) => item.type === "button" && pattern.test(text(item)));
    expect(button, `button ${pattern}`).toBeDefined(); expect(button!.props.disabled).toBeFalsy();
    await (button!.props.onClick as () => unknown)(); await flush();
  }
  function checkbox(sha: string) {
    const label = hosts(render()).find((item) => item.type === "label" && text(item).includes(sha.slice(0, 7)));
    expect(label, `commit ${sha.slice(0, 7)} remains available for selection`).toBeDefined();
    return hosts(label).find((item) => item.type === "input" && item.props.type === "checkbox")!;
  }
  async function check(sha: string, checked: boolean) { (checkbox(sha).props.onChange as (e: unknown) => void)({ target: { checked } }); await flush(); }
  render();
  return { click, check, checkbox, render, flush, onSaved };
}
beforeEach(() => {
  h.cursor = 0; h.slots = []; h.effects = []; h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return response(JSON.parse(String(init.body)));
    if (url.endsWith("/branches")) return response({ defaultBranch: "main", branches: [{ name: "main" }, { name: "feat/original" }, { name: "feat/other" }] });
    const branch = new URL(url, "https://synthetic.example").searchParams.get("branch") || "main";
    return response({ since: "2026-11-09T16:00:00Z", until: "2026-11-10T16:00:00Z", branch, page: 1, perPage: 50, nextPage: null,
      commits: (branch === "feat/other" ? [shaC] : [shaA, shaB]).map((sha) => ({ sha, shortSha: sha.slice(0, 7), message: sha === shaB ? "TASK-42 cue" : "Synthetic commit", authoredAt: "2026-11-10T01:00:00Z", mentionsTaskId: sha === shaB })) });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("staged commit selection", () => {
  it("checks persisted attachments and task cues locally until Save commits", async () => {
    const v = await view(); await v.click(/Add commits|Edit commits/i);
    expect(v.checkbox(shaA).props.checked).toBe(true); expect(v.checkbox(shaB).props.checked).toBe(true);
    expect(mutations()).toEqual([]);
    await v.click(/Save commits/i);
    expect(mutations()).toHaveLength(1);
    const [url, init] = mutations()[0];
    expect(url).toBe("/api/v1/projects/synthetic-project/tasks/synthetic-task/attached-commits");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ attachments: [{ sha: shaA, sourceBranch: "feat/original" }, { sha: shaB, sourceBranch: "main" }] });
    expect(v.onSaved).toHaveBeenCalled();
  });
  it("allows Save commits after deselecting every attachment", async () => {
    const v = await view(); await v.click(/Add commits|Edit commits/i);
    await v.check(shaA, false); await v.check(shaB, false);
    expect(mutations()).toEqual([]); await v.click(/Save commits/i);
    expect(JSON.parse(mutations()[0][1].body)).toEqual({ attachments: [] });
  });
  it("discards staged changes on cancel and restores persisted selection on reopening", async () => {
    const v = await view(); await v.click(/Add commits|Edit commits/i); await v.check(shaA, false);
    await v.click(/^Cancel$/); expect(mutations()).toEqual([]); expect(v.onSaved).not.toHaveBeenCalled();
    await v.click(/Add commits|Edit commits/i); expect(v.checkbox(shaA).props.checked).toBe(true);
  });
  it("keeps attachments outside the current branch removable and records the chosen source branch for additions", async () => {
    const v = await view(); await v.click(/Add commits|Edit commits/i);
    const select = hosts(v.render()).find((item) => item.type === "select")!;
    (select.props.onChange as (e: unknown) => void)({ target: { value: "feat/other" } }); await v.flush();
    expect(v.checkbox(shaA).props.checked).toBe(true);
    await v.check(shaA, false); await v.check(shaC, true); await v.click(/Save commits/i);
    const saved = JSON.parse(mutations()[0][1].body).attachments;
    expect(saved).not.toContainEqual(expect.objectContaining({ sha: shaA }));
    expect(saved).toContainEqual({ sha: shaC, sourceBranch: "feat/other" });
  });
});


it("checks a persisted SHA regardless of casing and saves its original provenance once", async () => {
  const v = await view([{ sha: shaA.toUpperCase(), sourceBranch: "feat/original" }]);
  await v.click(/Add commits|Edit commits/i);
  // Provider listings use lower case while a legacy persisted row can use upper case.
  const persisted = v.checkbox(shaA.toUpperCase());
  expect(persisted.props.checked).toBe(true);
  expect(v.checkbox(shaA).props.checked).toBe(true);
  await v.check(shaA, false);
  expect(v.checkbox(shaA.toUpperCase()).props.checked).toBe(false);
  await v.check(shaA, true);
  expect(v.checkbox(shaA.toUpperCase()).props.checked).toBe(true);
  await v.click(/Save commits/i);
  const saved = JSON.parse(mutations()[0][1].body).attachments as { sha: string; sourceBranch: string | null }[];
  expect(saved.filter(({ sha }) => sha.toLowerCase() === shaA)).toEqual([{ sha: shaA.toUpperCase(), sourceBranch: "feat/original" }]);
});
