import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createProgressReportHandlers } from "@/server/progress-report";
import { ids, range } from "./generation-fixtures";

const origin = "https://synthetic.example";
const empty = { report: { kind: "empty" as const, range, statements: [] as [], githubUnavailable: false as const }, reused: false };
function setup() {
  const resolveAccess = vi.fn(async (..._args: unknown[]): Promise<{ personId: string; role: "product_manager" | "developer" } | Response> => ({ personId: ids.pm, role: "product_manager" }));
  const generate = vi.fn(async (..._args: unknown[]) => empty);
  const handlers = createProgressReportHandlers({ config: { appOrigin: origin }, resolveAccess, progressReportGenerationService: { generate } });
  return { ...handlers, resolveAccess, generate };
}
function request(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/v1/projects/${ids.project}/progress-report`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code, message: expect.any(String) } });
}

describe("8.2 D1 PM-only report HTTP contract", () => {
  it.each([{}, { startDate: range.startDate, endDate: range.endDate }])("accepts exact request %j and returns the DTO", async (body) => {
    const f = setup();
    const response = await f.postProgressReport(request(body), { projectId: ids.project });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(empty);
    expect(f.generate).toHaveBeenCalledWith({ projectId: ids.project, personId: ids.pm, ...body });
  });

  it("refuses wrong Origin before malformed body and session", async () => {
    const f = setup();
    const response = await f.postProgressReport(request({ extra: true }, { Origin: "https://foreign.example" }), { projectId: ids.project });
    await error(response, 403, "FORBIDDEN");
    expect(f.resolveAccess).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each([
    ["array body", []], ["null body", null], ["extra field", { force: true }],
    ["partial range", { startDate: range.startDate }],
    ["non-string dates", { startDate: 1, endDate: 2 }],
    ["impossible date", { startDate: "2026-02-30", endDate: "2026-03-01" }],
    ["reversed range", { startDate: "2026-11-10", endDate: "2026-11-09" }],
  ])("refuses %s before resolving a session", async (_name, body) => {
    const f = setup();
    await error(await f.postProgressReport(request(body), { projectId: ids.project }), 400, "INVALID_REQUEST");
    expect(f.resolveAccess).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("refuses non-JSON content before session", async () => {
    const f = setup();
    await error(await f.postProgressReport(request({}, { "Content-Type": "text/plain" }), { projectId: ids.project }), 400, "INVALID_REQUEST");
    expect(f.resolveAccess).not.toHaveBeenCalled();
  });

  it("refuses invalid UUID before session", async () => {
    const f = setup();
    await error(await f.postProgressReport(request(), { projectId: "not-a-uuid" }), 400, "INVALID_REQUEST");
    expect(f.resolveAccess).not.toHaveBeenCalled();
  });

  it.each([[401, "UNAUTHENTICATED"], [404, "NOT_FOUND"]] as const)("passes safe %s access refusal without generation", async (status, code) => {
    const f = setup();
    f.resolveAccess.mockResolvedValue(Response.json({ error: { code, message: "Safe refusal" } }, { status, headers: { "Cache-Control": "no-store" } }));
    await error(await f.postProgressReport(request(), { projectId: ids.project }), status, code);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("developer membership is forbidden before generation", async () => {
    const f = setup();
    f.resolveAccess.mockResolvedValue({ personId: ids.developer, role: "developer" });
    await error(await f.postProgressReport(request(), { projectId: ids.project }), 403, "FORBIDDEN");
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each([
    ["REPORT_RANGE_TOO_LONG", 400], ["REPORT_INPUT_BUDGET_EXCEEDED", 400], ["REPORT_INPUT_CHANGED", 409],
    ["INVALID_OUTPUT", 502], ["AI_UNAVAILABLE", 503], ["AI_ERROR", 502], ["RATE_LIMITED", 429],
  ] as const)("maps %s with a safe no-store response", async (code, status) => {
    const f = setup();
    f.generate.mockRejectedValue(Object.assign(new Error("RAW_PROVIDER_DETAILS"), { code }));
    const response = await f.postProgressReport(request(), { projectId: ids.project });
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ error: { code, message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("RAW_PROVIDER_DETAILS");
  });

  it("unexpected exceptions do not expose raw details", async () => {
    const f = setup();
    f.generate.mockRejectedValue(new Error("PRIVATE_STACK_AND_PROVIDER_BODY"));
    const response = await f.postProgressReport(request(), { projectId: ids.project });
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_STACK_AND_PROVIDER_BODY");
  });

  it("preserves the quota reset timestamp in the safe 429 envelope", async () => {
    const f = setup();
    const resetsAt = "2026-11-09T16:00:00.000Z";
    f.generate.mockRejectedValue(Object.assign(new Error("RAW_QUOTA_DETAILS"), { code: "QUOTA_EXCEEDED", resetsAt }));
    const response = await f.postProgressReport(request(), { projectId: ids.project });
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "QUOTA_EXCEEDED", message: expect.any(String), resetsAt } });
    expect(JSON.stringify(body)).not.toContain("RAW_QUOTA_DETAILS");
  });
});
