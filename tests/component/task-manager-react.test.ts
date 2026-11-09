import { fileURLToPath } from "node:url";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

// Real React DOM and useTransition run in Chromium, without mocked React hooks.
// The router shim suspends a controlled server snapshot, preserving the old committed UI
// until completeTaskRefresh resolves it. This tests component refresh behavior, not Next/RSC transport.
const root = fileURLToPath(new URL("../../", import.meta.url));
let server: ViteDevServer;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  server = await createServer({
    configFile: false, root, logLevel: "error",
    resolve: { alias: { "next/navigation": fileURLToPath(new URL("../fixtures/task-manager-react/router.ts", import.meta.url)) } },
    cacheDir: "node_modules/.vite-task-manager-fixture",
    server: { host: "127.0.0.1", port: 0 },
    oxc: { jsx: { runtime: "automatic" } },
    plugins: [{
      name: "task-manager-router-fixture",
      configureServer(devServer) {
        devServer.middlewares.use((request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html");
          response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/task-manager-react/main.tsx"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  baseUrl = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); await server?.close(); });

async function openFixture(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  await page.goto(baseUrl);
  try { await browserExpect(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled(); }
  catch (error) { throw new Error(`Fixture failed: ${errors.join("; ")}`, { cause: error }); }
}

it.each(["Edit", "Reassign"])("%s blocks during real React refresh and uses the refreshed version next time", async action => {
  const page = await browser.newPage();
  const requests: { version: number }[] = [];
  try {
    await page.route("**/api/v1/**", async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await openFixture(page);
    await page.getByRole("button", { name: action, exact: true }).click();
    const save = action === "Edit" ? "Save task" : "Save assignment";
    await page.getByRole("button", { name: save, exact: true }).click();
    await page.waitForFunction(() => window.taskRefreshCount === 1);
    await browserExpect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Reassign", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("form")).toHaveCount(0);
    expect(requests).toEqual([{ ...requests[0], version: 7 }]);
    await browserExpect(page.getByRole("status", { name: "Server version" })).toHaveText("7");
    await page.evaluate(() => window.completeTaskRefresh({ role: "product_manager", version: 8 }));
    await browserExpect(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
    await browserExpect(page.getByRole("status", { name: "Server version" })).toHaveText("8");
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.getByRole("button", { name: save, exact: true }).click();
    await page.waitForFunction(() => window.taskRefreshCount === 2);
    expect(requests.map(request => request.version)).toEqual([7, 8]);
    await page.evaluate(() => window.completeTaskRefresh({ role: "product_manager", version: 9 }));
  } finally { await page.close(); }
}, 20_000);

it.each([403, 409])("%s blocks stale actions during refresh and applies the refreshed role", async status => {
  const page = await browser.newPage();
  let requests = 0;
  try {
    await page.route("**/api/v1/**", async route => {
      requests += 1;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code: status === 403 ? "FORBIDDEN" : "VERSION_CONFLICT" } }) });
    });
    await openFixture(page);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await page.waitForFunction(() => window.taskRefreshCount === 1);
    await browserExpect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Reassign", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("form")).toHaveCount(0);
    await page.evaluate(() => window.completeTaskRefresh({ role: "developer", version: 8 }));
    await browserExpect(page.getByText("Developer task detail")).toBeVisible();
    await browserExpect(page.getByRole("region", { name: "Task management" })).toHaveCount(0);
    expect(requests).toBe(1);
  } finally { await page.close(); }
}, 20_000);
