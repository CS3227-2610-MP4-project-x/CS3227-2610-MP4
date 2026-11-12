# PR title

Add PM reporting, verified acceptance evidence and synthetic role journeys

# PR description

Product managers can generate task-cited progress reports and inspect project AI usage. Acceptance checks verify canonical source references, render grouped evidence, and enforce bounded correction, prompt/context budgets and shared provider limits. Complete synthetic developer and product-manager browser journeys now cover submission, request-changes/resubmission, approval, report generation, provider failure/recovery, authorization denial and sign-out.

This draft covers the full branch against `origin/master` (`9ab2ec64c55b68dbfec068e565238223aac0aec4`), including inherited reporting and evidence work. The current task adds the approved E2E contract, a disposable PostgreSQL harness, guarded synthetic authentication/GitHub/AI adapters, six Chromium journey tests, 47 controls tests and a separate CI browser job. Ordinary authentication/provider behavior remains active outside explicit local test mode. No new dependency or migration was added by task 9.2; the full branch includes three previously committed report/provider migrations that still require a controlled release.

Validation recorded in the task 9.2 handoff:

- Lint, TypeScript and production build passed.
- Isolated final unit run: 78 files / 2,579 tests passed. An earlier concurrent build/unit run had five timeout failures; the isolated rerun passed.
- Synthetic PostgreSQL 18.6 integration run: 28 files / 388 tests passed before the final harness-only fixes.
- Fresh local Chromium run: six journeys passed, exit 0, retries disabled. Earlier failures and restricted-sandbox teardown limits remain recorded in the evidence manifest.
- Final independent review: zero must/should/nit findings; security pass recorded no additional findings after fixes.
- Strict OpenSpec validation exits 1 with 17 existing long-requirement warnings in untouched capability specs; no new E2E/CI warnings. Whitespace checks passed.

These results are task 9.2 session evidence, not a new release validation of every inherited commit. Full CI verification remains pending; the subsequent secret-scan failure and local correction are recorded below. Task 9.2 is checked as implementation complete following the human-approved D7 closeout clarification; CI execution remains explicitly pending, and the checkbox does not claim CI verification or release readiness. Synthetic sessions do not verify deployed OAuth or live providers; tasks 9.1, 9.3 and 9.4 retain their live security, accessibility and deployment checks. Developer A cross-review and human interaction-summary verification remain pending. Hosted migrations, deployment and production checks have not been performed by this task.

Task commits: specification `7ca02ca913b8aa37b1bf896ce24e47debf6583d6`; implementation `3b68867a22e710c24771ba4bd43cc8786efe29f3`. The human-approved implementation-completion clarification and workflow/log/evidence closure are recorded by the documentation commit containing this draft; its SHA is available in git history. No push, PR creation or merge is authorized by this draft.


CI follow-up: the secret scan reported three historical synthetic E2E values. The correction generates and masks signing material per run, simplifies two nonfunctional placeholders, and records only three independently reviewed exact historical fingerprints. Local gitleaks 8.30.1 full-history/current-directory scans pass; an unrelated negative control remains detected. The exact Bash generation step, launcher syntax, targeted lint and independent review pass. Remote CI rerun remains pending; no history rewrite or broad allowlist was introduced.
