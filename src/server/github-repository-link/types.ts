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
  personId: string;
}>;

export type AccessCheck = "missing" | "forbidden" | "authorized";

export type AvailableRepository = Readonly<{
  repositoryId: number;
  owner: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
}>;

export type SetupAttempt = Readonly<{
  attemptId: string;
  projectId: string;
  personId: string;
  githubUserId: string;
  installationId: string | null;
}>;

export type GitHubOAuthVerificationPort = Readonly<{
  createAuthorizationUrl(state: string, redirectUri: string): string;
  verifyRepositoryAccess(
    code: string,
    expectedGitHubUserId: string,
    selection: RepositorySelection,
  ): Promise<RepositoryBinding>;
  listAvailableRepositories(code: string, expectedGitHubUserId: string, installationId: string): Promise<readonly AvailableRepository[]>;
  verifyCurrentRepositoryAccess(repository: Readonly<{ installationId: string; repositoryId: string; owner: string; name: string }>): Promise<boolean>;
}>;

export type GitHubRepositoryLinkRepositoryPort = Readonly<{
  findProjectLinkAccess(projectId: string, authUserId: string): Promise<ProjectLinkAccess | null>;
  replaceBindingIfAuthorized(
    projectId: string,
    identity: VerifiedGitHubIdentity,
    binding: RepositoryBinding,
  ): Promise<AccessCheck>;
  createSetupAttempt(projectId: string, identity: VerifiedGitHubIdentity, stateHash: Buffer): Promise<SetupAttempt | null>;
  consumeSetupState(stateHash: Buffer, oauthStateHash: Buffer, installationId: string, identity: VerifiedGitHubIdentity): Promise<SetupAttempt | null>;
  consumeOAuthState(stateHash: Buffer, identity: VerifiedGitHubIdentity): Promise<SetupAttempt | null>;
  saveRepositorySnapshot(attempt: SetupAttempt, repositories: readonly AvailableRepository[]): Promise<string>;
  listSnapshotRepositories(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity): Promise<readonly AvailableRepository[] | null>;
  findSnapshotRepository(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity, repositoryId: string): Promise<(SetupAttempt & AvailableRepository) | null>;
  replaceSnapshotBinding(snapshotId: string, projectId: string, identity: VerifiedGitHubIdentity, repositoryId: string): Promise<AccessCheck>;
  findProjectRepositoryBinding(projectId: string, identity: VerifiedGitHubIdentity): Promise<Readonly<{ installationId: string; repositoryId: string; owner: string; name: string }> | null>;
}>;
