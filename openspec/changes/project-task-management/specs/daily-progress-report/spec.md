# Spec Delta

## Purpose

Defines the Progress Report: the product manager's AI feature, which summarizes project activity for a chosen date range from structured task activity and commit metadata.

## ADDED Requirements

### Requirement: Product manager generates a progress report
The system SHALL allow the project product manager to generate a per-developer progress report for inclusive SGT calendar dates, defaulting to today. It SHALL summarize completed, submitted and in-progress tasks and flag overdue tasks and repeated requests for changes. Date validation SHALL follow the range contract below.

#### Scenario: Product manager generates a progress report contract
- **WHEN** the system assembles report input
- **THEN** The system SHALL allow a project's product manager to generate a progress report for a date range. Inputs SHALL contain either neither endpoint or both strict, real `YYYY-MM-DD` dates named `startDate` and `endDate`. Both dates SHALL be inclusive SGT calendar dates (UTC+08:00), using UTC filtering from start midnight inclusive to midnight after the end date exclusive. Omission SHALL default to the database's current SGT day. Partial, malformed, impossible or reversed ranges SHALL be refused. No future-date restriction SHALL apply. The report SHALL summarize, per developer, the tasks completed, submitted for review, and in progress, and SHALL list tasks that are overdue or have had changes requested more than once.

#### Scenario: Product manager views today's report
- **WHEN** the product manager generates a report without choosing a range
- **THEN** the report covers the current SGT day

#### Scenario: Product manager chooses a range
- **WHEN** the product manager generates a report for a chosen date range
- **THEN** only activity within that range is included

#### Scenario: Activity late in the day
- **WHEN** a developer authors a task-attached commit at 11:30pm SGT
- **THEN** the commit is included in that day's report

#### Scenario: Inclusive SGT date boundaries
- **WHEN** the range is `2026-11-09` through `2026-11-09`
- **THEN** activity in `[2026-11-08T16:00:00.000Z, 2026-11-09T16:00:00.000Z)` is included, including the last millisecond and excluding the next midnight

#### Scenario: Invalid date range
- **WHEN** either endpoint is missing alone, malformed, not a real calendar date, or later than the end date
- **THEN** assembly returns `invalid_range` without an LLM call

### Requirement: Report statements cite tasks
Every statement in the report SHALL cite the IDs of the tasks it is based on, and every cited ID SHALL belong to the project.

#### Scenario: Report cites its sources
- **WHEN** a report is generated
- **THEN** each statement shows the task IDs it is based on

#### Scenario: Model cites an unknown task
- **WHEN** the model output cites a task ID that is not in the project
- **THEN** the statement is not shown as fact

### Requirement: Report input is structured activity
The system SHALL use allowlisted structured task activity and task-attached commit metadata only, with stable identities and ordering. It SHALL exclude deleted tasks, foreign-project data, diffs, check evidence text and arbitrary stored JSON. It SHALL retain original lifecycle event types without duplicate transitions and project only the safe fields specified below.

#### Scenario: Report input is structured activity contract
- **WHEN** the system assembles report input
- **THEN** The system SHALL build the report from explicitly allowlisted structured activity only: task state changes, progress updates, submissions, criteria check summaries, review feedback, assignment changes, and metadata for task-attached commits. Each record SHALL carry task UUID and display key, activity type, stable source ID, UTC timestamp and actor where present. All three lifecycle event types (`state_change`, `submission`, `review_feedback`) SHALL retain their original type and transition without duplicate state-change records. Soft-deleted tasks and all their activity SHALL be excluded. Records SHALL have stable timestamp ordering with activity type and source ID tie-breakers. The system SHALL NOT fetch or send source code diffs for the report.
- **AND** Commit metadata SHALL be read by attached SHA through the GitHub module's public service, selected by authored timestamp, and retain attachment time separately. Commit messages SHALL NOT associate unrelated commits with tasks. The developer-only commit picker authorization SHALL remain unchanged. Check summaries SHALL include only result ID/time, model, anchor SHA, redaction flag, criterion IDs/statuses and gap/omission counts; evidence text, raw provider text and arbitrary stored JSON SHALL be excluded. Each check created in range SHALL appear once; submissions SHALL reference its ID without duplicating it, and earlier checks MAY be referenced by ID only.

