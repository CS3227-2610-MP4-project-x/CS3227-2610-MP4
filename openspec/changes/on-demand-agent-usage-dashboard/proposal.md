# Proposal

## Why

Agent usage data is split across local Codex and Claude session records and repository handoffs, making it difficult to compare provider usage or relate resource consumption to work. A human-invoked skill can collect available local records on demand and produce one offline dashboard without running a background collector.

## What Changes

- Add a reusable skill that collects local Codex and Claude usage records only when a human invokes it, then generates a standalone HTML dashboard.
- Aggregate observed token and tool-call metrics by session, work item, and agent, with separate provider filtering and a usage-over-time graph.
- Use handoff and log documents to enrich work and agent attribution when they explicitly identify a session; never infer token values or ambiguous attribution.
- Keep collection state and generated reports local, omit raw transcript content, and show missing, unsupported, or partially collected data as such.

## Capabilities

### New Capabilities
- `local-agent-usage-reporting`: On-demand local collection, attribution, and reporting of Codex and Claude session usage.

### Modified Capabilities

## Impact

- Adds local Python collection/report tooling and a human-invoked skill with platform adapters as needed.
- Reads provider-generated local session records and repository handoff/log metadata; it does not call provider APIs or transmit collected data.
- Writes a standalone HTML report and machine-readable local collection state outside tracked project files by default.
- No application runtime, database, or third-party dependency changes are expected.
