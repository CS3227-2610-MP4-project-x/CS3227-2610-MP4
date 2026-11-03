import "server-only";

export type RepositorySelection = Readonly<{
  installationId: string;
  repositoryOwner: string;
  repositoryName: string;
}>;

export type VerifiedGitHubIdentity = Readonly<{
  authUserId: string;
  githubUserId: string;
}>;

export type RepositoryBinding = RepositorySelection & Readonly<{ repositoryId: string }>;

export type ProjectLinkAccess = Readonly<{
  role: string;
  authUserId: string;
  githubUserId: string;
}>;

export type AccessCheck = "missing" | "forbidden" | "authorized";

export type GitHubOAuthVerificationPort = Readonly<{
  createAuthorizationUrl(state: string, redirectUri: string): string;
  verifyRepositoryAccess(
    code: string,
    expectedGitHubUserId: string,
    selection: RepositorySelection,
  ): Promise<RepositoryBinding>;
}>;

export type GitHubRepositoryLinkRepositoryPort = Readonly<{
  findProjectLinkAccess(projectId: string, authUserId: string): Promise<ProjectLinkAccess | null>;
  replaceBindingIfAuthorized(
    projectId: string,
    identity: VerifiedGitHubIdentity,
    binding: RepositoryBinding,
  ): Promise<AccessCheck>;
}>;
