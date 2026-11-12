import "server-only";
import type {
  CommitQuery, GitHubBranch, GitHubCommit, GitHubCommitMetadata, GitHubEvidenceAdapter,
  GitHubRepository, GitHubResult, GitHubUser,
} from "@/server/github";
import { readSyntheticSessionClaims } from "./synthetic-session";

const SHA = "a90f0e8b51d2ce43838f1234567890abcdef1234";
const DATE = "2026-11-12T04:00:00.000Z";
const USER: GitHubUser = { id: 900001, login: "e2e-developer" };
const BRANCHES: readonly GitHubBranch[] = [{ name: "main", sha: SHA }];
const COMMIT: GitHubCommit = { sha: SHA, message: "Synthetic implementation", authorId: USER.id, authorLogin: USER.login, date: DATE };
const RULES = JSON.stringify({ version: 1, domainLogic: ["src/"], apiHandlers: ["src/app/api/"], tests: ["tests/"], ui: ["src/components/"], lockfileNames: ["package-lock.json"], generatedPathPrefixes: [".next/"] });
const DIFF = "diff --git a/src/example.ts b/src/example.ts\nindex 0000000..1111111 100644\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1,2 @@\n+export const e2eEvidence = true; // L12\n+export const implementation = 'synthetic'; // L13\n";

export class E2EGitHubAdapter implements GitHubEvidenceAdapter {
  async getRepositoryDefaultBranch(): Promise<GitHubResult<string>> { return { ok: true, value: "main" }; }
  async getCommitAuthor(): Promise<GitHubResult<GitHubUser>> { return { ok: true, value: USER }; }
  async getCommitIdentity(_repository: GitHubRepository, sha: string): Promise<GitHubResult<Readonly<{ sha: string; author: GitHubUser }>>> {
    return sha === SHA ? { ok: true, value: { sha: SHA, author: USER } } : { ok: false, category: "not_found" };
  }
  async listBranches(): Promise<GitHubResult<readonly GitHubBranch[]>> { return { ok: true, value: BRANCHES }; }
  async listCommits(_repository: GitHubRepository, query: CommitQuery): Promise<GitHubResult<readonly GitHubCommit[]>> {
    if (query.author.id !== USER.id || query.author.login !== USER.login || query.branch !== "main") return { ok: true, value: [] };
    const claims = await readSyntheticSessionClaims();
    return claims ? { ok: true, value: [{ ...COMMIT, message: `${claims.taskKey} synthetic implementation` }] } : { ok: false, category: "unauthorized" };
  }
  async fetchDiff(_repository: GitHubRepository, sha: string): Promise<GitHubResult<string>> {
    return sha === SHA ? { ok: true, value: DIFF } : { ok: false, category: "not_found" };
  }
  async fetchFileAtCommit(_repository: GitHubRepository, path: string, sha: string): Promise<GitHubResult<string>> {
    if (sha !== SHA) return { ok: false, category: "not_found" };
    if (path === ".acceptance-check.json") return { ok: true, value: RULES };
    if (path === "src/example.ts") return { ok: true, value: "export const e2eEvidence = true;\n" };
    return { ok: false, category: "not_found" };
  }
  async isAncestor(_repository: GitHubRepository, ancestor: string, descendant: string): Promise<GitHubResult<boolean>> {
    return { ok: true, value: ancestor === SHA && descendant === SHA };
  }
  async getCommitMetadata(_repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubCommitMetadata>> {
    return sha === SHA ? { ok: true, value: { sha: SHA, authoredAt: DATE, message: COMMIT.message, author: { githubUsername: USER.login } } } : { ok: false, category: "not_found" };
  }
}
