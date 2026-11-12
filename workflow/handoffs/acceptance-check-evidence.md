# Acceptance check evidence and bounded prompts

## Task record
- Task ID: acceptance-check-evidence (work label; no backlog ID asserted)
- Summary: compact occurrence references, verified evidence grouped by file, diagnostic statuses, bounded prompts/retries, contract-versioned reuse, wrapping evidence UI.
- Human owner: Developer A for acceptance checks/UI; Developer B coordination for shared usage persistence if authorized.
- Requirement IDs: existing named completion-assessment and ai-safeguards requirements; task numbers pending approved artifact update.
- Status: implementation and independent review complete; human verification/release pending.
- Next human action: review final implementation/evidence. Output cap decided: 2,000.

## Source and scope
- Repository: current workspace. Branch: docs/user-guide; no branch/history mutations authorized.
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Preserve unrelated docs/user-guide.md edits and logs/2026-11-11-user-guide-update.md.
- Prohibited: git history/GitHub actions, hosted migrations, secrets/prompt logging, task mutations, deleting project files, task-specific commit cleanup.
- Worker writes will be sequenced in this worktree, with exact scopes recorded before assignment.

## Decisions and open questions
- User approved resolving investigated issues through agent workflow and file grouping/wrapping UI.
- Human selected recorded 2,000-token output cap.
- Human approved compact refs, server-built grouped excerpts, model/final statuses with reasons, bounded correction then explicit Unclear warning; distributed per-key database limiter and new unapplied migration.

## Worker session reports

### Session root / orchestration
- Provider: codex
- Provider session ID: 01a1cd77-9f9d-7f20-8b7e-a25a676824b1
- Work ID: acceptance-check-evidence
- Agent: orchestrator
- Phase: completed implementation coordination
- Platform/model: Codex; model not available
- Role: orchestrator
- Human owner and scope: Developer A, coordination and handoff only
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage: not available
- Unavailable metrics: tokens, cache read/write, cost, elapsed
- Completed: inspected role contracts, OpenSpec status and apply instructions; requested explicit unresolved decisions.
- Files changed: this handoff; interaction summary.
- Checks: OpenSpec root found; project-task-management schema spec-driven, 34/40 tasks complete before this scope.
- Gaps: implementation not started.

### Session analyst / analyst
- Platform/model: Codex; model not available
- Role: analyst
- Human owner and assigned scope: Developer A acceptance assessment, shared gateway/usage persistence coordination with Developer B
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage and unavailable metrics: not available
- Findings: global normalized line matching rejects repeated braces; flat evidence loses provenance; current UI overflow-x-auto allows intrinsic-width growth. Compact refs need one server-side source map. Legacy history must not receive guessed attribution. Two calls total must include correction. Final prompt size must account for wrappers and metadata. Contract cache version must preserve canonical criteria/commit hashes used by submission.
- Source index: openspec/changes/project-task-management/specs/completion-assessment/spec.md; specs/ai-safeguards/spec.md; specs/data-persistence/spec.md; design.md; src/server/completion-assessment/{input,service,repository}.ts; src/server/ai/{gateway,output,limits,usage-port}.ts; src/components/completion-assessment/{check-history,developer-check-panel}.tsx; specs/ui-spec.md.
- Candidate paths: source index plus relevant tests/unit/completion-assessment, tests/unit/ai and persistence tests if authorized. Exact assignment pending.
- Acceptance examples: repeated lines uniquely addressable; mixed invalid refs get bounded correction; long excerpts wrap; source/tests separate; legacy history readable; new contract bypasses old cache.
- Files changed: none
- Checks: targeted source inspection and working-tree status.
- Gaps: pending human decisions.

## Change log
- 2026-11-12: analysis started; no implementation or approvals inferred from agent output.

## Confirmed worker scopes and sequence
1. Analyst: only completion-assessment, ai-safeguards, data-persistence delta specs and specs/ui-spec.md.
2. Planning recorder: only existing proposal.md, design.md, tasks.md, after analyst completes writes; record approved decisions without new product decisions.
3. Test-writer: tests/unit/completion-assessment/, tests/unit/ai/, new tests/unit/provider-call-repository.test.ts, new tests/integration/db/provider-call-limit.test.ts, and existing related tests/unit/task-pages/ only if fixture compatibility requires it. AI security/evaluation fixtures excluded.
4. Backend implementer: src/server/completion-assessment/ (except snapshot and submission semantics), src/server/ai/, src/server/repositories/provider-call-repository.ts (new), src/server/composition.ts minimal wiring, supabase/migrations/20261112120000_provider_call_limit.sql (new). No tests, specs, guides, or other services.
5. UI implementer: src/components/completion-assessment/check-history.tsx, developer-check-panel.tsx and optional local pure DTO helper in that directory; no other UI without scope update.
6. Frontend and reviewer: read-only code/browser verification.
Main-checkout worker writes are sequenced. UI implementation runs in the isolated detached worktree /tmp/mp4-acceptance-ui-01a1cd77 based on the same source revision, with approved artifacts and UI tests copied in; only owned UI files will be integrated after review. Root consolidates reports.

