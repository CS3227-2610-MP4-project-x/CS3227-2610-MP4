import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/component/developer-dashboard-react.test.ts"] } });
