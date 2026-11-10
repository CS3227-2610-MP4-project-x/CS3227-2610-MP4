import "server-only";

import { createSign } from "node:crypto";

// Provider-neutral GitHub evidence port. Repository IDs are supplied by the
// trusted binding layer; owner/name are retained for GitHub's repository URLs.
export type GitHubRepository = Readonly<{
  id: number;
  installationId: number;
  owner: string;
  name: string;
}>;

export type GitHubUser = Readonly<{ id: number; login: string }>;

export type GitHubBranch = Readonly<{ name: string; sha: string }>;

export type GitHubCommit = Readonly<{
  sha: string;
  message: string;
  authorId: number;
  authorLogin: string;
  date: string;
}>;
export type GitHubCommitMetadata = Readonly<{ sha: string; authoredAt: string; message: string; author: Readonly<{ githubUsername: string | null }> }>;

export type GitHubCommitAncestry = Readonly<{
  ancestorSha: string;
  descendantSha: string;
  isAncestor: boolean;
}>;

export type GitHubFailureCategory =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "malformed_response"
  | "invalid_request";

export type GitHubFailure = Readonly<{
  ok: false;
  category: GitHubFailureCategory;
  status?: number;
}>;

export type GitHubResult<T> = Readonly<{ ok: true; value: T }> | GitHubFailure;

export type CommitQuery = Readonly<{
  author: GitHubUser;
  since: string;
  until: string;
  branch: string;
}>;

export interface GitHubEvidenceAdapter {
  getRepositoryDefaultBranch(repository: GitHubRepository): Promise<GitHubResult<string>>;
  getCommitAuthor(repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubUser>>;
  getCommitIdentity(repository: GitHubRepository, sha: string): Promise<GitHubResult<Readonly<{ sha: string; author: GitHubUser }>>>;
  listBranches(repository: GitHubRepository): Promise<GitHubResult<readonly GitHubBranch[]>>;
  listCommits(repository: GitHubRepository, query: CommitQuery): Promise<GitHubResult<readonly GitHubCommit[]>>;
  fetchDiff(repository: GitHubRepository, sha: string): Promise<GitHubResult<string>>;
  fetchFileAtCommit(repository: GitHubRepository, path: string, commitSha: string): Promise<GitHubResult<string>>;
  isAncestor(repository: GitHubRepository, ancestorSha: string, descendantSha: string): Promise<GitHubResult<boolean>>;
}

export type GitHubAppAdapterOptions = Readonly<{
  appId: string;
  privateKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}>;

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const API_ORIGIN = new URL(API_ROOT).origin;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(category: GitHubFailureCategory, status?: number): GitHubFailure {
  return status === undefined ? { ok: false, category } : { ok: false, category, status };
}

function failureForStatus(status: number): GitHubFailureCategory {
  switch (status) {
    case 400:
    case 422:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "unavailable" : "malformed_response";
  }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function appJwt(appId: string, privateKey: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({ iss: appId, iat: now - 60, exp: now + 540 }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

function validRepo(repository: GitHubRepository): boolean {
  return Number.isSafeInteger(repository.id) && repository.id > 0 &&
    Number.isSafeInteger(repository.installationId) && repository.installationId > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(repository.owner) && /^[A-Za-z0-9_.-]+$/.test(repository.name);
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /^\d{4}-\d\d-\d\dT/.test(value);
}

function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40,64}$/i.test(value);
}

function isRepositoryFilePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.endsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\0"));
}

function nextPageUrl(linkHeader: string | null): URL | null | "invalid" {
  if (!linkHeader) return null;
  const links = linkHeader.matchAll(/<([^>]+)>\s*;\s*([^,]+)/g);
  for (const [, target, parameters] of links) {
    const relation = /(?:^|;)\s*rel\s*=\s*"?([^";\s]+)"?/i.exec(parameters)?.[1];
    if (!relation?.split(/\s+/).includes("next")) continue;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return "invalid";
    }
    if (url.origin !== API_ORIGIN || url.protocol !== "https:" || url.username || url.password || url.hash) {
      return "invalid";
    }
    return url;
  }
  return null;
}

