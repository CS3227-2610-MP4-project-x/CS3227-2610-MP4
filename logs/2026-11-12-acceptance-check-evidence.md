# Acceptance criteria check evidence investigation and fixes

Human verification: pending review. One summary for this chat session in this repository.

The user first requested discount validation/rounding and later tests in a sibling test repository. Those changes have a summary in that repository; no sibling changes form part of this implementation.

The user then requested investigation of acceptance-check history, diff packaging, file-grouped evidence and SoCLaaS token limits. Inspection found globally unique normalized-line verification can downgrade valid-looking evidence, flat prompt/output evidence, and missing context preflight. Read-only official metadata was checked without sending code/prompts.

The user authorized resolving these issues through the agent workflow, including wrapping long excerpts and grouping by file, while excluding task-specific commit cleanup. The user explicitly selected2,000 output tokens, approved the compact-reference/correction/diagnostic contract, and approved adding/testing a distributed per-key limiter migration without applying it hosted. The user asked why adapter changes and shared-key enforcement were needed; the assistant explained provider metadata belongs in the adapter and per-key limits span users/instances/retries.

Analyst and planning recorder updated specifications first. Independent test-writer and implementation workers used assigned paths/isolated checkouts. Frontend review reproduced mobile overflow; independent reviewer found lost semantic diff metadata, which was fixed and regression-tested. Final evidence preserves legacy history and shows new excerpts by file/commit with wrapping, bounded prompts/retries and safe provider limits.

Final checks:2,469 unit tests and382 local PostgreSQL integration tests passed; TypeScript, application/test ESLint, scoped whitespace and webpack production build passed. Default Turbopack build remained blocked by local port-binding permissions. Full lint retained4 pre-existing generated website errors; unrelated guide whitespace/edits were preserved. OpenSpec validation exit0 with long-requirement warnings. Independent reviewer reported no remaining product findings after fixes.

No dependencies, hosted migrations, inference smoke calls, deployments, commits, pushes or PRs. Build regenerated next-env.d.ts. Visual diff artifacts and complete changed-file/evidence/resource records are in workflow/handoffs/acceptance-check-evidence.md. Provider resource metrics not surfaced are recorded as not available. Human cross-review, this summary's verification, and controlled migration/release remain pending.
