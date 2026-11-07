import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeAdapter, LlmGateway, type UsagePort } from "@/server/ai";
import { CompletionAssessmentService, SubmissionTipLookup } from "@/server/completion-assessment";

// OpenSpec task 4.3 (tasks-lifecycle-4-3), written in Developer A's module with Developer A's
// agreement (design.md L5; handoff Q3). completion-assessment "Submission can look up the
// committed tip" and "AI check does not decide task completion"; task-management "Submission
// records attached commits and a matching check" ("Evidence is unavailable at submission").
// These are feature contracts, not Developer A's reserved AI-security evaluation cases.
//
// Seam assumed by this file (reported in the 4.3 handoff for the implementer to match):
//   SubmissionTipLookup, exported from `@/server/completion-assessment`, constructed with
//   { snapshots: { getSubmissionSnapshot(projectId, taskId) }, evidence: { loadPathRules(repository),
//   isAncestor(repository, ancestorSha, descendantSha) } } and no AI gateway or result repository.
//   getSubmissionSnapshot resolves { attachedCommitShas, criteria: [{ id, description, position }],
//   repository } (repository null when no GitHub repository is linked), or null for no task.
//   findSubmissionTip(projectId, taskId) resolves null (no tip) or
//   { anchorSha, commitShas, criteria, criteriaHash }: the unique tip, the attached commit set it
//   was resolved from (sorted, distinct), the criteria ordered by position then ID, and their
//   hash, computed exactly as stored check results' `criteria_hash` (the canonical hash tested in
//   service.test.ts). It never rejects: anything that fails gives null.
// The lifecycle uses commitShas and criteria to recheck its inputs inside the submission
// transaction (task-management "Submission rechecks its inputs before it is stored").
// All values are synthetic.

const projectId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40), shaD = "d".repeat(40);
const binding = { id: 100, installationId: 200, owner: "synthetic", name: "repository" };
const rules = { version: 1, domainLogic: ["core/"], apiHandlers: ["api/"], tests: ["tests/"], ui: ["ui/"],
  lockfileNames: ["package-lock.json"], generatedPathPrefixes: ["generated/"] };
const criteria = [
  { id: "criterion-b", description: "Return data", position: 2 },
  { id: "criterion-z", description: "Unicode café", position: 1 },
  { id: "criterion-a", description: "Validate input", position: 1 },
];
const orderedCriteria = [criteria[2], criteria[1], criteria[0]];

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
const criteriaHash = hash(JSON.stringify(orderedCriteria.map(({ id, description }) => ({ id, description }))));

/** Ancestry as a set of "ancestor>descendant" pairs; a commit is not its own strict ancestor here. */
function harness(options: { shas?: string[]; history?: string[]; repository?: typeof binding | null; snapshot?: "missing"; timeoutMs?: number } = {}) {
  const edges = new Set(options.history ?? [`${shaA}>${shaB}`, `${shaA}>${shaC}`, `${shaB}>${shaC}`]);
  const snapshot = {
    attachedCommitShas: options.shas ?? [shaB, shaC, shaA],
    criteria: structuredClone(criteria),
    repository: options.repository === undefined ? binding : options.repository,
  };
  const snapshots = { getSubmissionSnapshot: vi.fn(async () => options.snapshot === "missing" ? null : structuredClone(snapshot)) };
  const evidence = {
    loadPathRules: vi.fn(async () => JSON.stringify(rules)),
    isAncestor: vi.fn(async (_repository: unknown, ancestor: string, descendant: string) =>
      ancestor === descendant || edges.has(`${ancestor}>${descendant}`)),
    fetchDiff: vi.fn(async () => ""),
  };
  const lookupOptions = options.timeoutMs === undefined ? { snapshots, evidence } : { snapshots, evidence, timeoutMs: options.timeoutMs };
  const lookup = new SubmissionTipLookup(lookupOptions as unknown as ConstructorParameters<typeof SubmissionTipLookup>[0]);
  return { lookup, snapshots, evidence };
}

