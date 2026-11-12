import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { FakeAdapter, LlmGateway, type FakeOutcome, type LlmRequest, type UsagePort } from "@/server/ai";
import { GitHubEvidenceRepository, GitHubEvidenceService, githubEvidenceErrorResponse } from "@/server/github-evidence";
import type { GitHubEvidenceAdapter } from "@/server/github";
import { CompletionAssessmentService, type NewCheckResultPayload as CheckResultPayload } from "@/server/completion-assessment/service";

// Approved completion-assessment requirements, version 2: evidence occurrences,
// bounded input/retries, cache reuse and task-state containment. Synthetic feature
// contracts only; Developer A's AI security/evaluation fixtures are untouched.
const projectId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const personId = "00000000-0000-4000-8000-000000000003";
const identity = { authUserId: "00000000-0000-4000-8000-000000000004", githubUserId: "123" };
const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
const binding = { id: 100, installationId: 200, owner: "synthetic", name: "repository" };
const rules = { version: 1, domainLogic: ["core/"], apiHandlers: ["api/"], tests: ["tests/"], ui: ["ui/"],
  lockfileNames: ["package-lock.json"], generatedPathPrefixes: ["generated/"] };
const criteria = [
  { id: "criterion-b", description: "Return data", position: 2 },
  { id: "criterion-a", description: "Validate input", position: 1 },
];
function file(path: string, change: string) {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${change}\n`;
}
const diff = file("core/validate.ts", "validate(input);");
function hash(text: string) { return createHash("sha256").update(text, "utf8").digest("hex"); }
function versionedRules(value = rules) { return hash(JSON.stringify({ assessmentVersion: 2, evidenceReferenceVersion: 2, pathRulesHash: hash(JSON.stringify(value)) })); }
function references(request: LlmRequest, text = "+validate(input);") {
  return request.messages.flatMap((message) => [...message.content.matchAll(/^(L\d+) \| ([^\n]*)/gm)])
    .filter((match) => match[2] === text).map((match) => match[1]);
}
function modelOutput(refs: string[] = []) {
  return { criteria: [
    { criterionId: "criterion-a", status: "addressed", evidenceRefs: refs },
    { criterionId: "criterion-b", status: "unclear", evidenceRefs: [] as string[] },
  ], possibleGaps: ["Additional test coverage may help"] };
}
function success(value: unknown): FakeOutcome { return { ok: true, text: JSON.stringify(value), usage: { inputTokens: 100, outputTokens: 50 } }; }
type Step = (request: LlmRequest) => FakeOutcome;
const valid: Step = (request) => success(modelOutput(references(request)));
function harness(steps: readonly Step[] = [valid]) {
  const snapshot = { projectId, taskId, personId, role: "developer", assigneeId: personId,
    criteria: structuredClone(criteria), attachedCommitShas: [shaB, shaA], repository: binding };
  const snapshots = { getAssignedSnapshot: vi.fn(async () => structuredClone(snapshot)) };
  const evidence = {
    loadPathRules: vi.fn(async () => JSON.stringify(rules)),
    isAncestor: vi.fn(async (_repository: unknown, ancestor: string, descendant: string) => ancestor === descendant || ancestor < descendant),
    fetchDiff: vi.fn(async (_repository: unknown, sha: string) => sha === shaA ? diff : ""),
  };
  type SaveInput = { taskId: string; commitSetHash: string; criteriaHash: string; pathRulesHash: string;
    payload: CheckResultPayload; model: string; redacted: boolean };
  const writes: SaveInput[] = [];
  const repository = {
    findReusable: vi.fn(async (_key: { taskId: string; commitSetHash: string; criteriaHash: string; pathRulesHash: string }) => null as null | ReturnType<typeof check>),
    save: vi.fn(async (input: SaveInput) => { writes.push(structuredClone(input)); return { check: check(input.payload, input.redacted), created: true }; }),
  };
  const usage: UsagePort = {
    reserve: vi.fn(async () => ({ ok: true as const, usageRecordId: "synthetic-usage" })),
    settle: vi.fn(async () => {}), recordCacheHit: vi.fn(async () => {}),
  };
  let call = 0;
  const complete = vi.fn(async (request: LlmRequest) => {
    const step = steps[call++];
    if (!step) throw new Error("Unexpected third provider call");
    return new FakeAdapter([step(request)]).complete(request);
  });
  const gateway = new LlmGateway({ adapter: { complete, getCapabilities: () => new FakeAdapter([]).getCapabilities() }, usage,
    environment: "development", limits: { requestsPerMinute: 100, dailyTokenQuota: 10_000_000 } });
  const service = new CompletionAssessmentService({ snapshots, evidence, repository, gateway });
  return { service, snapshot, snapshots, evidence, repository, usage, complete, writes };
}
function check(value?: CheckResultPayload, redacted = false) {
  const payload = value ?? { assessmentVersion: 2 as const, anchorSha: shaB, criteria: [], possibleGaps: [], omittedFiles: [] };
  return { id: "00000000-0000-4000-8000-000000000099", anchorSha: payload.anchorSha,
    createdAt: "2026-11-07T00:00:00.000Z", redacted, payload };
}
function run(h: ReturnType<typeof harness>) { return h.service.runCheck(projectId, taskId, identity); }
function noGeneratedResult(h: ReturnType<typeof harness>) { expect(h.complete).not.toHaveBeenCalled(); expect(h.repository.save).not.toHaveBeenCalled(); }
function excerpts(value: CheckResultPayload) { return value.criteria[0].evidenceFiles?.flatMap((f) => f.excerpts.flatMap((e) => e.lines)) ?? []; }

describe("version 2 check orchestration and reuse", () => {
  it("persists server-built evidence, canonical criteria and diagnostic statuses without duplicate code", async () => {
    const h = harness(); const result = await run(h);
    expect(result.reused).toBe(false);
    expect(h.snapshots.getAssignedSnapshot).toHaveBeenCalledExactlyOnceWith(projectId, taskId, identity);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].payload).toMatchObject({ assessmentVersion: 2, anchorSha: shaB, criteria: [
      { criterionId: "criterion-a", criterion: "Validate input", status: "addressed", evidence: [],
        modelStatus: "addressed", verification: { state: "verified", reasonCodes: [] },
        evidenceFiles: [{ path: "core/validate.ts", commitSha: shaA }] },
      { criterionId: "criterion-b", criterion: "Return data", status: "unclear", evidence: [], evidenceFiles: [] },
    ] });
    expect(excerpts(h.writes[0].payload).map((line) => line.text)).toEqual(["+validate(input);"]);
    expect(h.complete.mock.calls[0][0].maxOutputTokens).toBe(2000);
    expect(h.snapshot.attachedCommitShas).toEqual([shaB, shaA]);
  });
  it("preserves commit and criteria hashes while salting only the path-rules cache dimension", async () => {
    const h = harness(); await run(h);
    expect(h.writes[0]).toMatchObject({ commitSetHash: hash(`${shaA}\n${shaB}`),
      criteriaHash: hash(JSON.stringify([{ id: "criterion-a", description: "Validate input" }, { id: "criterion-b", description: "Return data" }])),
      pathRulesHash: versionedRules() });
  });
  it("reuses an exact versioned cache key without inference or duplicate history", async () => {
    const h = harness(); h.repository.findReusable.mockResolvedValue(check());
    expect((await run(h)).reused).toBe(true); noGeneratedResult(h);
    expect(h.repository.findReusable.mock.calls[0][0].pathRulesHash).toBe(versionedRules());
    expect(h.usage.recordCacheHit).toHaveBeenCalledOnce();
  });
  it.each([
    ["unversioned", hash(JSON.stringify(rules))],
    ["previous evidence-reference version", hash(JSON.stringify({ assessmentVersion: 2, pathRulesHash: hash(JSON.stringify(rules)) }))],
  ])("does not reuse the %s path-rules fingerprint", async (_label, oldFingerprint) => {
    const h = harness();
    h.repository.findReusable.mockImplementation(async (key) => key.pathRulesHash === oldFingerprint ? check() : null);
    expect((await run(h)).reused).toBe(false); expect(h.writes).toHaveLength(1);
    expect(h.writes[0].payload.assessmentVersion).toBe(2);
  });
  it("normalizes rules before applying the version fingerprint", async () => {
    const h = harness(); h.evidence.loadPathRules.mockResolvedValue(JSON.stringify({ ...rules, domainLogic: ["z/", "core/", "z/"] }));
    await run(h); expect(h.writes[0].pathRulesHash).toBe(versionedRules({ ...rules, domainLogic: ["core/", "z/"] }));
  });
  it("uses one captured snapshot even if mutable inputs change during evidence reads", async () => {
    const h = harness(); h.evidence.loadPathRules.mockImplementation(async () => { h.snapshot.criteria[0].description = "Changed"; h.snapshot.attachedCommitShas.push(shaC); return JSON.stringify(rules); });
    await run(h); expect(h.snapshots.getAssignedSnapshot).toHaveBeenCalledOnce();
    expect(h.writes[0].commitSetHash).toBe(hash(`${shaA}\n${shaB}`));
    expect(h.writes[0].payload.criteria[1].criterion).toBe("Return data");
  });
  it("accepts one commit without ancestry queries", async () => {
    const h = harness([(request) => success(modelOutput(references(request)))]); h.snapshot.attachedCommitShas = [shaA];
    await run(h); expect(h.evidence.isAncestor).not.toHaveBeenCalled(); expect(h.writes[0].payload.anchorSha).toBe(shaA);
  });
  it("returns a competing persisted result without adding duplicate history", async () => {
    const h = harness(); h.repository.save.mockResolvedValue({ check: check(), created: false });
    expect(await run(h)).toEqual({ check: check(), reused: true });
  });
  it.each(["loadPathRules", "isAncestor", "fetchDiff"] as const)("contains evidence failure at %s", async (method) => {
    const h = harness(); h.evidence[method].mockRejectedValue(new Error("PRIVATE_PROVIDER_DETAIL"));
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503, message: expect.not.stringContaining("PRIVATE_PROVIDER_DETAIL") }); noGeneratedResult(h);
  });
  it.each(["not JSON", "{}", JSON.stringify({ ...rules, version: 2 })])("refuses invalid rules %s", async (config) => {
    const h = harness(); h.evidence.loadPathRules.mockResolvedValue(config);
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503 }); noGeneratedResult(h);
  });
  it("refuses malformed diffs", async () => { const h = harness(); h.evidence.fetchDiff.mockResolvedValue("not a Git diff"); await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" }); noGeneratedResult(h); });
  it("refuses missing repository", async () => { const h = harness(); h.snapshots.getAssignedSnapshot.mockResolvedValue({ ...h.snapshot, repository: null } as unknown as typeof h.snapshot); await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" }); noGeneratedResult(h); });
  it("refuses empty attached commits", async () => { const h = harness(); h.snapshot.attachedCommitShas = []; await expect(run(h)).rejects.toMatchObject({ code: "CHECK_REQUIRES_COMMITS", status: 409 }); noGeneratedResult(h); });
  it("refuses incomparable tips", async () => { const h = harness(); h.evidence.isAncestor.mockResolvedValue(false); await expect(run(h)).rejects.toMatchObject({ code: "INCOMPARABLE_COMMIT_TIPS", status: 409 }); noGeneratedResult(h); });
  it("authorizes before fetching evidence", async () => { const h = harness(); h.snapshots.getAssignedSnapshot.mockRejectedValue(Object.assign(new Error("Forbidden"), { code: "FORBIDDEN", status: 403 })); await expect(run(h)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 }); expect(h.evidence.loadPathRules).not.toHaveBeenCalled(); noGeneratedResult(h); });
});

describe("occurrence evidence and bounded correction", () => {
  it("accepts exact former wrappers for known IDs and stores canonical references", async () => {
    const h = harness([(request) => success(modelOutput(references(request).map((reference) => `[[${reference}]]`)))]);
    await run(h);
    expect(h.complete).toHaveBeenCalledOnce();
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "addressed", verification: { state: "verified", reasonCodes: [] } });
    expect(excerpts(h.writes[0].payload)).toEqual([{ reference: "L2", text: "+validate(input);" }]);
  });
  it.each([
    ["unknown ID", () => "[[L999999]]"],
    ["partial wrapper", (reference: string) => `[[${reference}]`],
    ["repeated wrapper", (reference: string) => `[[[[${reference}]]]]`],
    ["leading whitespace", (reference: string) => ` [[${reference}]]`],
    ["trailing whitespace", (reference: string) => `[[${reference}]] `],
    ["trailing newline", (reference: string) => `[[${reference}]]\n`],
  ] as const)("keeps a former wrapper with %s unresolved", async (_label, alterReference) => {
    const invalid: Step = (request) => success(modelOutput(references(request).map(alterReference)));
    const h = harness([invalid, invalid]);
    await run(h);
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "unclear", modelStatus: "addressed",
      verification: { state: "downgraded", reasonCodes: ["unknown_reference", "missing_evidence"] }, evidenceFiles: [] });
  });
  it.each(["files", "commits", "same hunk", "other hunk"])("accepts repeated identical lines across %s", async (location) => {
    const h = harness(); h.evidence.fetchDiff.mockImplementation(async (_repository, sha) => {
      if (location === "commits") return diff;
      if (sha !== shaA) return "";
      if (location === "files") return diff + file("tests/validate.test.ts", "validate(input);");
      if (location === "other hunk") return diff + "@@ -10 +10 @@\n+validate(input);\n";
      return diff.replace("+validate(input);", "+validate(input);\n+validate(input);");
    });
    await run(h); const payload = h.writes[0].payload;
    expect(payload.criteria[0].status).toBe("addressed");
    expect(payload.criteria[0].verification).toEqual({ state: "verified", reasonCodes: [] });
    expect(excerpts(payload)).toHaveLength(2); expect(new Set(excerpts(payload).map((l) => l.reference)).size).toBe(2);
    expect(h.complete).toHaveBeenCalledOnce();
    if (location === "files" || location === "commits") expect(payload.criteria[0].evidenceFiles).toHaveLength(2);
    if (location === "other hunk") expect(payload.criteria[0].evidenceFiles?.[0].excerpts).toHaveLength(2);
  });
  it("keeps separated referenced occurrences in separate excerpts in source order", async () => {
    const h = harness([(request) => success(modelOutput(references(request, "+first();").concat(references(request, "+last();")).reverse()))]);
    h.evidence.fetchDiff.mockImplementation(async (_r, sha) => sha === shaA ? file("core/validate.ts", "first();\n+middle();\n+last();") : "");
    await run(h); const groups = h.writes[0].payload.criteria[0].evidenceFiles!;
    expect(groups[0].excerpts).toHaveLength(2);
    expect(excerpts(h.writes[0].payload).map((l) => l.text)).toEqual(["+first();", "+last();"]);
  });
  it("corrects mixed valid/unknown references once using safe reason feedback", async () => {
    const h = harness([(request) => success(modelOutput([...references(request), "UNKNOWN_PRIVATE_RESPONSE"])), valid]);
    await run(h); expect(h.complete).toHaveBeenCalledTimes(2);
    const retry = h.complete.mock.calls[1][0].messages.map((m) => m.content).join("\n");
    expect(retry).toContain("unknown_reference"); expect(retry).toContain("criterion-a"); expect(retry).not.toContain("UNKNOWN_PRIVATE_RESPONSE");
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "addressed", verification: { state: "verified", reasonCodes: [] } });
  });
  it("downgrades unresolved references after the second call while retaining verified excerpts", async () => {
    const invalid: Step = (request) => success(modelOutput([...references(request), "UNKNOWN"]));
    const h = harness([invalid, invalid]); await run(h);
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "unclear", modelStatus: "addressed", evidence: [], verification: { state: "downgraded", reasonCodes: ["unknown_reference"] } });
    expect(excerpts(h.writes[0].payload).map((line) => line.text)).toEqual(["+validate(input);"]);
  });
  it("corrects addressed-without-evidence once then records missing_evidence", async () => {
    const h = harness([() => success(modelOutput()), () => success(modelOutput())]); await run(h);
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "unclear", modelStatus: "addressed", verification: { state: "downgraded", reasonCodes: ["missing_evidence"] } });
  });
  it("schema correction consumes the same retry as evidence correction", async () => {
    const h = harness([() => success({}), () => success(modelOutput())]); await run(h);
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.writes[0].payload.criteria[0].status).toBe("unclear");
  });
  it.each(["unknown", "missing", "duplicate", "array status", "extra code", "refs type"])("rejects malformed %s without persistence after two calls", async (kind) => {
    const step: Step = (request) => {
      const value = modelOutput(references(request));
      if (kind === "unknown") value.criteria[0].criterionId = "invented";
      if (kind === "missing") value.criteria.pop();
      if (kind === "duplicate") value.criteria[1].criterionId = value.criteria[0].criterionId;
      if (kind === "array status") Object.assign(value.criteria[0], { status: ["addressed"] });
      if (kind === "extra code") Object.assign(value.criteria[0], { evidence: ["+copied code"] });
      if (kind === "refs type") Object.assign(value.criteria[0], { evidenceRefs: "L1" });
      return success(value);
    };
    const h = harness([step, step]); await expect(run(h)).rejects.toMatchObject({ code: "INVALID_OUTPUT", status: 502 });
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.writes).toEqual([]);
  });
  it("can recover from schema invalid output", async () => { const h = harness([() => success({}), valid]); await run(h); expect(h.writes).toHaveLength(1); });
  it.each([["unavailable", "AI_UNAVAILABLE", 503], ["timeout", "AI_UNAVAILABLE", 503], ["invalid_request", "AI_ERROR", 502]] as const)("does not persist provider %s", async (category, code, status) => {
    const h = harness([() => ({ ok: false, category })]); await expect(run(h)).rejects.toMatchObject({ code, status }); expect(h.writes).toEqual([]);
  });
  it.each(["rate_limited", "quota_exceeded"] as const)("makes no inference for %s", async (reason) => {
    const h = harness(); vi.mocked(h.usage.reserve).mockResolvedValue(reason === "rate_limited" ? { ok: false, reason } : { ok: false, reason, resetsAt: "2026-11-08T00:00:00.000Z" });
    await expect(run(h)).rejects.toMatchObject({ code: reason === "rate_limited" ? "RATE_LIMITED" : "QUOTA_EXCEEDED", status: 429 }); noGeneratedResult(h);
  });
});

describe("necessary data and complete serialized input budget", () => {
  it("restores canonical criterion text and original assessed lines after prompt escaping", async () => {
    const source = "+render(<data>value</data>);  ";
    const h = harness([(request) => success(modelOutput(references(request, "+render(&lt;data>value&lt;/data>);  ")))]);
    h.snapshot.criteria[1].description = "Render <data> elements";
    h.evidence.fetchDiff.mockImplementation(async (_r, sha) => sha === shaA ? file("core/render.ts", source.slice(1)) : "");
    await run(h);
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ criterion: "Render <data> elements", status: "addressed" });
    expect(excerpts(h.writes[0].payload)[0].text).toBe(source);
  });

  it("sends compact file sections with IDs rather than duplicated Git headers or an output echo", async () => {
    const h = harness(); await run(h);
    const request = h.complete.mock.calls[0][0], user = request.messages.find((m) => m.role === "user")!.content;
    expect(user).toMatch(/<data name="file-\d+">/); expect(user).toContain(`FILE path=core/validate.ts commit=${shaA}`);
    expect(user).toMatch(/^L\d+ \| \+validate\(input\);/m);
    expect(user).not.toMatch(/\[\[L\d+\]\]/);
    expect(user).not.toContain("diff --git"); expect(user).not.toContain("--- a/"); expect(user).not.toContain("+++ b/");
    const system = request.messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("bare compact IDs"); expect(system).toContain("Return only L12");
    for (const field of ["criterionId", "status", "evidenceRefs", "possibleGaps"]) expect(system).toContain(field);
    expect(h.writes[0].payload.criteria[0].evidence).toEqual([]);
  });
  it("counts instructions, wrappers, escaped content and correction headroom; omits whole files then continues", async () => {
    const h = harness();
    h.evidence.fetchDiff.mockImplementation(async (_repository, sha) => sha === shaA ?
      file("core/oversized.ts", "<data>".repeat(7500)) + diff + file("ui/small.ts", "SMALL") +
      file("generated/output.ts", "EXCLUDED") + file("package-lock.json", "LOCK") : "");
    await run(h);
    const request = h.complete.mock.calls[0][0], prompt = request.messages.map((m) => m.content).join("");
    expect(prompt.length + 1024).toBeLessThanOrEqual(48000);
    expect(prompt).toContain("SMALL"); expect(prompt).toContain("validate(input)");
    expect(prompt).not.toContain("EXCLUDED"); expect(prompt).not.toContain("LOCK");
    expect(prompt).not.toContain("&lt;data>".repeat(20));
    expect(h.writes[0].payload.omittedFiles).toEqual(["core/oversized.ts"]);
  });
});

// Public evidence seam owns provider details and default-tip configuration lookup.
// No browser request or selected commit controls the configuration's revision.
describe("Group 7 public GitHub evidence service configuration reads", () => {
  function evidenceHarness() {
    const github: GitHubEvidenceAdapter = {
      getRepositoryDefaultBranch: vi.fn(async () => ({ ok: true as const, value: "main" })),
      listBranches: vi.fn(async () => ({ ok: true as const, value: [{ name: "feature", sha: shaA }, { name: "main", sha: shaC }] })),
      fetchFileAtCommit: vi.fn(async () => ({ ok: true as const, value: JSON.stringify(rules) })),
      getCommitAuthor: vi.fn(async () => ({ ok: true as const, value: { id: 123, login: "synthetic" } })),
      getCommitIdentity: vi.fn(async (_repository, sha) => ({ ok: true as const, value: { sha, author: { id: 123, login: "synthetic" } } })),
      listCommits: vi.fn(async () => ({ ok: true as const, value: [] })),
      fetchDiff: vi.fn(async () => ({ ok: true as const, value: diff })),
      isAncestor: vi.fn(async () => ({ ok: true as const, value: true })),
    };
    const database = { query: vi.fn(async () => { throw new Error("This snapshot-bound evidence read must not query task data"); }),
      connect: vi.fn(async () => { throw new Error("This evidence read must not open a database transaction"); }) };
    const service = new GitHubEvidenceService(new GitHubEvidenceRepository(database), github);
    return { service, github, database };
  }

  it("resolves the current default-branch tip and pins the root file read to that full SHA", async () => {
    const h = evidenceHarness();
    expect(await h.service.loadPathRules(binding)).toBe(JSON.stringify(rules));
    expect(h.github.getRepositoryDefaultBranch).toHaveBeenCalledExactlyOnceWith(binding);
    expect(h.github.listBranches).toHaveBeenCalledExactlyOnceWith(binding);
    expect(h.github.fetchFileAtCommit).toHaveBeenCalledExactlyOnceWith(binding, ".acceptance-check.json", shaC);
    expect(h.github.fetchFileAtCommit).not.toHaveBeenCalledWith(binding, expect.anything(), "main");
    expect(h.database.query).not.toHaveBeenCalled(); expect(h.database.connect).not.toHaveBeenCalled();
  });

  it("fails safely when the resolved default branch has no available tip", async () => {
    const h = evidenceHarness();
    vi.mocked(h.github.listBranches).mockResolvedValue({ ok: true, value: [{ name: "feature", sha: shaA }] });
    try {
      await h.service.loadPathRules(binding);
      expect.unreachable("missing default tip must refuse configuration retrieval");
    } catch (error) {
      const response = githubEvidenceErrorResponse(error);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "EVIDENCE_UNAVAILABLE", message: expect.any(String) } });
    }
    expect(h.github.fetchFileAtCommit).not.toHaveBeenCalled();
  });

  const providerCategories = ["unauthorized", "forbidden", "not_found", "rate_limited", "unavailable", "malformed_response", "invalid_request"] as const;
  for (const operation of ["getRepositoryDefaultBranch", "listBranches", "fetchFileAtCommit"] as const) {
    it.each(providerCategories)(`maps ${operation} provider %s to safe 503`, async (category) => {
      const h = evidenceHarness();
      vi.mocked(h.github[operation]).mockResolvedValue({ ok: false, category, status: 422 });
      try {
        await h.service.loadPathRules(binding);
        expect.unreachable("provider failure must refuse configuration retrieval");
      } catch (error) {
        const response = githubEvidenceErrorResponse(error);
        expect(response.status).toBe(503);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const body = await response.json();
        expect(body).toEqual({ error: { code: "EVIDENCE_UNAVAILABLE", message: "GitHub evidence is unavailable" } });
      }
      if (operation !== "fetchFileAtCommit") expect(h.github.fetchFileAtCommit).not.toHaveBeenCalled();
    });
  }

  it.each(["getRepositoryDefaultBranch", "listBranches", "fetchFileAtCommit"] as const)("contains thrown %s provider details", async (operation) => {
    const h = evidenceHarness();
    vi.mocked(h.github[operation]).mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"));
    try {
      await h.service.loadPathRules(binding);
      expect.unreachable("throwing provider must fail safely");
    } catch (error) {
      const response = githubEvidenceErrorResponse(error);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "EVIDENCE_UNAVAILABLE", message: "GitHub evidence is unavailable" } });
    }
  });
});
