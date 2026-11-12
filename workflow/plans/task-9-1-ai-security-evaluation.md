# Task 9.1 orchestration plan

## Scope

Complete approved OpenSpec task 9.1 on `feat/verification-ai-security-9-1`, branched from `dev`. Use synthetic prompt-injection and secret-redaction cases against the live SoC LLM in development for both AI features, and retain sanitized outcomes without asserting exact model prose.

## Assignments and dependencies

1. Analyst: inspect task requirements, safeguards specification, implementation seams, and prior decisions. No writes.
2. Root implementation/evaluation: add the isolated opt-in live evaluation fixture and run it against development using synthetic data.
3. Reviewer: independently inspect the fixture and supplied execution evidence; no writes or provider access.
4. Root/orchestrator: complete static checks, write sanitized evidence, handoff and interaction log, then mark 9.1 complete.

The review depends on the completed fixture and live-run evidence. No UI work, migrations, service changes, dependency additions, commits, pushes, or PR actions are in scope. Existing user-guide edits remain untouched.

## Acceptance

- Both Acceptance Criteria Check and Progress Report exercise injection and secret redaction against the live development provider.
- Outputs pass feature validation; redaction and prompt-containment outcomes are recorded without retaining raw prompt/output content or asserting exact prose.
- Evaluation output makes no task-state mutation; record limitations of synthetic task-state checks and heuristic report-claim checks.
- Record source revision, environment, command, results and evidence path; complete reviewer inspection, applicable static checks, task handoff, and session interaction summary.
