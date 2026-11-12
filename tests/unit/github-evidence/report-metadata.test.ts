import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createReportGithubMetadata } from "@/server/github-evidence";

const repository = { repositoryId: 41, installationId: 9, owner: "synthetic", name: "repo" };
const sha = "a".repeat(40);
const commit = { sha, authoredAt: "2026-11-09T15:30:00.000Z", message: "Synthetic commit", author: { githubUsername: "synthetic-developer" } };

describe("public report GitHub metadata port (8.1 D4/D7)", () => {
  it("reads only attached SHAs, deduplicates fetches and maps the trusted binding", async () => {
    const getCommitMetadata = vi.fn(async () => ({ ok: true as const, value: commit }));
    const port = createReportGithubMetadata({ adapter: { getCommitMetadata } });
    expect(await port.readBySha({ repository, shas: [sha, sha] })).toEqual({ kind: "available", commits: [commit] });
    expect(getCommitMetadata).toHaveBeenCalledExactlyOnceWith({ id: 41, installationId: 9, owner: "synthetic", name: "repo" }, sha);
  });
  it("does not call GitHub for an empty SHA list", async () => {
    const getCommitMetadata = vi.fn();
    const port = createReportGithubMetadata({ adapter: { getCommitMetadata } });
    expect(await port.readBySha({ repository, shas: [] })).toEqual({ kind: "available", commits: [] });
    expect(getCommitMetadata).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "forbidden", "not_found"] as const)("maps %s to unavailable without exposing provider details", async (category) => {
    const getCommitMetadata = vi.fn(async () => ({ ok: false as const, category, status: 503 }));
    const port = createReportGithubMetadata({ adapter: { getCommitMetadata } });
    expect(await port.readBySha({ repository, shas: [sha] })).toEqual({ kind: "unavailable" });
  });
  it("maps a thrown upstream error to unavailable", async () => {
    const getCommitMetadata = vi.fn(async () => { throw new Error("synthetic raw upstream failure"); });
    const port = createReportGithubMetadata({ adapter: { getCommitMetadata } });
    expect(await port.readBySha({ repository, shas: [sha] })).toEqual({ kind: "unavailable" });
  });
  it("retains successful metadata with an unavailable marker after a partial failure", async () => {
    const otherSha = "b".repeat(40);
    const getCommitMetadata = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: commit })
      .mockResolvedValueOnce({ ok: false, category: "unavailable", status: 503 });
    const port = createReportGithubMetadata({ adapter: { getCommitMetadata } });
    expect(await port.readBySha({ repository, shas: [sha, otherSha] })).toEqual({ kind: "unavailable", commits: [commit] });
  });
});
