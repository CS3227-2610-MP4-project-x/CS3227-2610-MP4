# Design

## Context

See `proposal.md` for motivation and `specs/local-agent-usage-reporting/spec.md` for observable behavior. The repository currently has handoff and log Markdown records but no usage collector or dashboard. Provider transcripts are generated locally; the Codex format is version-sensitive, so collection must expose compatibility gaps. The requested invocation model rules out background collection or scheduled report generation.

## Goals / Non-Goals

**Goals:**
- Keep collection, normalized state, and report generation in a small local Python tool using the standard library.
- Reconcile incremental per-response usage records across rescans without duplicating usage.
- Connect sessions to handoffs through explicit provider and session identifiers.
- Make provider, metric provenance, and collection coverage visible in the report.

**Non-Goals:**
- No provider API calls, telemetry export, account usage/quota polling, background hook installation, or scheduled jobs.
- No application UI, database integration, automatic task-outcome scoring, or transcript text search.
- No inference of a missing provider metric, cost, or work attribution.

## Decisions

### Human-invoked, one-shot collection

Both provider skill entries invoke one Python command that discovers configured local session roots, updates a local ledger, and writes a fresh HTML snapshot. No hooks or scheduler are installed. A scheduled or hook-driven design was considered because the MP3 tool uses one for catch-up, but rejected here because collection itself is explicitly limited to a human skill invocation.

### Provider adapters over shared normalized records

Use separate Codex and Claude readers to map each provider's per-response usage, timestamps, model, session ID, and tool-call observations into a shared record shape. Defaults are `CODEX_HOME/sessions` plus `CODEX_HOME/archived_sessions` for Codex and `~/.claude/projects` for Claude; allow explicit local path overrides. Do not treat transcript layout or fields as stable contracts: each adapter reports unsupported or malformed records, and its fixtures are tied to known source examples. Do not add one provider's usage to another's response identity.

### Local SQLite ledger with idempotent response keys

Store normalized session, response, attribution, checkpoint, and diagnostic facts in SQLite under `~/.agent-usage-dashboard/` by default. Deduplicate by provider plus response identity. Scan or resume local JSONL inputs only during skill execution; process complete lines and retry a partial final line on the next run. Preserve previously collected normalized rows if source files move or disappear. Avoid storing raw transcript lines, prompts, assistant text, tool arguments/results, or absolute paths in report data.

### Explicit work attribution

Extend each handoff session record with provider, provider session ID, and optional work ID if the agreed template needs them. Parse only those structured fields. Multiple matches remain ambiguous, and unmatched records remain unassigned. Existing free-form summaries may continue to be read for explicitly labeled fields, but prose matching and branch-prefix inference are excluded.

### Standalone report and CSV snapshot

Render an offline HTML report from a normalized snapshot, embedding escaped JSON data and local JavaScript/CSS without network resources. Default output is `~/.agent-usage-dashboard/reports/index.html`; allow an explicit output path. Include provider, work, agent, model, date, and phase filters; per-session/work/agent tables; input/output/cache/reasoning metrics; observed tool-call counts; time-series chart; coverage diagnostics; and CSV exports. Cache and reasoning columns are subsets of input/output, so they are not added to headline totals. Unknown values render as unavailable.

### Skills are the only automatic trigger

Provide a shared skill contract with Codex and Claude discoverable skill files. Each tells the current agent to invoke the local collector/report command only when a human requests the dashboard. It does not run at session startup, after every response, or as a side effect of unrelated work.

## Risks / Trade-offs

- Provider transcript formats can change → isolate parsers, validate records, retain version/coverage diagnostics, and avoid claiming complete coverage after unsupported files.
- Transcript files can contain private content → store only normalized allowlisted fields, keep all state outside Git, and make exports opt-in and redacted.
- Session IDs may be absent from old handoffs → show those sessions as unassigned and update the template for future records.
- Usage can be unavailable for local or historical sessions → display unknown values and incomplete coverage rather than zero.
- On-demand full scans may take time on large histories → checkpoint file positions and deduplicate response keys, but always run collection only inside explicit skill invocation.

## Migration Plan

No application migration is needed. Existing handoffs remain readable; new structured provider/session metadata applies prospectively. The tool initializes a private local ledger on first invocation. The skill reports its output path and coverage summary; users can remove local state through a documented explicit cleanup command.
