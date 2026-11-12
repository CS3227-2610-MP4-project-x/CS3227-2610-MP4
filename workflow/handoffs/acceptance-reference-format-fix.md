# Agent task handoff

## Task record

- Task ID: acceptance-reference-format-fix
- Summary: Remove ambiguity between displayed diff reference wrappers and bare source-map keys, and prevent old cached checks from being reused after the prompt/validator contract changes.
- Human owner: Developer A (Lim-ZY)
- Requirement IDs: Existing active OpenSpec Acceptance Criteria Check requirements; no new externally assigned backlog ID.
- Status: Implemented and independently reviewed; existing test fixtures need follow-up updates.
- Next human action: Review the result and decide when to refresh/run the affected tests.

## Source and scope

- Repository / branch / worktree: `CS3227-2610-MP4` / `fix/completion-assessment-evidence-verification` / shared project worktree
- Source revision: `8aa8f76` before this follow-up
- Permitted paths: `openspec/changes/project-task-management/{proposal.md,design.md,tasks.md,specs/ai-safeguards/spec.md,specs/completion-assessment/spec.md}`, `src/server/completion-assessment/{input.ts,service.ts}`, relevant existing completion-assessment tests only if later authorized, and this plan/handoff plus the existing session interaction summary.
- Prohibited paths/actions: `docs/user-guide.md`, `logs/2026-11-11-user-guide-update.md`, unrelated files, git history changes, push/PR, hosted database, deployment, and provider calls unless separately authorized.
- Dependencies and parallel work: Analyst completed the assigned proposal/spec updates; implementation follows. Reviewer is read-only and runs after implementation.

## Decisions and open questions

- Current state: The prompt renderer showed `[[L<n>]]`, but the server source map accepted only bare `L<n>`. Latest diagnostic logs showed all first-attempt references were noncanonical and none matched, causing `unknown_reference` and, for addressed criteria with no verified references, `missing_evidence`.
- Human-approved decisions: Show bare IDs such as `L12`; instruct the model to return only the bare value; normalize only an exact `[[L12]]` wrapper when `L12` exists in this request's source map; add an independent evidence-reference cache version so the previous cache entry is not reused; preserve stored `assessmentVersion: 2` and all historical readers; remove temporary diagnostics when permanent fix is implemented.
- Assumptions: No cache DTO migration or hosted database change is needed; existing unique key supports a distinct effective path-rules hash.
- Open questions / conflicts: None after retaining result DTO v2 and separating cache reference version.

## Worker session reports

### Session analyst / reference-fix

- Role: Analyst
- Human owner and assigned task scope: Developer A; inspect reference/cache contracts and update proposal and requirements only
- Source revision: `8aa8f76` plus existing uncommitted diagnostic instrumentation
- Platform and model: not available
- Resource usage (provider-reported): not available
- Unavailable resource metrics: tokens and cost not available
- Work completed / findings: Confirmed prompt emits wrapped references while validator looks up bare keys. Spec now requires bare prompt IDs, exact-known-wrapper normalization, separate `evidenceReferenceVersion: 2` in the cache fingerprint, and unchanged persisted result DTO v2.
- Files changed: `openspec/changes/project-task-management/proposal.md`; `openspec/changes/project-task-management/specs/completion-assessment/spec.md`; `openspec/changes/project-task-management/specs/ai-safeguards/spec.md`
- Checks run and exact results: `git diff --check` passed; no tests run
- Gaps / blockers: none
- Exploration scope / task question: Why are reference lookups failing and what minimal spec correction will resolve it?
- Compressed repository-context brief: `renderAcceptanceCheckFiles` assigned bare keys (`L1`, `L2`, …) but emitted prompt text as `[[L1]]`; the system prompt asked the model to copy the displayed compact ID exactly. The validator used exact `sourceMap.get(reference)`, so wrapped or otherwise malformed outputs were rejected. Existing check results use `assessmentVersion: 2`; cache fingerprints also used assessmentVersion 2 and normalized path rules. A separate evidence-reference cache version can invalidate the old cache identity without changing stored JSON or adding a migration. The human approved bare prompt IDs, exact wrapper normalization only for known IDs, and a cache-version bump.
- Relevant paths inspected: `src/server/completion-assessment/input.ts`, `service.ts`, `repository.ts`, relevant unit tests, active completion-assessment/AI safeguards specs, active design and prior evidence handoff.
- Candidate implementation paths: `input.ts` for prompt rendering; `service.ts` for exact normalization, instructions and cache version. Existing tests are candidates only; this task did not authorize test edits or execution.
- Dependencies, conflicts, and open decisions: Original draft overreached by changing result schema to v3; corrected to keep DTO v2 and add independent cache version only. No unresolved choices.
- Requirement examples: `L12` appears bare in prompt and resolves; exact `[[L12]]` resolves only if `L12` exists; partial/repeated/whitespace wrappers remain unknown; evidence-reference cache version 1 is not reused under version 2; v2 DTO/history remains readable.

## Consolidated outcome

- Changed files and rationale: `input.ts` now renders bare `L<number>` references. `service.ts` asks the model to return bare IDs, accepts only exact legacy `[[L<number>]]` wrappers whose inner IDs exist in the current source map, uses a true end-of-input check, and salts the cache key with independent `evidenceReferenceVersion: 2` while retaining DTO version 2. Temporary development logging and cache bypass are absent. Proposal/design/spec/task artifacts record the approved contract; task 12.2 is checked complete.
- Tests/checks and results: No tests were added, updated, or run under the higher-priority instruction for this turn. `npx tsc --noEmit` passed; scoped ESLint for both changed server files passed. Strict OpenSpec validation exited 1 on pre-existing long-requirement warnings across active specs. `git diff --check` found trailing whitespace in the unrelated user-guide edit, which was preserved.
- Generated artifacts: Implementer produced `/tmp/acceptance-reference-format-fix-diff.html` for visual inspection; no repository-generated artifacts.
- Dependencies added: None.
- Known gaps and unverified items: Independent review found existing service/input test fixtures still encode the old wrapper and cache hash, so those fixtures likely need updating before the affected suite passes. This is inspection-only; tests were not run. No live provider call was made. Exact historical raw invalid references remain unavailable.
- Reviewer findings: The reviewer initially found that JavaScript `$` could accept a final newline; implementer replaced it with a true end-of-input assertion, and reviewer confirmed the issue resolved. Review also identified the stale test fixtures noted above. No implementation findings remain.
- Next action and responsible human: Developer A reviews the code and determines when the affected tests can be updated and run.

## Change log

| Date/time (SGT) | Role/session | Update |
|---|---|---|
| 2026-11-12 | orchestrator / root | Recorded approved narrow scope and ownership. |
| 2026-11-12 | implementer / reviewer | Implemented bare references, strict known-wrapper compatibility and independent cache version; removed no additional diagnostics because they were already absent. Type/lint passed; reviewer confirmed strict end-of-input matching and reported stale test fixtures. |
