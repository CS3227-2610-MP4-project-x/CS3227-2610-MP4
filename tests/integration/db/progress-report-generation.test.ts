import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AI_LIMITS, FakeAdapter, LlmGateway } from "@/server/ai";
import { createProgressReportGenerationService, createProgressReportRepository, createProgressReportService, createReportCacheRepository, resolveReportRange } from "@/server/progress-report";
import { dbDescribe, useMigratedDatabase } from "./support/harness";
import { addMembership, createPerson, createProjectWithTeam, createTask, ENTITY_TABLES, insertReport, insertTaskChild, runtimePool } from "./support/fixtures";

const selection = { startDate: "2026-11-09", endDate: "2026-11-09" };
const resolved = resolveReportRange(selection, "2026-11-09");
if (resolved.kind !== "valid") throw new Error("Synthetic range is invalid");
const range = resolved.range;

dbDescribe("8.2 real PostgreSQL report generation/cache publication", () => {
  const database = useMigratedDatabase();
  function pool() { return runtimePool(database().connectAsRuntime); }
  async function fixture() {
    const team = await createProjectWithTeam(database().admin);
    const task = await createTask(database().admin, { projectId: team.projectId, assigneeId: team.developerId, status: "in_progress" });
    await insertTaskChild(database().admin, ENTITY_TABLES.progressUpdates, { projectId: team.projectId, taskId: task.id, actorId: team.developerId }, { created_at: "2026-11-09T01:00:00Z" });
    const statements = [{ developerId: team.developerId, category: "in_progress" as const, text: "Made progress.", taskIds: [task.id] }];
    const key = { projectId: team.projectId, rangeStart: range.startDate, rangeEnd: range.endDate, inputFingerprint: "a".repeat(64), generationContractVersion: "progress-report-v2", providerModel: "fake:fake", redactionReplacementCount: 0 };
    const publication = { key, statements, model: "fake", githubUnavailable: false, latestActivityAt: "2026-11-09T01:00:00.000Z", expectedVersion: null, personId: team.productManagerId };
    return { team, task, statements, key, publication };
  }
  function usage() {
    return {
      reserve: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, usageRecordId: "synthetic-usage" })),
      settle: vi.fn(async (..._args: unknown[]) => {}),
      recordCacheHit: vi.fn(async (..._args: unknown[]) => {}),
    };
  }

  it("round-trips one project/range row, isolates projects and retains legacy cache misses", async () => {
    const f = await fixture();
    const repository = createReportCacheRepository(pool());
    const created = await repository.publish(f.publication);
    expect(created.kind).toBe("stored");
    const stored = await repository.read(f.key);
    expect(stored).toMatchObject({ projectId: f.team.projectId, statements: f.statements, inputFingerprint: f.key.inputFingerprint, generationContractVersion: "progress-report-v2", providerModel: "fake:fake", githubUnavailable: false, version: expect.any(Number) });
    expect(new Date(stored!.createdAt).toISOString()).toBe(stored!.createdAt);
    const other = await createProjectWithTeam(database().admin);
    expect(await repository.read({ ...f.key, projectId: other.projectId })).toBeNull();
    await insertReport(database().admin, other.projectId, { start: range.startDate, end: range.endDate });
    expect(await repository.read({ ...f.key, projectId: other.projectId })).toMatchObject({ inputFingerprint: null, generationContractVersion: null, providerModel: null });
  });

  it("simultaneous identical publications preserve one winner without duplicate rows", async () => {
    const f = await fixture();
    const repository = createReportCacheRepository(pool());
    const results = await Promise.all([repository.publish(f.publication), repository.publish(f.publication)]);
    expect(results.map((result) => result.kind).sort()).toEqual(["stored", "winner"]);
    const rows = await database().admin.query("SELECT id, version FROM app.reports WHERE project_id = $1", [f.team.projectId]);
    expect(rows.rows).toHaveLength(1);
    for (const result of results) {
      if (result.kind === "conflict") throw new Error("Identical inputs must reuse a winner");
      expect(result.report.id).toBe(rows.rows[0].id);
    }
  });

  it("version guards prevent stale input from replacing a newer stored report", async () => {
    const f = await fixture();
    const repository = createReportCacheRepository(pool());
    const first = await repository.publish(f.publication);
    if (first.kind === "conflict") throw new Error("Initial insert failed");
    const nextKey = { ...f.key, inputFingerprint: "b".repeat(64) };
    const second = await repository.publish({ ...f.publication, key: nextKey, expectedVersion: first.report.version });
    expect(second.kind).toBe("stored");
    const stale = await repository.publish({ ...f.publication, expectedVersion: first.report.version });
    expect(stale.kind).toBe("conflict");
    expect(await repository.read(f.key)).toMatchObject({ inputFingerprint: nextKey.inputFingerprint });
  });

  it("checks current PM authorization transactionally before publication", async () => {
    const f = await fixture();
    const repository = createReportCacheRepository(pool());
    await expect(repository.publish({ ...f.publication, personId: f.team.developerId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await createProjectWithTeam(database().admin);
    await expect(repository.publish({ ...f.publication, personId: foreign.productManagerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await database().admin.query("SELECT count(*)::int AS count FROM app.reports WHERE project_id = $1", [f.team.projectId])).rows[0].count).toBe(0);
  });

  it("fingerprints actual context, timestamp ties, late attachments and in-range deletions", async () => {
    const f = await fixture();
    const metadata = { readBySha: vi.fn(async () => ({ kind: "available" as const, commits: [{ sha: "a".repeat(40), authoredAt: "2026-11-09T00:00:00.000Z", message: "Older authored commit", author: { githubUsername: "synthetic-dev" } }] })) };
    const assembly = createProgressReportService({ repository: createProgressReportRepository(pool()), githubMetadata: metadata });
    const req = { projectId: f.team.projectId, personId: f.team.productManagerId, ...selection };
    const fingerprint = async () => {
      const result = await assembly.assemble(req);
      if (result.kind !== "ready") throw new Error("Expected ready input");
      expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
      return result.inputFingerprint;
    };
    const first = await fingerprint();
    expect(await fingerprint()).toBe(first);
    await database().admin.query("UPDATE app.tasks SET title = $2 WHERE id = $1", [f.task.id, "Changed current context"]);
    const context = await fingerprint();
    expect(context).not.toBe(first);
    await insertTaskChild(database().admin, ENTITY_TABLES.progressUpdates, { projectId: f.team.projectId, taskId: f.task.id, actorId: f.team.developerId }, { body: "Same timestamp new record", created_at: "2026-11-09T01:00:00Z" });
    const tie = await fingerprint();
    expect(tie).not.toBe(context);
    await database().admin.query("UPDATE app.projects SET github_installation_id = 123, github_repository_id = 456, github_repository_owner = 'synthetic', github_repository_name = 'repo' WHERE id = $1", [f.team.projectId]);
    await insertTaskChild(database().admin, ENTITY_TABLES.attachedCommits, { projectId: f.team.projectId, taskId: f.task.id, actorId: f.team.developerId }, { commit_sha: "a".repeat(40), created_at: "2026-11-10T00:00:00Z" });
    const attachment = await fingerprint();
    expect(attachment).not.toBe(tie);
    const deleted = await createTask(database().admin, { projectId: f.team.projectId, assigneeId: f.team.developerId });
    await database().admin.query("UPDATE app.tasks SET deleted_at = $2 WHERE id = $1", [deleted.id, "2026-11-09T03:00:00Z"]);
    const deletion = await assembly.assemble(req);
    if (deletion.kind !== "ready") throw new Error("Expected ready input");
    expect(deletion.inputFingerprint).not.toBe(attachment);
    expect(deletion.inputText).not.toContain(deleted.id);
    const deletionRead = await createProgressReportRepository(pool()).withReadSnapshot((session) => session.readDeletionMarkers!({ projectId: f.team.projectId, range }));
    expect(deletionRead).toEqual([{ taskId: deleted.id, deletedAt: "2026-11-09T03:00:00.000Z" }]);
  });

  it("generates then reuses actual persisted cache without changing task state", async () => {
    const f = await fixture();
    const reportPool = pool();
    const assembly = createProgressReportService({ repository: createProgressReportRepository(reportPool), githubMetadata: { readBySha: async () => ({ kind: "available", commits: [] }) } });
    const adapter = new FakeAdapter([{ ok: true, text: JSON.stringify({ statements: f.statements }), usage: { inputTokens: 12, outputTokens: 8 } }]);
    const complete = vi.spyOn(adapter, "complete");
    const records = usage();
    const gateway = new LlmGateway({ adapter, usage: records, environment: "development", limits: AI_LIMITS.development });
    const service = createProgressReportGenerationService({ assembly, repository: createReportCacheRepository(reportPool), gateway, providerModel: "fake:fake" });
    const req = { projectId: f.team.projectId, personId: f.team.productManagerId, ...selection };
    const before = (await database().admin.query("SELECT status, assignee_id, version FROM app.tasks WHERE id = $1", [f.task.id])).rows;
    expect((await service.generate(req)).reused).toBe(false);
    expect((await service.generate(req)).reused).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(records.reserve).toHaveBeenCalledOnce();
    expect(records.recordCacheHit).toHaveBeenCalledOnce();
    expect((await database().admin.query("SELECT status, assignee_id, version FROM app.tasks WHERE id = $1", [f.task.id])).rows).toEqual(before);
    expect((await database().admin.query("SELECT statements FROM app.reports WHERE project_id = $1", [f.team.projectId])).rows[0].statements).toEqual(f.statements);
  });

  it("a change during the provider call completes without a held transaction and refuses stale publication", async () => {
    const f = await fixture();
    const reportPool = pool();
    const assembly = createProgressReportService({ repository: createProgressReportRepository(reportPool), githubMetadata: { readBySha: async () => ({ kind: "available", commits: [] }) } });
    const adapter = new FakeAdapter([{ ok: true, text: JSON.stringify({ statements: f.statements }), usage: { inputTokens: 12, outputTokens: 8 } }]);
    const original = adapter.complete.bind(adapter);
    vi.spyOn(adapter, "complete").mockImplementation(async (req) => {
      await database().admin.query("SET statement_timeout = '2s'");
      await database().admin.query("UPDATE app.tasks SET title = 'Changed while generating' WHERE id = $1", [f.task.id]);
      return original(req);
    });
    const gateway = new LlmGateway({ adapter, usage: usage(), environment: "development", limits: AI_LIMITS.development });
    const service = createProgressReportGenerationService({ assembly, repository: createReportCacheRepository(reportPool), gateway, providerModel: "fake:fake" });
    await expect(service.generate({ projectId: f.team.projectId, personId: f.team.productManagerId, ...selection })).rejects.toMatchObject({ code: "REPORT_INPUT_CHANGED" });
    expect((await database().admin.query("SELECT count(*)::int AS count FROM app.reports WHERE project_id = $1", [f.team.projectId])).rows[0].count).toBe(0);
  });

  it("replaces unavailable-evidence reports with each fresh charged generation", async () => {
    const f = await fixture();
    const reportPool = pool();
    await database().admin.query("UPDATE app.projects SET github_installation_id = 123, github_repository_id = 456, github_repository_owner = 'synthetic', github_repository_name = 'repo' WHERE id = $1", [f.team.projectId]);
    await insertTaskChild(database().admin, ENTITY_TABLES.attachedCommits, { projectId: f.team.projectId, taskId: f.task.id, actorId: f.team.developerId }, { commit_sha: "b".repeat(40), created_at: "2026-11-09T02:00:00Z" });
    const assembly = createProgressReportService({ repository: createProgressReportRepository(reportPool), githubMetadata: { readBySha: async () => ({ kind: "unavailable" }) } });
    const secondStatements = [{ ...f.statements[0], text: "Fresh second partial report." }];
    const adapter = new FakeAdapter([
      { ok: true, text: JSON.stringify({ statements: f.statements }), usage: { inputTokens: 12, outputTokens: 8 } },
      { ok: true, text: JSON.stringify({ statements: secondStatements }), usage: { inputTokens: 12, outputTokens: 8 } },
    ]);
    const complete = vi.spyOn(adapter, "complete");
    const records = usage();
    const gateway = new LlmGateway({ adapter, usage: records, environment: "development", limits: AI_LIMITS.development });
    const service = createProgressReportGenerationService({ assembly, repository: createReportCacheRepository(reportPool), gateway, providerModel: "fake:fake" });
    const req = { projectId: f.team.projectId, personId: f.team.productManagerId, ...selection };
    const first = await service.generate(req);
    const second = await service.generate(req);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(false);
    expect(second.report).toMatchObject({ kind: "generated", githubUnavailable: true, statements: [{ text: secondStatements[0].text }] });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(records.reserve).toHaveBeenCalledTimes(2);
    expect(records.recordCacheHit).not.toHaveBeenCalled();
    expect((await database().admin.query("SELECT statements FROM app.reports WHERE project_id = $1", [f.team.projectId])).rows[0].statements).toEqual(secondStatements);
  });

  it("rejects edits made during the final GitHub metadata read before publication", async () => {
    const f = await fixture();
    const reportPool = pool();
    await database().admin.query("UPDATE app.projects SET github_installation_id = 123, github_repository_id = 456, github_repository_owner = 'synthetic', github_repository_name = 'repo' WHERE id = $1", [f.team.projectId]);
    await insertTaskChild(database().admin, ENTITY_TABLES.attachedCommits, { projectId: f.team.projectId, taskId: f.task.id, actorId: f.team.developerId }, { commit_sha: "c".repeat(40), created_at: "2026-11-09T02:00:00Z" });
    let reads = 0;
    const readBySha = vi.fn(async () => {
      reads += 1;
      if (reads === 2) await database().admin.query("UPDATE app.tasks SET title = 'Edited during final metadata read' WHERE id = $1", [f.task.id]);
      return { kind: "available" as const, commits: [{ sha: "c".repeat(40), authoredAt: "2026-11-09T01:00:00.000Z", message: "Synthetic commit", author: { githubUsername: "synthetic-dev" } }] };
    });
    const assembly = createProgressReportService({ repository: createProgressReportRepository(reportPool), githubMetadata: { readBySha } });
    const adapter = new FakeAdapter([{ ok: true, text: JSON.stringify({ statements: f.statements }), usage: { inputTokens: 12, outputTokens: 8 } }]);
    const gateway = new LlmGateway({ adapter, usage: usage(), environment: "development", limits: AI_LIMITS.development });
    const service = createProgressReportGenerationService({ assembly, repository: createReportCacheRepository(reportPool), gateway, providerModel: "fake:fake" });
    await expect(service.generate({ projectId: f.team.projectId, personId: f.team.productManagerId, ...selection })).rejects.toMatchObject({ code: "REPORT_INPUT_CHANGED" });
    expect(readBySha.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((await database().admin.query("SELECT count(*)::int AS count FROM app.reports WHERE project_id = $1", [f.team.projectId])).rows[0].count).toBe(0);
  });

  it("serializes current PM publication against a competing role transfer", async () => {
    const f = await fixture();
    const repository = createReportCacheRepository(pool());
    const seed = await repository.publish(f.publication);
    if (seed.kind === "conflict") throw new Error("Initial report insert failed");
    const nextPm = await createPerson(database().admin);
    await addMembership(database().admin, f.team.projectId, nextPm, "developer");
    const blocker = await database().connectAsRuntime();
    const transfer = await database().connectAsRuntime();
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const transferPid = (await transfer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const waitUntil = async <T>(observe: () => Promise<T | undefined>): Promise<T> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await observe();
        if (result !== undefined) return result;
      }
      throw new Error("Expected PostgreSQL concurrency observation was not reached");
    };
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM app.reports WHERE id = $1 FOR UPDATE", [seed.report.id]);
    const publication = repository.publish({ ...f.publication, key: { ...f.key, inputFingerprint: "d".repeat(64) }, expectedVersion: seed.report.version }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let transferCommitted = false;
    let transferWork: Promise<void> | undefined;
    try {
      await waitUntil(async () => {
        const blocked = await database().admin.query("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
        return blocked.rowCount ? true : undefined;
      });
      transferWork = (async () => {
        await transfer.query("BEGIN");
        await transfer.query("SELECT person_id FROM app.memberships WHERE project_id = $1 AND person_id = ANY($2::uuid[]) ORDER BY person_id FOR UPDATE", [f.team.projectId, [f.team.productManagerId, nextPm]]);
        await transfer.query("UPDATE app.memberships SET role = 'developer' WHERE project_id = $1 AND person_id = $2", [f.team.projectId, f.team.productManagerId]);
        await transfer.query("UPDATE app.memberships SET role = 'product_manager' WHERE project_id = $1 AND person_id = $2", [f.team.projectId, nextPm]);
        await transfer.query("COMMIT");
        transferCommitted = true;
      })();
      const ordering = await waitUntil(async () => {
        if (transferCommitted) return "transfer-first" as const;
        const blocked = await database().admin.query("SELECT cardinality(pg_blocking_pids($1)) AS blockers", [transferPid]);
        return blocked.rows[0].blockers > 0 ? "publication-first" as const : undefined;
      });
      await blocker.query("ROLLBACK");
      const published = await publication;
      await transferWork;
      if (ordering === "transfer-first") {
        expect(published).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
        expect(await repository.read(f.key)).toMatchObject({ inputFingerprint: f.key.inputFingerprint });
      } else {
        expect(published).toMatchObject({ ok: true, result: { kind: "stored" } });
      }
    } finally {
      await blocker.query("ROLLBACK");
      await publication;
      await transferWork?.catch(() => undefined);
      await transfer.query("ROLLBACK");
    }
  });

  it("does not reuse an uncommitted partial report that wins an insert conflict", async () => {
    const f = await fixture();
    const blocker = await database().connectAsRuntime();
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await blocker.query("BEGIN");
    await insertReport(blocker, f.team.projectId, { start: range.startDate, end: range.endDate }, {
      model: "fake", statements: JSON.stringify(f.statements), github_evidence_unavailable: true,
      input_fingerprint: f.key.inputFingerprint, generation_contract_version: f.key.generationContractVersion, provider_model: f.key.providerModel, redaction_replacement_count: 0,
    });
    const publication = createReportCacheRepository(pool()).publish({ ...f.publication, githubUnavailable: true }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const waiting = await database().admin.query("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
        if (waiting.rowCount) { blocked = true; break; }
      }
      expect(blocked, "publication reached the real unique-key insertion wait").toBe(true);
      await blocker.query("COMMIT");
      expect(await publication).toEqual({ ok: true, result: { kind: "conflict" } });
    } finally {
      await blocker.query("ROLLBACK");
      await publication;
    }
  });

  it("rechecks input after an insert conflict wait before returning a complete winner", async () => {
    const f = await fixture();
    const reportPool = pool();
    const assembly = createProgressReportService({ repository: createProgressReportRepository(reportPool), githubMetadata: { readBySha: async () => ({ kind: "available", commits: [] }) } });
    const req = { projectId: f.team.projectId, personId: f.team.productManagerId, ...selection };
    const initial = await assembly.assemble(req);
    if (initial.kind !== "ready") throw new Error("Expected synthetic ready input");
    const blocker = await database().connectAsRuntime();
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await blocker.query("BEGIN");
    const winner = await insertReport(blocker, f.team.projectId, { start: range.startDate, end: range.endDate }, {
      model: "fake", statements: JSON.stringify(f.statements), github_evidence_unavailable: false,
      input_fingerprint: initial.inputFingerprint, generation_contract_version: "progress-report-v2", provider_model: "fake:fake", redaction_replacement_count: 0,
    });
    const adapter = new FakeAdapter([{ ok: true, text: JSON.stringify({ statements: [{ ...f.statements[0], text: "Losing generation" }] }), usage: { inputTokens: 12, outputTokens: 8 } }]);
    const complete = vi.spyOn(adapter, "complete");
    const records = usage();
    const gateway = new LlmGateway({ adapter, usage: records, environment: "development", limits: AI_LIMITS.development });
    const service = createProgressReportGenerationService({ assembly, repository: createReportCacheRepository(reportPool), gateway, providerModel: "fake:fake" });
    const generation = service.generate(req).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const waiting = await database().admin.query("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
        if (waiting.rowCount) { blocked = true; break; }
      }
      expect(blocked, "generation reached the real unique-key insertion wait").toBe(true);
      expect(complete).toHaveBeenCalledOnce();
      await database().admin.query("UPDATE app.tasks SET title = 'Input changed during insert conflict wait' WHERE id = $1", [f.task.id]);
      await blocker.query("COMMIT");
      expect(await generation).toMatchObject({ ok: false, error: { code: "REPORT_INPUT_CHANGED" } });
      expect(records.recordCacheHit).not.toHaveBeenCalled();
      const rows = await database().admin.query("SELECT id, statements FROM app.reports WHERE project_id = $1", [f.team.projectId]);
      expect(rows.rows).toEqual([{ id: winner.id, statements: f.statements }]);
    } finally {
      await blocker.query("ROLLBACK");
      await generation;
    }
  });
});