#### Scenario: Report input excludes diffs
- **WHEN** the system prepares the report input
- **THEN** the input contains no diff content

#### Scenario: Safe structured projections
- **WHEN** lifecycle events, check results and attached commits are assembled
- **THEN** submissions and feedback retain their transitions, check evidence snippets and unknown fields are absent, and diff access is never invoked
- **AND** one SHA attached to two tasks retains both task associations while a submission does not duplicate its referenced check

#### Scenario: Project isolation and stable ordering
- **WHEN** records share a timestamp or tasks belong to another project or are deleted
- **THEN** equal-time records are ordered by activity type and source ID, and foreign-project and deleted-task records are absent

#### Scenario: No activity in range
- **WHEN** there is no activity in the selected range and required GitHub metadata reads succeeded or no attached SHAs required reading
- **THEN** the system reports that there was no activity without calling the LLM

### Requirement: Report context is explicit
The system SHALL separate explicitly labelled current task context from activity in the chosen range. Current context SHALL NOT imply historical end-of-range state or make an otherwise empty range active. Current assignees and activity actors SHALL remain distinct, with the projection and attribution rules below.

#### Scenario: Report context is explicit contract
- **WHEN** the system assembles report input
- **THEN** The system SHALL include explicitly labelled current context for all live project tasks separately from range-filtered activity: task UUID/key, title, current assignee, status, due date and request-changes count within the range. Overdue SHALL mean non-Done with due date before the selected end date; repeated-change flags SHALL mean more than one review-feedback event within the range. Current context SHALL NOT be described as historical end-of-range state and SHALL NOT make an otherwise empty range active. Summaries SHALL group tasks by current assignee while retaining activity actors separately. Progress and submissions SHALL be attributed to their actor; PM approvals and feedback SHALL NOT be attributed as developer work.

#### Scenario: Reassignment preserves attribution
- **WHEN** a task is reassigned after a progress update
- **THEN** the update retains its original actor and current task context shows its current assignee separately

#### Scenario: Context is not range activity
- **WHEN** a live in-progress task has no activity in the range
- **THEN** it is current context, not evidence of work in that range, and does not prevent an empty result

### Requirement: Report size is limited
The system SHALL refuse ranges longer than seven inclusive calendar days and inputs above 72,000 UTF-16 code units after redaction and escaping. It SHALL measure the complete deterministic serialized input as specified below and SHALL NOT truncate or silently drop records. Refusal SHALL ask for a shorter range without an LLM call.

#### Scenario: Report size is limited contract
- **WHEN** the system assembles report input
- **THEN** The system SHALL refuse a report range longer than 7 inclusive calendar days. The input budget SHALL be 72,000 UTF-16 code units measured using JavaScript `.length` on deterministic compact JSON with fixed field order, after whole-text-field redaction and existing prompt-data escaping. Measurement SHALL include metadata, current task context and availability markers, but exclude fixed instructions and outer prompt wrappers. Exactly 72,000 SHALL pass; 72,001 SHALL be refused. When the complete input exceeds the budget, the system SHALL return `input_budget_exceeded` without calling the LLM and SHALL ask the product manager to choose a shorter range. The system SHALL NOT truncate or silently drop records to fit the budget.

#### Scenario: Seven inclusive days
- **WHEN** the range is November 3 through November 9
- **THEN** the range is accepted, while November 2 through November 9 returns `range_too_long`

#### Scenario: Exact input budget boundary
- **WHEN** redacted and escaped serialized data measures 72,000 or 72,001 code units
- **THEN** the former passes and the latter is refused without an LLM call or omitted records

