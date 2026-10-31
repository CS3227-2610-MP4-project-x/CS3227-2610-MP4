# AI interaction summary — 2026-10-30/31 (task 2.3 environment configuration)

- **Human request:** run the agent workflow for task 2.3. The analyst writes a context brief, draft scenarios and open decisions. Stop for approval before code, tests or the handoff.

  After the stop, the human approved the spec. They asked the agent to resolve the open decisions and conflicts as it recommended, and to commit in as many commits as it saw fit.
- **Human decisions:**
  - Approved the `environment-configuration` spec delta. It is a new capability in `proposal.md`.
  - Asked the agent to resolve analyst questions Q1 to Q7 and the source conflicts as it recommended. These are recorded in `design.md`, "Environment Decisions", E1 to E9:
    - server-side Supabase Auth through `@supabase/ssr`, with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, both server-only;
    - the GitHub OAuth secrets are kept only in Supabase;
    - `AI_PROVIDER`, `SOCLAAS_API_KEY` and `SOCLAAS_MODEL`;
    - quotas are code constants;
    - one lazily validated config module;
    - `APP_ENV`, with a later `CHECK` migration in task 6.3;
    - `APP_ORIGIN`;
    - Vercel scopes;
    - `SUPABASE_DB_URL` is listed commented out, which amends the task 2.4 choice.
  - Q8, tester accounts, stays open.
  - Conflict fixes:
    - corrected the `.env.example` ownership text and D16;
    - recorded what remains of task 2.3;
    - added a per-environment sign-in check to task 9.4.
- **Agents (Claude Code subagents):**
  - **Analyst:** context brief, candidate edit paths, draft spec delta, open decisions Q1 to Q8 and conflicts C1 to C3. It edited no files.
  - **Main session:** wrote the approved spec and the design, proposal and tasks edits. `openspec validate project-task-management --strict` passed.
  - **Commit/PR agent:** committed the changes on `feat/data-persistence-env-schema`.
  - The human then asked the agent to continue with the implementation and to explain the Vercel and Supabase setup.
  - **Orchestrator:** wrote `workflow/handoffs/environment-configuration.md` (AC1 to AC14, write paths, human provisioning checklist).
  - **Test-writer:** wrote `tests/unit/environment-configuration.test.ts`. It checks the `.env.example` variable set, placeholders, the absence of `NEXT_PUBLIC_` and of forbidden variables, the `Set in:` comments, and `.gitignore` coverage through `git check-ignore`.
  - **Implementer:** extended `.env.example` with the E1 to E9 variables, added `.vercel/` to `.gitignore`, and added "Environments and configuration" with the human setup steps to `docs/developer-guide.md`.
  - **Reviewer:** reported no must-fix findings. In fix round 1:
    - the guide now follows E8 and E2 exactly instead of adding instructions;
    - the guide cites the SoC key-owner rule;
    - the guide says a human configures `dev` branch protection;
    - the test now requires a `Set in:` line.
  - The frontend agent was skipped because the task has no UI.
  - The human found the setup steps too thin; for example, the GitHub OAuth app homepage and redirect URLs were not spelled out. At the human's request, the main session rewrote "Setting up the environments" in `docs/developer-guide.md` as an ordered runbook, steps 0 to 12, with:
    - a worksheet;
    - the exact Supabase, Vercel and GitHub fields;
    - Vercel variable tables for each scope;
    - PowerShell versions of the commands.

    Two things the decisions do not cover are flagged in the guide as needing a team decision, not decided:
    - Vercel Deployment Protection on the `dev` preview;
    - whether the Supabase Email provider is turned off.

    The redirect-URL path is still deferred to task 3.1. No second review was run on this rewrite.
- **Checks (local, Windows):** `npm run lint` and `npx tsc --noEmit` passed, `npm test` passed 29 of 29, and `next build` passed. The regenerated `next-env.d.ts` was reverted.
- **Not done yet:**
  - human review and commit of the implementation;
  - the human provisioning listed in "Task 2.3 scope after task 2.4" and in the developer guide;
  - ticking task 2.3, after provisioning is confirmed.
- **Also unverified:** the gitleaks result for the new files, until the CI `secret-scan` job runs.
- **Unverified:**
  - the live state of the Supabase projects, the Vercel project and the OAuth apps;
  - whether Vercel Hobby offers branch-specific Preview variables and can deploy this organisation-owned repository (E8).
- **Dependencies added:** none. `@supabase/ssr` and `@supabase/supabase-js` are planned for task 3.1.
- **Secrets:** none recorded.
- **Human verification:** of this summary is pending.
