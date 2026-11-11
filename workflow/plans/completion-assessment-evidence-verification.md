# Plan: completion-assessment evidence verification

## Task

- **Task ID:** `completion-assessment-evidence-verification`
- **Human owner:** Developer A (Lim-ZY)
- **Approved requirement:** OpenSpec Task `11.4` and `Requirement: Evidence is verified against the diff` in `openspec/changes/project-task-management/tasks.md` and `openspec/changes/project-task-management/specs/completion-assessment/spec.md`.
- **Approval:** Human approved the initial change, then explicitly clarified and approved broader normalization; current contract is recorded in the active spec and design.
- **Source revision:** `21421393200c64aefe2b3578f9bdfcb8ba7f6acf`
- **Branch / worktree:** `dev`, repository worktree.

## Approved behavior and acceptance evidence

1. Normalize the model quote and each assessed diff-line occurrence by trimming surrounding whitespace, removing exactly one leading unified diff marker (`+`, `-`, or space) when present, then trimming surrounding whitespace again. The second trim handles indentation/spacing following a marker, e.g. `+  return true;` → `return true;`.
2. Verify only exact whole-line matches where the normalized quote maps to exactly one assessed diff-line occurrence. Do not use substring matching.
3. Persist/display the original assessed diff line, preserving its original marker and whitespace.
4. Evidence that maps to multiple occurrences or cannot be mapped remains unverified; any criterion with unverified evidence is downgraded to `unclear` and unverified text is not shown as fact.

## Confirmed file ownership and sequence

Assignments are sequential because tests and implementation share a checkout; no two workers may write concurrently. Initial tests and implementation were completed for the first-marker-only rule, then reviewed against the expanded spec. Root identified that the current helper trims only before marker removal, so a marker followed by indentation does not fully normalize. The current spec/design/task 11.4 explicitly requires trim → remove one marker → trim; the next passes address that gap.

1. **Test-writer** — may edit only `tests/unit/completion-assessment/service.test.ts`. Add a focused case where whitespace follows the marker on both evidence and assessed line, include surrounding whitespace, verify the normalized lines match, and assert that the original diff line is preserved. OpenSpec and implementation are read-only.
2. **Implementer** — after test-writer handoff, may edit only `src/server/completion-assessment/service.ts`. Change normalization to trim surrounding whitespace after removing one marker, preserving the original diff-line representation. Tests and specs are read-only. Use `present-changes-visually` if available and report its artifact or unavailability.
3. **Reviewer** — after implementation, independently revisit the updated approved requirement and the two assigned paths, including second-trim behavior, all acceptance points, cohesion/coupling, abstractions, edge cases, and reported test evidence. No file writes.

The approved requirement/spec and design update are being handled by the root coordinator and are outside these worker write scopes. The orchestrator owns only this plan and `workflow/handoffs/completion-assessment-evidence-verification.md`.

## Prohibited scope

- No edits outside the exact worker path assigned at that phase.
- No migration, API contract, prompt, gateway, UI, AI security evaluation, or unrelated test changes.
- No dependency changes, generated artifacts, commits, pushes, PR actions, or deletion.
- Do not edit or remove the unrelated pre-existing untracked `logs/2026-11-11-add-role-usage-slide.md`.

## Dependencies and status

- Approved Task 11.4 and OpenSpec/design delta must remain available before worker execution.
- Test-writer precedes implementer; reviewer follows implementer. Findings return to the human owner for resolution.
- **Status:** Second-trim implementation, focused checks, and renewed independent review complete; awaiting Developer A review.
- **Checks:** Second-trim pre-fix suite had 96 passed and 1 expected regression failure. Revised implementation focused suite passed 97/97; implementer reports scoped `git diff --check` pass; reviewer independently passed full-worktree `git diff --check`. Orchestrator ran no tests.
- **Resource metrics:** Not available from the platform.
