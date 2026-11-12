import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckHistoryEntry as StoredCheckResult } from "@/components/completion-assessment/check-history";

// Approved completion-assessment requirements: Developer runs an acceptance
// criteria check; Check results are reused; Check history is visible to both
// roles; AI check does not decide task completion. UI-spec: Acceptance Criteria
// Check behavior. No formal requirement IDs are assigned.
// Follow the repository's Node-only client hook harness (home.test.tsx).
// This exercises event handlers and rendered state; browser focus/layout remain
// the frontend reviewer's responsibility. No AI security fixtures are touched.
const boundary = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  slots: [] as unknown[],
  fetch: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      if (!boundary.active) return actual.useState(initial);
      const slot = boundary.cursor++;
      if (!(slot in boundary.slots)) boundary.slots[slot] = typeof initial === "function" ? initial() : initial;
      return [boundary.slots[slot], (next: unknown) => {
        boundary.slots[slot] = typeof next === "function" ? next(boundary.slots[slot]) : next;
      }];
    },
    useRef(initial: unknown) {
      if (!boundary.active) return actual.useRef(initial);
      const slot = boundary.cursor++;
      if (!(slot in boundary.slots)) boundary.slots[slot] = { current: initial };
      return boundary.slots[slot];
    },
  };
});

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const endpoint = `/api/v1/projects/${projectId}/tasks/${taskId}/acceptance-criteria-check`;
const privateDetail = "synthetic-private-provider-detail";
function check(id = "33333333-3333-4333-8333-333333333333", createdAt = "2026-11-07T04:00:00.000Z", anchorSha = "a".repeat(40)): StoredCheckResult {
  return {
    id, anchorSha, createdAt, redacted: false,
    payload: {
      anchorSha,
      criteria: [
        { criterionId: "criterion-state", criterion: "Validate callback state", status: "addressed", evidence: ["+ const state = validateState(req);"] },
        { criterionId: "criterion-error", criterion: "Return a clear invalid-state error", status: "unclear", evidence: ["- return invalid();", "+ return invalidState();"] },
        { criterionId: "criterion-tests", criterion: "Cover invalid-state behavior in tests", status: "not_addressed", evidence: [] },
      ],
      possibleGaps: ["Expired state tokens need coverage."],
      omittedFiles: ["src/domain/large-change.ts", "tests/large-fixture.ts"],
    },
  };
}

// Approved version 2 persisted contract. No guessed provenance is added to legacy fixtures.
function groupedCheck() {
  const legacy = check();
  return { ...legacy, payload: { ...legacy.payload, assessmentVersion: 2 as const, criteria: [{
    ...legacy.payload.criteria[0], evidence: [], modelStatus: "addressed" as const,
    verification: { state: "verified" as const, reasonCodes: [] },
    evidenceFiles: [
      { path: "src/discount.ts", commitSha: "b".repeat(40), excerpts: [
        { hunkId: "h1", lines: [{ reference: "r1", text: "+  return roundToCents(price);" }] },
        { hunkId: "h2", lines: [{ reference: "r2", text: "+  validate(price);" }] },
      ] },
      { path: "tests/discount.test.ts", commitSha: "c".repeat(40), excerpts: [
        { hunkId: "h3", lines: [{ reference: "r3", text: "+  expect(discount(200, 25)).toBe(150);" }] },
      ] },
    ],
  }] } };
}

