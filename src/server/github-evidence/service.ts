import "server-only";
import type { GitHubEvidenceAdapter, GitHubRepository } from "@/server/github";
import type { VerifiedGitHubIdentity } from "@/server/github-repository-link";
import { GitHubEvidenceRepository } from "./repository";
import { evidenceFailure } from "./errors";

type CommitFilters = Readonly<{ since?: string; until?: string; branch?: string; page?: number; perPage?: number }>;
const SHA = /^[0-9a-f]{7,64}$/i;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

function repositoryOf(context: Awaited<ReturnType<GitHubEvidenceRepository["findTaskContext"]>>): GitHubRepository {
  if (!context || context.repositoryId === null || context.installationId === null || !context.repositoryOwner || !context.repositoryName) evidenceFailure(503);
  return { id: context.repositoryId, installationId: context.installationId, owner: context.repositoryOwner, name: context.repositoryName };
}
function resultError(category: string): never {
  // These categories originate from GitHub, not the caller's session or task
  // authorization. Revoked, suspended, and inaccessible installations must
  // remain distinguishable from an empty commit list without exposing provider
  // access details as an application permission denial.
  evidenceFailure(category === "invalid_request" ? 400 : 503);
}
function sgtDay(now: Date): { since: string; until: string } {
  const day = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - 8 * 60 * 60 * 1000;
  return { since: new Date(start).toISOString(), until: new Date(start + 24 * 60 * 60 * 1000).toISOString() };
}
function validInstant(value: string): boolean { return ISO_UTC.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }

export class GitHubEvidenceService {
  constructor(private readonly repository: GitHubEvidenceRepository, private readonly github: GitHubEvidenceAdapter,
    private readonly now: () => Date = () => new Date()) {}

  private async assignedContext(projectId: string, taskId: string, identity: VerifiedGitHubIdentity) {
    let context;
    try { context = await this.repository.findTaskContext(projectId, taskId, identity); } catch { evidenceFailure(500); }
    if (!context) evidenceFailure(404);
    if (context.role !== "developer" || context.assigneeId !== context.personId) evidenceFailure(403);
    return context;
  }

  async getTaskIdentity(projectId: string, taskId: string, identity: VerifiedGitHubIdentity) {
    const context = await this.assignedContext(projectId, taskId, identity);
    return { taskId: context.taskId, projectId: context.projectId, taskKey: context.taskKey, title: context.title };
  }

  async listBranches(projectId: string, taskId: string, identity: VerifiedGitHubIdentity) {
    const context = await this.assignedContext(projectId, taskId, identity);
    const repository = repositoryOf(context);
    const [branches, defaultBranch] = await Promise.all([
      this.github.listBranches(repository), this.github.getRepositoryDefaultBranch(repository),
    ]);
    if (!branches.ok) resultError(branches.category);
    if (!defaultBranch.ok) resultError(defaultBranch.category);
    return { defaultBranch: defaultBranch.value, branches: branches.value.map(({ name }) => ({ name })) };
  }

  async listCommits(projectId: string, taskId: string, identity: VerifiedGitHubIdentity, filters: CommitFilters) {
    const context = await this.assignedContext(projectId, taskId, identity);
    const repository = repositoryOf(context);
    const defaults = sgtDay(this.now());
    const since = filters.since ?? defaults.since;
    const until = filters.until ?? defaults.until;
    const page = filters.page ?? 1;
    const perPage = filters.perPage ?? 50;
    if (!validInstant(since) || !validInstant(until) || Date.parse(since) >= Date.parse(until) ||
        !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) evidenceFailure(400);
    let branch = filters.branch ?? context.taskBranch ?? "";
    if (!branch) {
      const metadata = await this.github.getRepositoryDefaultBranch(repository);
      if (!metadata.ok) resultError(metadata.category);
      branch = metadata.value;
    }
    const branches = await this.github.listBranches(repository);
    if (!branches.ok) resultError(branches.category);
    if (!branches.value.some((item) => item.name === branch)) evidenceFailure(400);
    const commits = await this.github.listCommits(repository, {
      author: { id: context.githubUserId, login: context.githubUsername }, since, until, branch,
    });
    if (!commits.ok) resultError(commits.category);
    const matching = commits.value.filter((commit) => commit.authorId === context.githubUserId &&
      Date.parse(commit.date) >= Date.parse(since) && Date.parse(commit.date) < Date.parse(until));
    const start = (page - 1) * perPage;
    if (!Number.isSafeInteger(start)) evidenceFailure(400);
    const current = matching.slice(start, start + perPage);
    return { since, until, branch, page, perPage, nextPage: start + perPage < matching.length ? page + 1 : null,
      commits: current.map((commit) => ({ sha: commit.sha, shortSha: commit.sha.slice(0, 7), message: commit.message,
        authoredAt: commit.date, mentionsTaskId: commit.message.includes(context.taskKey) })) };
  }

