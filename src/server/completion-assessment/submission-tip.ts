import "server-only";

import { createHash } from "node:crypto";
import { parseAcceptancePathRules } from "./path-rules";
import type { TaskSnapshotCriterion, TaskSnapshotRepositoryBinding } from "./snapshot-repository";

// completion-assessment "Submission can look up the committed tip" (design.md "Task Lifecycle
// Decisions (4.3)" L5, agreed by Developer A). A read-only lookup for the task lifecycle: it
// starts no check, never calls the LLM, fetches no diff and writes nothing. Every failure is
// "no tip", so a submission always proceeds.

type Query = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}>;

/** What the tip is resolved from: the attached commits, the criteria and the linked repository. */
export type SubmissionSnapshot = Readonly<{
  attachedCommitShas: readonly string[];
  criteria: readonly TaskSnapshotCriterion[];
  repository: TaskSnapshotRepositoryBinding | null;
}>;

/**
 * The unique tip and the inputs it was resolved from: the attached commit set (sorted,
 * distinct), the criteria ordered by position then ID, and their hash, computed as stored check
 * results' `criteria_hash`.
 */
export type SubmissionTip = Readonly<{
  anchorSha: string;
  commitShas: readonly string[];
  criteria: readonly TaskSnapshotCriterion[];
  criteriaHash: string;
}>;

type SnapshotPort = Readonly<{ getSubmissionSnapshot(projectId: string, taskId: string): Promise<SubmissionSnapshot | null> }>;
type EvidencePort = Readonly<{
  loadPathRules(repository: TaskSnapshotRepositoryBinding): Promise<string>;
  isAncestor(repository: TaskSnapshotRepositoryBinding, ancestorSha: string, descendantSha: string): Promise<boolean>;
}>;
/**
 * `timeoutMs` bounds the whole lookup, including the path-rules load and every ancestry query,
 * because it runs before the submission's version check (fix round 1, F8).
 */
type SubmissionTipOptions = Readonly<{ snapshots: SnapshotPort; evidence: EvidencePort; timeoutMs?: number }>;

/**
 * The default budget: two GitHub adapter request timeouts (30 s each, github-adapter.ts), so the
 * lookup plus the submission transaction fit well inside the state route's 150 s `maxDuration`,
 * the duration already approved for the acceptance-criteria-check route (design.md G11).
 */
export const SUBMISSION_TIP_TIMEOUT_MS = 60_000;

/** Set once the budget has expired, so the lookup stops making GitHub calls. */
type Budget = { expired: boolean };

class BudgetExpired extends Error {}

/**
 * Logs why a lookup gave no tip, as a redacted category only: an error class name or
 * "timeout", never a message, SQL, SHA, task text or token (fix round 1, F3).
 */
function logTipLookupFailure(category: string): void {
  console.warn("[submission-tip] lookup unavailable; submitting without a check reference", { category });
}

