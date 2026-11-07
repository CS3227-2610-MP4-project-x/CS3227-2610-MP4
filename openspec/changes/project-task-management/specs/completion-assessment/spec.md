# Spec Delta

## Purpose

Defines the Acceptance Criteria Check: the developer's AI feature, which assesses the commits attached to a task against each of the task's acceptance criteria before submission. Assigned developers and project managers can read distinct check history, and a review submission references a check only when its anchor SHA and criteria hash match the submitted commit history and current criteria.

## ADDED Requirements

### Requirement: Developer runs an acceptance criteria check
The system SHALL allow the assigned developer to run an AI check of the task's attached commits against each acceptance criterion. The model input SHALL identify each criterion by its stable criterion ID and text. The validated result payload SHALL have exactly this shape: `{ "anchorSha": string, "criteria": [{ "criterionId": string, "criterion": string, "status": "addressed" | "not_addressed" | "unclear", "evidence": string[] }], "possibleGaps": string[], "omittedFiles": string[] }`. Each current criterion SHALL appear exactly once, associated by its ID. Each evidence entry SHALL exactly equal one line from the assessed diff. The result SHALL list possible gaps, such as missing tests or unhandled edge cases. The result SHALL NOT contain a numeric score. A check SHALL NOT approve, reject, submit, or change the task state.

Unknown, duplicate, or missing criterion IDs SHALL make model output invalid. The system SHALL use the LLM gateway's existing schema-validation retry. If output remains invalid after that retry, the request SHALL fail with HTTP 502 `INVALID_OUTPUT` and SHALL NOT create a check result.

The commit-set hash SHALL be SHA-256 of the full commit SHAs sorted lexicographically and joined with a single line-feed (`\n`) character, with no trailing line feed. The criteria hash SHALL be SHA-256 of the UTF-8 compact JSON serialization of an array of `{ "id": string, "description": string }` objects in criterion position order, with criterion ID as the tie-breaker and property order `id`, then `description`. The task ID SHALL remain a separate cache and persistence key dimension.

The assigned developer SHALL initiate a check through `POST /api/v1/projects/{projectId}/tasks/{taskId}/acceptance-criteria-check` with exactly `{}` as its JSON body. The server SHALL use the task's current attached commits and acceptance criteria. On success the route SHALL return HTTP 200 with `{ "check": <check result>, "reused": <boolean> }` and `Cache-Control: no-store`. The `check` result SHALL expose its result ID, anchor SHA, creation timestamp, redaction flag, and result payload.

#### Scenario: Developer runs the check
- **WHEN** an assigned developer runs the check on a task with attached commits
- **THEN** the developer sees, for every acceptance criterion, a status and the diff evidence for it, plus a list of possible gaps

#### Scenario: Check request succeeds
- **WHEN** the assigned developer posts exactly `{}` to the task-scoped check route and the task has assessable attached commits
- **THEN** the server assesses the task's current attached commits against its current acceptance criteria
- **AND** returns HTTP 200 with `{ "check": <check result>, "reused": false }` when it creates a result
- **AND** the response is not cached

#### Scenario: Invalid check request
- **WHEN** the check request has malformed JSON, a body other than exactly `{}`, or a malformed project/task UUID
- **THEN** the system returns the existing HTTP 400 `INVALID_REQUEST` error

#### Scenario: Unauthenticated check request
- **WHEN** the caller has no valid session
- **THEN** the system returns the existing HTTP 401 `UNAUTHENTICATED` error

#### Scenario: Non-member check request
- **WHEN** the task does not exist or the caller is not a project member
- **THEN** the system returns the existing HTTP 404 `NOT_FOUND` error

#### Scenario: Product manager cannot initiate a check
- **WHEN** the product manager posts to the task-scoped check route
- **THEN** the request fails with the existing HTTP 403 `FORBIDDEN` error and no LLM call or check result is created

#### Scenario: No commits attached
- **WHEN** the assigned developer runs the check on a task with no attached commits
- **THEN** the system returns HTTP 409 `CHECK_REQUIRES_COMMITS`, does not call the LLM, and asks the developer to attach commits first

