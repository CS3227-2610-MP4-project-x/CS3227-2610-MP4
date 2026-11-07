# Handoff usage backfill scripts (2026-11-05)

Read-only scripts that recover Claude Code usage from local transcripts in
`~/.claude/projects/<project>/`. Python standard library only; run with `python -I`.

- `inventory.py <project_dir> <out.csv>`: lists every root session and subagent with
  de-duplicated usage (by message ID), model, times, and tool calls.
- `tables.py <project_dir> <out.json>`: per-task tables (task-to-session map is hard-coded).
- `backfill.py <project_dir> <handoffs_dir> [--write]`: the script that edited the six
  handoffs. The task map is hard-coded, and it refuses to run on a handoff already backfilled.
  Without `--write` it writes previews next to itself.

Not part of the application; workflow tooling only. `__pycache__/` and outputs stay untracked.
- `cache_ttl.py <project_dir>`: per-subagent cache writes/reads, gaps between responses, and writes after a 5–60 minute gap