function errorCategory(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function criteriaInOrder(criteria: readonly TaskSnapshotCriterion[]): readonly TaskSnapshotCriterion[] {
  return [...criteria].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}

/** The same canonical hash the check service stores as `criteria_hash`. */
function criteriaHash(ordered: readonly TaskSnapshotCriterion[]): string {
  const canonical = JSON.stringify(ordered.map(({ id, description }) => ({ id, description })));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export class SubmissionTipLookup {
  constructor(private readonly options: SubmissionTipOptions) {}

  /**
   * The unique tip of the task's attached commits, or null when there is none, evidence is
   * unavailable, or the time budget expires. It never rejects.
   */
  async findSubmissionTip(projectId: string, taskId: string): Promise<SubmissionTip | null> {
    const budget: Budget = { expired: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        budget.expired = true;
        logTipLookupFailure("timeout");
        resolve(null);
      }, this.options.timeoutMs ?? SUBMISSION_TIP_TIMEOUT_MS);
    });
    const lookup = this.resolve(projectId, taskId, budget).catch((error: unknown) => {
      if (!budget.expired) logTipLookupFailure(errorCategory(error));
      return null;
    });
    try {
      return await Promise.race([lookup, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolve(projectId: string, taskId: string, budget: Budget): Promise<SubmissionTip | null> {
    const snapshot = await this.options.snapshots.getSubmissionSnapshot(projectId, taskId);
    if (!snapshot) return null;
    const commitShas = [...new Set(snapshot.attachedCommitShas)].sort(compareText);
    if (commitShas.length === 0 || !snapshot.repository) return null;
    // The path rules must be readable, as for a check; unavailable rules mean no tip.
    if (!parseAcceptancePathRules(await this.options.evidence.loadPathRules(snapshot.repository)).ok) return null;
    const anchorSha = await this.uniqueTip(snapshot.repository, commitShas, budget);
    if (!anchorSha) return null;
    const criteria = criteriaInOrder(snapshot.criteria);
    return { anchorSha, commitShas, criteria, criteriaHash: criteriaHash(criteria) };
  }

  /**
   * The commit that descends from every other commit, or null. One pass keeps the commit that
   * no later commit descends from; a unique tip must be that commit, which is then verified.
   */
  private async uniqueTip(repository: TaskSnapshotRepositoryBinding, shas: readonly string[], budget: Budget): Promise<string | null> {
    const isAncestor = (ancestor: string, descendant: string) => {
      if (budget.expired) throw new BudgetExpired();
      return this.options.evidence.isAncestor(repository, ancestor, descendant);
    };
    let candidate = shas[0];
    for (const sha of shas.slice(1)) {
      if (!await isAncestor(sha, candidate)) candidate = sha;
    }
    for (const sha of shas) {
      if (sha !== candidate && !await isAncestor(sha, candidate)) return null;
    }
    return candidate;
  }
}

type SubmissionSnapshotRow = Record<string, unknown> & {
  criteria: unknown;
  attached_commit_shas: unknown;
  github_repository_id: string | null;
  github_installation_id: string | null;
  github_repository_owner: string | null;
  github_repository_name: string | null;
};

function jsonValue(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function parseCriteria(value: unknown): readonly TaskSnapshotCriterion[] {
  const items = jsonValue(value);
  if (!Array.isArray(items)) throw new Error("Invalid submission snapshot.");
  return items.map((item: unknown) => {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || typeof row.description !== "string" || !Number.isSafeInteger(row.position)) {
      throw new Error("Invalid submission snapshot.");
    }
    return { id: row.id, description: row.description, position: Number(row.position) };
  });
}

function parseShas(value: unknown): readonly string[] {
  const items = jsonValue(value);
  if (!Array.isArray(items) || !items.every((item) => typeof item === "string")) throw new Error("Invalid submission snapshot.");
  return items as string[];
}

/**
 * Reads a live task's attached commits, criteria and linked repository for the tip lookup. The
 * lifecycle has already authorized the submitter, so no identity is joined here.
 */
export class SubmissionSnapshotRepository {
  constructor(private readonly database: Query) {}

  async getSubmissionSnapshot(projectId: string, taskId: string): Promise<SubmissionSnapshot | null> {
    const result = await this.database.query<SubmissionSnapshotRow>(
      `SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ac.id::text, 'description', ac.description, 'position', ac.position
              ) ORDER BY ac.position, ac.id) FROM app.acceptance_criteria ac WHERE ac.task_id = t.id), '[]'::jsonb) AS criteria,
              COALESCE((SELECT jsonb_agg(c.commit_sha ORDER BY c.commit_sha)
                FROM app.attached_commits c WHERE c.task_id = t.id), '[]'::jsonb) AS attached_commit_shas,
              pr.github_repository_id::text AS github_repository_id,
              pr.github_installation_id::text AS github_installation_id,
              pr.github_repository_owner, pr.github_repository_name
         FROM app.tasks t
         JOIN app.projects pr ON pr.id = t.project_id
        WHERE t.id = $1::uuid AND t.project_id = $2::uuid AND t.deleted_at IS NULL`,
      [taskId, projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const binding = [row.github_repository_id, row.github_installation_id, row.github_repository_owner, row.github_repository_name];
    const repository = binding.every((value) => value !== null) ? {
      id: Number(row.github_repository_id),
      installationId: Number(row.github_installation_id),
      owner: String(row.github_repository_owner),
      name: String(row.github_repository_name),
    } : null;
    return { attachedCommitShas: parseShas(row.attached_commit_shas), criteria: parseCriteria(row.criteria), repository };
  }
}
