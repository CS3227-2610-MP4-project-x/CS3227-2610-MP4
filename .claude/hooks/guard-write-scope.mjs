// PreToolUse hook: blocks file writes outside a subagent role's write scope.
// Registered once in .claude/settings.json for Write|Edit|NotebookEdit. Claude Code runs
// settings hooks for subagent tool calls too and passes the subagent's name as `agent_type`.
// No `agent_type` means the main session, which is not restricted; agent types without an
// entry in SCOPES (reviewer, frontend, built-in agents) are not restricted either.
// Exit 2 with a stderr message blocks the tool call and tells the agent why.
import path from "node:path";

const SCOPES = {
  // Contract: workflow/agents/test-writer.md — writes only under tests/.
  "test-writer": { allow: ["tests/"], deny: [] },
  // Contract: workflow/agents/implementer.md — never edits tests, specs, or coordination records.
  implementer: { allow: null, deny: ["tests/", "openspec/", "specs/", "workflow/"] },
  // Contract: workflow/agents/analyst.md — writes only OpenSpec proposal/specification files.
  analyst: { allow: ["openspec/"], deny: [] },
  // Contract: workflow/agents/orchestrator.md — writes only coordination records.
  orchestrator: { allow: ["workflow/plans/", "workflow/handoffs/"], deny: [] },
  // Contract: workflow/agents/commit-pr.md — never edits product files, tests, specs, or migrations.
  "commit-pr": { allow: null, deny: ["src/", "tests/", "openspec/", "specs/", "supabase/", "public/"] },
};

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);

const role = input.agent_type;
const scope = typeof role === "string" && Object.hasOwn(SCOPES, role) ? SCOPES[role] : null;
if (!scope) process.exit(0);

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
