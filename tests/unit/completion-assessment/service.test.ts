import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeAdapter, LlmGateway, type FakeOutcome, type UsagePort } from "@/server/ai";
import { GitHubEvidenceRepository, GitHubEvidenceService, githubEvidenceErrorResponse } from "@/server/github-evidence";
import type { GitHubEvidenceAdapter } from "@/server/github";
import { CompletionAssessmentService, type CheckResultPayload } from "@/server/completion-assessment/service";

// Approved completion-assessment requirements: developer check, exact evidence,
// bounded input, canonical hashes, cache reuse and task-state containment.
// These are feature contracts, not Developer A's reserved AI-security evaluations.
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
function payload(): { anchorSha: string; criteria: { criterionId: string; criterion: string; status: "addressed" | "not_addressed" | "unclear"; evidence: string[] }[]; possibleGaps: string[]; omittedFiles: string[] } {
  return { anchorSha: shaB, criteria: [
    { criterionId: "criterion-a", criterion: "Validate input", status: "addressed", evidence: ["+validate(input);"] },
    { criterionId: "criterion-b", criterion: "Return data", status: "unclear", evidence: [] },
  ], possibleGaps: ["Additional test coverage may help"], omittedFiles: [] };
}
function success(value: unknown): FakeOutcome {
  return { ok: true, text: JSON.stringify(value), usage: { inputTokens: 100, outputTokens: 50 } };
}
function hash(text: string) { return createHash("sha256").update(text, "utf8").digest("hex"); }
function harness(script: readonly FakeOutcome[] = [success(payload())]) {
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
  const adapter = new FakeAdapter(script);
  const complete = vi.spyOn(adapter, "complete");
  const gateway = new LlmGateway({ adapter, usage, environment: "development",
    limits: { requestsPerMinute: 100, dailyTokenQuota: 10_000_000 } });
  const service = new CompletionAssessmentService({ snapshots, evidence, repository, gateway });
  return { service, snapshot, snapshots, evidence, repository, usage, complete, writes };
}
function check(value: CheckResultPayload = payload(), redacted = false) {
  return { id: "00000000-0000-4000-8000-000000000099", anchorSha: value.anchorSha,
    createdAt: "2026-11-07T00:00:00.000Z", redacted, payload: value };
}
function run(h: ReturnType<typeof harness>) { return h.service.runCheck(projectId, taskId, identity); }
function noGeneratedResult(h: ReturnType<typeof harness>) {
  expect(h.complete).not.toHaveBeenCalled(); expect(h.repository.save).not.toHaveBeenCalled();
}

