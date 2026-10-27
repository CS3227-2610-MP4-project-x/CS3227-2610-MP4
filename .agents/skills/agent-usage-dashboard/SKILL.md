---
name: agent-usage-dashboard
description: Collect local Codex and Claude token usage and generate an offline dashboard when a human explicitly requests it.
---

# Agent usage dashboard

Only run this skill after a human explicitly asks to generate or refresh the usage dashboard. Never collect usage at session start, after a response, or as a side effect of unrelated work.

From the repository root, run:

```bash
python3 -m tools.agent_usage_dashboard generate --repo .
```

The command reads local Codex and Claude JSONL session histories, updates the local normalized ledger, and writes the standalone report to `~/.agent-usage-dashboard/reports/index.html` by default. If the human asks for another location or local history roots, pass `--output PATH`, `--codex-root PATH`, `--claude-root PATH`, or `--state PATH`.

Report the exact output path and the coverage or diagnostic summary shown by the report. Do not include transcript content in messages or exports.
