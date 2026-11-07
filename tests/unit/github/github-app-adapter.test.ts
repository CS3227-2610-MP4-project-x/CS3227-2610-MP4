import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FakeGitHubAdapter,
  GitHubAppAdapter,
  type CommitQuery,
  type GitHubEvidenceAdapter,
  type GitHubRepository,
} from "../../../src/server/github";

vi.mock("server-only", () => ({}));

// Task 5.2: github-evidence requirements "GitHub access tokens are not exposed
// or persisted", "Assigned developers can choose branches and list their own
// commits", and "Unavailable evidence is reported distinctly"; design E10/D-H.
// All credentials and provider responses are synthetic; no network requests run.
const repository: GitHubRepository = { id: 123, installationId: 456, owner: "sample", name: "project" };
const query: CommitQuery = {
  author: { id: 789, login: "developer" },
  since: "2026-11-03T00:00:00Z",
  until: "2026-11-03T23:59:59Z",
  branch: "feature/a & b",
};
const TOKEN = "synthetic-installation-token-do-not-leak";
const PROVIDER_ERROR = "synthetic-provider-detail-do-not-leak";
const ANCESTOR_SHA = "a".repeat(40);
const MIDDLE_SHA = "b".repeat(40);
const TIP_SHA = "c".repeat(40);
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function harness(response: () => Response | Promise<Response> = () => json([])) {
  const fetchStub = vi.fn<typeof fetch>(async (input) => {
    if (String(input).endsWith("/access_tokens")) {
      return json({ token: TOKEN, expires_at: "2026-11-03T01:00:00Z" }, 201);
    }
    return response();
  });
  const adapter = new GitHubAppAdapter({
    appId: "1234", privateKey, fetch: fetchStub, now: () => Date.parse("2026-11-03T00:00:00Z"),
  });
  return { adapter, fetchStub };
}

