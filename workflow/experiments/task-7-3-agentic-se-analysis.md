# Task 7.3 Agentic SE experiment: presentation analysis

## Question and scope

This experiment asks whether a coordinated specialist workflow or one capable agent was more effective for the approved Group 7.3 slice: the assigned-developer Acceptance Criteria Check route, reusable check/history UI, and read-only task-detail GET/history access. Both runs used the approved task-detail DTO and ordering decisions. The single-agent implementation started from `9537871`; its current approved read-model requirements were brought into the baseline OpenSpec before implementation.

The multi-agent arm used analyst, orchestrator, test-writer, implementer, reviewer, frontend, and commit/PR preparation roles in sequential, scoped assignments. The single-agent arm used one worker for the approved implementation, tests, and self-verification. It did not launch an independent reviewer. Task 4.3 submission/lifecycle work and Task 4.4 board/review-queue integration were excluded in both scopes.

## Evidence

| Evidence | Multi-agent workflow | Single-agent workflow |
|---|---|---|
| Work duration evidence | Dashboard event span: 13:40:01.963–15:50:13.153 SGT (2h10m11s). This is an event span, not continuous active work. | Worker-reported execution: 18:58:52–19:10:03 SGT (11m11s). Ledger events span 18:58:00.759–19:10:23.846 SGT, so preserve the two measures separately. |
| Usage evidence | 969 response records in the human-authorized time window; 84,027,163 input, 308,064 output, 82,228,224 cached input, and 96,517 reasoning tokens. | 70 records for the worker session linked by role and overlapping time; 6,176,808 input, 30,358 output, 6,055,296 cached input, and 7,386 reasoning tokens. |
| Verification | Final focused aggregate: 240 tests passed across the check panel, route, task-detail read, and project-authorization suites; TypeScript, scoped lint, and diff checks passed. | 205 tests passed across five focused files; TypeScript, scoped lint, diff checks, and OpenSpec validation passed. The suite mix is different, so counts are not a direct quality ranking. |
| Review | Independent route, UI, and read-model review plus source-only frontend QA; findings were fixed and final reviews cleared. | Self-review reported no remaining findings. Independent review is pending, so the evidence does not establish independent review quality. |

The multi-agent dashboard window had 341 matched response records, 318 ambiguous, and 310 unknown. Thus 64.8% of records were automatically ambiguous or unknown; those records are included only because the user authorized human attribution by time window. They account for 74.7% of known input tokens. Cost and tool-call counts were not surfaced. The single-agent ledger session has no Work ID and is linked to the run by the worker role and overlapping timestamps.

Cached input was about 97.9% of input for the multi-agent window and 98.0% for the single-agent session. Reasoning tokens were 31.3% and 24.3% of output, respectively. These are descriptive ratios from the available usage fields; cache reads are included in input and reasoning is included in output. They do not show that either workflow caused lower token use or cache misses.

## What the evidence says about effectiveness

### Coordination and quality

The multi-agent workflow is strong evidence for the project's required specialized coordination pattern. Approved requirements preceded implementation, the orchestrator assigned non-overlapping paths, writers worked sequentially, and a read-only reviewer plus frontend QA provided separate feedback. Human decisions settled ownership and the full task-detail DTO before dependent work proceeded. The handoff records therefore show context, scope, and decision management as part of the engineering process, rather than simply counting agents.

Independent review materially improved the implementation. Across the 7.3 cycles, the reviewer/frontend feedback surfaced one P1 and eight P2 issues: the route's missing static `maxDuration = 150`; incomplete nested-response validation; stale component state and asynchronous request races; history disclosure and text-contrast issues; and task-detail authorization-race and date-timezone defects. Tests were added for those cases, implementations were revised, and the final reviews cleared them. This is a concrete quality benefit of independent perspectives, especially for security boundaries, state races, and UI fit.

The single-agent run completed the same broad approved slice quickly and passed its focused tests and static checks. Its self-review identified and corrected test-fixture, obsolete 501 expectation, and OpenSpec placement issues. That is useful evidence that one agent can handle a bounded, well-specified cross-file task. It is not evidence that a single agent found no product defects: it did not receive independent review, while the multi-agent arm did.

### Resource use and context engineering

The dashboard indicates that cached input was a large share of token input in both records, while reasoning-token share differed. The multi-agent window also has substantial attribution uncertainty and aggregates many sessions and roles. Its 84.0M input tokens cannot be compared as a like-for-like cost against one 6.2M-token worker session: the observation windows, role counts, scope exposure, and task attribution differ, and the multi-agent event span is not measured active time. No cost or tool-call data is available. Present these as observed resource records, not savings or efficiency multipliers.

The handoff and OpenSpec give examples of useful context engineering: source revision, task boundaries, approved decisions, file ownership, excluded integrations, test commands, known gaps, and explicit `not available` metrics. Specialist roles then received narrow task context. The single-agent worker received the end-to-end scope and constraints up front. A reasonable lesson is to front-load stable requirements and boundaries, then provide detailed source context at the task handoff; avoid flooding every role with the full project history.

