// PreToolUse hook: blocks file writes outside a subagent role's write scope.
// Usage: node guard-write-scope.mjs <test-writer|implementer>
// Exit 2 with a stderr message blocks the tool call and tells the agent why.
import path from "node:path";

const SCOPES = {
  // Contract: workflow/agents/test-writer.md — writes only under tests/.
  "test-writer": { allow: ["tests/"], deny: [] },
  // Contract: workflow/agents/implementer.md — never edits tests, specs, or coordination records.
  implementer: { allow: null, deny: ["tests/", "openspec/", "specs/", "workflow/"] },
};

const role = process.argv[2];
const scope = SCOPES[role];
if (!scope) {
  console.error(`guard-write-scope: unknown role "${role}"`);
  process.exit(2);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) process.exit(0);

const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");

const outside = rel.startsWith("../") || path.isAbsolute(rel);
const allowed = !outside && (scope.allow === null || scope.allow.some((p) => rel.startsWith(p)));
const denied = scope.deny.some((p) => rel.startsWith(p));

if (outside || !allowed || denied) {
  console.error(
    `Blocked: the ${role} role may not write "${rel}". ` +
      `See workflow/agents/${role}.md; ask the orchestrator for a scope update instead.`,
  );
  process.exit(2);
}