### Approved concrete recording
- New model response: criteria with criterionId/status/evidenceRefs, possibleGaps only.
- New stored payload assessmentVersion2; retain evidence:[] for compatibility and evidenceFiles grouped by file/commit/hunk; optional modelStatus/verification diagnostics. Legacy flat results preserved.
- Effective pathRulesHash = SHA256 compact JSON {assessmentVersion:2,pathRulesHash:<canonical normalized rules hash>}.
- 48,000 final redacted/escaped system+user message-content UTF16 units, including fixed instructions and 1,024-character bounded correction headroom; 2,000 output tokens.
- At most two total inference calls; safe criterion-ID/reason-code feedback only; no raw response replay. Missing/unknown refs corrected once then safely downgraded.
- Model context preflight uses UTF8 bytes plus 2,000 output and 1,024 framing allowance against official fetched model context. Metadata <=60-second per-instance cache; no stale fallback.
- Distributed per-key rolling60-second permit before each attempted inference, based on official fetched rate metadata; SHA256 credential fingerprint only. New tables owned by usage/provider-call repository, least-privilege runtime; no transaction across inference call. Hosted migration not applied.

## Initial validation and UI baseline
- OpenSpec validate project-task-management --strict: exit 0, long-requirement warnings only (existing and revised requirements); no structural error reported.
- Baseline tests/unit/completion-assessment + tests/unit/ai: 13 files, 632 tests passed.
- Initial new UI tests: 7 expected failures, 54 passes; v2 groups/diagnostics/wrapping not implemented yet.
- Frontend baseline: signed-in Developer, assigned local task route, IAB2/tab1. At320px viewport document width582px and acceptance panel512.875px; existing evidence flat/unlabelled. At1280px no equivalent widening. No check or task mutation.
- Local PostgreSQL17 container mp4-acceptance-evidence-pg, localhost54339, synthetic trust connection. No hosted DB touched.
- UI implementer separate worktree scope: check-history.tsx, developer-check-panel.tsx, optional local pure DTO validator; no tests/specs/shared files.
- Frontend baseline resources: tokens/model/exact child session ID/cache/cost not available.
- Test-writer initial session: changed only tests/unit/completion-assessment/check-panel.test.tsx; red result above; other metrics not available.
- Planning recorder: only approved design/proposal/task artifacts edited; scoped whitespace check passed, metrics not available.

## Consolidated worker reports and outcome

### Session planning recorder
- Provider: codex; exact child session ID/model: not available
- Role: records already human-approved planning decisions; no independent architecture approval
- Human owner and scope: Developer A; proposal/design/task records only
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage / unavailable metrics: tokens, cache, cost, time not available
- Completed: recorded approved superseding contracts; final tracking marks12.1–12.6 done,12.7 pending; OpenSpec40/47 complete (other existing project work remains).
- Checks: scoped whitespace passed.
- Gaps: human cross-review/disclosure verification/release pending.

### Session backend implementer
- Provider: codex; exact child session ID/model: not available
- Role: implementer
- Human owner and scope: Developer A assessment/gateway; Developer B review for usage persistence. Main checkout assigned server paths, new provider permit repository/migration; one authorized legacy UI sentence.
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage / unavailable metrics: tokens, cache, cost, time not available
- Completed: compact occurrence references, server-built grouped excerpts, safe model/final diagnostics, max2 correction/schema calls, complete prompt accounting, 2,000 output tokens, model capability/context preflight, atomic shared-key permits, versioned cache and strong v2-write/legacy-read types.
- Checks: own297 tests/6files passed; scoped ESLint and TypeScript passed. Consolidated broader results below.
- Visual diff: /tmp/acceptance-check-backend-diff.html. Includes complete worktree, including preserved pre-existing unrelated guide changes.
- Dependencies: none. Migration not applied hosted. No live inference.
- Gaps: controlled hosted release pending.

