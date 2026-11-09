import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GitHubAppAdapter } from "@/server/github";

const repository = { id: 41, installationId: 9, owner: "synthetic", name: "repo" };
const sha = "a".repeat(40);
function harness(commitStatus = 200, commitBody: unknown = {
  sha,
  commit: { author: { date: "2026-11-09T15:30:00Z", name: "Synthetic" }, message: "Synthetic commit" },
  author: { login: "synthetic-developer" },
  files: [{ filename: "excluded.ts", patch: "EXCLUDED_PATCH" }],
}) {
  // Synthetic ephemeral signing material, generated only in memory for this test.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/app/installations/9/access_tokens")) return Response.json({ token: "synthetic-installation-token", expires_at: "2026-11-09T02:00:00Z", permissions: { contents: "read", metadata: "read" }, repository_selection: "selected", repositories: [{ id: 41, owner: { login: "synthetic" }, name: "repo" }] });
    if (url.endsWith(`/repos/synthetic/repo/commits/${sha}`)) return Response.json(commitBody, { status: commitStatus });
    throw new Error("Unexpected GitHub endpoint in metadata-only test");
  };
  const adapter = new GitHubAppAdapter({ appId: "123", privateKey, fetch: fetcher, now: () => Date.parse("2026-11-09T01:00:00Z") });
  return { adapter, calls };
}

describe("GitHub attached-SHA metadata adapter (8.1 D4/D5)", () => {
  it("fetches authored metadata with a repository-scoped read token and excludes response patches", async () => {
    const h = harness();
    const result = await h.adapter.getCommitMetadata(repository, sha);
    expect(result).toEqual({ ok: true, value: { sha, authoredAt: "2026-11-09T15:30:00.000Z", message: "Synthetic commit", author: { githubUsername: "synthetic-developer" } } });
    expect(JSON.stringify(result)).not.toContain("EXCLUDED_PATCH");
    expect(h.calls.map((call) => call.url)).toEqual([
      "https://api.github.com/app/installations/9/access_tokens",
      `https://api.github.com/repos/synthetic/repo/commits/${sha}`,
    ]);
    const scope = JSON.parse(String(h.calls[0].init?.body));
    expect(scope).toMatchObject({ repository_ids: [41], permissions: { contents: "read", metadata: "read" } });
  });
  it("allows a commit without a linked GitHub author", async () => {
    const h = harness(200, { sha, commit: { author: { date: "2026-11-09T15:30:00Z" }, message: "Synthetic commit" }, author: null });
    expect(await h.adapter.getCommitMetadata(repository, sha)).toMatchObject({ ok: true, value: { author: { githubUsername: null } } });
  });
  it.each([403, 404, 429, 500])("returns a safe unavailable result for HTTP %s", async (status) => {
    const h = harness(status, { message: "EXCLUDED_RAW_PROVIDER_ERROR" });
    const result = await h.adapter.getCommitMetadata(repository, sha);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("EXCLUDED_RAW_PROVIDER_ERROR");
    expect(JSON.stringify(result)).not.toContain("synthetic-installation-token");
  });
});
