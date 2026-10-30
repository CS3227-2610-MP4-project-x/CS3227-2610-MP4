import { defineConfig } from "vitest/config";

// Two separate configurations selected by Vitest's mode:
// - `npm test` (default mode): unit tests only; needs no database.
// - `npm run test:integration` (`--mode integration`): PostgreSQL integration tests in
//   tests/integration/db against the disposable database in TEST_DATABASE_URL (design D-K).
export default defineConfig(({ mode }) =>
  mode === "integration"
    ? {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/db/**/*.{test,spec}.ts"],
          clearMocks: true,
          // Test files share cluster-wide roles, so they run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 300_000,
        },
      }
    : {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.{test,spec}.{js,ts,jsx,tsx}"],
          clearMocks: true,
        },
      },
);
