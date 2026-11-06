# 2026-11-06: Resolving the reflection notes' open items

Tool: Claude Code (VS Code extension), main session on Opus 5.5. Branch: `chore/backfill-handoff-evidence`.

## Prompts

1. The user asked how to run experiment X1 (task 4.1 with the full pipeline, 4.2 single-agent) from the reflection notes. Claude explained the steps; no files changed.
2. The user asked Claude to resolve each item in the reflection notes' "Still open" list as it recommended, then split the changes into commits.

## What was done

- **D7 revision:** removed `experimental.cacheTtl: 1h` from `.claude/agents/implementer.md`, `orchestrator.md` and `test-writer.md`. The earlier counterfactual showed it would have cost about 8% more on past sessions; the implementer's 5% saving was an upper bound from 4 gaps. Updated the Enforcement table in `workflow/agents/README.md`.
- **Frontend agent:** set `model: sonnet` and `effort: medium` in `.claude/agents/frontend.md`, matching the reviewer (the other read-only verifier role). `maxTurns` is left unset because the agent has never run.
- **6.3 re-review:** recovered the "Re-review fix round 2" reviewer report from the local transcript and recorded it in `workflow/handoffs/llm-gateway-core.md`: no must-fix, 4 should-fix test gaps, 3 notes, 1 question. These are still open; no decision was recorded at the time.
- **Enforcement check:** launched a test-writer and an analyst subagent to write outside their scopes on purpose.
  - Neither the Write nor the Edit was blocked, and the transcripts show no hook invocation. The hook script blocks correctly when run by hand.
  - Recorded as a known failure in `workflow/agents/README.md`. The canary edit to `workflow/README.md` was reverted, and the untracked `src/canary.ts` was deleted, as the human's own check plan specifies.
  - The `.env.local` deny check was not run: auto mode's classifier refused to launch that subagent.
- **Not done:**
  - Archiving the dashboard OpenSpec change: blocked because `tasks.md` has 1.1–1.3 unchecked while its handoff says they are complete.
  - The ESLint rule: needs a team decision.
  - The dashboard role split: needs an OpenSpec change first.
  - The Codex items: Lim-ZY's.

## Checks

- No application code changed. `npm` checks were not run, because only agent configuration and Markdown files changed.

## Human verification

- Pending: Human has approved the changes.
