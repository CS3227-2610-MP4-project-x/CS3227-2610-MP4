# On-demand agent usage dashboard

## Interaction summary

- Human requested an on-demand token usage dashboard generated only when a human invokes a skill, using the local collection/reporting flow reviewed from the MP3 repository.
- The approved scope covers local Codex and Claude session usage, explicit handoff/log attribution, provider separation, session/work/agent summaries, a token-over-time graph, and local offline HTML/CSV output.
- The human reviewed the OpenSpec scope and explicitly requested implementation on 2026-10-27. The work was completed under that approved scope.
- Implemented the human-invoked Python command, Codex and Claude readers, local normalized SQLite ledger with checkpoints, explicit handoff attribution, offline filtered dashboard/CSV export, Codex and Claude skill instructions, usage documentation, and structured handoff fields.
- Added synthetic coverage for provider separation, token totals, explicit/ambiguous attribution, missing and malformed usage, partial records, privacy, rescans, archive moves, and unreadable files. Independent review findings were corrected; no real provider histories were scanned and no dependencies were added.
- Validation passed: Python compilation, 11 synthetic unit tests, generated JavaScript syntax check, CLI help, and strict OpenSpec validation. Visual diff: `_temp/visual-diff.html`.

## Human verification

The requester approved the implementation scope, reviewed the completion summary, and authorized a commit on 2026-10-27.
