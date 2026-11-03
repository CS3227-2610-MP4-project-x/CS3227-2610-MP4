import "server-only";

import type { ServerConfig } from "@/server/config";
import { linkFailure } from "./errors";
import { createHash, randomBytes } from "node:crypto";
import { createLinkState, readLinkState } from "./state";
import type {
  GitHubOAuthVerificationPort,
  GitHubRepositoryLinkRepositoryPort,
  RepositoryBinding,
  RepositorySelection,
  AvailableRepository,
  SetupAttempt,
  VerifiedGitHubIdentity,
} from "./types";

export type LinkStart = Readonly<{ authorizationUrl: string; state: string }>;
const digest = (state: string) => createHash("sha256").update(state).digest();

export class GitHubRepositoryLinkService {
  constructor(
    private readonly repository: GitHubRepositoryLinkRepositoryPort,
    private readonly verification: GitHubOAuthVerificationPort,
    private readonly config: Pick<ServerConfig, "appOrigin" | "githubAppClientId" | "githubAppClientSecret" | "githubAppSlug">,
  ) {}

  async startSetup(projectId: string, identity: VerifiedGitHubIdentity): Promise<{ setupUrl: string; state: string }> {
    const access = await this.projectLinkAccess(projectId, identity.authUserId);
    this.requireManager(access, identity);
    const state = randomBytes(32).toString("base64url");
    const created = await this.repository.createSetupAttempt(projectId, identity, digest(state));
    if (!created) linkFailure(403);
    const setupUrl = new URL(`/apps/${encodeURIComponent(this.config.githubAppSlug)}/installations/new`, "https://github.com");
    setupUrl.searchParams.set("state", state);
    return { setupUrl: setupUrl.toString(), state };
  }

  async beginOAuthFromSetup(identity: VerifiedGitHubIdentity, setupState: string, installationId: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(setupState) || !/^[1-9]\d{0,18}$/.test(installationId)) linkFailure(400);
    const oauthState = randomBytes(32).toString("base64url");
    let attempt: SetupAttempt | null;
    try { attempt = await this.repository.consumeSetupState(digest(setupState), digest(oauthState), installationId, identity); }
    catch { return linkFailure(500); }
    if (!attempt) linkFailure(403);
    const authorizationUrl = this.verification.createAuthorizationUrl(
      oauthState, `${this.config.appOrigin}/api/v1/auth/github-app/callback`,
    );
    return { authorizationUrl, oauthState };
  }

  async completeSetupAuthorization(identity: VerifiedGitHubIdentity, cookieState: string, callbackState: string, code: string) {
    if (!callbackState || callbackState !== cookieState || !code) linkFailure(400);
    let attempt: SetupAttempt | null;
    try { attempt = await this.repository.consumeOAuthState(digest(callbackState), identity); }
    catch { return linkFailure(500); }
    if (!attempt || !attempt.installationId) linkFailure(403);
    const access = await this.projectLinkAccess(attempt.projectId, identity.authUserId);
    this.requireManager(access, identity);
    let repositories: readonly AvailableRepository[];
    try { repositories = await this.verification.listAvailableRepositories(code, identity.githubUserId, attempt.installationId); }
    catch { return linkFailure(403); }
    let snapshotId: string;
    try { snapshotId = await this.repository.saveRepositorySnapshot(attempt, repositories); }
    catch { return linkFailure(500); }
    return `${this.config.appOrigin}/projects/${attempt.projectId}/settings?githubSnapshot=${encodeURIComponent(snapshotId)}`;
  }

  async readSnapshot(projectId: string, snapshotId: string, identity: VerifiedGitHubIdentity) {
    const access = await this.projectLinkAccess(projectId, identity.authUserId);
    this.requireManager(access, identity);
    try {
      const repositories = await this.repository.listSnapshotRepositories(snapshotId, projectId, identity);
      if (!repositories) linkFailure(404);
      return repositories;
    } catch (error) {
      if (error instanceof Error && error.name === "GitHubRepositoryLinkError") throw error;
      return linkFailure(500);
    }
  }

  async readProjectBinding(projectId: string, identity: VerifiedGitHubIdentity) {
    const access = await this.projectLinkAccess(projectId, identity.authUserId);
    this.requireManager(access, identity);
    try { return await this.repository.findProjectRepositoryBinding(projectId, identity); }
    catch { return linkFailure(500); }
  }

  async linkSnapshotRepository(projectId: string, snapshotId: string, repositoryId: number, identity: VerifiedGitHubIdentity) {
    const access = await this.projectLinkAccess(projectId, identity.authUserId);
    this.requireManager(access, identity);
    let selected: (SetupAttempt & AvailableRepository) | null;
    try { selected = await this.repository.findSnapshotRepository(snapshotId, projectId, identity, String(repositoryId)); }
    catch { return linkFailure(500); }
    if (!selected?.installationId) linkFailure(404);
    let hasAccess = false;
    try { hasAccess = await this.verification.verifyCurrentRepositoryAccess({
      installationId: selected.installationId, repositoryId: String(selected.repositoryId),
      owner: selected.owner, name: selected.name,
    }); } catch { hasAccess = false; }
    if (!hasAccess) linkFailure(403);
    let status: "missing" | "forbidden" | "authorized";
    try { status = await this.repository.replaceSnapshotBinding(snapshotId, projectId, identity, String(repositoryId)); }
    catch { return linkFailure(500); }
    this.requireManagerStatus(status);
  }

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
