import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  root: path("../../../"), cacheDir: "/tmp/developer-dashboard-visual-vite", server: { host: "127.0.0.1", port: 4175 },
  resolve: { alias: { "@": path("../../../src"), "next/navigation": path("./router.ts"), "next/link": path("./link.tsx"), "next/image": path("./image.tsx") } },
  oxc: { jsx: { runtime: "automatic" } },
  plugins: [{ name: "dashboard-visual-fixture", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?")[0];
      if (pathname !== "/" && !pathname?.startsWith("/projects/")) return next();
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/fixtures/developer-dashboard-react/main.tsx"></script></body></html>');
    });
  } }],
});
