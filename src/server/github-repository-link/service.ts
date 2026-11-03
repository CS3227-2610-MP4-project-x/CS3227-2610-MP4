import "server-only";

import type { ServerConfig } from "@/server/config";
import { linkFailure } from "./errors";
import { createLinkState, readLinkState } from "./state";
import type {
  GitHubOAuthVerificationPort,
  GitHubRepositoryLinkRepositoryPort,
  RepositoryBinding,
  RepositorySelection,
  VerifiedGitHubIdentity,
} from "./types";

export type LinkStart = Readonly<{ authorizationUrl: string; state: string }>;

export class GitHubRepositoryLinkService {
  constructor(
    private readonly repository: GitHubRepositoryLinkRepositoryPort,
    private readonly verification: GitHubOAuthVerificationPort,
    private readonly config: Pick<ServerConfig, "appOrigin" | "githubAppClientSecret">,
  ) {}

  async startAuthorization(
    projectId: string,
    identity: VerifiedGitHubIdentity,
    selection: RepositorySelection,
  ): Promise<LinkStart> {
    const access = await this.projectLinkAccess(projectId, identity.authUserId);
    this.requireManager(access, identity);
    const state = createLinkState(projectId, identity, selection, this.config.githubAppClientSecret);
    const authorizationUrl = this.verification.createAuthorizationUrl(
      state,
      `${this.config.appOrigin}/api/v1/auth/github-app/callback`,
    );
    return { authorizationUrl, state };
  }

  async completeAuthorization(
    identity: VerifiedGitHubIdentity,
    stateCookie: string,
    callbackState: string,
    code: string,
  ): Promise<string> {
    const state = readLinkState(stateCookie, callbackState, this.config.githubAppClientSecret);
    if (identity.authUserId !== state.authUserId || identity.githubUserId !== state.githubUserId) linkFailure(403);
    const initialAccess = await this.projectLinkAccess(state.projectId, identity.authUserId);
    this.requireManager(initialAccess, identity);

    const binding = await this.verification.verifyRepositoryAccess(code, identity.githubUserId, {
      installationId: state.installationId,
      repositoryOwner: state.repositoryOwner,
      repositoryName: state.repositoryName,
    });

    const finalAccess = await this.persistBinding(state.projectId, identity, binding);
    this.requireManagerStatus(finalAccess);
    return `${this.config.appOrigin}/projects/${state.projectId}`;
  }

  private requireManager(
    access: Awaited<ReturnType<GitHubRepositoryLinkRepositoryPort["findProjectLinkAccess"]>>,
    identity: VerifiedGitHubIdentity,
  ): void {
    if (!access) linkFailure(404);
    if (access.role !== "product_manager") linkFailure(403);
    if (access.authUserId !== identity.authUserId || access.githubUserId !== identity.githubUserId) linkFailure(403);
  }

  private requireManagerStatus(status: "missing" | "forbidden" | "authorized"): void {
    if (status === "missing") linkFailure(404);
    if (status === "forbidden") linkFailure(403);
  }

  private async projectLinkAccess(projectId: string, authUserId: string) {
    try { return await this.repository.findProjectLinkAccess(projectId, authUserId); }
    catch { return linkFailure(500); }
  }

  private async persistBinding(
    projectId: string,
    identity: VerifiedGitHubIdentity,
    binding: RepositoryBinding,
  ) {
    try { return await this.repository.replaceBindingIfAuthorized(projectId, identity, binding); }
    catch { return linkFailure(500); }
  }
}

