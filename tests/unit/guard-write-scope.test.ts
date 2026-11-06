import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const HOOK = path.join(ROOT, ".claude/hooks/guard-write-scope.mjs");

// Claude Code passes `agent_type` only when the hook fires inside a subagent.
function runHookWithInput(input: Record<string, unknown>) {
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

function runHook(agentType: string, filePath: string) {
  return runHookWithInput({ cwd: ROOT, agent_type: agentType, tool_input: { file_path: filePath } });
}

const CASES: Array<[role: string, file: string, allowed: boolean]> = [
  ["test-writer", "tests/unit/example.test.ts", true],
  ["test-writer", "src/server/example.ts", false],
  ["implementer", "src/server/example.ts", true],
  ["implementer", "tests/unit/example.test.ts", false],
  ["implementer", "workflow/handoffs/example.md", false],
  ["analyst", "openspec/changes/example/specs/example/spec.md", true],
  ["analyst", "src/server/example.ts", false],
  ["analyst", "workflow/handoffs/example.md", false],
  ["orchestrator", "workflow/handoffs/example.md", true],
  ["orchestrator", "workflow/plans/example.md", true],
  ["orchestrator", "workflow/agents/orchestrator.md", false],
  ["orchestrator", "openspec/changes/example/tasks.md", false],
  ["orchestrator", "src/server/example.ts", false],
  ["commit-pr", "temp/pr-draft.md", true],
  ["commit-pr", "src/server/example.ts", false],
  ["commit-pr", "tests/unit/example.test.ts", false],
  ["commit-pr", "supabase/migrations/example.sql", false],
  ["commit-pr", "openspec/changes/example/tasks.md", false],
];

describe("guard-write-scope hook", () => {
  it.each(CASES)("%s writing %s is allowed=%s", (role, file, allowed) => {
    const { status, stderr } = runHook(role, file);
    if (allowed) {
      expect(status).toBe(0);
    } else {
      expect(status).toBe(2);
      expect(stderr).toContain(`the ${role} role may not write`);
    }
  });

  it("blocks writes outside the repository for every role", () => {
    for (const role of ["test-writer", "implementer", "analyst", "orchestrator", "commit-pr"]) {
      expect(runHook(role, "../outside.md").status).toBe(2);
    }
  });

  it("does not restrict the main session, which carries no agent_type", () => {
    const { status } = runHookWithInput({ cwd: ROOT, tool_input: { file_path: "src/server/example.ts" } });
    expect(status).toBe(0);
  });

  it("does not restrict agent types without a write scope", () => {
    for (const agentType of ["reviewer", "frontend", "Explore", "constructor", "toString"]) {
      expect(runHook(agentType, "src/server/example.ts").status).toBe(0);
    }
  });

  it("allows tool calls that carry no file path", () => {
    expect(runHookWithInput({ cwd: ROOT, agent_type: "analyst", tool_input: {} }).status).toBe(0);
  });

  it("checks notebook paths too", () => {
    const { status } = runHookWithInput({
      cwd: ROOT,
      agent_type: "test-writer",
      tool_input: { notebook_path: "src/example.ipynb" },
    });
    expect(status).toBe(2);
  });
});
