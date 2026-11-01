# Spec Delta

## Purpose

Provides a human-triggered, local report of available Codex and Claude session usage, connected to repository work records where the session identity is explicit.

## ADDED Requirements

### Requirement: Human invocation controls collection and report generation
The system MUST collect usage records and generate or refresh the dashboard only as part of a human-invoked usage-dashboard skill run.

#### Scenario: Skill is not invoked
- **WHEN** no human invokes the usage-dashboard skill
- **THEN** the system does not scan provider session stores, update its usage ledger, or generate a dashboard

#### Scenario: Skill is invoked
- **WHEN** a human invokes the skill in a supported local environment
- **THEN** it collects available records and generates the requested dashboard in that invocation

### Requirement: Provider usage is collected with provenance
The system MUST keep Codex and Claude records separately attributable and retain the source and availability status of every metric.

#### Scenario: Provider reports usage
- **WHEN** a supported session record contains usage metrics
- **THEN** the system records its provider, session identity, model when available, observation time, token categories, and source provenance

#### Scenario: Metric is missing or the record is unsupported
- **WHEN** a metric is absent, invalid, or comes from an unsupported record format
- **THEN** the system represents it as unknown and exposes a coverage diagnostic rather than treating it as zero

#### Scenario: Provider writes a recognized newer record layout
- **WHEN** a provider version stores per-response usage, model, or reasoning metrics in a different recognized record layout or field name
- **THEN** the system normalizes those metrics to the same token categories as the older layout and records each response once

#### Scenario: Only running totals are available
- **WHEN** a session file reports cumulative or running-total usage without per-response usage records
- **THEN** the system does not record the totals as responses and exposes a coverage diagnostic

#### Scenario: Providers are compared
- **WHEN** the dashboard filters or groups records by provider
- **THEN** Codex and Claude usage remains separately identifiable and is not silently merged

### Requirement: Work attribution requires an explicit session match
The system MUST use handoff and log documents only to enrich session attribution when they explicitly identify the provider session or a documented relationship; it MUST NOT infer usage or work attribution from a branch name, filename, prose similarity, or agent label alone.

#### Scenario: Session identity is explicitly recorded
- **WHEN** a handoff or log record identifies a provider session
- **THEN** the dashboard may associate that session's measured usage with the recorded work item and agent metadata

#### Scenario: Session identity cannot be matched
- **WHEN** no explicit matching identity is present or multiple matches are possible
- **THEN** the session remains visible with attribution marked unknown or ambiguous

### Requirement: Codex hooks capture lifecycle metadata only
Codex lifecycle hooks MUST capture surfaced identity metadata without collecting usage or triggering dashboard generation.

#### Scenario: Codex root session starts and ends
- **WHEN** Codex emits `SessionStart` or `SessionEnd`
- **THEN** the hook records only the surfaced event type, timestamp when available, and root session identity, without recording token counts or starting a dashboard scan

#### Scenario: Codex subagent starts and stops
- **WHEN** Codex emits `SubagentStart` or `SubagentStop`
- **THEN** the hook records only the surfaced event type, timestamp when available, parent session identity, and subagent identity/type, plus a privacy-preserving transcript-path join value at stop when available

### Requirement: Codex subagent events preserve parent identity
The system MUST NOT treat a subagent event's parent session ID as the child session ID.

#### Scenario: A subagent event contains the parent session ID
- **WHEN** Codex emits `SubagentStart` or `SubagentStop` with `session_id`
- **THEN** the system records it as the parent identity and obtains child identity only through a verified transcript relationship

### Requirement: Codex subagent attribution requires an exact unique join
The dashboard MUST attribute a Codex child session only when its transcript relationship is exact and unique.

#### Scenario: A child usage session has a verified transcript relationship
- **WHEN** dashboard collection can verify that one Codex usage session corresponds to one captured subagent transcript path
- **THEN** the session's measured usage may be attributed to that captured subagent identity

#### Scenario: A child usage session cannot be uniquely verified
- **WHEN** a transcript path is absent, cannot be matched, or resolves to multiple usage sessions
- **THEN** that usage remains visible with unknown or ambiguous agent attribution and is not assigned by heuristic

### Requirement: Codex work and root-agent attribution are explicit
The system MUST obtain Codex work IDs and workflow root-agent labels from explicit handoff metadata. It MUST NOT infer a work ID or root-agent label from hook event fields, agent type, repository branch, or transcript content. Existing provider session IDs in handoffs MUST identify the exact Codex session they describe.

#### Scenario: A Codex session is included in a task handoff
- **WHEN** the orchestrator records a Codex worker session in the handoff
- **THEN** the record includes its exact provider session ID and explicit work ID and workflow agent label when available

#### Scenario: Work or root-agent metadata is unavailable
- **WHEN** no explicit work ID or root-agent label can be associated with a Codex usage session
- **THEN** the dashboard shows those fields as unknown while preserving any independently verified subagent identity

### Requirement: Hook capture does not trigger on-demand collection
The system MUST keep provider history scanning, ledger updates, and report generation exclusive to the human-invoked dashboard skill. Codex lifecycle hooks MUST NOT scan provider session stores, update the usage ledger, or generate or refresh the HTML dashboard.

#### Scenario: A Codex lifecycle event occurs without a dashboard request
- **WHEN** a Codex lifecycle hook runs
- **THEN** it may append the approved lifecycle metadata record but does not scan session histories, update the dashboard ledger, or generate a report

#### Scenario: A human invokes the dashboard skill
- **WHEN** the dashboard skill is explicitly invoked
- **THEN** the collector may read Codex usage sessions and captured lifecycle metadata to produce the report

### Requirement: Dashboard summarizes usage by session, work, and agent
The dashboard MUST present available usage grouped at session, work-item, and agent levels, with token categories and tool-call counts shown only when supported by collected records.

#### Scenario: User reviews a session
- **WHEN** a session has collected usage
- **THEN** the dashboard shows its available input, output, cached input, cache-write, reasoning, total-token, and tool-call metrics without double-counting subset metrics

#### Scenario: User groups usage
- **WHEN** the user selects a grouping dimension
- **THEN** usage is aggregated for that dimension and missing component values remain visible as missing

### Requirement: Dashboard supports provider and time analysis
The dashboard MUST provide a Codex/Claude provider filter and a graph of observed token usage over time.

#### Scenario: Provider filter is changed
- **WHEN** the user selects Codex or Claude
- **THEN** provider-specific usage tables and graphs reflect only that provider

#### Scenario: Usage is plotted over time
- **WHEN** records have valid timestamps and token values
- **THEN** the graph plots observed usage by time and excludes unknown values without presenting them as zero

### Requirement: Collection and reports stay local and omit transcript content
The system MUST keep its usage ledger and generated dashboard local by default and MUST NOT copy prompts, assistant prose, tool arguments, or tool results into the ledger, exports, or report.

#### Scenario: Collection completes
- **WHEN** the skill has collected provider records
- **THEN** it stores only normalized metadata and usage metrics locally and reports the generated file location

#### Scenario: Collection finds sensitive transcript content
- **WHEN** source records contain conversation or tool content
- **THEN** that content is not included in generated outputs or diagnostics