function commit(id = query.author.id, login = query.author.login) {
  return {
    sha: "abcdef1234567", author: { id, login },
    commit: { message: "Synthetic change", author: { date: query.since } },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("repository-scoped installation access", () => {
  it("mints only for the linked repository with read-only contents and metadata", async () => {
    const { adapter, fetchStub } = harness();
    expect(await adapter.listBranches(repository)).toEqual({ ok: true, value: [] });
    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/app/installations/456/access_tokens");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      repository_ids: [123], permissions: { contents: "read", metadata: "read" },
    });
    const authorization = new Headers(init?.headers).get("authorization");
    expect(authorization).toMatch(/^Bearer /);
    const jwt = authorization!.slice("Bearer ".length).split(".");
    const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
    expect(claims.iss).toBe("1234");
    expect(claims.exp).toBeGreaterThan(Date.parse("2026-11-03T00:00:00Z") / 1000);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(new Headers(fetchStub.mock.calls[1][1]?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("scopes a second repository read to that repository, without returning credentials", async () => {
    const { adapter, fetchStub } = harness();
    const first = await adapter.listBranches(repository);
    const second = await adapter.listBranches({ ...repository, id: 124, name: "another" });
    const mintBodies = fetchStub.mock.calls.filter(([url]) => String(url).endsWith("/access_tokens"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(mintBodies).toEqual([
      { repository_ids: [123], permissions: { contents: "read", metadata: "read" } },
      { repository_ids: [124], permissions: { contents: "read", metadata: "read" } },
    ]);
    expect(JSON.stringify([first, second])).not.toContain(TOKEN);
    expect(JSON.stringify([first, second])).not.toContain(privateKey);
  });
});

describe("repository evidence", () => {
  it("uses the approved GitHub API version for token minting and every evidence operation", async () => {
    const { adapter, fetchStub } = harness(() => json([]));
    await adapter.listBranches(repository);
    await adapter.listCommits(repository, query);
    await adapter.fetchDiff(repository, "abcdef1234567");
    expect(fetchStub.mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const [, init] of fetchStub.mock.calls) {
      expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe("2026-03-10");
    }
  });

  it("includes branches beyond page one by following the provider's next-page link", async () => {
    const nextUrl = "https://api.github.com/repos/sample/project/branches?per_page=100&page=2";
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
      if (new URL(String(input)).searchParams.get("page") === "2") {
        return json([{ name: "later-branch", commit: { sha: "abcdef2" } }]);
      }
      const response = json([{ name: "main", commit: { sha: "abcdef1" } }]);
      response.headers.set("Link", `<${nextUrl}>; rel="next", <${nextUrl}>; rel="last"`);
      return response;
    });
    const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
    expect(await adapter.listBranches(repository)).toEqual({ ok: true, value: [
      { name: "main", sha: "abcdef1" }, { name: "later-branch", sha: "abcdef2" },
    ] });
    expect(fetchStub.mock.calls.some(([input]) => String(input) === nextUrl)).toBe(true);
  });

  it("includes commits beyond page one while preserving the verified author/date/branch filters", async () => {
    const params = new URLSearchParams({
      author: query.author.login, since: query.since, until: query.until,
      sha: query.branch, per_page: "100", page: "2",
    });
    const nextUrl = `https://api.github.com/repos/sample/project/commits?${params}`;
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
      if (new URL(String(input)).searchParams.get("page") === "2") {
        return json([{ ...commit(), sha: "abcdef2" }, commit(999)]);
      }
      const response = json([{ ...commit(), sha: "abcdef1" }]);
      response.headers.set("Link", `<${nextUrl}>; rel="next"`);
      return response;
    });
    const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
    const result = await adapter.listCommits(repository, query);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected paginated evidence");
    expect(result.value.map(({ sha }) => sha)).toEqual(["abcdef1", "abcdef2"]);
    expect(result.value.every(({ authorId }) => authorId === query.author.id)).toBe(true);
    const reads = fetchStub.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/commits"));
    expect(reads).toHaveLength(2);
    for (const [input] of reads) {
      const url = new URL(String(input));
      expect(url.searchParams.get("author")).toBe(query.author.login);
      expect(url.searchParams.get("since")).toBe(query.since);
      expect(url.searchParams.get("until")).toBe(query.until);
      expect(url.searchParams.get("sha")).toBe(query.branch);
    }
  });

  it("lists branch names and commit SHAs", async () => {
    const { adapter, fetchStub } = harness(() => json([
      { name: "main", commit: { sha: "abcdef1" } }, { name: "feature/one", commit: { sha: "abcdef2" } },
    ]));
    expect(await adapter.listBranches(repository)).toEqual({ ok: true, value: [
      { name: "main", sha: "abcdef1" }, { name: "feature/one", sha: "abcdef2" },
    ] });
    expect(new URL(String(fetchStub.mock.calls[1][0])).pathname).toBe("/repos/sample/project/branches");
  });

  it("sends the verified author, date range and branch as independent query parameters", async () => {
    const { adapter, fetchStub } = harness(() => json([commit()]));
    expect(await adapter.listCommits(repository, query)).toEqual({ ok: true, value: [{
      sha: "abcdef1234567", message: "Synthetic change", authorId: 789, authorLogin: "developer", date: query.since,
    }] });
    const url = new URL(String(fetchStub.mock.calls[1][0]));
    expect(url.pathname).toBe("/repos/sample/project/commits");
    expect(url.searchParams.get("author")).toBe(query.author.login);
    expect(url.searchParams.get("since")).toBe(query.since);
    expect(url.searchParams.get("until")).toBe(query.until);
    expect(url.searchParams.get("sha")).toBe(query.branch);
  });

  it("checks stable author identity even when another author has the same login", async () => {
    const { adapter } = harness(() => json([commit(999), commit(789, "renamed-developer")]));
    const result = await adapter.listCommits(repository, query);
    expect(result).toMatchObject({ ok: true, value: [{ authorId: 789, authorLogin: "renamed-developer" }] });
    if (!result.ok) throw new Error("Expected evidence");
    expect(result.value).toHaveLength(1);
  });

  it("keeps a successful empty commit list distinct from unavailable evidence", async () => {
    const { adapter } = harness(() => json([]));
    expect(await adapter.listCommits(repository, query)).toEqual({ ok: true, value: [] });
  });

  it("fetches the selected commit as a diff", async () => {
    const diff = "diff --git a/file b/file\n+synthetic change\n";
    const { adapter, fetchStub } = harness(() => new Response(diff));
    expect(await adapter.fetchDiff(repository, "abcdef1234567")).toEqual({ ok: true, value: diff });
    const [url, init] = fetchStub.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe("/repos/sample/project/commits/abcdef1234567");
    expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github.diff");
  });
});

// Group 7: completion-assessment requirements "Check input is limited to what
// the assessment needs" and "Developer runs an acceptance criteria check".
// These adapter tests establish immutable config reads and pairwise ancestry;
// selected-set tip resolution belongs to the check-service tests.
describe("immutable repository file evidence", () => {
  it("reads the root configuration as raw text at the supplied immutable SHA", async () => {
    const content = '{"version":1,"domainLogic":["core/"]}';
    const { adapter, fetchStub } = harness(() => new Response(content));
    expect(await adapter.fetchFileAtCommit(repository, ".acceptance-check.json", TIP_SHA))
      .toEqual({ ok: true, value: content });
    const [input, init] = fetchStub.mock.calls[1];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/repos/sample/project/contents/.acceptance-check.json");
    expect([...url.searchParams.entries()]).toEqual([["ref", TIP_SHA]]);
    expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github.raw+json");
    expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe("2026-03-10");
  });

  it("encodes path segments without treating path characters as query parameters", async () => {
    const { adapter, fetchStub } = harness(() => new Response("synthetic file"));
    await adapter.fetchFileAtCommit(repository, "policy files/rules?#.json", TIP_SHA);
    const url = new URL(String(fetchStub.mock.calls[1][0]));
    expect(url.pathname).toBe("/repos/sample/project/contents/policy%20files/rules%3F%23.json");
    expect([...url.searchParams.entries()]).toEqual([["ref", TIP_SHA]]);
    expect(url.hash).toBe("");
  });

  it.each(["main", "abcdef1", "", "x".repeat(40)])("refuses non-immutable ref %j before network access", async (ref) => {
    const { adapter, fetchStub } = harness();
    expect(await adapter.fetchFileAtCommit(repository, ".acceptance-check.json", ref))
      .toEqual({ ok: false, category: "invalid_request" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it.each(["", "/absolute.json", "../outside.json", "config/../rules.json", "config\\rules.json"])
    ("refuses non-repository file path %j before network access", async (path) => {
      const { adapter, fetchStub } = harness();
      expect(await adapter.fetchFileAtCommit(repository, path, TIP_SHA))
        .toEqual({ ok: false, category: "invalid_request" });
      expect(fetchStub).not.toHaveBeenCalled();
    });

  it("keeps a successfully read empty file distinct from unavailable evidence", async () => {
    const { adapter } = harness(() => new Response(""));
    expect(await adapter.fetchFileAtCommit(repository, ".acceptance-check.json", TIP_SHA))
      .toEqual({ ok: true, value: "" });
  });
});

describe("commit ancestry evidence", () => {
  it.each([
    ["ahead", true], ["identical", true], ["behind", false], ["diverged", false],
  ] as const)("maps compare status %s to ancestor=%s", async (status, isAncestor) => {
    const { adapter, fetchStub } = harness(() => json({ status }));
    expect(await adapter.isAncestor(repository, ANCESTOR_SHA, TIP_SHA)).toEqual({ ok: true, value: isAncestor });
    const [input, init] = fetchStub.mock.calls[1];
    expect(new URL(String(input)).pathname)
      .toBe(`/repos/sample/project/compare/${ANCESTOR_SHA}...${TIP_SHA}`);
    expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github+json");
    expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe("2026-03-10");
  });

  it("provides the directed relations needed for a selected chain's descendant tip", async () => {
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
      const range = new URL(String(input)).pathname.split("/").at(-1);
      const relations: Record<string, string> = {
        [`${ANCESTOR_SHA}...${MIDDLE_SHA}`]: "ahead",
        [`${MIDDLE_SHA}...${TIP_SHA}`]: "ahead",
        [`${ANCESTOR_SHA}...${TIP_SHA}`]: "ahead",
        [`${TIP_SHA}...${MIDDLE_SHA}`]: "behind",
      };
      return json({ status: relations[range ?? ""] });
    });
    const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
    for (const ancestor of [ANCESTOR_SHA, MIDDLE_SHA]) {
      expect(await adapter.isAncestor(repository, ancestor, TIP_SHA)).toEqual({ ok: true, value: true });
    }
    expect(await adapter.isAncestor(repository, ANCESTOR_SHA, MIDDLE_SHA)).toEqual({ ok: true, value: true });
    expect(await adapter.isAncestor(repository, TIP_SHA, MIDDLE_SHA)).toEqual({ ok: true, value: false });
  });

  it("reports both directions false for incomparable selected tips", async () => {
    const { adapter } = harness(() => json({ status: "diverged" }));
    expect(await adapter.isAncestor(repository, MIDDLE_SHA, TIP_SHA)).toEqual({ ok: true, value: false });
    expect(await adapter.isAncestor(repository, TIP_SHA, MIDDLE_SHA)).toEqual({ ok: true, value: false });
  });

  it("recognizes identical SHAs without requiring GitHub availability", async () => {
    const { adapter, fetchStub } = harness();
    expect(await adapter.isAncestor(repository, ANCESTOR_SHA, ANCESTOR_SHA.toUpperCase()))
      .toEqual({ ok: true, value: true });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it.each([{}, null, [], { status: "unknown" }, { status: 123 }])
    ("rejects malformed compare evidence %j", async (body) => {
      const { adapter } = harness(() => json(body));
      expect(await adapter.isAncestor(repository, ANCESTOR_SHA, TIP_SHA))
        .toEqual({ ok: false, category: "malformed_response", status: 200 });
    });

  it("rejects a non-JSON compare response", async () => {
    const { adapter } = harness(() => new Response("not JSON"));
    expect(await adapter.isAncestor(repository, ANCESTOR_SHA, TIP_SHA))
      .toEqual({ ok: false, category: "malformed_response", status: 200 });
  });

  it.each([["main", TIP_SHA], [ANCESTOR_SHA, "abcdef1"]])
    ("refuses invalid comparison refs %s and %s before network access", async (ancestor, descendant) => {
      const { adapter, fetchStub } = harness();
      expect(await adapter.isAncestor(repository, ancestor, descendant)).toEqual({ ok: false, category: "invalid_request" });
      expect(fetchStub).not.toHaveBeenCalled();
    });
});

describe("safe provider failures", () => {
  const statuses = [
    [401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [429, "rate_limited"], [503, "unavailable"],
  ] as const;
  const operations = ["listBranches", "listCommits", "fetchDiff", "fetchFileAtCommit", "isAncestor"] as const;

  for (const operation of operations) {
    for (const phase of ["mint", "read"] as const) {
      it.each(statuses)(`${operation}: ${phase} HTTP %i returns only safe failure metadata`, async (status, category) => {
        const fetchStub = vi.fn<typeof fetch>(async (input) => {
          if (phase === "read" && String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
          return json({ message: `${PROVIDER_ERROR} ${TOKEN}` }, status);
        });
        const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const result = operation === "listBranches" ? await adapter.listBranches(repository)
          : operation === "listCommits" ? await adapter.listCommits(repository, query)
          : operation === "fetchDiff" ? await adapter.fetchDiff(repository, "abcdef1234567")
          : operation === "fetchFileAtCommit" ? await adapter.fetchFileAtCommit(repository, ".acceptance-check.json", TIP_SHA)
          : await adapter.isAncestor(repository, ANCESTOR_SHA, TIP_SHA);
        expect(result).toEqual({ ok: false, category, status });
        expect(JSON.stringify(result)).not.toContain(PROVIDER_ERROR);
        expect(JSON.stringify(result)).not.toContain(TOKEN);
        expect(JSON.stringify(result)).not.toContain(privateKey);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(fetchStub).toHaveBeenCalledTimes(phase === "mint" ? 1 : 2);
      });
    }
  }

  it.each(["mint", "read"])("handles %s network failures without exposing thrown details", async (phase) => {
    const fetchStub = vi.fn<typeof fetch>(async (input) => {
      if (phase === "read" && String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
      throw new Error(`${PROVIDER_ERROR} ${TOKEN}`);
    });
    const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
    expect(await adapter.listBranches(repository)).toEqual({ ok: false, category: "unavailable" });
  });

  for (const operation of ["fetchFileAtCommit", "isAncestor"] as const) {
    it.each(["mint", "read"])(`${operation}: handles %s network failure without returning provider details`, async (phase) => {
      const fetchStub = vi.fn<typeof fetch>(async (input) => {
        if (phase === "read" && String(input).endsWith("/access_tokens")) return json({ token: TOKEN }, 201);
        throw new Error(`${PROVIDER_ERROR} ${TOKEN}`);
      });
      const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
      const result = operation === "fetchFileAtCommit"
        ? await adapter.fetchFileAtCommit(repository, ".acceptance-check.json", TIP_SHA)
        : await adapter.isAncestor(repository, ANCESTOR_SHA, TIP_SHA);
      expect(result).toEqual({ ok: false, category: "unavailable" });
      expect(fetchStub).toHaveBeenCalledTimes(phase === "mint" ? 1 : 2);
    });
  }

  it("reports malformed branch data as unavailable evidence rather than an empty list", async () => {
    const { adapter } = harness(() => json({ message: PROVIDER_ERROR }));
    expect(await adapter.listBranches(repository)).toEqual({ ok: false, category: "malformed_response", status: 200 });
  });

  it("never sends a repository read after a malformed token response", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => json({ message: PROVIDER_ERROR }, 201));
    const adapter = new GitHubAppAdapter({ appId: "1234", privateKey, fetch: fetchStub });
    expect(await adapter.listBranches(repository)).toEqual({ ok: false, category: "malformed_response", status: 201 });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe("deterministic GitHub fake", () => {
  it("provides deterministic empty success through the common port without network access", async () => {
    const fetchStub = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
    const first: GitHubEvidenceAdapter = new FakeGitHubAdapter();
    const second: GitHubEvidenceAdapter = new FakeGitHubAdapter();
    for (let i = 0; i < 2; i++) {
      expect(await first.listBranches(repository)).toEqual(await second.listBranches(repository));
      expect(await first.listCommits(repository, query)).toEqual({ ok: true, value: [] });
      expect(await first.fetchDiff(repository, "abcdef1234567")).toEqual({ ok: true, value: "" });
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("repeats configured evidence and safe failures independently for each operation", async () => {
    const branches = { ok: true, value: [{ name: "main", sha: "abcdef1" }] } as const;
    const commits = { ok: false, category: "rate_limited", status: 429 } as const;
    const diff = { ok: true, value: "synthetic diff" } as const;
    const adapter: GitHubEvidenceAdapter = new FakeGitHubAdapter({ branches, commits, diff });
    for (let i = 0; i < 2; i++) {
      expect(await adapter.listBranches(repository)).toEqual(branches);
      expect(await adapter.listCommits(repository, query)).toEqual(commits);
      expect(await adapter.fetchDiff(repository, "abcdef1234567")).toEqual(diff);
    }
  });
});