The multi-agent sequence has coordination and repeated-review overhead, but it exposes independent checks and makes parallel specialization possible when work is separable. This particular run serialized writers to protect shared files, so it demonstrates role specialization and staged handoffs more strongly than parallel speedup. The single-agent run had fewer handoffs and a short reported duration, but its review coverage is incomplete.

## Relation to the project description

- **Spec-Driven Development and Multi-Agent SE:** This experiment supplies process evidence for approved OpenSpec requirements, specialist roles, scoped handoffs, human gates, and independent review. The single-agent arm is a reflection/control case; it should not be presented as replacing the project's required multi-agent process.
- **AI security:** The delivered slice validates same-origin JSON and request shape, checks project membership and developer assignment, returns `no-store` data, rechecks authorization against the returned task snapshot, avoids task-state mutation, and treats check output as derived data. Regression tests cover malformed output and authorization/state boundaries. These are concrete implementation and test artifacts; live SoC-provider behavior was not exercised in this experiment.
- **Context Engineering:** The handoff captures scope, approved DTO/order, file ownership, source revision, and exclusions. Review artifacts show why the handoff gates mattered: the read-model contract had to be approved before API/test work continued.
- **Resource-aware Use:** Model/session and token metrics are recorded where surfaced, unavailable fields are labeled, and attribution ambiguity is made explicit. The available data does not measure cost, tool calls, active minutes, or cache-miss reduction attributable to a workflow choice.
- **Other project requirements:** This comparison does not evaluate all role-based AI features, online deployment, development/production separation, or end-to-end product readiness. Do not use it as evidence for those requirements.

## Presentation-ready claims and limits

1. “Specialist review found concrete defects that passed through the implementation stage; the team converted them into regression tests and cleared the findings before calling the slice complete.” Support with the P1/P2 examples, review log, and final 240-test run.
2. “A single agent completed the approved slice in 11m11s and passed 205 focused tests, but this run has self-review only; independent review is needed before claiming equal quality.” Support with the single-agent handoff and usage record.
3. “The available usage data shows high cache-read shares in both observations, but it cannot establish that one workflow used fewer resources because the multi-agent attribution and time window are broader.” Support with the 969-record window, its 64.8% ambiguous/unknown rate, and the session-scoped single-agent metrics.
4. “Use specialist agents when the task spans security, UI, API, persistence, and review boundaries; use one agent for tightly bounded work with approved requirements, while retaining independent human or agent review for high-risk changes.” Present this as a lesson inferred from this case, not a universal result.

Do not claim a causal speedup, token savings, or a statistically reliable winner. A stronger follow-up would apply the same independent reviewer and acceptance checklist to the single-agent branch, retain matching task scope and test suites, and capture actual active time and provider cost/tool metrics if the platform exposes them.

## Overall assessment and 12-minute presentation flow

The strongest defensible conclusion is: **the multi-agent workflow has stronger documented independent assurance for this security- and UI-sensitive cross-layer task; the single-agent run shows that one agent can complete a well-bounded, approved slice with fewer handoffs, but independent review is still pending.** The available duration and token records do not establish that either workflow was faster or more resource-efficient on a like-for-like basis.

Suggested pacing for the 12-minute presentation:

1. **Experiment question and boundaries — 1 minute.** State the shared Task 7.3 slice, the `9537871` single-agent baseline, and the excluded Task 4.3/4.4 work.
2. **Coordination and context — 2 minutes.** Show the specialist role sequence, approved OpenSpec decisions, scoped ownership, and handoffs.
3. **Review and rework — 3 minutes.** Walk through the route-duration P1 and one or two P2 examples, then show the regression test/fix and final cleared review.
4. **Security and verification — 2 minutes.** Highlight auth checks, strict request validation, no-store behavior, no task-state mutation, and the final focused test evidence.
5. **Usage evidence and limits — 2 minutes.** Present token/cache/reasoning figures with the attribution uncertainty and explain why the totals are not a savings comparison.
6. **Reflection and decision rule — 2 minutes.** Conclude where specialists helped, where one agent reduced handoffs, and why high-risk work still needs independent review.

For the five-minute Q&A, be ready to answer:

- **Did multi-agent save time?** The record does not establish that: 2h10m is a response-event span, not active work, and it is not comparable to the worker-reported 11m11s.
- **Did single-agent have no findings?** It had no remaining self-review findings, but an independent review has not been run.
- **Why does the multi-agent token total look much larger?** The capture covers many roles and a broad time window; 64.8% of records are ambiguous or unknown, and 74.7% of known input lies in those rows.
- **What is the practical lesson?** Use specialized agents for separable, cross-boundary work where independent review adds value; use one agent for tightly bounded work with approved requirements, while retaining review for security-sensitive changes.
