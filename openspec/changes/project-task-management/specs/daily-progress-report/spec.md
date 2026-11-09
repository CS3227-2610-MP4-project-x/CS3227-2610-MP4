# Spec Delta

## Purpose

Defines the Progress Report: the product manager's AI feature, which summarizes project activity for a chosen date range from structured task activity and commit metadata.

## ADDED Requirements

### Requirement: Product manager report page
The system SHALL provide `/projects/{projectId}/reports` for the current project product manager, with inclusive SGT start/end date controls defaulting to today and an explicit Generate report action. Opening or refreshing the page SHALL NOT generate a report.

#### Scenario: Authorized report navigation
- **WHEN** the product manager opens project navigation or dashboard actions
- **THEN** Reports and Progress Report link to the report page
- **AND** developers receive neither action nor report data

#### Scenario: Report presentation
- **WHEN** generation succeeds
- **THEN** show the returned range, developer groups, category labels, plain-text statements and task-display-key links to project task detail
- **AND** show generated time, a reuse notice when reused is true, and the server-owned unavailable-GitHub-evidence warning when applicable

#### Scenario: Empty and failed requests
- **WHEN** the API returns an empty report or a safe error
- **THEN** show the matching no-activity or actionable error state
- **AND** never describe a failed request as an empty report
- **AND** do not display a previous result as belonging to a newly selected range

#### Scenario: Pending and superseded requests
- **WHEN** generation is pending or a response belongs to a superseded request
- **THEN** prevent duplicate submission and prevent stale results from replacing the current range/result

#### Scenario: Direct page access
- **WHEN** a session is absent, the requester is a nonmember, or is a developer
- **THEN** respectively redirect to sign-in, show safe not-found, or show a PM-only unavailable state without fetching report/member data

Task 8.3 D9 retains the redaction disclosure requirement in `ai-safeguards`. Its separately scoped metadata prerequisite blocks dependent disclosure UI until its contract is approved and implemented; no redaction count may be invented and this page is not complete while that prerequisite remains unresolved.

### Requirement: Progress report generation API
The system SHALL provide a PM-only report-generation POST endpoint with strict input, safe responses and the approved task 8.2 transport contract.

#### Scenario: Progress report generation API contract
- **WHEN** the system generates or reuses a report
- **THEN** The system SHALL expose only `POST /api/v1/projects/{projectId}/progress-report` for task 8.2, accepting exactly `{}` or `{startDate,endDate}` and returning HTTP 200 `{report,reused}` with a `generated` or `empty` report DTO. It SHALL apply Origin, JSON/body/path validation, session, membership and PM checks in that order, and repeat current PM authorization in the service. It SHALL use existing safe JSON errors, `Cache-Control: no-store`, Node runtime and `maxDuration = 150`. Invalid dates SHALL use 400 `INVALID_REQUEST`; oversized ranges and inputs SHALL use respectively 400 `REPORT_RANGE_TOO_LONG` and `REPORT_INPUT_BUDGET_EXCEEDED`, with fixed messages explaining the limit and shorter-range action. GET/history and UI remain outside this task.

#### Scenario: Authorized generation
- **WHEN** the current PM posts a valid range
- **THEN** the server assembles approved input and returns a validated generated report or deterministic empty result

#### Scenario: Unauthorized generation
- **WHEN** the session is absent, the requester is a developer or the requester is a nonmember
- **THEN** return respectively 401, 403 or concealed 404 before evidence reads, LLM calls or report/usage writes

#### Scenario: Invalid generation request
- **WHEN** Origin, JSON type, UUID, extra fields or range validation fails
- **THEN** return the defined safe refusal without generation

#### Scenario: Generation input refusal
- **WHEN** the range exceeds seven inclusive days or assembled input exceeds 72,000 UTF-16 code units
- **THEN** return the specific safe 400 error without calling the LLM

#### Scenario: Invalid output or provider failure
- **WHEN** output fails schema/citation validation twice or the provider fails
- **THEN** return the existing safe gateway error, preserve usage settlement and write no new report

#### Scenario: AI containment
- **WHEN** generation succeeds or fails
- **THEN** no task, assignment, approval or lifecycle state changes

