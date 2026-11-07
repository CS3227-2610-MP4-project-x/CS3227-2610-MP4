import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SubmissionTipLookup } from "@/server/completion-assessment";

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
function harness(options: { shas?: string[]; history?: string[]; repository?: typeof binding | null; snapshot?: "missing" } = {}) {
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
  const lookup = new SubmissionTipLookup({ snapshots, evidence } as unknown as ConstructorParameters<typeof SubmissionTipLookup>[0]);
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
