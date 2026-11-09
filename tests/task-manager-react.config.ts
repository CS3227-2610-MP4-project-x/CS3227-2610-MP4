import { defineConfig } from "vitest/config";

// Run explicitly with npx vitest run --config tests/task-manager-react.config.ts.
// Requires the Playwright Chromium installation; ordinary unit CI needs no browser.
export default defineConfig({
  test: { environment: "node", include: ["tests/component/task-manager-react.test.ts"] },
});
