import { describe, expect, it, vi } from "vitest";
import { FakeAdapter, SoclaasAdapter } from "@/server/ai";

// Provider capability freshness/context/rate metadata; all HTTP calls are synthetic.
const model = "synthetic-model";
function setup() {
  let clock = 0, unavailable = false;
  let context: unknown = 262144, rate: unknown = 30;
  const fetchStub = vi.fn<typeof fetch>(async (url) => {
    if (unavailable) throw new Error("synthetic private response");
    const body = String(url).endsWith("/v1/models") ? { data: [{ id: model, context_length: context }] }
      : { policy: { requests_per_minute_limit: rate } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const adapter = new SoclaasAdapter({ apiKey: "synthetic-key", model, fetch: fetchStub, now: () => clock });
  return { adapter, fetchStub, setClock: (n: number) => { clock = n; }, fail: () => { unavailable = true; },
    metadata: (c: unknown, r: unknown) => { context = c; rate = r; } };
}
describe("provider capability metadata", () => {
  it("fetches context for the configured model and per-key request limit using server-only authentication", async () => {
    const h = setup();
    expect(await h.adapter.getCapabilities()).toEqual({ contextTokens: 262144, requestsPerMinute: 30, sharedKeyLimit: true });
    expect(h.fetchStub).toHaveBeenCalledTimes(2);
    const urls = h.fetchStub.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("https://soclaas-api.comp.nus.edu.sg/v1/models");
    expect(urls).toContain("https://soclaas-portal.comp.nus.edu.sg/api-key/budget");
    for (const [, init] of h.fetchStub.mock.calls) expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-key");
  });
  it("caches for less than 60 seconds and refreshes exactly at expiration", async () => {
    const h = setup(); await h.adapter.getCapabilities(); h.setClock(59999); await h.adapter.getCapabilities();
    expect(h.fetchStub).toHaveBeenCalledTimes(2);
    h.metadata(131072, 20); h.setClock(60000);
    expect(await h.adapter.getCapabilities()).toMatchObject({ contextTokens: 131072, requestsPerMinute: 20 });
    expect(h.fetchStub).toHaveBeenCalledTimes(4);
  });
  it("does not fall back to stale capabilities when refresh fails", async () => {
    const h = setup(); await h.adapter.getCapabilities(); h.setClock(60000); h.fail();
    await expect(h.adapter.getCapabilities()).rejects.toThrow("Provider capabilities are unavailable");
    await expect(h.adapter.getCapabilities()).rejects.toThrow("Provider capabilities are unavailable");
  });
  it.each([[0, 30], [262144, 0], [null, 30], [262144, "30"], [1.5, 30]])("rejects invalid context/rate metadata %j %j", async (context, rate) => {
    const h = setup(); h.metadata(context, rate); await expect(h.adapter.getCapabilities()).rejects.toThrow("Provider capabilities are unavailable");
  });
  it("does not share cached metadata between different adapter instances", async () => {
    const one = setup(), two = setup(); await one.adapter.getCapabilities(); two.metadata(50000, 10);
    expect(await two.adapter.getCapabilities()).toMatchObject({ contextTokens: 50000, requestsPerMinute: 10 });
    expect(two.fetchStub).toHaveBeenCalledTimes(2);
  });
  it("exposes deterministic fake capabilities without HTTP requests", async () => {
    const fake = new FakeAdapter([]); const first = await fake.getCapabilities();
    expect(first).toMatchObject({ sharedKeyLimit: false }); expect(first.contextTokens).toBeGreaterThan(48000 + 3024);
    expect(await fake.getCapabilities()).toEqual(first);
  });
});
