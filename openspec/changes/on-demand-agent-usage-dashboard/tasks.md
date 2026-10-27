# Tasks

## 1. Provider collection and local ledger

- [ ] 1.1 Add standard-library Codex and Claude session readers for documented/default local roots plus explicit path overrides; validate supported records and verify with synthetic fixtures for response usage, malformed lines, partial trailing lines, and missing fields.
- [ ] 1.2 Add a private local SQLite ledger with provider-scoped response deduplication, session metadata, explicit source provenance, attribution, and coverage diagnostics; verify rescans do not duplicate records and unknown metrics remain null.
- [ ] 1.3 Parse explicit provider/session/work/agent fields from handoff and log records and extend the handoff session template for future structured records; verify exact matches attribute correctly while unmatched and ambiguous sessions remain visible as unassigned.
- [x] 1.4 Support the current Codex layout (top-level `token_usage_record`, `turn_context` model, `cache_write_input_tokens`) and Claude `output_tokens_details.thinking_tokens`, keeping the older layouts; never record Codex running totals as responses, and report a diagnostic when only totals exist. Verify with synthetic fixtures for each layout.

## 2. Dashboard and exports

- [ ] 2.1 Build a standalone offline HTML report with provider/work/agent/model/date/phase filters, per-session/work/agent usage, and an observed tokens-over-time graph; verify filtering, totals, subset accounting, and unknown-value rendering from synthetic snapshots.
- [ ] 2.2 Add coverage, timing, and collection diagnostics plus CSV exports; verify exported data contains only allowlisted normalized metadata and metrics, with no transcript text or absolute source paths.
- [ ] 2.3 Add the command that performs collection and report generation only when explicitly invoked, with a private local default output and an explicit output-path option; verify one invocation refreshes the report and does not modify tracked files by default.

## 3. Human-invoked skills and usage guidance

- [ ] 3.1 Add discoverable Codex and Claude skill entries that call the shared command only after a human asks to generate the dashboard; verify both instructions identify the output path and never trigger collection automatically.
- [ ] 3.2 Document supported local sources, privacy boundaries, provider-format limitations, invocation, output location, and diagnostics; verify documented commands match the CLI interface.

## 4. Integration review

- [ ] 4.1 Review the complete diff against the capability scenarios and repository boundaries; verify no credentials, transcript content, generated dashboard, or local ledger is tracked.
