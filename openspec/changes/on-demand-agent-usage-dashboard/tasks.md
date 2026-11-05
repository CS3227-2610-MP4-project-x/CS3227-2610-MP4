# Tasks

## 1. Provider collection and local ledger

- [ ] 1.1 Add standard-library Codex and Claude session readers for documented/default local roots plus explicit path overrides; validate supported records and verify with synthetic fixtures for response usage, malformed lines, partial trailing lines, and missing fields.
- [ ] 1.2 Add a private local SQLite ledger with provider-scoped response deduplication, session metadata, explicit source provenance, attribution, and coverage diagnostics; verify rescans do not duplicate records and unknown metrics remain null.
- [ ] 1.3 Parse explicit provider/session/work/agent fields from handoff and log records and extend the handoff session template for future structured records; verify exact matches attribute correctly while unmatched and ambiguous sessions remain visible as unassigned.
- [x] 1.4 Support the current Codex layout (top-level `token_usage_record`, `turn_context` model, `cache_write_input_tokens`) and Claude `output_tokens_details.thinking_tokens`, keeping the older layouts; never record Codex running totals as responses, and report a diagnostic when only totals exist. Verify with synthetic fixtures for each layout.
- [x] 1.5 Add Codex-only lifecycle hooks for root and subagent start/stop events. Append only surfaced identity metadata to private local state; hooks must not scan session histories, update the ledger, or generate the dashboard.
- [x] 1.6 During human-invoked dashboard generation, join Codex subagent hook metadata to usage sessions by an exact unique transcript-path hash, then attribute subagent ID/type and the explicitly matched parent-handoff work ID. Keep missing or ambiguous matches unknown.

- [x] 1.7 Prefer explicit per-response Codex thread IDs over parent-valued session IDs; replay and safely repair existing local ledger identities and transcript mappings, with conflict/unavailable-source diagnostics. Verify inherited metadata, legacy fallback, upgrade, rescan, append, and archive cases.

## 2. Dashboard and exports

- [x] 2.1 Build a standalone offline HTML report with provider/work/agent/model/date/phase filters, per-session/work/agent usage, and an observed tokens-over-time graph; verify filtering, totals, subset accounting, and unknown-value rendering from synthetic snapshots.
- [x] 2.2 Add coverage, timing, and collection diagnostics plus CSV exports; verify exported data contains only allowlisted normalized metadata and metrics, with no transcript text or absolute source paths.
- [x] 2.3 Add the command that performs collection and report generation only when explicitly invoked, with a private local default output and an explicit output-path option; verify one invocation refreshes the report and does not modify tracked files by default.
- [x] 2.4 Sort session, work, and agent table rows by each row's latest observed usage timestamp, newest first; place rows without timestamps last and apply a deterministic provider/group-key tie-breaker. Verify all three grouping modes with synthetic records containing older, newer, tied, and missing timestamps.

- [x] 2.5 Insert Timestamp (SGT) after Session / group, using latest observed usage; verify missing times and SGT date rollover.
- [x] 2.6 Add initially collapsed session disclosure controls for captured subagent calls, exact child usage matches, unknown measurements, empty states, and newest-first children; verify pointer/keyboard operation and unchanged summary totals.

- [x] 2.7 Explain measured, missing, parent-only, and ambiguous child usage in expanded rows; verify measured child metrics from the thread-aware collector.

## 3. Human-invoked skills and usage guidance

- [x] 3.1 Add discoverable Codex and Claude skill entries that call the shared command only after a human asks to generate the dashboard; verify both instructions identify the output path and never trigger collection automatically.
- [x] 3.2 Document supported local sources, privacy boundaries, provider-format limitations, invocation, output location, and diagnostics; verify documented commands match the CLI interface.

## 4. Integration review

- [x] 4.1 Review the complete diff against the capability scenarios and repository boundaries; verify no credentials, transcript content, generated dashboard, or local ledger is tracked.