#### Scenario: Selected commits have incomparable tips
- **WHEN** there is no unique selected commit that descends from every other selected commit
- **THEN** the system returns HTTP 409 `INCOMPARABLE_COMMIT_TIPS`, refuses the check without calling the LLM or creating a result, and tells the developer to select commits with one common descendant tip

#### Scenario: Commit ancestry is unavailable
- **WHEN** GitHub evidence needed to determine the selected commits' ancestry cannot be retrieved
- **THEN** the system returns HTTP 503 `EVIDENCE_UNAVAILABLE`, does not call the LLM, and creates no check result

#### Scenario: Developer re-runs after changes
- **WHEN** the developer attaches different commits and runs the check again
- **THEN** a new result is produced for the new set of commits and becomes the latest result

### Requirement: Evidence is verified against the diff
The system SHALL verify that every quoted evidence line appears in the diff that was assessed. A criterion whose evidence cannot be verified SHALL be shown as unclear.

#### Scenario: Model quotes a line that is not in the diff
- **WHEN** the model returns evidence for a criterion that does not appear in the assessed diff
- **THEN** that criterion is shown as unclear and the unverified evidence is not displayed as fact

#### Scenario: Model output has invalid criterion associations
- **WHEN** model output contains an unknown criterion ID, a duplicate criterion ID, or omits a current criterion
- **THEN** the gateway retries once using its existing schema-validation behavior
- **AND** if the retried output still has invalid criterion associations, the request fails with HTTP 502 `INVALID_OUTPUT` and no check result is created

#### Scenario: Evidence entries are exact diff lines
- **WHEN** the model returns evidence for a criterion
- **THEN** each evidence entry exactly matches one line of the assessed diff
- **AND** any criterion with evidence that cannot be verified is shown as unclear without displaying unverified evidence as fact

### Requirement: Check input is limited to what the assessment needs
The system SHALL send the model only the task's acceptance criteria, identified by stable criterion ID and text, and the filtered diff of the attached commits. Lockfiles, generated files, and binary files SHALL be excluded. A file SHALL be excluded as binary when GitHub's diff marks that file as binary. The input budget SHALL be 48,000 characters. Eligible files SHALL be included or omitted whole. The result SHALL list every eligible file omitted because of that budget; excluded files SHALL NOT appear in the omitted-file list.

Each repository SHALL provide deterministic, source-controlled path rules in a root `.acceptance-check.json` file. The file SHALL be versioned JSON with exactly these properties: `version`, `domainLogic`, `apiHandlers`, `tests`, `ui`, `lockfileNames`, and `generatedPathPrefixes`. `version` SHALL be the integer `1`. `domainLogic`, `apiHandlers`, `tests`, `ui`, and `generatedPathPrefixes` SHALL be arrays of repository-relative directory prefixes. Prefixes SHALL use `/` separators, be relative to the repository root, and end in `/`; matching SHALL be literal and SHALL NOT use glob or regular-expression semantics. `lockfileNames` SHALL be an array of exact, case-sensitive literal basenames; a changed file SHALL be excluded as a lockfile when its basename exactly matches an entry. GitHub-binary files, configured lockfiles, and files under configured generated prefixes SHALL be excluded before eligible files are classified or considered for the input budget. If a path matches more than one category, the first matching category in priority order SHALL apply: domain logic, API handlers, tests, then UI. Unmatched eligible files SHALL be classified as other.

The server SHALL resolve the linked repository's current default-branch tip at check time and read `.acceptance-check.json` from that resolved commit SHA, independently of the commits selected for assessment. It SHALL validate the exact schema and normalize the rules by removing duplicates from every array and sorting each array lexicographically. The normalized path-rules hash SHALL be SHA-256 of the UTF-8 compact JSON serialization with the fixed property order `version`, `domainLogic`, `apiHandlers`, `tests`, `ui`, `lockfileNames`, `generatedPathPrefixes`, and the normalized arrays. Missing, invalid, or unavailable configuration SHALL fail safely with HTTP 503 `EVIDENCE_UNAVAILABLE`, without calling the LLM or creating a check result.

When GitHub diff metadata identifies a rename, the system SHALL use the destination (new) repository path for classification and configured lockfile and generated-file exclusion checks, and SHALL process the rename as one file entry.