export class GitHubAppAdapter implements GitHubEvidenceAdapter {
  readonly #appId: string;
  readonly #privateKey: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(options: GitHubAppAdapterOptions) {
    this.#appId = options.appId;
    this.#privateKey = options.privateKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
  }

  async #fetchResponse(url: URL, accept: string, token: string): Promise<GitHubResult<Response>> {
    if (url.origin !== API_ORIGIN || url.protocol !== "https:" || url.username || url.password || url.hash) {
      return failed("malformed_response");
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return failed("unavailable");
    }
    if (!response.ok) return failed(failureForStatus(response.status), response.status);
    return { ok: true, value: response };
  }

  async #singleRead<T>(
    repository: GitHubRepository,
    path: string,
    accept: string,
    parse: (response: Response) => Promise<T>,
  ): Promise<GitHubResult<T>> {
    if (!validRepo(repository)) return failed("invalid_request");
    const tokenResult = await this.#installationToken(repository);
    if (!tokenResult.ok) return tokenResult;
    const responseResult = await this.#fetchResponse(new URL(`${API_ROOT}${path}`), accept, tokenResult.value);
    if (!responseResult.ok) return responseResult;
    try {
      return { ok: true, value: await parse(responseResult.value) };
    } catch {
      return failed("malformed_response", responseResult.value.status);
    }
  }

  async #paginatedRead<T>(
    repository: GitHubRepository,
    path: string,
    accept: string,
    parsePage: (response: Response) => Promise<readonly T[]>,
  ): Promise<GitHubResult<readonly T[]>> {
    if (!validRepo(repository)) return failed("invalid_request");
    const tokenResult = await this.#installationToken(repository);
    if (!tokenResult.ok) return tokenResult;
    let url = new URL(`${API_ROOT}${path}`);
    const visited = new Set<string>();
    const combined: T[] = [];
    while (true) {
      if (visited.has(url.href)) return failed("malformed_response");
      visited.add(url.href);
      const responseResult = await this.#fetchResponse(url, accept, tokenResult.value);
      if (!responseResult.ok) return responseResult;
      const response = responseResult.value;
      let page: readonly T[];
      try {
        page = await parsePage(response);
      } catch {
        return failed("malformed_response", response.status);
      }
      combined.push(...page);
      const next = nextPageUrl(response.headers.get("Link"));
      if (next === "invalid") return failed("malformed_response", response.status);
      if (next === null) return { ok: true, value: combined };
      url = next;
    }
  }

  async #installationToken(repository: GitHubRepository): Promise<GitHubResult<string>> {
    let response: Response;
    try {
      response = await this.#fetch(`${API_ROOT}/app/installations/${encodeURIComponent(String(repository.installationId))}/access_tokens`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt(this.#appId, this.#privateKey, this.#now())}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": API_VERSION,
        },
        body: JSON.stringify({
          repository_ids: [repository.id],
          permissions: { contents: "read", metadata: "read" },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return failed("unavailable");
    }
    if (!response.ok) return failed(failureForStatus(response.status), response.status);
    try {
      const body: unknown = await response.json();
      if (!isObject(body) || typeof body.token !== "string" || body.token.length === 0) {
        return failed("malformed_response", response.status);
      }
      return { ok: true, value: body.token };
    } catch {
      return failed("malformed_response", response.status);
    }
  }

  async listBranches(repository: GitHubRepository): Promise<GitHubResult<readonly GitHubBranch[]>> {
    const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/branches?per_page=100`;
    return this.#paginatedRead(repository, path, "application/vnd.github+json", async (response) => {
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("invalid response");
      return body.map((item): GitHubBranch => {
        if (!isObject(item) || typeof item.name !== "string" || !isObject(item.commit) || typeof item.commit.sha !== "string") {
          throw new Error("invalid response");
        }
        return { name: item.name, sha: item.commit.sha };
      });
    });
  }

  async getRepositoryDefaultBranch(repository: GitHubRepository): Promise<GitHubResult<string>> {
    return this.#singleRead(repository, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      "application/vnd.github+json", async (response) => {
        const body: unknown = await response.json();
        if (!isObject(body) || typeof body.default_branch !== "string" || !body.default_branch) throw new Error("invalid response");
        return body.default_branch;
      });
  }

  async getCommitAuthor(repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubUser>> {
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) return failed("invalid_request");
    return this.#singleRead(repository, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`,
      "application/vnd.github+json", async (response) => {
        const body: unknown = await response.json();
        if (!isObject(body) || typeof body.sha !== "string" || body.sha.toLowerCase() !== sha.toLowerCase() ||
            !isObject(body.author) || !Number.isSafeInteger(body.author.id) || typeof body.author.login !== "string") throw new Error("invalid response");
        return { id: body.author.id as number, login: body.author.login };
      });
  }

  async getCommitMetadata(repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubCommitMetadata>> {
    if (!isFullCommitSha(sha)) return failed("invalid_request");
    return this.#singleRead(repository, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`,
      "application/vnd.github+json", async (response) => {
        const body: unknown = await response.json();
        if (!isObject(body) || typeof body.sha !== "string" || body.sha.toLowerCase() !== sha.toLowerCase() || !isObject(body.commit) ||
            !isObject(body.commit.author) || typeof body.commit.author.date !== "string" || !isIsoDate(body.commit.author.date) ||
            typeof body.commit.message !== "string") throw new Error("invalid response");
        let username: string | null = null;
        if (body.author !== null && body.author !== undefined) {
          if (!isObject(body.author) || typeof body.author.login !== "string") throw new Error("invalid response");
          username = body.author.login;
        }
        return { sha: body.sha, authoredAt: new Date(body.commit.author.date).toISOString(), message: body.commit.message, author: { githubUsername: username } };
      });
  }

  async getCommitIdentity(repository: GitHubRepository, sha: string): Promise<GitHubResult<Readonly<{ sha: string; author: GitHubUser }>>> {
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) return failed("invalid_request");
    return this.#singleRead(repository, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`,
      "application/vnd.github+json", async (response) => {
        const body: unknown = await response.json();
        if (!isObject(body) || typeof body.sha !== "string" || !/^[0-9a-f]{40,64}$/i.test(body.sha) ||
            !body.sha.toLowerCase().startsWith(sha.toLowerCase()) || !isObject(body.author) ||
            !Number.isSafeInteger(body.author.id) || typeof body.author.login !== "string") throw new Error("invalid response");
        return { sha: body.sha, author: { id: body.author.id as number, login: body.author.login } };
      });
  }

  async listCommits(repository: GitHubRepository, query: CommitQuery): Promise<GitHubResult<readonly GitHubCommit[]>> {
    if (!query.author.login || !Number.isSafeInteger(query.author.id) || !isIsoDate(query.since) || !isIsoDate(query.until) || query.since > query.until || !query.branch) {
      return failed("invalid_request");
    }
    const params = new URLSearchParams({ author: query.author.login, since: query.since, until: query.until, sha: query.branch, per_page: "100" });
    const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits?${params}`;
    return this.#paginatedRead(repository, path, "application/vnd.github+json", async (response) => {
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("invalid response");
      const commits: GitHubCommit[] = [];
      for (const item of body) {
        if (!isObject(item) || typeof item.sha !== "string" || !isObject(item.commit) || !isObject(item.commit.author) ||
          typeof item.commit.author.date !== "string" || typeof item.commit.message !== "string" || !isObject(item.author) ||
          !Number.isSafeInteger(item.author.id) || typeof item.author.login !== "string") throw new Error("invalid response");
        if (item.author.id !== query.author.id) continue;
        commits.push({ sha: item.sha, message: item.commit.message, date: item.commit.author.date, authorId: item.author.id as number, authorLogin: item.author.login });
      }
      return commits;
    });
  }

  async fetchDiff(repository: GitHubRepository, sha: string): Promise<GitHubResult<string>> {
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) return failed("invalid_request");
    const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`;
    return this.#singleRead(repository, path, "application/vnd.github.diff", async (response) => response.text());
  }

  async fetchFileAtCommit(repository: GitHubRepository, path: string, commitSha: string): Promise<GitHubResult<string>> {
    if (!isRepositoryFilePath(path) || !isFullCommitSha(commitSha)) return failed("invalid_request");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const query = new URLSearchParams({ ref: commitSha });
    const endpoint = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${encodedPath}?${query}`;
    return this.#singleRead(repository, endpoint, "application/vnd.github.raw+json", async (response) => response.text());
  }

  async isAncestor(repository: GitHubRepository, ancestorSha: string, descendantSha: string): Promise<GitHubResult<boolean>> {
    if (!isFullCommitSha(ancestorSha) || !isFullCommitSha(descendantSha)) return failed("invalid_request");
    if (ancestorSha.toLowerCase() === descendantSha.toLowerCase()) return { ok: true, value: true };
    const range = `${encodeURIComponent(ancestorSha)}...${encodeURIComponent(descendantSha)}`;
    const endpoint = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/compare/${range}`;
    return this.#singleRead(repository, endpoint, "application/vnd.github+json", async (response) => {
      const body: unknown = await response.json();
      if (!isObject(body) || !["ahead", "behind", "identical", "diverged"].includes(String(body.status))) {
        throw new Error("invalid response");
      }
      return body.status === "ahead" || body.status === "identical";
    });
  }
}