describe("Group 7.2 check orchestration", () => {
  it("uses the captured snapshot, finds the descendant tip and persists a validated advisory result", async () => {
    const h = harness();
    expect(await run(h)).toEqual({ check: check(), reused: false });
    expect(h.snapshots.getAssignedSnapshot).toHaveBeenCalledExactlyOnceWith(projectId, taskId, identity);
    expect(h.evidence.loadPathRules).toHaveBeenCalledWith(binding);
    expect(h.evidence.fetchDiff.mock.calls.map(([, sha]) => sha).sort()).toEqual([shaA, shaB]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ taskId, payload: payload(), model: "fake", redacted: false });
    const prompt = h.complete.mock.calls[0][0].messages.map((m) => m.content).join("\n");
    for (const item of criteria) { expect(prompt).toContain(item.id); expect(prompt).toContain(item.description); }
    expect(prompt).toContain("+validate(input);");
    expect(h.snapshot).toEqual(expect.objectContaining({ attachedCommitShas: [shaB, shaA], criteria }));
  });

  it("hashes canonical full SHAs and criteria position then ID with exact serialization", async () => {
    const h = harness();
    h.snapshot.criteria = [criteria[0], { id: "criterion-z", description: "Unicode café", position: 1 }, criteria[1]];
    const value = payload();
    value.criteria.push({ criterionId: "criterion-z", criterion: "Unicode café", status: "unclear", evidence: [] });
    const replacement = harness([success(value)]);
    replacement.snapshot.criteria = h.snapshot.criteria;
    await run(replacement);
    expect(replacement.writes[0]).toMatchObject({
      commitSetHash: hash(`${shaA}\n${shaB}`),
      criteriaHash: hash(JSON.stringify([
        { id: "criterion-a", description: "Validate input" }, { id: "criterion-z", description: "Unicode café" },
        { id: "criterion-b", description: "Return data" },
      ])), pathRulesHash: hash(JSON.stringify(rules)),
    });
  });

  it("uses one captured snapshot even when task inputs change during remote calls", async () => {
    const h = harness();
    h.evidence.loadPathRules.mockImplementation(async () => {
      h.snapshot.criteria[0].description = "Changed after snapshot";
      h.snapshot.attachedCommitShas.push(shaC);
      return JSON.stringify(rules);
    });
    await run(h);
    expect(h.snapshots.getAssignedSnapshot).toHaveBeenCalledTimes(1);
    expect(h.writes[0].commitSetHash).toBe(hash(`${shaA}\n${shaB}`));
    expect(h.writes[0].payload.criteria.find((c) => c.criterionId === "criterion-b")?.criterion).toBe("Return data");
  });

  it("accepts a single selected commit as its own tip without ancestry queries", async () => {
    const h = harness(); h.snapshot.attachedCommitShas = [shaB];
    await run(h); expect(h.evidence.isAncestor).not.toHaveBeenCalled();
    expect(h.writes[0].payload.anchorSha).toBe(shaB);
  });

  it("refuses missing repository binding without AI or persistence", async () => {
    const h = harness();
    h.snapshots.getAssignedSnapshot.mockResolvedValue({ ...h.snapshot, repository: null } as unknown as typeof h.snapshot);
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503 }); noGeneratedResult(h);
  });

  it("refuses malformed diffs without AI or persistence", async () => {
    const h = harness(); h.evidence.fetchDiff.mockResolvedValue("not a Git diff");
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503 }); noGeneratedResult(h);
  });

  it("refuses an empty commit selection before AI or persistence", async () => {
    const h = harness(); h.snapshot.attachedCommitShas = [];
    await expect(run(h)).rejects.toMatchObject({ code: "CHECK_REQUIRES_COMMITS", status: 409 }); noGeneratedResult(h);
  });

  it("refuses incomparable selected tips", async () => {
    const h = harness(); h.evidence.isAncestor.mockResolvedValue(false);
    await expect(run(h)).rejects.toMatchObject({ code: "INCOMPARABLE_COMMIT_TIPS", status: 409 }); noGeneratedResult(h);
  });

  it.each(["loadPathRules", "isAncestor", "fetchDiff"] as const)("fails safely when %s fails", async (method) => {
    const h = harness(); h.evidence[method].mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"));
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503,
      message: expect.not.stringContaining("SYNTHETIC_PRIVATE_PROVIDER_DETAIL") }); noGeneratedResult(h);
  });

  it.each(["not JSON", "{}", JSON.stringify({ ...rules, version: 2 })])("refuses invalid config %s", async (config) => {
    const h = harness(); h.evidence.loadPathRules.mockResolvedValue(config);
    await expect(run(h)).rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE", status: 503 }); noGeneratedResult(h);
  });

  it("propagates snapshot authorization failure without accessing evidence or AI", async () => {
    const h = harness(); h.snapshots.getAssignedSnapshot.mockRejectedValue(Object.assign(new Error("Insufficient permissions"), { code: "FORBIDDEN", status: 403 }));
    await expect(run(h)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(h.evidence.loadPathRules).not.toHaveBeenCalled(); noGeneratedResult(h);
  });

  it("reuses an exact four-dimension cache hit with no AI or duplicate history", async () => {
    const h = harness(); h.repository.findReusable.mockResolvedValue(check());
    expect(await run(h)).toEqual({ check: check(), reused: true }); noGeneratedResult(h);
    expect(h.repository.findReusable).toHaveBeenCalledExactlyOnceWith({ taskId,
      commitSetHash: hash(`${shaA}\n${shaB}`), criteriaHash: hash(JSON.stringify([
        { id: "criterion-a", description: "Validate input" }, { id: "criterion-b", description: "Return data" },
      ])), pathRulesHash: hash(JSON.stringify(rules)) });
    expect(h.usage.recordCacheHit).toHaveBeenCalledOnce();
  });

  it("normalizes reordered and duplicate path rules before cache lookup", async () => {
    const h = harness();
    h.evidence.loadPathRules.mockResolvedValue(JSON.stringify({ ...rules, domainLogic: ["z/", "core/", "z/"] }));
    h.repository.findReusable.mockResolvedValue(check()); await run(h);
    expect(h.repository.findReusable.mock.calls[0][0].pathRulesHash)
      .toBe(hash(JSON.stringify({ ...rules, domainLogic: ["core/", "z/"] })));
  });

  it("changing the rules permits a new result for the same commits and criteria", async () => {
    const h = harness(); h.evidence.loadPathRules.mockResolvedValue(JSON.stringify({ ...rules, domainLogic: ["new-core/"] }));
    h.repository.findReusable.mockImplementation(async (key) => key.pathRulesHash === hash(JSON.stringify(rules)) ? check() : null);
    expect((await run(h)).reused).toBe(false); expect(h.writes).toHaveLength(1);
  });

  it("returns the existing result if persistence loses a competing unique-key insert", async () => {
    const h = harness(); h.repository.save.mockResolvedValue({ check: check(), created: false });
    expect(await run(h)).toEqual({ check: check(), reused: true });
  });

  it("stores a conditional redaction flag for assessed input", async () => {
    const h = harness();
    const token = "ghp" + "_" + "x".repeat(36);
    h.evidence.fetchDiff.mockImplementation(async (_repository, sha) => sha === shaA ? diff + file("core/config.ts", token) : "");
    await run(h);
    expect(h.writes[0].redacted).toBe(true);
    expect(h.complete.mock.calls[0][0].messages.map((m) => m.content).join("\n")).not.toContain(token);
  });

  it("filters, prioritizes, bounds whole files and stores server-calculated omissions", async () => {
    const expected = payload(); expected.omittedFiles = ["core/oversized.ts"];
    const h = harness([success(expected)]);
    h.evidence.fetchDiff.mockImplementation(async (_repository, sha) => sha === shaA ?
      file("ui/first.ts", "UI_MARKER") + file("core/oversized.ts", "X".repeat(48_001)) + diff +
      file("generated/output.ts", "EXCLUDED_MARKER") + file("package-lock.json", "LOCK_MARKER") : "");
    await run(h);
    const prompt = h.complete.mock.calls[0][0].messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("UI_MARKER"); expect(prompt).not.toContain("EXCLUDED_MARKER");
    expect(prompt).not.toContain("LOCK_MARKER"); expect(prompt).not.toContain("X".repeat(100));
    expect(prompt.indexOf("+validate(input);")).toBeLessThan(prompt.indexOf("+UI_MARKER"));
    expect(h.writes[0].payload.omittedFiles).toEqual(["core/oversized.ts"]);
  });
});