#### Scenario: Complete input is measured
- **WHEN** a single oversized update or many small records exceed the budget
- **THEN** assembly refuses the complete input after redaction rather than returning a partial successful input

#### Scenario: Range longer than 7 days
- **WHEN** the product manager requests a report for a range longer than 7 days
- **THEN** the system refuses the request and states the 7-day limit

#### Scenario: Activity exceeds the input budget
- **WHEN** the activity in the chosen range is larger than the report input budget
- **THEN** no LLM call is made and the product manager is asked to choose a shorter range

### Requirement: Reports are reused until new activity arrives
The system SHALL reuse a stored report for the same project and date range, without calling the LLM, until new activity in that range is recorded.

#### Scenario: Report requested again
- **WHEN** the product manager requests a report for a project and range with no new activity since the stored report
- **THEN** the stored report is returned and no LLM call is made

### Requirement: Report access is limited to the product manager
The system SHALL allow only the project's product manager to generate or view its progress reports.

#### Scenario: Developer requests a report
- **WHEN** a developer requests a progress report
- **THEN** the system refuses the request

### Requirement: Unavailable evidence is shown in the report
The system SHALL state in the report when GitHub evidence for the range was unavailable, rather than implying no work occurred.

Assembly SHALL preserve available structured activity and carry an explicit GitHub-unavailable marker when metadata cannot be read. With unavailable metadata and no other activity, assembly SHALL return ready input containing that marker rather than an empty result. Database read failure SHALL be a safe error, never an empty result.

#### Scenario: GitHub unavailable during report generation
- **WHEN** commit metadata cannot be retrieved for the range
- **THEN** the report states that GitHub evidence was unavailable

#### Scenario: Unavailable metadata is not no activity
- **WHEN** required metadata reads fail and no other range activity exists
- **THEN** assembly returns ready input containing the unavailable-evidence marker rather than claiming no activity

### Requirement: Report input assembly is read-only
A server-only service SHALL authorize current PM membership before evidence retrieval, use a consistent read-only database snapshot closed before GitHub calls, and expose only safe outcomes and errors. Assembly SHALL make no LLM calls or domain, report, usage or cache writes. Task 8.2 retains HTTP payload/status design.

#### Scenario: Report input assembly is read-only contract
- **WHEN** the system assembles report input
- **THEN** A server-only service SHALL authorize current PM membership before retrieving activity or metadata. A missing project or nonmember SHALL receive safe `NOT_FOUND` (404 semantics); a developer member SHALL receive safe `FORBIDDEN` (403 semantics). Assembly SHALL use one consistent read-only database snapshot and close it before GitHub calls. It SHALL return discriminated `ready`, `empty`, `invalid_range`, `range_too_long` or `input_budget_exceeded` outcomes, with safe infrastructure errors. It SHALL make no LLM calls and no task, report, usage or cache writes. HTTP payload/status design remains task 8.2.

#### Scenario: Authorization precedes evidence reads
- **WHEN** a developer or nonmember requests assembly
- **THEN** the appropriate safe refusal occurs before activity or metadata retrieval

#### Scenario: Assembly has no mutation effects
- **WHEN** assembly is ready, empty, invalid-range or over budget
- **THEN** no LLM call or domain, report, usage or cache write occurs

#### Scenario: Mixed GitHub metadata outcomes retain available activity
- **WHEN** one attached SHA metadata read succeeds and another fails
- **THEN** assembly keeps the successful commit metadata and every corresponding task association, marks GitHub evidence unavailable, and does not claim the available subset is complete evidence

#### Scenario: Existing data-section escaping is reused
- **WHEN** untrusted text contains `<data` or `</data` delimiters
- **THEN** the existing prompt-data sanitizer neutralizes those delimiters before measuring the complete input
- **AND** arbitrary `<tag>` and `</untrusted_data>` text does not require additional escaping under D6