### Session UI implementer
- Provider: codex; exact child session ID/model: not available
- Role: implementer
- Human owner/scope: Developer A; two completion-assessment component files in isolated /tmp/mp4-acceptance-ui-01a1cd77; root integrated only assigned source files.
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage / unavailable metrics: not available
- Completed: file/commit groups and separate contiguous excerpts, strict v2/legacy response validation, wrapping paths/code and constrained containers, explicit verification warnings. Backend added reviewer-requested legacy provenance sentence afterward.
- Checks: own61 UI tests, TypeScript, scoped ESLint and whitespace passed.
- Visual diff: /tmp/acceptance-ui-diff.html (isolated snapshot, includes copied approved planning/test context).
- Dependencies: none.

### Session test-writer
- Provider: codex; exact child session ID/model: not available
- Role: test-writer
- Human owner/scope: Developer A behavioral tests; Developer B persistence coordination. Isolated /tmp/mp4-acceptance-tests-01a1cd77; root integrated12 assigned test files. Existing human-owned AI security fixtures/cases preserved.
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage / unavailable metrics: not available
- Completed: positive/boundary/failure tests for refs, metadata, grouping, retries, budgets, context, capabilities, cache/history, wrapping, permits, DB concurrency/least privilege and canonical submission hashes. Migrated old model fixtures to approved compact schema.
- Red/green evidence: initial7 new UI cases failed/54 passed; final UI62 cases pass within full suite. Relevant isolated17files/671tests passed; own TypeScript/scoped ESLint/whitespace passed. Root performed final full tests below.
- Evidence: /tmp/mp4-acceptance-targeted-results.txt.
- Gaps: no live-model security evaluation; reserved to human and not part of this scoped change.

### Session frontend
- Provider: codex; exact child session ID/model: not available
- Role: read-only frontend QA
- Human owner/scope: Developer A acceptance-check UI
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2
- Resource usage / unavailable metrics: not available
- Independent baseline: signed-in Developer task route, IAB2/tab1,1280 and320×800; flat unlabeled excerpts and mobile document582px/panel512.875px reproduced.
- Independent final source review: grouped file/commit/excerpt rendering, wrapping/constrained parents, strict parser and safe diagnostics match intent. Found missing legacy provenance label; implementation fixed and source rechecked.
- Root-supplied runtime evidence: actual component+application CSS rendered with synthetic v2+legacy DTOs at localhost3011;320 viewport document305px/card215.2px, code126.4px or152px with matching scroll widths;1280 viewport document1265px/card1030.4px. Long600-character code/path wraps, separate files/commits/excerpts visible, downgrade warning distinct.
- Root directly rechecked actual assigned localhost3000 task route after implementation: historical result opens; provenance label present;320 viewport document305px/panel215.2px/code152px,pre-wrap/break-all. No check or task mutation. Browser viewport reset.
- Files changed: none.
- Findings: none remaining; final rendered checks were root-operated because frontend agent's final browser scope was unavailable. Screenshots and DOM measurements are in chat tool evidence.

### Session reviewer
- Provider: codex; exact child session ID/model: not available
- Role: independent read-only reviewer
- Human owner/scope: Developer A scope; usage/migration boundary for Developer B human cross-review
- Source revision: 9035636ae1437853720682e18a28ed4e8c4402e2 plus working tree
- Resource usage / unavailable metrics: not available
- Found P2: stripping all pre-hunk metadata made rename/mode-only changes unassessable. Implementer fixed meaningful mode/rename/create/delete/EOF preservation with stable refs, while removing redundant transport headers.
- Follow-up: actual renderer probes for mode/rename/create/delete/EOF all5 passed; priorP2 resolved; no remaining product findings. Every scoped acceptance area met by source/tests, DB local-only, human release pending.
- Quality: service/gateway/adapter/repository boundaries cohesive; no task mutation or credential coupling. Parallel legacy helper remains a minor maintenance consideration; new runtime-path tests cover live helpers.
- Checks: own scoped ESLint and whitespace passed; no files modified, no approval/merge asserted.

## Final verification evidence
Environment: local Node24.20.0, Next16.4.3, disposable PostgreSQL17. Source: uncommitted working tree based on9035636ae1437853720682e18a28ed4e8c4402e2. Commands and terminal evidence are in this chat.

