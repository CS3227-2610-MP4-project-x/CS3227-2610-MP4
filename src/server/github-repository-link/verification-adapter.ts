import "server-only";

import { createSign } from "node:crypto";

import { linkFailure } from "./errors";
import type { GitHubOAuthVerificationPort, RepositoryBinding, RepositorySelection } from "./types";

const GITHUB_WEB_ORIGIN = "https://github.com";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const PAGE_SIZE = "100";

type GitHubOAuthConfig = Readonly<{ clientId: string; clientSecret: string; appId: string; privateKey: string }>;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveDecimal(value: unknown): string | null {
  const normalized = String(value ?? "");
  return /^[1-9]\d*$/.test(normalized) ? normalized : null;
}

function nextPage(response: Response, current: URL): URL | null {
  const linkHeader = response.headers.get("link");
  if (!linkHeader) return null;
  const nextEntry = linkHeader.split(/,\s*(?=<)/).find((entry) =>
    /;\s*rel\s*=\s*"?next"?(?:\s*;|$)/i.test(entry),
  );
  if (!nextEntry) return null;
  const match = /^\s*<([^>]+)>/.exec(nextEntry);
  if (!match) linkFailure(500);
  let next: URL;
  try { next = new URL(match[1]); } catch { return linkFailure(500); }
  if (next.origin !== GITHUB_API_ORIGIN || next.protocol !== "https:" || next.username || next.password ||
      next.pathname !== current.pathname || next.hash) linkFailure(500);
  return next;
}

export class GitHubOAuthVerificationAdapter implements GitHubOAuthVerificationPort {
  constructor(private readonly config: GitHubOAuthConfig) {}

