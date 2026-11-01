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

#### Scenario: Codex response identifies a child thread inside a parent session
- **WHEN** a top-level Codex per-response usage record contains a non-empty `thread_id` and a parent-valued `session_id`
- **THEN** the collector uses the explicit `thread_id` as the response's usage-session identity and retains the measured token categories
- **AND** it does not replace child identity with an inherited parent `session_meta` record or infer identity from a filename

#### Scenario: A previously collected ledger used parent-valued session identities
- **WHEN** the thread-aware reader first processes an existing local ledger
- **THEN** it replays available Codex sources, corrects exactly matching previously collected response identities without duplicating tokens, and rebuilds those files' transcript relationships
- **AND** repeated generation, incremental appends, and archival remain idempotent; missing sources are retained with an explicit upgrade-coverage diagnostic

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

#### Scenario: A captured call has explicit child and parent metadata but no stop transcript reference
- **WHEN** a captured call's exact agent ID matches the child's measured `thread_id` and its transcript's first metadata record identifies that same child and the same explicit `source.subagent.thread_spawn.parent_thread_id`
- **AND** no conflicting parent relationship or captured stop transcript reference exists
- **THEN** collection may verify that relationship during generation and show the child's measured usage even when its stop reference is unavailable

#### Scenario: A child usage session cannot be uniquely verified
- **WHEN** neither an exact unique transcript-path join nor the explicit child/parent metadata relationship can be verified
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

#### Scenario: Grouped usage rows are ordered by recency
- **WHEN** the dashboard displays session, work, or agent rows
- **THEN** each row is ordered by its latest non-null `observed_at`, newest first; rows with no observed timestamp appear last, and equal or missing timestamps are ordered deterministically by provider and then the row's stable group key in ascending lexical order

### Requirement: Session rows expose timestamps and subagent usage
The dashboard MUST insert a Timestamp column immediately after Session / group. It MUST display each row's latest valid observed usage time in Singapore Time (SGT, UTC+08:00), or Unknown when unavailable, and retain newest-first ordering in every grouping mode.

#### Scenario: A session is expanded or collapsed
- **WHEN** the user activates a session row's disclosure control with a pointer or keyboard
- **THEN** the initially collapsed row reveals or hides its captured subagent calls, labeled by available agent role/identity, with each child's available token categories and total usage
- **AND** sessions without captured calls show an explicit empty state

#### Scenario: Child usage can be verified
- **WHEN** a captured call has an exact unique child transcript/session relationship and unambiguous attribution
- **THEN** its expanded detail shows only that child's measured usage, with latest usage time, newest child first
- **AND** parent row metrics continue to describe the parent's own usage; expanding details never changes dashboard totals or exports, and child sessions remain independently visible in the session table

#### Scenario: A captured call lacks separate child measurements
- **WHEN** a captured subagent identity has missing, conflicting, or parent-only usage relationships
- **THEN** the call remains visible in the parent's expanded detail with unknown token values, without substituting parent usage or inferring a child identity

#### Scenario: Child usage availability is explained
- **WHEN** the user expands a session's subagent calls
- **THEN** each call indicates measured child usage, no separate usage reported, only parent usage reported, or an ambiguous session relationship, as supported by collection evidence

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