- `npm test`: PASS,70files/2,469tests. Escalated local process permissions required for repository git/hook tests; initial sandbox-only run failed those environmental checks.
- `TEST_DATABASE_URL=<disposable localhost54339> npm run test:integration`: PASS,26files/382tests. Applies migrations only to per-file synthetic disposable databases; verifies concurrent permits, grants, Data API denial, all existing integrity and submission semantics. Initial one old flat-model fixture was migrated, then full suite passed. No hosted credentials used.
- `npm run typecheck`: PASS after final fixture/type integration. Production webpack build TypeScript also passed.
- `npx eslint src tests`: PASS.
- `npm run lint`: blocked by4 pre-existing generated vendor-JS errors in product-website/_site/markbind/js (files dated6November); unrelated output/config preserved.
- `npm run build`: Turbopack blocked by OS process/port-binding EPERM, including requested escalation.
- `npm run build -- --webpack`: PASS, optimized production build, TypeScript, static generation and route manifest. Supported fallback used without changing package/config.
- OpenSpec strict validation: exit0, long-requirement warnings for existing/revised requirements; no structural errors.
- Scoped whitespace check across assigned source/tests/specs/workflow/log: PASS. Whole-tree check retains unrelated docs/user-guide.md:45 trailing whitespace.
- No dependency/lockfile change; no intentional file deletion; no hosted migration/inference, deployment, commits, pushes or PR.

## Changed files
- logs/2026-11-12-acceptance-check-evidence.md
- next-env.d.ts
- openspec/changes/project-task-management/design.md
- openspec/changes/project-task-management/proposal.md
- openspec/changes/project-task-management/specs/ai-safeguards/spec.md
- openspec/changes/project-task-management/specs/completion-assessment/spec.md
- openspec/changes/project-task-management/specs/data-persistence/spec.md
- openspec/changes/project-task-management/tasks.md
- specs/ui-spec.md
- src/components/completion-assessment/check-history.tsx
- src/components/completion-assessment/developer-check-panel.tsx
- src/server/ai/fake-adapter.ts
- src/server/ai/gateway.ts
- src/server/ai/index.ts
- src/server/ai/llm-adapter.ts
- src/server/ai/output.ts
- src/server/ai/soclaas-adapter.ts
- src/server/ai/usage-port.ts
- src/server/completion-assessment/index.ts
- src/server/completion-assessment/input.ts
- src/server/completion-assessment/repository.ts
- src/server/completion-assessment/service.ts
- src/server/composition.ts
- src/server/repositories/provider-call-repository.ts
- supabase/migrations/20261112120000_provider_call_limit.sql
- tests/integration/db/provider-call-limit.test.ts
- tests/integration/db/submission-tip-lookup.test.ts
- tests/integration/db/support/fixtures.ts
- tests/unit/ai/gateway.test.ts
- tests/unit/ai/provider-capabilities.test.ts
- tests/unit/ai/provider-limits.test.ts
- tests/unit/completion-assessment/check-panel.test.tsx
- tests/unit/completion-assessment/input.test.ts
- tests/unit/completion-assessment/route.test.ts
- tests/unit/completion-assessment/service.test.ts
- tests/unit/completion-assessment/submission-tip.test.ts
- tests/unit/provider-call-repository.test.ts
- workflow/handoffs/acceptance-check-evidence.md

## Generated artifacts and release boundary
- `next-env.d.ts` was regenerated by the production build: generated route/root-parameter type imports now target `.next/types/` instead of `.next/dev/types/`. Kept generated output current; no manual application behavior change. `.next/` and tsbuildinfo remain ignored.
- Visual diff artifacts listed above are complete working-tree snapshots and include preserved unrelated guide changes; those changes are not part of this task.
- Synthetic UI fixture: /tmp/acceptance-check-ui-fixture/index.html (initial grouping/wrapping snapshot); final legacy label separately verified on actual task route and in tests.
- Temporary isolated worktrees remain under /tmp for review; no file deletion or git history action performed.
- New migration: supabase/migrations/20261112120000_provider_call_limit.sql. Local migration verified; hosted execution explicitly not performed. Before hosted release, responsible operator obtains a pre-migration backup and records a tested restore plan; apply additive migration before enabling revised real-provider calls, verify runtime/API grants, then run a controlled real-provider smoke check. Missing permit table fails safely without inference. Rollback/restore and app revision selection remain controlled human actions.
- Human next action: Developer A/B cross-review code and local evidence, verify this interaction summary, then separately authorize named-branch commits and controlled migration/release as desired. Task12.7 remains pending. No agent self-approval asserted.