  createAuthorizationUrl(state: string, redirectUri: string): string {
    const url = new URL("/login/oauth/authorize", GITHUB_WEB_ORIGIN);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async verifyRepositoryAccess(
    code: string,
    expectedGitHubUserId: string,
    selection: RepositorySelection,
  ): Promise<RepositoryBinding> {
    const accessToken = await this.exchangeCode(code);
    const user = object(await this.requestJson(new URL("/user", GITHUB_API_ORIGIN), accessToken));
    if (!user || positiveDecimal(user.id) !== expectedGitHubUserId) linkFailure(403);

    const installationUrl = new URL("/user/installations", GITHUB_API_ORIGIN);
    installationUrl.searchParams.set("per_page", PAGE_SIZE);
    const installations = await this.paginatedCollection(installationUrl, accessToken, "installations");
    const hasInstallation = installations.some((item) =>
      positiveDecimal(object(item)?.id) === selection.installationId,
    );
    if (!hasInstallation) linkFailure(403);

    const repositoriesUrl = new URL(
      `/user/installations/${encodeURIComponent(selection.installationId)}/repositories`,
      GITHUB_API_ORIGIN,
    );
    repositoriesUrl.searchParams.set("per_page", PAGE_SIZE);
    const repositories = await this.paginatedCollection(repositoriesUrl, accessToken, "repositories");
    const requestedFullName = `${selection.repositoryOwner}/${selection.repositoryName}`.toLowerCase();
    const repository = repositories.map(object).find((candidate) => candidate &&
      String(candidate.full_name ?? "").toLowerCase() === requestedFullName &&
      String(object(candidate.owner)?.login ?? "").toLowerCase() === selection.repositoryOwner.toLowerCase() &&
      String(candidate.name ?? "").toLowerCase() === selection.repositoryName.toLowerCase());
    const repositoryId = positiveDecimal(repository?.id);
    if (!repository || !repositoryId) linkFailure(403);
    return { ...selection, repositoryId };
  }

  async listAvailableRepositories(code: string, expectedGitHubUserId: string, installationId: string) {
    const accessToken = await this.exchangeCode(code);
    const user = object(await this.requestJson(new URL("/user", GITHUB_API_ORIGIN), accessToken));
    if (!user || positiveDecimal(user.id) !== expectedGitHubUserId) linkFailure(403);
    const installationsUrl = new URL("/user/installations", GITHUB_API_ORIGIN);
    installationsUrl.searchParams.set("per_page", PAGE_SIZE);
    const installations = await this.paginatedCollection(installationsUrl, accessToken, "installations");
    if (!installations.some((item) => positiveDecimal(object(item)?.id) === installationId)) linkFailure(403);
    const repositoriesUrl = new URL(`/user/installations/${encodeURIComponent(installationId)}/repositories`, GITHUB_API_ORIGIN);
    repositoriesUrl.searchParams.set("per_page", PAGE_SIZE);
    const repositories = await this.paginatedCollection(repositoriesUrl, accessToken, "repositories");
    return repositories.flatMap((value) => {
      const repository = object(value);
      if (!repository || positiveDecimal(repository.id) === null || typeof repository.name !== "string" ||
          typeof repository.full_name !== "string" || typeof repository.private !== "boolean") return [];
      const owner = object(repository.owner)?.login;
      if (typeof owner !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) ||
          !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name)) return [];
      const defaultBranch = repository.default_branch;
      if (typeof defaultBranch !== "string") return [];
      return [{ repositoryId: Number(repository.id), owner, name: repository.name,
        isPrivate: repository.private, defaultBranch }];
    });
  }

  async verifyCurrentRepositoryAccess(repository: Readonly<{ installationId: string; repositoryId: string; owner: string; name: string }>): Promise<boolean> {
    const url = new URL(`/app/installations/${encodeURIComponent(repository.installationId)}/access_tokens`, GITHUB_API_ORIGIN);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.appJwt()}`,
          "Content-Type": "application/json", "X-GitHub-Api-Version": GITHUB_API_VERSION },
        body: JSON.stringify({ repository_ids: [Number(repository.repositoryId)], permissions: { contents: "read", metadata: "read" } }),
        cache: "no-store",
      });
    } catch { return false; }
    if (!response.ok) return false;
    const payload = object(await this.readJson(response));
    if (typeof payload?.token !== "string" || !payload.token) return false;
    const repoUrl = new URL(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`, GITHUB_API_ORIGIN);
    try {
      const repoResponse = await fetch(repoUrl, { headers: { Accept: "application/vnd.github+json",
        Authorization: `Bearer ${payload.token}`, "X-GitHub-Api-Version": GITHUB_API_VERSION }, cache: "no-store" });
      if (!repoResponse.ok) return false;
      const repo = object(await this.readJson(repoResponse));
      return positiveDecimal(repo?.id) === repository.repositoryId;
    } catch { return false; }
  }

  private appJwt(): string {
    // GitHub App installation verification uses the same signing format as the evidence adapter.
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: string) => Buffer.from(value).toString("base64url");
    const unsigned = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iss: this.config.appId, iat: now - 60, exp: now + 540 }))}`;
    const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
    return `${unsigned}.${signer.sign(this.config.privateKey).toString("base64url")}`;
  }

  private async exchangeCode(code: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(new URL("/login/oauth/access_token", GITHUB_WEB_ORIGIN), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code }),
        cache: "no-store",
      });
    } catch { return linkFailure(500); }
    const payload = object(await this.readJson(response));
    if (typeof payload?.access_token !== "string" || !payload.access_token) linkFailure(500);
    return payload.access_token;
  }

  private async paginatedCollection(url: URL, token: string, property: "installations" | "repositories"): Promise<unknown[]> {
    const collection: unknown[] = [];
    const visited = new Set<string>();
    let page: URL | null = url;
    while (page) {
      const current = page;
      if (visited.has(current.toString())) linkFailure(500);
      visited.add(current.toString());
      const response = await this.requestResponse(current, token);
      const payload = object(await this.readJson(response));
      const entries = payload?.[property];
      if (!Array.isArray(entries)) linkFailure(500);
      collection.push(...entries);
      page = nextPage(response, current);
    }
    return collection;
  }

  private async requestJson(url: URL, token: string): Promise<unknown> {
    return this.readJson(await this.requestResponse(url, token));
  }

  private async requestResponse(url: URL, token: string): Promise<Response> {
    if (url.origin !== GITHUB_API_ORIGIN || url.protocol !== "https:" || url.username || url.password) linkFailure(500);
    try {
      return await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        cache: "no-store",
      });
    } catch { return linkFailure(500); }
  }

  private async readJson(response: Response): Promise<unknown> {
    if (!response.ok) linkFailure(500);
    try { return await response.json(); } catch { return linkFailure(500); }
  }
}
