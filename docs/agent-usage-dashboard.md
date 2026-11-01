# Local agent usage dashboard

The dashboard is a human-invoked, offline report for observed local Codex and
Claude session token usage. It uses Python's standard library and does not call
provider APIs. Optional Codex lifecycle hooks record local identity metadata;
they do not collect token usage, scan histories, or generate the dashboard.

## Generate a report

From the repository root, run:

```bash
python3 -m tools.agent_usage_dashboard generate --repo .
```

This explicit command scans supported local session JSONL files, updates a
normalized SQLite ledger, and writes
`~/.agent-usage-dashboard/reports/index.html`. Collection is not triggered by
importing the module, starting a session, or invoking unrelated skills.

Optional local overrides:

```bash
python3 -m tools.agent_usage_dashboard generate \
  --codex-root "$HOME/.codex" \
  --claude-root "$HOME/.claude/projects" \
  --repo . \
  --state "$HOME/.agent-usage-dashboard" \
  --output "$HOME/.agent-usage-dashboard/reports/index.html"
```

`--codex-root` is the Codex home containing `sessions/` and
`archived_sessions/`. `--claude-root` is recursively searched for JSONL session
records. `--state` is a directory for the local ledger; `--output` is an HTML
file. Both state and report default outside the repository. The requested
output path is printed after generation.

## Dashboard features

- Provider filter for Codex and Claude, plus work, agent, model, phase, and date
  filters.
- Token usage grouped by session, work ID, or agent, ordered by latest observed
  usage first; missing timestamps appear last.
- A Timestamp (SGT) column immediately after Session / group shows the latest
  observed usage time in Singapore Time (UTC+08:00).
- Session disclosure buttons expand/collapse captured Codex subagent calls,
  showing role/identity and each child's measured usage, newest child first.
  Calls without an exact unique child usage match show Unknown metrics.
  Each detail row explains whether child usage was measured, unavailable,
  parent-only, ambiguous, or excluded by the current filters.
  Sessions without captured calls show an explicit empty state. The buttons
  support pointer, Enter, and Space activation.
- Parent rows retain their own measured usage. Child sessions also remain
  independently visible; expanded detail is a breakdown, so opening it does not
  change summary totals or duplicate CSV records.
- A time graph of responses with valid timestamps and observed input/output
  values; unknown values are not plotted as zero.
- Input, output, cache-read, cache-write, reasoning, and tool-call columns.
  Cache and reasoning metrics are subsets and are not added to total tokens.
- Coverage diagnostics and a CSV export of the currently filtered normalized
  rows.

## Session sources and attribution

The Codex reader looks for JSONL records in `sessions/` and
`archived_sessions/` under the Codex home. It reads per-response usage from
either layout:

- current Codex: top-level `token_usage_record` records, with the model taken
  from `turn_context`. Response identity uses explicit `payload.thread_id`
  when present, then falls back to `payload.session_id`. Child records can
  retain the parent's `session_id` and inherited parent metadata while their
  `thread_id` identifies the actual subagent;
- older Codex: `token_usage_record` inside `event_msg` token-count records,
  with the model taken from `session_meta`.

It never substitutes cumulative or running totals (`total_token_usage`,
`last_token_usage`). A session file that contains only running totals shows a
`per_response_usage_unavailable` diagnostic.

The Claude reader recognizes assistant JSONL records with `sessionId`,
response/message identity, timestamp, model, and `message.usage`. Reasoning
tokens come from `message.usage.output_tokens_details.thinking_tokens`; older
transcripts without that field show reasoning as unknown. Provider transcript
formats may change; unsupported or malformed records are surfaced as generic
diagnostics. Newer CLIs also write non-usage record types, such as titles,
attachments, and request metadata. These are skipped and counted under
`unsupported_record` without affecting usage totals.

Handoff and log Markdown can enrich work attribution only when a session block
contains explicit `Provider`, `Provider session ID`, `Work ID`, `Agent`, or
`Phase` fields. For a root Codex session, exact provider/session identity is
required to connect its workflow role and work item. A single exact
provider/session match is attributed; multiple matches show as ambiguous and
no match remains unknown. The tool does not infer links from filenames,
branches, or prose.

The repository's `.codex/config.toml` registers `SessionStart`, `SessionEnd`,
`SubagentStart`, and `SubagentStop` handlers. Codex requires project hooks to be
reviewed and trusted before they run. The hook appends only event metadata,
session/model IDs where surfaced, subagent ID/type, an observation timestamp,
and a hash of the normalized subagent transcript path to
`~/.agent-usage-dashboard/codex-lifecycle.jsonl` (or
`AGENT_USAGE_STATE/codex-lifecycle.jsonl`). It never stores transcript paths or
content. The dashboard uses the stop-event path hash to match exactly one
scanned Codex usage file and attributes those provider-reported token records
to the subagent identity. Codex subagent hook `session_id` is the parent ID; it
is never used as the child session ID. Work ID is inherited only through an
exact parent-session handoff match. When a stop reference is absent, generation can also verify the exact captured
agent ID against the measured thread ID and the transcript's first metadata
record, which must explicitly identify the same child and parent. This allows
interrupted calls to show their recorded usage. Conflicting parent metadata is
rejected, and a supplied stop reference is never bypassed. Missing, conflicting,
or ambiguous links remain unknown/ambiguous.

## After updating the reader

The thread-aware reader automatically replays available Codex sources once when
upgrading an existing ledger. It corrects exactly matching parent-keyed response
identities, rebuilds transcript relationships, and preserves overall measured
usage without counting the same response twice. Normal incremental collection
resumes afterward. A small allowlist of successfully replayed transcript hashes
lets sources that were temporarily unavailable be retried later.

Conflicting measurements are retained with a `thread_identity_conflict`
diagnostic and ambiguous relationship rather than merged. Retained sources that
cannot be reverified during upgrade produce a
`thread_upgrade_sources_unavailable` diagnostic. Usage whose original source is
no longer available cannot be corrected from that source.

The upgrade uses a local SQLite reader-version marker and an additive table;
it does not change application tables or provider source files. Back up the local
ledger before an upgrade if you need a rollback point. To restore, stop dashboard
generation and use SQLite's backup API to restore the saved ledger, then run the
previous collector version. Keep the backup outside the repository.

## Privacy and limitations

The local SQLite ledger contains normalized metrics and allowlisted metadata,
not prompts, assistant text, tool arguments, or tool results. The HTML and CSV
also omit transcript content and source file paths. Report output is standalone
and uses no network resources. The SQLite database is stored in a private local
directory with restrictive permissions where supported.

The ledger keeps provider-scoped checkpoints using a hashed local file
identity, the byte offset after the last complete line, and a digest of the
processed prefix. It resumes from complete lines on the next invocation and
retries an incomplete trailing line when more data arrives. Codex transcript
path hashes are mapped to session IDs in the ledger so attribution survives
later incremental runs and source archival. Checkpoints do not contain source
paths or transcript contents.

Provider JSONL formats are version-sensitive. Missing fields remain unknown;
malformed, partial, unreadable, or unsupported records produce generic coverage
diagnostics without echoing source text or paths. Historical sessions may lack
provider IDs or usage details, in which case attribution or usage remains
unknown. No token cost, quota use, or absent tool-call count is inferred.
