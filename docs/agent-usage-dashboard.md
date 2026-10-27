# Local agent usage dashboard

The dashboard is a human-invoked, offline report for observed local Codex and
Claude session token usage. It uses Python's standard library and does not call
provider APIs, install hooks, or run a background collector.

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
- Token usage grouped by session, work ID, or agent.
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
  from `turn_context`;
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
contains explicit `Provider`, `Provider session ID`, and optional `Work ID`,
`Agent`, or `Phase` fields. A single exact provider/session match is attributed;
multiple matches show as ambiguous and no match remains unknown. The tool does
not infer links from filenames, branches, or prose.

## After updating the reader

The ledger keeps collected rows and resumes each file from its saved position,
so an updated reader does not re-read history it has already scanned. After
pulling a change to `tools/agent_usage_dashboard.py`, delete the ledger and
regenerate:

```bash
rm ~/.agent-usage-dashboard/usage.sqlite3
python3 -m tools.agent_usage_dashboard generate --repo .
```

In PowerShell, use `Remove-Item "$HOME\.agent-usage-dashboard\usage.sqlite3"`.
Rows from session files that have since been deleted are not recovered.

## Privacy and limitations

The local SQLite ledger contains normalized metrics and allowlisted metadata,
not prompts, assistant text, tool arguments, or tool results. The HTML and CSV
also omit transcript content and source file paths. Report output is standalone
and uses no network resources. The SQLite database is stored in a private local
directory with restrictive permissions where supported.

The ledger keeps provider-scoped checkpoints using a hashed local file
identity, the byte offset after the last complete line, and a digest of the
processed prefix. It resumes from complete lines on the next invocation and
retries an incomplete trailing line when more data arrives. Checkpoints do not
contain source paths or transcript contents.

Provider JSONL formats are version-sensitive. Missing fields remain unknown;
malformed, partial, unreadable, or unsupported records produce generic coverage
diagnostics without echoing source text or paths. Historical sessions may lack
provider IDs or usage details, in which case attribution or usage remains
unknown. No token cost, quota use, or absent tool-call count is inferred.