type ElementProps = { children?: ReactNode; onClick?: () => void | Promise<void>; disabled?: boolean };
function elements(node: ReactNode): Array<{ type: unknown; props: ElementProps }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<ElementProps>(node) ? text(node.props.children) : "";
}
function markup(node: ReactNode) { return renderToStaticMarkup(node); }
function escape(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;"); }
async function history(checkHistory: readonly StoredCheckResult[]) {
  const { CheckHistory } = await import("@/components/completion-assessment/check-history");
  return markup(<CheckHistory checkHistory={checkHistory} />);
}
async function developer(checkHistory: readonly StoredCheckResult[] = []) {
  const { DeveloperCheckPanel } = await import("@/components/completion-assessment/developer-check-panel");
  boundary.active = true;
  let props = { projectId, taskId, checkHistory };
  const render = (nextProps?: Partial<typeof props>) => {
    if (nextProps) props = { ...props, ...nextProps };
    boundary.cursor = 0;
    return DeveloperCheckPanel(props);
  };
  const run = () => {
    const button = elements(render()).find((node) => node.type === "button" && /run check/i.test(text(node.props.children)));
    expect(button, "assigned developer has a Run check action").toBeDefined();
    return button!;
  };
  return { render, run };
}
function success(value: StoredCheckResult, reused = false) {
  return { ok: true, status: 200, json: async () => ({ check: value, reused }) };
}
function deferredResponse() {
  let resolve!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function failure(code: string) {
  return { ok: false, status: 503, json: async () => ({ error: { code, message: privateDetail } }) };
}

beforeEach(() => {
  boundary.active = false;
  boundary.cursor = 0;
  boundary.slots = [];
  boundary.fetch.mockReset();
  vi.stubGlobal("fetch", boundary.fetch);
});
afterEach(() => { boundary.active = false; vi.unstubAllGlobals(); });

describe("shared developer and PM read-only check history", () => {
  it("renders version 2 evidence in separate labeled file/commit groups and excerpts", async () => {
    const value = groupedCheck();
    const html = await history([value]);
    for (const file of value.payload.criteria[0].evidenceFiles) {
      expect(html).toContain(file.path);
      expect(html).toContain(file.commitSha.slice(0, 7));
    }
    const excerpts = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map((match) => match[1]);
    expect(excerpts).toHaveLength(3);
    expect(excerpts.filter((excerpt) => excerpt.includes("roundToCents") && excerpt.includes("expect(discount"))).toEqual([]);
    for (const file of value.payload.criteria[0].evidenceFiles) for (const excerpt of file.excerpts) {
      for (const line of excerpt.lines) expect(html).toContain(escape(line.text));
    }
  });

  it("wraps long unbroken evidence and paths while preserving whitespace", async () => {
    const value = groupedCheck();
    const longLine = "+  " + "x".repeat(800);
    value.payload.criteria[0].evidenceFiles[0].path = "src/" + "p".repeat(400) + ".ts";
    value.payload.criteria[0].evidenceFiles[0].excerpts[0].lines[0].text = longLine;
    const html = await history([value]);
    const pre = [...html.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g)].find((match) => match[2].includes(longLine));
    expect(pre, "long evidence remains visible").toBeDefined();
    expect(pre![1]).toMatch(/whitespace-pre-wrap|white-space:\s*pre-wrap/);
    expect(pre![1]).toMatch(/break-all|overflow-wrap[^\"; ]*|word-break:\s*break-all/);
    expect(html).toMatch(/min-w-0/);
    expect(html).toContain(value.payload.criteria[0].evidenceFiles[0].path);
  });

  it("shows verification downgrades separately from the model status", async () => {
    const value = groupedCheck();
    const downgraded = { ...value, payload: { ...value.payload, criteria: [{
      ...value.payload.criteria[0], status: "unclear" as const,
      verification: { state: "downgraded" as const, reasonCodes: ["unknown_reference" as const] },
    }] } };
    const html = await history([downgraded]);
    expect(html).toMatch(/verification|could not.*verif|unverified/i);
    expect(html).toMatch(/model[\s\S]{0,80}addressed/i);
    expect(html).toMatch(/reference|evidence/i);
    expect(html).not.toContain(privateDetail);
  });
  it("shows an explicit empty state without invoking an API", async () => {
    const html = await history([]);
    expect(html).toMatch(/no (?:acceptance criteria )?checks|no .*results|no .*history|not .*run/i);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("preserves owner-provided newest-first history with anchors and timestamp metadata", async () => {
    const newer = check();
    const older = check("44444444-4444-4444-8444-444444444444", "2026-11-06T04:00:00.000Z", "b".repeat(40));
    const html = await history([newer, older]);
    expect(html).toContain(newer.anchorSha.slice(0, 7));
    expect(html).toContain(older.anchorSha.slice(0, 7));
    expect(html.indexOf(newer.anchorSha.slice(0, 7))).toBeLessThan(html.indexOf(older.anchorSha.slice(0, 7)));
    expect(html).toContain(`dateTime="${newer.createdAt}"`);
    expect(html).toContain(`dateTime="${older.createdAt}"`);
  });

  it("keeps each stored result collapsed with its anchor and timestamp in the visible summary", async () => {
    const values = [check(), check("44444444-4444-4444-8444-444444444444", "2026-11-06T04:00:00.000Z", "b".repeat(40))];
    const html = await history(values);
    for (const value of values) {
      const summary = [...html.matchAll(/<details\b([^>]*)>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/g)]
        .find((match) => match[2].includes(value.anchorSha.slice(0, 7)));
      expect(summary, "each check has its own native disclosure summary").toBeDefined();
      expect(summary![1]).not.toMatch(/\bopen(?:\s|=|$)/);
      expect(summary![2]).toContain(`dateTime="${value.createdAt}"`);
      for (const criterion of value.payload.criteria) expect(summary![2]).not.toContain(criterion.criterion);
    }
  });

  it("places the result body and expandable evidence inside its check disclosure", async () => {
    const value = check();
    const html = await history([value]);
    const disclosure = [...html.matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*)/g)]
      .find((match) => match[1].includes(value.anchorSha.slice(0, 7)));
    expect(disclosure, "native details lets either role reveal the full stored result").toBeDefined();
    for (const criterion of value.payload.criteria) expect(disclosure![2]).toContain(criterion.criterion);
    expect(disclosure![2]).toMatch(/<details\b[^>]*>\s*<summary\b[^>]*>Evidence \(diff excerpt\)<\/summary>/);
    for (const line of value.payload.criteria[0].evidence) expect(disclosure![2]).toContain(escape(line));
  });

  it("uses readable secondary text tokens for small metadata and empty evidence", async () => {
    const html = await history([check()]);
    const labels = ["Check result", "Advisory results · newest checks first", "No relevant changes were found in the assessed commits."];
    for (const label of labels) {
      const element = [...html.matchAll(/<p\b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/p>/g)]
        .find((match) => match[2] === label);
      expect(element, `rendered supporting text: ${label}`).toBeDefined();
      // neutral-400 and brighter satisfy the UI spec's body-text contrast on
      // the approved charcoal surfaces; neutral-500 does not.
      expect(element![1]).toMatch(/\btext-(?:neutral-[1-4]00|white)\b/);
      expect(element![1]).not.toMatch(/\btext-neutral-[5-9]00\b/);
    }
    expect(html).toMatch(/<time\b[^>]*class="[^"]*\btext-(?:neutral-[1-4]00|white)\b/);
  });

  it("renders each criterion with a human-readable addressed, unclear, or not addressed status", async () => {
    const value = check();
    const html = await history([value]);
    for (const criterion of value.payload.criteria) expect(html).toContain(criterion.criterion);
    expect(html).toMatch(/Addressed/i);
    expect(html).toMatch(/Unclear/i);
    expect(html).toMatch(/Not addressed/i);
    expect(html).not.toMatch(/\b\d+\s*%|numeric score|completion score/i);
  });

  it("labels legacy excerpts without inventing file provenance", async () => {
    const html = await history([check()]);
    expect(html).toContain("File provenance unavailable for this historical result.");
    expect(html).not.toContain("src/discount.ts");
  });

  it("provides expandable diff evidence, including removed and added lines", async () => {
    const value = check();
    const html = await history([value]);
    for (const criterion of value.payload.criteria) for (const line of criterion.evidence) expect(html).toContain(escape(line));
    expect(html).toMatch(/<details\b|aria-expanded=/);
    expect(html).toMatch(/<summary\b|aria-controls=/);
  });

  it("shows possible gaps and every budget-omitted eligible file", async () => {
    const value = check();
    const html = await history([value]);
    expect(html).toMatch(/possible gaps/i);
    for (const gap of value.payload.possibleGaps) expect(html).toContain(gap);
    for (const path of value.payload.omittedFiles) expect(html).toContain(path);
    expect(html).toMatch(/omitted|not assessed/i);
  });

  it("omits the redaction note when no redaction occurred", async () => {
    expect(await history([check()])).not.toMatch(/secrets? (?:were |was )?redacted|redacted before assessment/i);
  });

  it("shows a concise redaction note using only the safe payload", async () => {
    const value = check();
    const safe = { ...value, redacted: true, payload: { ...value.payload, criteria: [{ ...value.payload.criteria[0], evidence: ["+ const token = '[REDACTED:github-token]';"] }] } };
    const html = await history([safe]);
    expect(html).toMatch(/secret[\s\S]*redact|redact[\s\S]*assessment/i);
    expect(html).toContain("[REDACTED:github-token]");
    expect(html).not.toContain(privateDetail);
  });

  it("presents checks as advisory and offers PMs no run, edit, or lifecycle action", async () => {
    const html = await history([check()]);
    expect(html).toMatch(/advisory/i);
    expect(html).not.toMatch(/<(?:button|a)\b[^>]*>[\s\S]*?(?:Run check|Edit check|Submit for review|Approve|Request changes)[\s\S]*?<\/(?:button|a)>/i);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("renders stored criterion, evidence, gaps and paths as escaped plain text", async () => {
    const value = check();
    const unsafe = "<script>syntheticContent()</script>";
    const html = await history([{ ...value, payload: { ...value.payload,
      criteria: [{ ...value.payload.criteria[0], criterion: unsafe, evidence: [unsafe] }],
      possibleGaps: [unsafe], omittedFiles: [unsafe],
    } }]);
    expect(html).toContain(escape(unsafe));
    expect(html).not.toContain(unsafe);
  });
});

describe("developer Run check interactions", () => {
  it("accepts the version 2 response and retains file-grouped evidence in history", async () => {
    const value = groupedCheck();
    boundary.fetch.mockResolvedValue(success(value));
    const harness = await developer();
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toContain("src/discount.ts");
    expect(html).toContain("tests/discount.test.ts");
    expect(html).not.toContain('role="alert"');
  });

  it.each(["unknown version", "invalid lines", "invalid diagnostics"])("rejects a malformed version 2 response: %s", async (kind) => {
    const value = groupedCheck();
    const payload: Record<string, unknown> = structuredClone(value.payload);
    if (kind === "unknown version") payload.assessmentVersion = 3;
    if (kind === "invalid lines") payload.criteria = [{ ...value.payload.criteria[0], evidenceFiles: [
      { path: "src/discount.ts", commitSha: "b".repeat(40), excerpts: [{ hunkId: "h1", lines: [null] }] },
    ] }];
    if (kind === "invalid diagnostics") payload.criteria = [{ ...value.payload.criteria[0], verification: {
      state: "downgraded", reasonCodes: ["provider-private-error"],
    } }];
    boundary.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ check: { ...value, payload }, reused: false }) });
    const harness = await developer();
    await harness.run().props.onClick!();
    expect(markup(harness.render())).toContain('role="alert"');
    expect(markup(harness.render())).not.toContain("provider-private-error");
  });
  it.each(["http error", "network error", "invalid result"])("keeps task B's error when task A returns a late %s", async (lateResponse) => {
    const requestA = deferredResponse();
    const requestB = deferredResponse();
    boundary.fetch.mockReturnValueOnce(requestA.promise).mockReturnValueOnce(requestB.promise);
    const harness = await developer();
    const pendingA = harness.run().props.onClick!();
    harness.render({ taskId: "55555555-5555-4555-8555-555555555555", checkHistory: [] });
    const pendingB = harness.run().props.onClick!();
    requestB.resolve(failure("EVIDENCE_UNAVAILABLE"));
    await pendingB;
    const before = markup(harness.render());
    expect(before).toContain('role="alert"');
    expect(before).toMatch(/evidence|repository|configuration/i);
    if (lateResponse === "network error") requestA.reject(new Error(privateDetail));
    else requestA.resolve(lateResponse === "http error" ? failure("FORBIDDEN") : { ok: true, status: 200, json: async () => ({}) });
    await pendingA;
    expect(markup(harness.render())).toBe(before);
  });

  it("keeps task B's reuse notice and history when task A returns a late reused result", async () => {
    const requestA = deferredResponse();
    const requestB = deferredResponse();
    const resultB = check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z", "b".repeat(40));
    boundary.fetch.mockReturnValueOnce(requestA.promise).mockReturnValueOnce(requestB.promise);
    const harness = await developer();
    const pendingA = harness.run().props.onClick!();
    harness.render({ taskId: "55555555-5555-4555-8555-555555555555", checkHistory: [] });
    const pendingB = harness.run().props.onClick!();
    requestB.resolve(success(resultB, true));
    await pendingB;
    const before = markup(harness.render());
    expect(before).toMatch(/existing (?:check|result)|reus/i);
    expect(before).toContain(resultB.anchorSha.slice(0, 7));
    requestA.resolve(success(check(), true));
    await pendingA;
    expect(markup(harness.render())).toBe(before);
  });

  it.each(["success", "reuse", "error"])("ignores an older %s after returning to task A while its new request is pending", async (lateResponse) => {
    const first = deferredResponse();
    const second = deferredResponse();
    boundary.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const harness = await developer();
    const pendingFirst = harness.run().props.onClick!();
    harness.render({ taskId: "55555555-5555-4555-8555-555555555555", checkHistory: [] });
    harness.render({ taskId, checkHistory: [] });
    const pendingSecond = harness.run().props.onClick!();
    const before = markup(harness.render());
    expect(before).toMatch(/Checking|Running the check/);
    first.resolve(lateResponse === "error" ? failure("FORBIDDEN") : success(check(), lateResponse === "reuse"));
    await pendingFirst;
    expect(markup(harness.render())).toBe(before);
    const buttons = elements(harness.render()).filter((node) => node.type === "button");
    expect(buttons.some((node) => node.props.disabled)).toBe(true);
    const current = check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z", "b".repeat(40));
    second.resolve(success(current));
    await pendingSecond;
    const html = markup(harness.render());
    expect(harness.run().props.disabled).not.toBe(true);
    expect(html).toContain(current.anchorSha.slice(0, 7));
    expect(html).not.toContain(check().anchorSha.slice(0, 7));
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/existing (?:check|result)|already checked/i);
  });

  it.each(["task", "project"])("shows only the new task's history when the %s identity changes", async (identity) => {
    const previous = check();
    const next = check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z", "b".repeat(40));
    const harness = await developer([previous]);
    expect(markup(harness.render())).toContain(previous.anchorSha.slice(0, 7));
    // Keep the hook slots intact to exercise reuse of the mounted panel.
    const html = markup(harness.render({
      ...(identity === "task" ? { taskId: "55555555-5555-4555-8555-555555555555" } : { projectId: "66666666-6666-4666-8666-666666666666" }),
      checkHistory: [next],
    }));
    expect(html).toContain(next.anchorSha.slice(0, 7));
    expect(html).not.toContain(previous.anchorSha.slice(0, 7));
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("clears the previous task's history when the next task has no checks", async () => {
    const previous = check();
    const harness = await developer([previous]);
    harness.render();
    const html = markup(harness.render({ taskId: "55555555-5555-4555-8555-555555555555", checkHistory: [] }));
    expect(html).not.toContain(previous.anchorSha.slice(0, 7));
    expect(html).toMatch(/no (?:acceptance criteria )?checks|no .*results|no .*history|not .*run/i);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("shows refreshed history supplied for the same task", async () => {
    const existing = check();
    const newer = check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z", "b".repeat(40));
    const harness = await developer([existing]);
    harness.render();
    const html = markup(harness.render({ checkHistory: [newer, existing] }));
    expect(html).toContain(newer.anchorSha.slice(0, 7));
    expect(html).toContain(existing.anchorSha.slice(0, 7));
    expect(html.indexOf(newer.anchorSha.slice(0, 7))).toBeLessThan(html.indexOf(existing.anchorSha.slice(0, 7)));
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("posts exactly {} to the existing task-scoped endpoint and displays the returned result", async () => {
    const value = check();
    boundary.fetch.mockResolvedValue(success(value));
    const harness = await developer();
    await harness.run().props.onClick!();
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(boundary.fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "Content-Type": "application/json" }), body: "{}" }));
    const html = markup(harness.render());
    expect(html).toContain(value.anchorSha.slice(0, 7));
    expect(html).toContain(value.payload.criteria[0].criterion);
    expect(html).toContain(value.createdAt);
  });

  it("shows the existing result with a reuse notice and one history entry", async () => {
    const value = check();
    boundary.fetch.mockResolvedValue(success(value, true));
    const harness = await developer([value]);
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toMatch(/existing (?:check|result)|already (?:been )?(?:checked|done)|reus/i);
    expect(html.split(`dateTime="${value.createdAt}"`)).toHaveLength(2);
  });

  it("adds a distinct new result while retaining the older result", async () => {
    const older = check("44444444-4444-4444-8444-444444444444", "2026-11-06T04:00:00.000Z", "b".repeat(40));
    const newer = check();
    boundary.fetch.mockResolvedValue(success(newer));
    const harness = await developer([older]);
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toContain(older.anchorSha.slice(0, 7));
    expect(html).toContain(newer.anchorSha.slice(0, 7));
    expect(html.indexOf(newer.anchorSha.slice(0, 7))).toBeLessThan(html.indexOf(older.anchorSha.slice(0, 7)));
  });

  it.each([
    ["missing payload", { payload: undefined }],
    ["null payload", { payload: null }],
    ["invalid criterion status", { payload: { ...check().payload, criteria: [{ ...check().payload.criteria[0], status: "approved" }] } }],
    ["criteria is not an array", { payload: { ...check().payload, criteria: {} } }],
    ["null criterion", { payload: { ...check().payload, criteria: [null] } }],
    ["evidence is not an array", { payload: { ...check().payload, criteria: [{ ...check().payload.criteria[0], evidence: {} }] } }],
    ["non-string evidence", { payload: { ...check().payload, criteria: [{ ...check().payload.criteria[0], evidence: [null] }] } }],
    ["possible gaps is not an array", { payload: { ...check().payload, possibleGaps: {} } }],
    ["non-string possible gap", { payload: { ...check().payload, possibleGaps: [null] } }],
    ["omitted files is not an array", { payload: { ...check().payload, omittedFiles: {} } }],
    ["non-string omitted file", { payload: { ...check().payload, omittedFiles: [null] } }],
  ])("rejects a successful response with %s and preserves existing history", async (_scenario, invalidFields) => {
    const existing = check();
    // Each nested-payload fixture uses check()'s anchor. Keep the top-level
    // anchor identical so an unrelated anchor mismatch cannot mask its defect.
    const invalid = { ...check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z"), ...invalidFields };
    boundary.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ check: invalid, reused: false }) });
    const harness = await developer([existing]);
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/invalid result|could not|try again/i);
    expect(html).toContain(existing.anchorSha.slice(0, 7));
    expect(html.split(`dateTime="${existing.createdAt}"`)).toHaveLength(2);
    expect(html).not.toContain(invalid.createdAt);
    expect(harness.run().props.disabled).not.toBe(true);
  });

  it.each([
    ["addressed array", ["addressed"]],
    ["unclear array", ["unclear"]],
    ["not-addressed array", ["not_addressed"]],
    ["empty array", []],
    ["object", {}],
  ])("rejects a successful response with a %s status without changing history", async (_scenario, status) => {
    const existing = check();
    const returned = check("44444444-4444-4444-8444-444444444444", "2026-11-08T04:00:00.000Z", "b".repeat(40));
    // Keep both anchor fields consistent so only the status value is malformed.
    const invalid = { ...returned, payload: { ...returned.payload,
      criteria: [{ ...returned.payload.criteria[0], status }],
    } };
    boundary.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ check: invalid, reused: false }) });
    const harness = await developer([existing]);
    const before = markup(harness.render());
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/invalid result|could not|try again/i);
    expect(html).not.toContain(privateDetail);
    expect(html).toContain(existing.anchorSha.slice(0, 7));
    expect(html.split(`dateTime="${existing.createdAt}"`)).toHaveLength(2);
    expect(html).not.toContain(returned.anchorSha.slice(0, 7));
    // Compare the rendered history independently of the newly displayed error.
    expect(html.match(/<details\b[\s\S]*<\/details>/)?.[0]).toBe(before.match(/<details\b[\s\S]*<\/details>/)?.[0]);
    expect(harness.run().props.disabled).not.toBe(true);
  });

  it("disables Run check and announces loading until the request finishes", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    boundary.fetch.mockReturnValue(new Promise<ReturnType<typeof success>>((done) => { resolve = done; }));
    const harness = await developer();
    const pending = harness.run().props.onClick!();
    const tree = harness.render();
    const buttons = elements(tree).filter((node) => node.type === "button");
    expect(buttons.some((node) => node.props.disabled)).toBe(true);
    expect(markup(tree)).toMatch(/checking|running|loading/i);
    resolve(success(check()));
    await pending;
    expect(harness.run().props.disabled).not.toBe(true);
  });

  it.each([
    [409, "CHECK_REQUIRES_COMMITS", /attach.*commits|commits.*first/i],
    [409, "INCOMPARABLE_COMMIT_TIPS", /common descendant|one.*tip|single.*tip/i],
    [503, "EVIDENCE_UNAVAILABLE", /evidence|repository|configuration|try again|retry/i],
    [429, "RATE_LIMITED", /limit|try again|retry/i],
    [429, "QUOTA_EXCEEDED", /quota|limit|try again|retry/i],
    [503, "AI_UNAVAILABLE", /unavailable|try again|retry/i],
    [502, "AI_ERROR", /failed|could not|try again|retry/i],
    [502, "INVALID_OUTPUT", /invalid|could not|try again|retry/i],
    [403, "FORBIDDEN", /permission|allowed|access|try again|retry/i],
  ])("shows a safe actionable error for HTTP %s %s", async (status, code, message) => {
    boundary.fetch.mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: privateDetail } }) });
    const existing = check();
    const harness = await developer([existing]);
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toMatch(/role="alert"|role="status"/);
    expect(html).toMatch(message);
    expect(html).not.toContain(privateDetail);
    expect(html).toContain(existing.anchorSha.slice(0, 7));
    expect(harness.run().props.disabled).not.toBe(true);
  });

  it.each(["network", "non-json"])("recovers safely from a %s failure", async (failure) => {
    if (failure === "network") boundary.fetch.mockRejectedValue(new Error(privateDetail));
    else boundary.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error(privateDetail); } });
    const harness = await developer();
    await harness.run().props.onClick!();
    const html = markup(harness.render());
    expect(html).toMatch(/role="alert"|role="status"/);
    expect(html).toMatch(/try again|retry|could not|failed/i);
    expect(html).not.toContain(privateDetail);
    expect(harness.run().props.disabled).not.toBe(true);
  });
});