describe("Group 7.2 output association and failure handling", () => {
  it("documents every exact output shape key in the trusted model instructions", async () => {
    const h = harness(); await run(h);
    const trustedPrompt = h.complete.mock.calls[0][0].messages
      .filter((message) => message.role === "system").map((message) => message.content).join("\n");
    for (const key of ["anchorSha", "criteria", "criterionId", "criterion", "status", "evidence", "possibleGaps", "omittedFiles"]) {
      expect(trustedPrompt).toContain(`"${key}"`);
    }
    for (const status of ["addressed", "not_addressed", "unclear"]) expect(trustedPrompt).toContain(status);
  });

  it("rejects an array status rather than coercing it to an allowed literal string", async () => {
    const value = payload();
    const invalid = { ...value, criteria: [{ ...value.criteria[0], status: ["addressed"] }, value.criteria[1]] };
    const h = harness([success(invalid), success(invalid)]);
    await expect(run(h)).rejects.toMatchObject({ code: "INVALID_OUTPUT", status: 502 });
    expect(h.complete).toHaveBeenCalledTimes(2);
    expect(h.repository.save).not.toHaveBeenCalled();
  });

  it("accepts and persists the same redacted criterion text that the model receives", async () => {
    const token = "ghp" + "_" + "x".repeat(36);
    const description = `Validate using ${token}`;
    const redactedText = "Validate using [REDACTED:github-token]";
    const value = payload(); value.criteria[0].criterion = redactedText;
    const h = harness([success(value), success(value)]);
    h.snapshot.criteria[1].description = description;
    const result = await run(h);
    const modelInput = h.complete.mock.calls[0][0].messages.map((message) => message.content).join("\n");
    expect(modelInput).toContain(redactedText);
    expect(modelInput).not.toContain(token);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(result.check.payload.criteria[0].criterion).toBe(redactedText);
    expect(h.writes[0].payload.criteria[0].criterion).toBe(redactedText);
    expect(h.writes[0].redacted).toBe(true);
    expect(JSON.stringify(h.writes)).not.toContain(token);
  });

  it("accepts a criterion echoed in its model-visible escaped data-tag form", async () => {
    const description = "Render <data> elements with </data> closing tags";
    const modelText = "Render &lt;data> elements with &lt;/data> closing tags";
    const value = payload(); value.criteria[0].criterion = modelText;
    const h = harness([success(value), success(value)]);
    h.snapshot.criteria[1].description = description;

    const result = await run(h);

    const modelInput = h.complete.mock.calls[0][0].messages.map((message) => message.content).join("\n");
    expect(modelInput).toContain(modelText);
    expect(modelInput).not.toContain(description);
    expect(h.complete).toHaveBeenCalledTimes(1);
    const expected = { ...value.criteria[0], criterion: description };
    expect(result.check.payload.criteria[0]).toEqual(expected);
    expect(h.writes[0].payload.criteria[0]).toEqual(expected);
  });

  it("verifies escaped data-tag evidence and persists its original assessed diff line without downgrading", async () => {
    const assessedLine = "+render(<data>value</data>);";
    const modelLine = "+render(&lt;data>value&lt;/data>);";
    const value = payload(); value.criteria[0].evidence = [modelLine];
    const h = harness([success(value)]);
    h.evidence.fetchDiff.mockImplementation(async (_repository, sha) =>
      sha === shaA ? file("core/render.ts", assessedLine.slice(1)) : "");

    const result = await run(h);

    const modelInput = h.complete.mock.calls[0][0].messages.map((message) => message.content).join("\n");
    expect(modelInput).toContain(modelLine);
    expect(modelInput).not.toContain(assessedLine);
    expect(h.complete).toHaveBeenCalledTimes(1);
    const expected = { ...value.criteria[0], status: "addressed", evidence: [assessedLine] };
    expect(result.check.payload.criteria[0]).toEqual(expected);
    expect(h.writes[0].payload.criteria[0]).toEqual(expected);
  });

  it("accepts escaped omitted paths from the model and persists their original Git paths", async () => {
    const omittedPath = "core/<data>-oversized.ts";
    const modelPath = "core/&lt;data>-oversized.ts";
    const value = payload(); value.omittedFiles = [modelPath];
    const h = harness([success(value), success(value)]);
    h.evidence.fetchDiff.mockImplementation(async (_repository, sha) => sha === shaA ?
      file(omittedPath, "X".repeat(48_001)) + diff : "");

    const result = await run(h);

    const modelInput = h.complete.mock.calls[0][0].messages.map((message) => message.content).join("\n");
    expect(modelInput).toContain(modelPath);
    expect(modelInput).not.toContain(omittedPath);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(result.check.payload.omittedFiles).toEqual([omittedPath]);
    expect(h.writes[0].payload.omittedFiles).toEqual([omittedPath]);
  });

  it.each(["unknown", "duplicate", "missing"])("retries invalid %s criterion associations once and stores nothing", async (kind) => {
    const value = payload();
    if (kind === "unknown") value.criteria[0].criterionId = "unknown";
    if (kind === "duplicate") value.criteria[1].criterionId = value.criteria[0].criterionId;
    if (kind === "missing") value.criteria.pop();
    const h = harness([success(value), success(value)]);
    await expect(run(h)).rejects.toMatchObject({ code: "INVALID_OUTPUT", status: 502 });
    expect(h.complete).toHaveBeenCalledTimes(2); expect(h.writes).toEqual([]);
  });

  it("can recover when the schema retry supplies every current criterion", async () => {
    const h = harness([success({}), success(payload())]);
    expect((await run(h)).reused).toBe(false); expect(h.complete).toHaveBeenCalledTimes(2); expect(h.writes).toHaveLength(1);
  });

  it("downgrades unverifiable evidence to unclear and removes unverified lines", async () => {
    const value = payload(); value.criteria[0].evidence.push("validate(input);");
    const h = harness([success(value)]); await run(h);
    expect(h.writes[0].payload.criteria[0]).toMatchObject({ status: "unclear", evidence: ["+validate(input);"] });
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it.each(["anchor", "omissions", "text", "score", "status", "evidence-type"])("refuses mismatching %s payload", async (kind) => {
    const value: Record<string, unknown> = payload();
    if (kind === "anchor") value.anchorSha = shaA;
    if (kind === "omissions") value.omittedFiles = ["invented.ts"];
    if (kind === "score") value.score = 100;
    if (kind === "text") (value.criteria as ReturnType<typeof payload>["criteria"])[0].criterion = "Invented criterion";
    if (kind === "status") (value.criteria as Record<string, unknown>[])[0].status = "passed";
    if (kind === "evidence-type") (value.criteria as unknown[])[0] = { ...payload().criteria[0], evidence: "not an array" };
    const h = harness([success(value), success(value)]);
    await expect(run(h)).rejects.toMatchObject({ code: "INVALID_OUTPUT", status: 502 }); expect(h.writes).toEqual([]);
  });

  it.each([
    ["unavailable", "AI_UNAVAILABLE", 503], ["timeout", "AI_UNAVAILABLE", 503], ["invalid_request", "AI_ERROR", 502],
  ] as const)("does not persist provider %s failure", async (category, code, status) => {
    const h = harness([{ ok: false, category }]);
    await expect(run(h)).rejects.toMatchObject({ code, status }); expect(h.writes).toEqual([]);
  });

  it.each(["rate_limited", "quota_exceeded"] as const)("does not call AI or persist for %s", async (reason) => {
    const h = harness(); vi.mocked(h.usage.reserve).mockResolvedValue(reason === "rate_limited" ?
      { ok: false, reason } : { ok: false, reason, resetsAt: "2026-11-08T00:00:00.000Z" });
    await expect(run(h)).rejects.toMatchObject({ code: reason === "rate_limited" ? "RATE_LIMITED" : "QUOTA_EXCEEDED", status: 429 });
    noGeneratedResult(h);
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