export type FakeGitHubBranchesOutcome = Readonly<{ ok: true; value: readonly GitHubBranch[] }> | GitHubFailure;
export type FakeGitHubCommitsOutcome = Readonly<{ ok: true; value: readonly GitHubCommit[] }> | GitHubFailure;
export type FakeGitHubDiffOutcome = Readonly<{ ok: true; value: string }> | GitHubFailure;
export type FakeGitHubFileOutcome = Readonly<{ path: string; commitSha: string; content: string }>;
export type FakeGitHubAncestryOutcome = GitHubCommitAncestry;

export type FakeGitHubScript = Readonly<{
  branches?: FakeGitHubBranchesOutcome;
  commits?: FakeGitHubCommitsOutcome;
  commitMetadata?: Readonly<Record<string, GitHubResult<GitHubCommitMetadata>>>;
  diff?: FakeGitHubDiffOutcome;
  files?: readonly FakeGitHubFileOutcome[];
  ancestry?: readonly FakeGitHubAncestryOutcome[];
}>;

export class FakeGitHubAdapter implements GitHubEvidenceAdapter {
  readonly #script: FakeGitHubScript;

  constructor(script: FakeGitHubScript = {}) {
    this.#script = script;
  }

  async getRepositoryDefaultBranch(): Promise<GitHubResult<string>> { return { ok: true, value: "main" }; }

