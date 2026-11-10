## Summary

Adds the signed-in project workspace with product-manager task controls, developer task journeys, review queues, project dashboards and membership management. GitHub App repository linking and task-attached commit evidence support the Acceptance Criteria Check, using a server-only LLM gateway with validation, redaction, quotas and usage accounting.

Completes backend Progress Report generation: product managers request bounded inclusive SGT ranges, every statement is validated against authorized task citations, and unchanged complete input can reuse a stored report. Activity, context, deletion and evidence changes invalidate reuse. Publication guards current PM access, concurrent report versions and database freshness across network calls and insertion waits; unavailable GitHub evidence remains explicit and partial reports are regenerated.

The full branch also includes additive PostgreSQL migrations, the product-information website, developer/user documentation, agent usage tooling and recorded workflow evidence. This draft covers the complete branch delta against local `master` (`1d53b31c677f4a8be163a5404948f2e4338c236e`), not only the latest report commit. No remote refresh was performed for this inventory.

## Validation

- Final local lint, TypeScript, production build and whitespace checks passed.
- Unit suite: 2,343 passed across 62 files.
- Disposable PostgreSQL 18 integration suite: 369 passed across 23 files, including report invalidation, competing publication, PM transfer and insertion-conflict regressions.
- Task 8.2 independent review: initial 3 must/1 should, fresh round 1 found 2 remaining must findings, fresh round 2 returned zero findings. Both permitted fix rounds are recorded in `workflow/handoffs/reports-generation-8-2.md`.
- Strict OpenSpec validation exits 1 for six pre-existing length warnings in unrelated specifications; no Progress Report warning or error remains. Evidence is in `workflow/evidence/reports-generation-8-2/`.

## Release and follow-up

- Apply the new report-cache migration only through the controlled release procedure with a pre-migration backup and restore plan. No production migration or deployment was run.
- Task 8.3 report/usage UI, full authenticated journeys, live-provider evaluation and Developer A's adversarial AI evaluation remain unverified or deferred. Default fake-provider behavior is unchanged; scripted fakes establish the reported generation paths.
- Developer A API/composition cross-review, both developers' release-evidence review and human verification of the session interaction summary remain required.
- This is a local PR draft. Nothing has been pushed and no PR has been opened.
