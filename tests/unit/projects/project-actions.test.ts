import { describe, expect, it, vi } from "vitest";

// Task 4.5 D1/D5/D6: existing mutation routes only, exact payloads and no retry.
import { createProject, addProjectMember, transferProjectManager } from "@/components/projects";

const projectId = "51000000-0000-4000-8000-000000000001";
const actions = [
  { name: "create", url: "/api/v1/projects", payload: { key: "web", name: " Synthetic project " },
    run: (request: typeof fetch) => createProject({ key: "web", name: " Synthetic project " }, request) },
  { name: "add", url: `/api/v1/projects/${projectId}/members`, payload: { githubUsername: "Synthetic-Dev" },
    run: (request: typeof fetch) => addProjectMember(projectId, "Synthetic-Dev", request) },
  { name: "transfer", url: `/api/v1/projects/${projectId}/product-manager-transfer`, payload: { githubUsername: "Synthetic-Dev" },
    run: (request: typeof fetch) => transferProjectManager(projectId, "Synthetic-Dev", request) },
];

describe.each(actions)("$name project request", ({ url, payload, run }) => {
  it("sends one JSON POST with only the approved fields and returns the response", async () => {
    const response = new Response("{}", { status: 201 });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(await run(request)).toBe(response);
    expect(request).toHaveBeenCalledTimes(1);
    const [destination, options] = request.mock.calls[0];
    expect(destination).toBe(url);
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("content-type")).toMatch(/^application\/json(?:;|$)/i);
    expect(JSON.parse(String(options?.body))).toEqual(payload);
  });

  it.each([400, 401, 403, 404, 409, 429, 500, 503])("returns HTTP %s without repeating the write", async (status) => {
    const response = new Response("{}", { status });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(await run(request)).toBe(response);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("propagates a network rejection to the form without retrying", async () => {
    const failure = new Error("synthetic-network-failure");
    const request = vi.fn<typeof fetch>().mockRejectedValue(failure);
    await expect(run(request)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