The system SHALL process groups in the priority order above and sort paths alphabetically within each group. It SHALL include a whole file if it fits; if a file does not fit, it SHALL omit that file and continue to later files. Every eligible file omitted because of the budget SHALL be listed. Classification SHALL use the validated path rules and SHALL NOT require an LLM call or infer purpose from file content.

#### Scenario: Diff contains excluded files
- **WHEN** the attached commits change a file whose basename is listed in `lockfileNames` and source files
- **THEN** only the source file changes are sent to the model

#### Scenario: Configured generated paths and GitHub binary files are excluded
- **WHEN** the attached commits change a file under a configured `generatedPathPrefixes` directory, a file GitHub marks as binary, and eligible source files
- **THEN** generated and binary file content is not sent to the model
- **AND** only eligible source file changes are sent to the model

#### Scenario: Diff exceeds the input budget
- **WHEN** the filtered diff is larger than the input budget
- **THEN** no more than 48,000 characters of eligible diff are sent to the model
- **AND** every eligible file omitted to meet the budget is listed
- **AND** excluded files are absent from that list

#### Scenario: Diff selection follows repository path priorities
- **WHEN** the eligible diff exceeds the input budget and the repository has valid path-priority rules
- **THEN** eligible files are considered in domain logic, API handler, test, UI, and other priority order, with paths sorted alphabetically within each group
- **AND** a file that does not fit is skipped while later files are still considered
- **AND** the system includes only whole files and lists all eligible files that did not fit

#### Scenario: Unmatched file path
- **WHEN** an eligible changed file matches no configured path rule
- **THEN** it is assigned to the other priority group

#### Scenario: Renamed files use the destination path
- **WHEN** GitHub diff metadata identifies a rename from a path under a configured generated prefix to an eligible path under the configured tests prefix
- **THEN** the system treats the rename as one file entry, checks exclusions and classifies it using the destination path, and assigns it to the tests priority group
- **AND** the old path does not cause the renamed file to be excluded

#### Scenario: Path rules come from the current default branch
- **WHEN** a check is requested for selected commits and the repository's default branch contains `.acceptance-check.json`
- **THEN** the server resolves that branch's current tip and reads the file at that commit, independently of the selected commits
- **AND** a change to the normalized rules changes the path-rules hash for the same selected commits and criteria

#### Scenario: Path rules are missing, invalid, or unavailable
- **WHEN** the current default-branch tip or `.acceptance-check.json` cannot be read, or the JSON does not match the versioned schema
- **THEN** the system returns HTTP 503 `EVIDENCE_UNAVAILABLE`, does not call the LLM, and creates no check result

#### Scenario: Excluded files do not count as budget omissions
- **WHEN** the changed files include files excluded by `lockfileNames`, `generatedPathPrefixes`, or GitHub's binary diff marking alongside budget-omitted eligible files
- **THEN** the model receives no excluded file content and the omitted-file list contains only eligible files omitted for budget

### Requirement: Check results are reused
The system SHALL reuse a stored result, without calling the LLM, only when the check is requested again with the same set of commits, the same acceptance criteria, and the same normalized repository path rules. The system SHALL identify those inputs using commit-set, criteria, and normalized path-rules hashes. A reused result SHALL return HTTP 200 with `reused: true`, create no duplicate result row or history entry, and tell the assigned developer that the existing result is being shown. A change to normalized repository path rules SHALL allow a new result for the same commits and criteria.

#### Scenario: Same commits, criteria, and path rules
- **WHEN** a check is requested for a commit set, criteria, and path rules that already have a stored result
- **THEN** the stored result is returned with HTTP 200 and `reused: true`, and no LLM call is made
- **AND** no duplicate check-result row or history entry is created
- **AND** the developer is told that the existing result is being shown

#### Scenario: Path rules changed
- **WHEN** a check is requested for the same commits and criteria as a stored result, but repository path rules have changed
- **THEN** the existing result is not reused and the system assesses the diff using the normalized rules read from the current default-branch tip

#### Scenario: Equivalent path rules normalize identically
- **WHEN** the current configuration has duplicate entries or entries in a different array order but contains the same rules
- **THEN** the normalized path-rules hash is unchanged and the matching stored result is reused

