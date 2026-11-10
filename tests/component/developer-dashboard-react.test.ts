import { fileURLToPath } from "node:url";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, it } from "vitest";
const root = fileURLToPath(new URL("../../", import.meta.url));
let server: ViteDevServer; let browser: Browser; let baseUrl: string;
beforeAll(async () => {
  const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/developer-dashboard-react/${name}`, import.meta.url));
  server = await createServer({ configFile: false, root, logLevel: "error", cacheDir: "/tmp/developer-dashboard-vite", resolve: { alias: {
    "@": `${root}src`, "next/navigation": fixture("router.ts"), "next/link": fixture("link.tsx"), "next/image": fixture("image.tsx"),
  } }, server: { host: "127.0.0.1", port: 0 }, oxc: { jsx: { runtime: "automatic" } }, plugins: [{ name: "synthetic-dashboard", configureServer(devServer) {
    devServer.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?")[0];
      if (pathname !== "/" && !pathname?.startsWith("/projects/")) return next();
      response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/developer-dashboard-react/main.tsx"></script></body></html>');
    });
  } }] });
  await server.listen(); baseUrl = server.resolvedUrls!.local[0]; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); await server?.close(); });
it("real React filters own rows and restores All without changing global progress", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl);
    await browserExpect(page.getByText("Synthetic To Do task", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^In Review/ }).click();
    await browserExpect(page.getByText("Synthetic In Review task", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Synthetic To Do task", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuenow", "50");
    await page.getByRole("button", { name: /^All/ }).click();
    await browserExpect(page.getByText("Synthetic To Do task", { exact: true })).toBeVisible();
  } finally { await page.close(); }
});
it("empty assignments render a clear successful empty state", async () => {
  const page = await browser.newPage();
  try { await page.goto(`${baseUrl}?empty=1`); await browserExpect(page.getByText(/no .*tasks|no tasks/i).first()).toBeVisible(); }
  finally { await page.close(); }
});

const alpha = "47000000-0000-4000-8000-000000000001";
const beta = "49000000-0000-4000-8000-000000000002";
const preferenceName = "no-pressure-project-syntheticaccount";
it("remembers an authorized project, persists a switched project and keeps its destination on reload", async () => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}projects/${alpha}/dashboard`);
    await browserExpect.poll(async () => (await context.cookies()).find(cookie => cookie.name === preferenceName)?.value).toBe(alpha);
    await page.locator("summary").filter({ hasText: "Synthetic Alpha" }).click();
    await page.getByRole("link", { name: /Synthetic Beta/ }).click();
    await browserExpect(page).toHaveURL(`${baseUrl}projects/${beta}/dashboard`);
    await browserExpect.poll(async () => (await context.cookies()).find(cookie => cookie.name === preferenceName)?.value).toBe(beta);
    await page.reload();
    await browserExpect(page.locator("summary").filter({ hasText: "Synthetic Beta" })).toBeVisible();
    await browserExpect.poll(async () => (await context.cookies()).find(cookie => cookie.name === preferenceName)?.value).toBe(beta);
  } finally { await context.close(); }
});
it("still switches projects when the browser rejects preference writes", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(Document.prototype, "cookie", { configurable: true, get: () => "", set: () => { throw new Error("Synthetic blocked browser preference"); } });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}projects/${alpha}/board`);
    await page.locator("summary").filter({ hasText: "Synthetic Alpha" }).click();
    await page.getByRole("link", { name: /Synthetic Beta/ }).click();
    await browserExpect(page).toHaveURL(`${baseUrl}projects/${beta}/board`);
    await browserExpect(page.locator("summary").filter({ hasText: "Synthetic Beta" })).toBeVisible();
    browserExpect((await context.cookies()).find(cookie => cookie.name === preferenceName)).toBeUndefined();
  } finally { await context.close(); }
});
it("renders the real no-membership dashboard with empty cards and prominent Create project links", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}?no-projects=1`);
    await browserExpect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "Create project" })).toHaveCount(2);
    await browserExpect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await browserExpect(page.getByText(/no tasks to show/i)).toBeVisible();
  } finally { await page.close(); }
});