  async getCommitAuthor(_repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubUser>> {
    const commit = this.#script.commits?.ok ? this.#script.commits.value.find((item) => item.sha === sha) : undefined;
    return commit ? { ok: true, value: { id: commit.authorId, login: commit.authorLogin } } : failed("not_found");
  }

  async getCommitMetadata(_repository: GitHubRepository, sha: string): Promise<GitHubResult<GitHubCommitMetadata>> {
    return this.#script.commitMetadata?.[sha] ?? failed("not_found");
  }

  async getCommitIdentity(_repository: GitHubRepository, sha: string): Promise<GitHubResult<Readonly<{ sha: string; author: GitHubUser }>>> {
    const commit = this.#script.commits?.ok ? this.#script.commits.value.find((item) => item.sha.toLowerCase().startsWith(sha.toLowerCase())) : undefined;
    return commit ? { ok: true, value: { sha: commit.sha, author: { id: commit.authorId, login: commit.authorLogin } } } : failed("not_found");
  }

  async listBranches(): Promise<GitHubResult<readonly GitHubBranch[]>> {
    return this.#script.branches ?? { ok: true, value: [] };
  }

  async listCommits(): Promise<GitHubResult<readonly GitHubCommit[]>> {
    return this.#script.commits ?? { ok: true, value: [] };
  }

  async fetchDiff(): Promise<GitHubResult<string>> {
    return this.#script.diff ?? { ok: true, value: "" };
  }

  async fetchFileAtCommit(_repository: GitHubRepository, path: string, commitSha: string): Promise<GitHubResult<string>> {
    const file = this.#script.files?.find((item) => item.path === path && item.commitSha.toLowerCase() === commitSha.toLowerCase());
    return file ? { ok: true, value: file.content } : failed("not_found");
  }

  async isAncestor(_repository: GitHubRepository, ancestorSha: string, descendantSha: string): Promise<GitHubResult<boolean>> {
    if (ancestorSha.toLowerCase() === descendantSha.toLowerCase()) return { ok: true, value: true };
    const relation = this.#script.ancestry?.find((item) =>
      item.ancestorSha.toLowerCase() === ancestorSha.toLowerCase() &&
      item.descendantSha.toLowerCase() === descendantSha.toLowerCase());
    return relation ? { ok: true, value: relation.isAncestor } : failed("unavailable");
  }
}