#### Scenario: Distinct check results remain in history
- **WHEN** a new result is stored for a different commit set, criteria hash, or normalized path-rules hash
- **THEN** the result remains visible in task-detail history to the assigned developer and the project's product manager
- **AND** the product manager can read results but cannot initiate or alter a check

#### Scenario: Result stores the selected-set anchor
- **WHEN** a check result is stored
- **THEN** its existing JSONB result stores the SHA of the unique selected commit that descends from every other selected commit
- **AND** no schema migration is required solely to store this value

#### Scenario: Selected set has one tip
- **WHEN** one selected commit descends from every other selected commit
- **THEN** that commit's SHA is stored as the result's anchor SHA

### Requirement: Check history is visible to both roles
The system SHALL let the assigned developer run checks and view their distinct stored history through task detail. The product manager SHALL have read-only access to that history through task detail and review responses. Task-detail and review responses SHALL expose `checkHistory`, with one entry per distinct stored result ordered by `createdAt` descending then `id` descending. Each entry SHALL contain the result ID, anchor SHA, creation timestamp, redaction flag, and result payload. Duplicate cache reuse SHALL NOT create a separate history entry. The task-detail GET envelope and its role access are defined by the task-management requirement "Authorized members read task detail".

#### Scenario: Product manager reviews a submission
- **WHEN** the product manager opens a task in In Review
- **THEN** the result referenced by that submission, if any, is shown alongside the attached commits
- **AND** the task's distinct `checkHistory` is available

#### Scenario: Both roles can read check history
- **WHEN** the assigned developer or the product manager opens task detail
- **THEN** they can view the task's distinct stored check results in stable newest-first order, with result ID as the tie-breaker for equal creation timestamps
- **AND** a product manager has no action to initiate or edit a check

#### Scenario: Submission references a matching check
- **WHEN** the assigned developer submits a task and a stored check has an anchor SHA matching the unique tip of the submitted commit history and a criteria hash matching the current acceptance criteria
- **THEN** the submission event references that check result
- **AND** the review response presents the referenced result and the task's `checkHistory`

#### Scenario: Submission has no matching check
- **WHEN** the assigned developer submits a task and no stored check has both an anchor SHA matching the unique tip of the submitted commit history and a criteria hash matching the current acceptance criteria
- **THEN** the submission carries no check-result reference
- **AND** all stored check results remain in `checkHistory`

#### Scenario: Redaction note is conditional
- **WHEN** a check's assessed input had one or more secrets redacted
- **THEN** the developer and product manager see a concise note that secrets were redacted before assessment
- **WHEN** no secret was redacted
- **THEN** no redaction note is shown

#### Scenario: Check errors use the API error contract
- **WHEN** the check route refuses a request for rate limiting, quota, provider unavailability, AI failure, or invalid model output
- **THEN** it uses the existing HTTP 429 `RATE_LIMITED` or `QUOTA_EXCEEDED`, HTTP 503 `AI_UNAVAILABLE`, or HTTP 502 `AI_ERROR` or `INVALID_OUTPUT` error as applicable
- **AND** protected errors use `{ "error": { "code": "...", "message": "..." } }` without provider details

### Requirement: Submission can look up the committed tip
The system SHALL provide the task lifecycle a read-only lookup that returns the unique tip of a task's attached commits, or no tip when none can be determined. The lookup SHALL NOT start a check, call the LLM, or write task state, and a submission SHALL use it before its database transaction begins.

#### Scenario: Unique tip found
- **WHEN** one attached commit descends from every other attached commit
- **THEN** the lookup returns that commit's SHA

#### Scenario: No tip or unavailable evidence
- **WHEN** the attached commits have no unique tip, there are none, or GitHub or the repository path rules are unavailable
- **THEN** the lookup returns no tip, the submission proceeds without a check reference, and no check is started

### Requirement: AI check does not decide task completion
The system SHALL NOT use a check result to approve, reject, submit, or change the state of a task. Only the project's product manager may approve or request changes on a submitted task.

#### Scenario: Check is generated
- **WHEN** the system generates a check result
- **THEN** the task state is unchanged
