# E2E commit-picker date fix: AI interaction summary

Date: 13 November 2026 (SGT). Human verification: approved.

The human pasted a failing CI `e2e-role-journeys` run and asked for a fix. Two Chromium journeys timed out waiting for a commit checkbox in the commit-picker dialog: the developer journey, and the acceptance-provider failure/recovery journey. The other 8 tests passed.

Root cause: `src/server/test-support/e2e-github-adapter.ts` returned its synthetic commit with a fixed authored date, 2026-11-12T04:00Z. The commit picker defaults its range to the current SGT day, and `GitHubEvidenceService.listCommits` drops commits outside the requested window. The journeys passed on 12 November and failed from 13 November because the dialog showed no commits.

Change: the E2E-only fake's `listCommits` now dates the synthetic commit at the requested `since` bound. That bound is inclusive in the service filter. Production code, the service filter, tests, and specifications are unchanged. One file was modified, plus this log.

Checks: `npx tsc --noEmit` and targeted ESLint pass. The Playwright suite was not run locally because the disposable PostgreSQL admin configuration was not available to the agent. CI verification is pending.

Follow-up noted, not changed: `tests/e2e/role-journeys.spec.ts` and its fixture hard-code November 2026 dates: due date 2026-11-30 and report range 2026-11-01 to 2026-11-30. The seeded progress update uses `now()`. These may fail after November 2026.

No dependency, migration, commit, push or PR was made.
