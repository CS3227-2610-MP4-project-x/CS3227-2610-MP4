# AI interaction summary — Codex agent usage hooks

Human verification: pending. This summary records AI-assisted work for this chat; the human owner should review and verify it.

## User-approved scope and decisions

- The user approved Codex-only lifecycle hooks to improve agent-session token attribution in the local usage dashboard.
- The dashboard remains human-invoked. Hooks may record allowlisted identity metadata but must not scan histories, update the ledger, or generate HTML.
- Subagent usage is linked by an exact unique hash of the transcript path. Codex's parent session ID is never treated as the child session ID; unmatched or conflicting links remain unknown or ambiguous.
- The user then explicitly requested testing the complete workflow from agent creation through dashboard generation.

## Work performed

- Updated the active dashboard OpenSpec with Codex lifecycle and child-session attribution requirements.
- Added project hook configuration for SessionStart, SessionEnd, SubagentStart, and SubagentStop, plus a privacy-minimized local metadata writer.
- Updated the dashboard collector to use the exact transcript-path hash and explicit parent handoff to map subagent sessions; updated the skill, documentation, and handoff template.
- Added synthetic hook and dashboard tests. The end-to-end test creates root and child lifecycle events, checks hook side effects, records provider-measured child usage (317 input, 29 output), generates the HTML twice, and verifies the report renders the child as `test-writer [agent-child-42]` with its exact parent work and phase.
- Independent source review found and helped resolve four attribution edge cases.

## Verification and limitations

- `python -m unittest discover -s tests/agent_usage_dashboard -v`: passed, 28 tests.
- `git diff --check`: passed.
- `openspec validate on-demand-agent-usage-dashboard --strict`: passed after splitting a long requirement into concise lifecycle and attribution requirements.
- The visual worktree comparison was generated at `_temp/codex-usage-hooks-diff.html` (13 changed files).
- No live Codex lifecycle metadata log was present. Codex project hooks must be reviewed and trusted by a human before activation, so an actual live agent run and real-history dashboard generation have not been verified.
- No actual dashboard was generated from local user history. Synthetic output and state were isolated in temporary directories.
- No dependencies added. No commit, push, or deployment performed.
- Worker platform usage and model-specific token metrics were not exposed; handoff records these as `not available` rather than estimating.

## Follow-up

- Human owner reviews and trusts `.codex/config.toml` in Codex, then runs one real root/subagent workflow and explicitly invokes the dashboard skill to confirm live attribution.
- Human verification of this summary and review of the complete worktree are pending. Commit requires separate authorization.
