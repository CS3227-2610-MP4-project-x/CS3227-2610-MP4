# AI interaction summary — 2026-10-27

- Human request: review the agent scaffold from merge `f538689` (multi-agent coordination, context engineering and resource use, harness engineering), then apply the recommended fixes.
- Review findings reported to the human: the roles follow orchestrator-subagent and generator-verifier patterns, ownership and handoff guidance. Gaps: rules were mostly instructions with no computational enforcement; Claude Code subagents cannot start other subagents, so the `orchestrator` subagent cannot dispatch workers; no limit on the review loop; no per-role model selection for Claude; frontend plan mode prevented running the app.
- Human-verified decisions (via clarifying questions):
  - Guard `git push`, `gh pr`, `git reset --hard`, `git rebase`, and `git config` with permission **ask** rules (prompt every time), not deny rules.
  - Change the Codex reviewer and test-writer model from `gpt-6-sol` to `gpt-6.1-sol`. This supersedes the 2026-10-26 instruction.
  - Let the Claude frontend agent run the dev server, but remove its edit tools.
  - Add hooks that enforce the test-writer and implementer write scopes.
- Changes:
  - Added `.claude/settings.json` with the ask rules.
  - Added `.claude/hooks/guard-write-scope.mjs`, a PreToolUse hook declared in `.claude/agents/test-writer.md` and `.claude/agents/implementer.md`. The test-writer may write only under `tests/`; the implementer may not write `tests/`, `openspec/`, `specs/`, or `workflow/`.
  - Set `model: sonnet` for the Claude reviewer and analyst.
  - Replaced `permissionMode: plan` with `disallowedTools: Edit, Write, NotebookEdit` in `.claude/agents/frontend.md`.
  - Updated the Codex model in `.codex/agents/reviewer.toml` and `.codex/agents/test-writer.toml`.
  - Added "Coordination limits" (the main session orchestrates in Claude Code, leaf workers never delegate, at most two review fix rounds, size the pipeline to the task) and "Enforcement" sections to `workflow/agents/README.md`.
- Validation: the hook was pipe-tested with POSIX and Windows paths for both roles (allowed paths exit 0, blocked paths exit 2). `.claude/settings.json` parses as JSON. All Codex TOML files parse. `git diff --check` passed.
- Unverified: the hook has not yet fired inside a live subagent run; the new frontmatter loads in a new session. The `gpt-6.1-sol` ID has not been checked against a Codex install.
- Known gaps: the hook does not block file writes made through shell commands. The ask rules cover the Bash tool only, not the PowerShell tool. The Codex frontend stays `read-only`, so in Codex a human must start the dev server.
- No dependencies added. No secrets recorded.

## Follow-up: agent usage dashboard showed Unknown values

- Human request: explain the Unknown values in the usage dashboard, then fix the bugs and update the relevant documents.
- Diagnosis: only the structure of local session files was inspected, never transcript content.
  - Current Codex stores per-response usage in top-level `token_usage_record` records and the model in `turn_context`. Its `token_count` events carry only running totals. The reader expected the older `event_msg` layout, so every Codex metric and model was Unknown.
  - Claude reports thinking tokens under `output_tokens_details.thinking_tokens`, not `reasoning_tokens`.
  - Work, Agent, and Attribution are Unknown by design until handoffs record `Provider` and `Provider session ID`.
- Human-verified decision: keep supporting the older Codex layout alongside the current one.
- Deviation from the earlier suggestion: `last_token_usage` is not used as a fallback. Running totals do not match per-response records one-to-one, so using them would double-count. A file with only running totals now produces a `per_response_usage_unavailable` diagnostic.
- Changes:
  - Spec delta: two scenarios added under "Provider usage is collected with provenance".
  - `design.md`: recognized layouts recorded.
  - `tasks.md`: task 1.4 added and checked.
  - `tools/agent_usage_dashboard.py`: Codex reader handles both layouts, the `turn_context` model, and `cache_write_input_tokens`; Claude reasoning is read from `thinking_tokens`; `world_state` is recognized.
  - Three synthetic tests added to `tests/agent_usage_dashboard/test_dashboard.py`.
  - `docs/agent-usage-dashboard.md` updated.
  - Follow-up row added to `workflow/handoffs/on-demand-agent-usage-dashboard.md`.
- Validation: `python3 -Werror -m py_compile` passed. `python3 -m unittest discover -s tests/agent_usage_dashboard -v` ran 14 tests: OK, 1 skipped (mode-000 is unreadable only on POSIX). A scratch report from live local history showed 1,370 Codex responses across 28 sessions with no unknown metrics or models. 451 of 8,276 Claude responses have no reported thinking tokens and remain Unknown.
- Not run: `openspec validate --strict` (the OpenSpec CLI is not installed on this machine).
- Open item for the human: newer CLIs write non-usage record types (for example Claude `attachment`, `ai-title`, `api-request`, and Codex `inter_agent_communication_metadata`). They are skipped correctly but still counted as `unsupported_record` diagnostics. Whether to treat them as recognized has not been decided.
- Follow-up: the human's own report still showed Unknown Codex values. Cause: the local ledger at `~/.agent-usage-dashboard/usage.sqlite3` held 2,149 empty Codex rows from the old reader, and saved read positions prevented the files being rescanned.
- Human-verified decision: reset that local ledger rather than add an automatic migration. With the human's approval the ledger file was deleted and regenerated. Result: 1,370 Codex responses with no unknown metrics or models, and 8,288 Claude responses (451 without reported thinking tokens). An "After updating the reader" reset step was added to `docs/agent-usage-dashboard.md`; anyone else who ran the old reader must reset their own ledger.
