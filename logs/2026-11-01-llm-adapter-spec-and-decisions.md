# AI interaction summary — 2026-11-01

- Human request: run the agent workflow for OpenSpec task 6.1 (SoC LLM adapter and deterministic fake adapter) in `project-task-management`. Use the analyst agent to produce a context brief, candidate edit paths, and missing scenarios with open decisions, then stop for approval without writing code, tests, or the handoff.
- Analyst (Claude Code subagent): produced a source-linked brief, candidate edit paths under `src/server/ai/` and `tests/unit/ai/`, a draft adapter requirement for `ai-safeguards`, and eight open decisions (D1–D8). It found no conflict between sources and changed no repository files. Its resource metrics were not available beyond what the platform reported.
- Human decision: approved the spec delta, and asked the agent to resolve D1–D8 as it recommended, update the relevant docs, and commit in as many scoped commits as it saw fit.
- Files changed:
  - `specs/ai-safeguards/spec.md`: added the approved requirement "The LLM provider is behind a replaceable adapter" with four scenarios, unchanged from the draft.
  - `design.md`: new "LLM Adapter Decisions" section recording D1–D8. D3 defers configuration loading and composition-root wiring to task 6.3 (or 3.1/5.1 if first), amending E5's task list.
  - `docs/developer-guide.md`: the configuration-module note now names tasks 3.1, 5.1, and 6.3.
- Checks: `openspec validate project-task-management --strict` passed. No application code, tests, handoff, or dependencies were added.
- Commits: created on `feat/llm-gateway-soc-adapter` as authorized. No push or pull request.
- Human follow-up: start the orchestrator, test-writer, and implementer for task 6.1 against the recorded decisions. Task 6.3 must wire `AI_PROVIDER` selection and confirm the Route Handler maximum duration covers two 60-second calls.
- Human has approved the changes. No secrets recorded.

## Implementation run (same session)

- Human request: run orchestrator, test-writer, implementer, and reviewer (frontend skipped, no UI) for task 6.1, with at most 2 fix rounds, then run lint, type-check, tests, and build. Do not commit. The prompt's placeholders were unfilled; the agent used slug `llm-gateway-soc-adapter`, task 6.1, implementer paths `src/server/ai/{llm-adapter,soclaas-adapter,fake-adapter,index}.ts`, and test paths `tests/unit/ai/`.
- Orchestrator: wrote `workflow/handoffs/llm-gateway-soc-adapter.md` (AC1–AC17, assumptions A1–A5, questions Q1–Q4). Q4 found a conflict between the spec ("returns that model name") and D2 (use the provider response's model); it was escalated to the human, and tests were told not to assert the differing case.
- Test-writer: added `tests/unit/ai/soclaas-adapter.test.ts`, `fake-adapter.test.ts`, and `source-boundaries.test.ts`; confirmed they failed before implementation.
- Implementer: added the four `src/server/ai/` files. No dependency added. Choices on unresolved points: response model used when a non-empty string; empty-string content accepted; fake estimate rounds up; no refusal of `default`; a timeout while reading a 2xx body is `timeout`.
- Reviewer: no blocking findings. Two should-fix items in tests (AC3 test cannot detect a differing response model; the boundary test forbidding `src/server/config/` and `composition.ts` will break task 6.3) and seven nits. No fix round was run, because neither item is in the implementer's paths and the first depends on the human's Q4 ruling.
- Checks at `30cc2a8` plus working tree: `npm run lint` passed, `npx tsc --noEmit` passed, `npm test` 112/112 passed, `npm run build` passed. `npm run build` regenerated the tracked `next-env.d.ts`.
- Not committed. Human has approved the changes. No secrets recorded.

## Q4 ruling and live assumption checks (same session)

- Human decision: resolve Q4 by following D2. The "Pinned model is used" scenario in `specs/ai-safeguards/spec.md` now says the result carries the model the provider reports, or the configured model if none; `openspec validate --strict` passed. The test-writer added tests for a differing response model and for unusable response model values (`tests/unit/ai/soclaas-adapter.test.ts`).
- Human request: explain how to confirm assumptions A1–A3, and verify them with scripts using the development SoCLaaS key in `.env.local`. The agent wrote two probe scripts outside the repository; they read the key without printing it, and no key appeared in any output.
- Live results (development key, 1 November 2026): A1 confirmed (OpenAI-style body; `choices[0].message.content` string; `model` echoed as `qwen3.6:35b`; integer `prompt_tokens`/`completion_tokens`; `reasoning_effort: "none"` accepted). Errors are `{"error": "..."}` for 400 and 401. An unknown model returns 503, not 403, so it maps to `unavailable`. An unknown path returns 200 `text/html`, and 405 returns `text/plain`, which the adapter maps to `malformed_response`. A3 confirmed: Node `fetch` rejects with `TimeoutError` and an aborted signal on the adapter's own timeout, and with `TypeError` (`ENOTFOUND`) otherwise. The real `SoclaasAdapter` returned the expected success and failure results end to end.
- Checks: `npm test` and `npx tsc --noEmit` and `npm run lint` passed after the test change. Not committed. Human verification of this section is pending.
- Human decision: resolve the remaining items as the agent recommended. The test-writer removed the check in `tests/unit/ai/source-boundaries.test.ts` that `src/server/config/` and `composition.ts` do not exist, so it does not block task 6.3. The orchestrator updated the handoff with the Q4 ruling, the accepted implementer choices, the live A1–A3 results, and the reviewer nits as follow-ups. The build-regenerated `next-env.d.ts` was restored with `git checkout`.
