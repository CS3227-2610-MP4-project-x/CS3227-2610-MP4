// Public entry point for GitHub evidence adapters and their application types.
export type {
  CommitQuery,
  FakeGitHubBranchesOutcome,
  FakeGitHubCommitsOutcome,
  FakeGitHubDiffOutcome,
  FakeGitHubFileOutcome,
  FakeGitHubAncestryOutcome,
  FakeGitHubScript,
  GitHubAppAdapterOptions,
  GitHubBranch,
  GitHubCommit,
  GitHubCommitMetadata,
  GitHubCommitAncestry,
  GitHubEvidenceAdapter,
  GitHubFailure,
  GitHubFailureCategory,
  GitHubRepository,
  GitHubResult,
  GitHubUser,
} from "./github-adapter";
export { FakeGitHubAdapter, GitHubAppAdapter } from "./github-adapter";