#### Scenario: Empty generation outcome
- **WHEN** assembly is empty
- **THEN** return an `empty` DTO containing the resolved range, empty statements, `githubUnavailable:false` and `reused:false`, without persistence, gateway calls or usage/cache-hit records
- **AND** unavailable required metadata retains the approved ready behavior rather than becoming empty

#### Scenario: Deterministic generation verification
- **WHEN** task 8.2 is verified
- **THEN** scripted existing fake-adapter tests cover valid output, invalid output/retry, provider failure and missing usage; the default fake behavior remains unchanged
- **AND** handler and direct-service tests cover PM-only access, while PostgreSQL tests cover cache round-trip, project isolation, timestamp ties, deletion, backdated attachments, versions and concurrent publication
- **AND** application-wide valid canned fake mode and adversarial AI security fixture ownership remain deferred to the responsible journey work and Developer A respectively

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
The system SHALL validate every report statement against the approved strict schema and authorized task citations, rejecting invalid output through the gateway retry policy.

#### Scenario: Report statements cite tasks contract
- **WHEN** the system generates or reuses a report
- **THEN** Every statement SHALL follow the strict task 8.2 schema `{statements:[{developerId,category,text,taskIds}]}`. Categories SHALL be `completed`, `submitted`, `in_progress`, `overdue` or `repeated_changes`. The developer SHALL be a current-assignee UUID supplied in input; text SHALL be nonblank plain text; citations SHALL be nonempty distinct task UUIDs belonging to that assignee's authorized live input group. Extra fields, unknown, foreign-project, deleted or absent-input citations and invalid grouping SHALL invalidate the entire response. The gateway SHALL retry once, then return `INVALID_OUTPUT` without writing a report. Citation membership checks do not prove prose truth. The server SHALL supply range, stored ID, model, timestamps, task display keys and GitHub availability; no uncited overview or model-owned availability message is allowed. Generation SHALL use fixed instructions, named untrusted data, `progress_report` usage attribution and the recorded 2,000-output-token maximum.

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
The system SHALL reuse reports only while complete fresh input and generation identity match, using fingerprint invalidation and guarded publication.

#### Scenario: Reports are reused until new activity arrives contract
- **WHEN** the system generates or reuses a report
- **THEN** The system SHALL retain one replaceable report per project/range and reuse it only when freshly assembled complete canonical input, generation contract version and compatible configured provider/model identity match. A new migration SHALL add a lowercase SHA-256 `input_fingerprint` and `generation_contract_version`; legacy rows without these are misses. The fingerprint SHALL include in-range deletion markers for tasks excluded from normal input. Material input changes, including current context, equal-time activity, late attachments and GitHub availability, SHALL invalidate reuse. Partial-evidence reports MAY be persisted with a server-owned warning but SHALL NOT be reused while metadata remains unavailable. Cache hits SHALL record one zero-token gateway cache hit without an LLM call or quota/rate charge.

#### Scenario: Report requested again
- **WHEN** the product manager requests a report for a project and range with no new activity since the stored report
- **THEN** the stored report is returned and no LLM call is made

#### Scenario: Material input changes invalidate reuse
- **WHEN** activity, current task context, an in-range deletion, a newly attached older-authored commit, equal-time activity or evidence availability changes
- **THEN** fingerprint comparison prevents stale reuse even if the latest activity timestamp does not increase

#### Scenario: Partial evidence is retried
- **WHEN** required GitHub metadata is unavailable
- **THEN** available evidence and a server-owned warning are preserved, and subsequent requests retry metadata instead of reusing the partial report

#### Scenario: Publication is fresh and guarded
- **WHEN** generation finishes
- **THEN** the service rechecks current PM authorization and input freshness before publishing, without holding a database transaction across GitHub or LLM calls
- **AND** changed input returns safe 409 `REPORT_INPUT_CHANGED` without storing the new result; an optimistic report-version guard prevents an older generation overwriting a newer row
- **AND** identical concurrent inputs may incur duplicate charged calls and reuse the winning stored row, but those calls are not recorded as cache hits

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
