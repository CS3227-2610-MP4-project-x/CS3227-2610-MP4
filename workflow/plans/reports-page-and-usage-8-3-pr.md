## Summary

Adds the signed-in project workspace with project creation and membership management, PM task controls, developer progress/submission journeys, review queues and project dashboards. GitHub task evidence and the Acceptance Criteria Check provide validated, cited assistance through the existing server-only AI gateway; only the project's PM can approve or request changes.

Completes the PM Progress Report journey: choose up to seven inclusive SGT dates and explicitly generate a report grouped by developer, with task links, reuse status and unavailable-evidence warnings. Opening the page does not generate. Fresh input, current PM access and concurrent-publication guards protect report reuse and storage. Server-owned redaction counts survive persistence and verified reuse; legacy unknown counts regenerate, and positive counts receive a disclosure without secret values.

Adds a PM-only Project Settings AI usage panel and read-only project usage API. Daily feature totals separate settled charges, pending reservations and cache hits, use SGT boundaries, filter to the configured environment and expose no person breakdown. Developers receive neither the panel nor usage data.

The full branch also includes additive database migrations, the product-information website, user/developer documentation, tests and workflow evidence. This draft covers the complete branch delta against cached `origin/master` at `b78a787a2b2c160d72038c85dc4cab70c49a46db`, including inherited changes before task 8.3. No fetch was performed; the branch has no upstream. Task 8.3 is marked implementation-complete; OpenSpec tracks 28/33 tasks complete.

## Validation

- Final lint, TypeScript, production build and whitespace checks passed. The 45 task 8.3 source/test/spec/migration files matched the tested SHA-256 manifest before the product commit.
- Unit suite: 2,398 tests passed across 69 files.
- Isolated synthetic PostgreSQL 18 integration suite: 375 tests passed across 25 files, including usage boundaries/isolation, legacy redaction-count migration and concurrent positive-count report publication.
- Intercepted Chromium component harness: 8 checks passed, no failures or page errors. This establishes component behavior, not authenticated Next.js journeys.
- Independent general, frontend, security and fresh final reviews reported no outstanding findings. Source-boundary tests permit the aggregate reader while keeping usage mutations in the gateway repository.
- Strict OpenSpec validation exits 1 for six pre-existing requirement-length warnings in unrelated specifications; no new report/usage warning remains. Evidence and the source manifest are under `workflow/evidence/reports-page-and-usage-8-3/`; review details are in `workflow/handoffs/reports-page-and-usage-8-3.md`.

## Release and follow-up

- Task 8.3 adds `supabase/migrations/20261110090000_report_redaction_count.sql`; shipped migrations were not edited. No dependencies were added. Real-environment migrations were not applied: the updated application requires the report-cache and redaction-count migrations before use. Apply them through the controlled release procedure with a pre-migration backup and restore plan.
- Actual authenticated Next.js navigation/prefetch, session/PM-transfer journeys, full end-to-end journeys, keyboard/screen-reader accessibility, live-provider/adversarial AI evaluation and PostgreSQL 17 compatibility remain unverified. Synthetic database verification used PostgreSQL 18. The application-wide canned fake report mode remains deferred.
- Developer A cross-review, both developers' release-evidence review and human verification of the interaction summary remain pending. Implementation completion is not release approval.
- This is a local PR draft. Nothing was pushed, no PR was opened and no production deployment or migration was performed.
