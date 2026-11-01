import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Task 6.1 (llm-gateway-soc-adapter). Lightweight static checks over the source files in
// src/server/ai/ for acceptance criteria AC11-AC14 in
// workflow/handoffs/llm-gateway-soc-adapter.md (decisions D3 and D7 in
// openspec/changes/project-task-management/design.md, and the AGENTS.md coupling and AI
// containment rules). These are coarse text checks; the reviewer still reads the code
// (for example, for mutable module-level objects, which a text check cannot detect).

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const aiDirectory = join(repositoryRoot, "src", "server", "ai");

function sourceFiles(): Array<{ path: string; text: string }> {
  const entries = readdirSync(aiDirectory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, text: readFileSync(path, "utf8") };
    });
}

// Removes comments so that prose mentioning, for example, "console" does not count.
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe("src/server/ai source boundaries", () => {
  it("contains the public entry point and the adapter modules", () => {
    for (const name of ["index.ts", "llm-adapter.ts", "soclaas-adapter.ts", "fake-adapter.ts"]) {
      expect(existsSync(join(aiDirectory, name)), name).toBe(true);
    }
  });

  it("reads no environment variable (AC11, D3)", () => {
    for (const file of sourceFiles()) {
      expect(withoutComments(file.text), file.path).not.toMatch(/\bprocess\s*\.\s*env\b|\bimport\.meta\.env\b/);
    }
  });

  it("does not log (AC12, D7)", () => {
    for (const file of sourceFiles()) {
      const code = withoutComments(file.text);
      expect(code, file.path).not.toMatch(/\bconsole\s*\./);
      expect(code, file.path).not.toMatch(/\b(logger|pino|winston)\b/i);
    }
  });

  it("declares no module-level let or var (AC13)", () => {
    for (const file of sourceFiles()) {
      expect(withoutComments(file.text), file.path).not.toMatch(/^(export\s+)?(let|var)\s/m);
    }
  });

  it("imports no task, project, repository, or database module (AC14)", () => {
    const forbidden = /(task|project|repositor|database|\bdb\b|postgres|^pg$|supabase|drizzle|prisma|kysely|composition)/i;
    for (const file of sourceFiles()) {
      for (const specifier of importSpecifiers(withoutComments(file.text))) {
        expect(specifier, `${file.path} imports ${specifier}`).not.toMatch(forbidden);
        // Only sibling modules inside src/server/ai/ (or Node built-ins) are expected.
        expect(specifier.startsWith("./") || specifier.startsWith("node:"), `${file.path} imports ${specifier}`).toBe(true);
      }
    }
  });
});