  async attachCommits(projectId: string, taskId: string, identity: VerifiedGitHubIdentity, shas: readonly string[]) {
    const uniqueShas = [...new Set(shas)];
    if (!uniqueShas.length || uniqueShas.some((sha) => !SHA.test(sha))) evidenceFailure(400);
    const context = await this.assignedContext(projectId, taskId, identity);
    const repository = repositoryOf(context);
    const authors = await Promise.all(uniqueShas.map((sha) => this.github.getCommitAuthor(repository, sha)));
    for (const author of authors) {
      if (!author.ok) resultError(author.category);
      if (author.value.id !== context.githubUserId) evidenceFailure(403);
    }
    let saved: boolean;
    try { saved = await this.repository.saveAttachedCommits(projectId, taskId, identity, uniqueShas); }
    catch { evidenceFailure(500); }
    if (!saved) evidenceFailure(403);
    return { attachedCommits: uniqueShas.map((sha) => ({ sha })) };
  }

  private static evidenceUnavailable(): never { evidenceFailure(503); }

  /** Reads the path configuration from the linked repository's current default-branch tip. */
  async loadPathRules(repository: GitHubRepository): Promise<string> {
    let branchResult;
    try { branchResult = await this.github.getRepositoryDefaultBranch(repository); }
    catch { return GitHubEvidenceService.evidenceUnavailable(); }
    if (!branchResult.ok) return GitHubEvidenceService.evidenceUnavailable();
    let branchesResult;
    try { branchesResult = await this.github.listBranches(repository); }
    catch { return GitHubEvidenceService.evidenceUnavailable(); }
    if (!branchesResult.ok) return GitHubEvidenceService.evidenceUnavailable();
    const tip = branchesResult.value.find((branch) => branch.name === branchResult.value)?.sha;
    if (typeof tip !== "string" || !/^[0-9a-f]{40,64}$/i.test(tip)) return GitHubEvidenceService.evidenceUnavailable();
    let fileResult;
    try { fileResult = await this.github.fetchFileAtCommit(repository, ".acceptance-check.json", tip); }
    catch { return GitHubEvidenceService.evidenceUnavailable(); }
    if (!fileResult.ok) return GitHubEvidenceService.evidenceUnavailable();
    return fileResult.value;
  }

  async fetchDiff(repository: GitHubRepository, commitSha: string): Promise<string> {
    let result;
    try { result = await this.github.fetchDiff(repository, commitSha); }
    catch { return GitHubEvidenceService.evidenceUnavailable(); }
    if (!result.ok) return GitHubEvidenceService.evidenceUnavailable();
    return result.value;
  }

  async isAncestor(repository: GitHubRepository, ancestorSha: string, descendantSha: string): Promise<boolean> {
    if (ancestorSha === descendantSha) return true;
    let result;
    try { result = await this.github.isAncestor(repository, ancestorSha, descendantSha); }
    catch { return GitHubEvidenceService.evidenceUnavailable(); }
    if (!result.ok) return GitHubEvidenceService.evidenceUnavailable();
    return result.value;
  }
}