describe("SubmissionTipLookup (Submission can look up the committed tip)", () => {
  it("returns the commit that descends from every other attached commit, with the inputs it was resolved from (Unique tip found)", async () => {
    const h = harness();
    const tip = await h.lookup.findSubmissionTip(projectId, taskId);
    expect(tip).not.toBeNull();
    expect(tip!.anchorSha).toBe(shaC);
    expect([...tip!.commitShas].sort()).toEqual([shaA, shaB, shaC]);
    expect(tip!.criteria.map(({ id, description, position }) => ({ id, description, position }))).toEqual(orderedCriteria);
    expect(tip!.criteriaHash).toBe(criteriaHash);
    expect(h.snapshots.getSubmissionSnapshot).toHaveBeenCalledExactlyOnceWith(projectId, taskId);
    expect(h.evidence.loadPathRules).toHaveBeenCalledWith(binding);
  });

  it("finds the tip whatever order the commits were attached in", async () => {
    for (const shas of [[shaA, shaB, shaC], [shaC, shaA, shaB], [shaB, shaA, shaC]]) {
      expect((await harness({ shas }).lookup.findSubmissionTip(projectId, taskId))?.anchorSha).toBe(shaC);
    }
  });

  it("returns a single attached commit as its own tip without ancestry queries", async () => {
    const h = harness({ shas: [shaD], history: [] });
    expect((await h.lookup.findSubmissionTip(projectId, taskId))?.anchorSha).toBe(shaD);
    expect(h.evidence.isAncestor).not.toHaveBeenCalled();
  });

  it("returns no tip when the attached commits have no unique tip (two branches)", async () => {
    const h = harness({ shas: [shaA, shaB, shaC], history: [`${shaA}>${shaB}`, `${shaA}>${shaC}`] });
    expect(await h.lookup.findSubmissionTip(projectId, taskId)).toBeNull();
  });

  it("returns no tip, without calling GitHub, when no commits are attached", async () => {
    const h = harness({ shas: [] });
    expect(await h.lookup.findSubmissionTip(projectId, taskId)).toBeNull();
    expect(h.evidence.isAncestor).not.toHaveBeenCalled();
  });

  it("returns no tip, without calling GitHub, when the project has no linked repository", async () => {
    const h = harness({ repository: null });
    expect(await h.lookup.findSubmissionTip(projectId, taskId)).toBeNull();
    expect(h.evidence.loadPathRules).not.toHaveBeenCalled();
    expect(h.evidence.isAncestor).not.toHaveBeenCalled();
  });

  it("returns no tip when the task cannot be read", async () => {
    const h = harness({ snapshot: "missing" });
    expect(await h.lookup.findSubmissionTip(projectId, taskId)).toBeNull();
  });

  it.each([
    ["the repository path rules cannot be loaded", (h: ReturnType<typeof harness>) => h.evidence.loadPathRules.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"))],
    ["the path rules are not valid JSON", (h: ReturnType<typeof harness>) => h.evidence.loadPathRules.mockResolvedValue("not JSON")],
    ["an ancestry query fails", (h: ReturnType<typeof harness>) => h.evidence.isAncestor.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"))],
    ["the task read fails", (h: ReturnType<typeof harness>) => h.snapshots.getSubmissionSnapshot.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_DATABASE_DETAIL"))],
  ])("returns no tip, without rejecting, when %s (No tip or unavailable evidence)", async (_case, breakIt) => {
    const h = harness();
    breakIt(h);
    await expect(h.lookup.findSubmissionTip(projectId, taskId)).resolves.toBeNull();
  });

  it("returns no tip when the path rules are unavailable, even for a single attached commit", async () => {
    const h = harness({ shas: [shaD], history: [] });
    h.evidence.loadPathRules.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"));
    expect(await h.lookup.findSubmissionTip(projectId, taskId)).toBeNull();
  });

  it("only reads: it fetches no diff, so no check can be started (AI check does not decide task completion)", async () => {
    const h = harness();
    await h.lookup.findSubmissionTip(projectId, taskId);
    expect(h.evidence.fetchDiff).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fix round 1, F5: the lookup and the check service must agree on the stored key
// ---------------------------------------------------------------------------

// A check reference is stored only when the lookup's criteriaHash equals the criteria_hash the
// check service stored, and its anchorSha equals the stored result's anchorSha. The lookup keeps
// its own copy of the hash and tip selection (service.ts is outside task 4.3's write scope), so
// this test runs the real CompletionAssessmentService through the module's public entry and
// compares the key it hands to its result repository with what the lookup returns. The hash is
// never recomputed here.
describe("SubmissionTipLookup agrees with the stored check key (F5)", () => {
  const personId = "00000000-0000-4000-8000-000000000003";
  const identity = { authUserId: "00000000-0000-4000-8000-000000000004", githubUserId: "123" };
  const diff = "diff --git a/core/validate.ts b/core/validate.ts\n--- a/core/validate.ts\n+++ b/core/validate.ts\n@@ -1 +1 @@\n-old\n+validate(input);\n";

  type Criterion = { id: string; description: string; position: number };

  async function storedKeyAndTip(input: { criteria: Criterion[]; shas: string[]; history: string[]; tip: string }) {
    const edges = new Set(input.history);
    const ports = {
      snapshots: {
        getAssignedSnapshot: vi.fn(async () => ({
          projectId, taskId, personId, role: "developer", assigneeId: personId,
          criteria: structuredClone(input.criteria), attachedCommitShas: [...input.shas], repository: binding,
        })),
        getSubmissionSnapshot: vi.fn(async () => ({
          attachedCommitShas: [...input.shas], criteria: structuredClone(input.criteria), repository: binding,
        })),
      },
      evidence: {
        loadPathRules: vi.fn(async () => JSON.stringify(rules)),
        isAncestor: vi.fn(async (_repository: unknown, ancestor: string, descendant: string) =>
          ancestor === descendant || edges.has(`${ancestor}>${descendant}`)),
        fetchDiff: vi.fn(async (_repository: unknown, sha: string) => sha === input.tip ? diff : ""),
      },
    };
    // The synthetic model answer the check service validates: every criterion, in a fixed order.
    const ordered = [...input.criteria].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const answer = { anchorSha: input.tip, criteria: ordered.map((criterion) => ({
      criterionId: criterion.id, criterion: criterion.description, status: "unclear", evidence: [],
    })), possibleGaps: [], omittedFiles: [] };
    const usage: UsagePort = {
      reserve: vi.fn(async () => ({ ok: true as const, usageRecordId: "synthetic-usage" })),
      settle: vi.fn(async () => {}), recordCacheHit: vi.fn(async () => {}),
    };
    const gateway = new LlmGateway({
      adapter: new FakeAdapter([{ ok: true, text: JSON.stringify(answer), usage: { inputTokens: 10, outputTokens: 10 } }]),
      usage, environment: "development", limits: { requestsPerMinute: 100, dailyTokenQuota: 10_000_000 },
    });
    const saved: { criteriaHash: string; payload: { anchorSha: string } }[] = [];
    const repository = {
      findReusable: vi.fn(async () => null),
      save: vi.fn(async (record: { criteriaHash: string; payload: { anchorSha: string }; redacted: boolean }) => {
        saved.push(structuredClone(record));
        return { check: { id: "00000000-0000-4000-8000-000000000099", anchorSha: record.payload.anchorSha,
          createdAt: "2026-11-07T00:00:00.000Z", redacted: record.redacted, payload: record.payload }, created: true };
      }),
    };
    const service = new CompletionAssessmentService(
      { ...ports, repository, gateway } as unknown as ConstructorParameters<typeof CompletionAssessmentService>[0],
    );
    await service.runCheck(projectId, taskId, identity);
    const lookup = new SubmissionTipLookup(ports as unknown as ConstructorParameters<typeof SubmissionTipLookup>[0]);
    const tip = await lookup.findSubmissionTip(projectId, taskId);
    expect(saved).toHaveLength(1);
    return { stored: saved[0], tip };
  }

  it.each([
    ["criteria with tied positions, given out of order", criteria],
    ["a single criterion", [{ id: "00000000-0000-4000-8000-0000000000c1", description: "Only criterion", position: 1 }]],
    ["UUID criteria with quotes, newlines and non-ASCII text", [
      { id: "00000000-0000-4000-8000-0000000000c3", description: "Third \"quoted\"\nline", position: 3 },
      { id: "00000000-0000-4000-8000-0000000000c2", description: "Zweite Prüfung, ✓", position: 2 },
      { id: "00000000-0000-4000-8000-0000000000c1", description: "First", position: 1 },
    ]],
  ])("returns the criteria hash and anchor the check service stores, for %s", async (_case, items) => {
    const { stored, tip } = await storedKeyAndTip({
      criteria: items, shas: [shaB, shaC, shaA], history: [`${shaA}>${shaB}`, `${shaA}>${shaC}`, `${shaB}>${shaC}`], tip: shaC,
    });
    expect(tip).not.toBeNull();
    expect(tip!.criteriaHash).toBe(stored.criteriaHash);
    expect(tip!.anchorSha).toBe(stored.payload.anchorSha);
  });

  it("selects the same tip as the check service for a single attached commit", async () => {
    const { stored, tip } = await storedKeyAndTip({ criteria, shas: [shaD], history: [], tip: shaD });
    expect(tip?.anchorSha).toBe(stored.payload.anchorSha);
    expect(tip?.criteriaHash).toBe(stored.criteriaHash);
  });
});

// ---------------------------------------------------------------------------
// Fix round 1, F8: the lookup has an overall time budget
// ---------------------------------------------------------------------------

// The lookup runs before the submission's version check and may make about 2N sequential GitHub
// calls, so it resolves null once a total time budget expires. Seam: the constructor's options
// gain an optional `timeoutMs` (the default is the implementer's choice; this file only requires
// it to be finite and at most five minutes). The budget must use timers that Vitest's fake timers
// control (setTimeout), so these tests advance time instead of waiting.
describe("SubmissionTipLookup time budget (F8)", () => {
  const never = () => new Promise<never>(() => undefined);

  async function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(milliseconds);
    return settled;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["an ancestry query never answers", (h: ReturnType<typeof harness>) => h.evidence.isAncestor.mockImplementation(never)],
    ["the path rules never load", (h: ReturnType<typeof harness>) => h.evidence.loadPathRules.mockImplementation(never)],
  ])("resolves null within the configured budget when %s", async (_case, hang) => {
    const h = harness({ timeoutMs: 1_000 });
    hang(h);
    const pending = h.lookup.findSubmissionTip(projectId, taskId);
    expect(await settlesWithin(pending, 1_000)).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it("does not give up before the budget: slow answers inside it still find the tip", async () => {
    const h = harness({ timeoutMs: 10_000 });
    const edges = new Set([`${shaA}>${shaB}`, `${shaA}>${shaC}`, `${shaB}>${shaC}`]);
    h.evidence.isAncestor.mockImplementation((_repository: unknown, ancestor: string, descendant: string) =>
      new Promise<boolean>((resolve) => setTimeout(() => resolve(ancestor === descendant || edges.has(`${ancestor}>${descendant}`)), 200)));
    const pending = h.lookup.findSubmissionTip(projectId, taskId);
    expect(await settlesWithin(pending, 9_000)).toBe(true);
    expect((await pending)?.anchorSha).toBe(shaC);
  });

  it("has a finite default budget when none is configured", async () => {
    const h = harness();
    h.evidence.isAncestor.mockImplementation(never);
    const pending = h.lookup.findSubmissionTip(projectId, taskId);
    expect(await settlesWithin(pending, 300_000)).toBe(true);
    await expect(pending).resolves.toBeNull();
  });
});
