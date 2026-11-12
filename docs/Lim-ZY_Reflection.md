# Lim-ZY Reflection

Building this project made me think about AI-assisted software engineering as a system of carefully made decisions and checks, rather than just a way to produce code faster. 

## Multi-Agent Software Engineering

### How did we design and implement coordination?

We used a multi-staged multi-agent workflow: approved requirements and decisions came first (from analyst), then the orchestrator assigned scoped work, followed by test writing, implementation, review, and frontend inspection where relevant. Handoffs carried the task scope, source revision, file ownership, decisions, exclusions, checks, and known gaps. This gave each role a defined responsibility and made it clearer when work was ready for the next person or agent. All the agents used the same handoff for the same shared context. The Task 7.3 experiment records this sequence and contrasts it with a single worker completing the same broad approved slice (`workflow/experiments/task-7-3-agentic-se-analysis.md`, `workflow/handoffs/task-7-3-x1-single-agent.md`).

The pattern worked best when the task crossed boundaries that benefited from different perspectives. In Task 7.3, independent review and frontend QA found issues that implementation and self-checking had not caught, including a missing route duration setting, incomplete validation, asynchronous UI state problems, and authorization and date-handling edge cases. Those findings were addressed with implementation changes and regression tests before the final multi-agent verification. For me, this is the strongest practical case for specialist coordination in our project: review actually surfaced concrete defects.

Additionally, this multi-staged multi-agent workflow encouraged parallelisation in the implementation loop, which made a task (or multiple tasks) complete faster, from my own experience and observation.

### How did we check triggering, context, resource sharing, and handoffs?

We checked the workflow through its artifacts: approved OpenSpec requirements, role contracts, scoped plans, handoffs, review reports, and final verification evidence. Each stage had a trigger in the task sequence, and decisions were recorded before dependent implementation proceeded. This made the intended flow inspectable after the work, though a written workflow is not by itself proof that every agent followed it perfectly. The separate experiment analysis and session records were useful because they distinguish observed facts from interpretation.

Additionally, the acceptance criteria (written as scenarios) and requirements were clearly written in openspec, so I found review to be easy.

The single-agent comparison also exposed the value of explicit handoff checks. That run corrected stale tests that still expected an earlier HTTP 501 stub, fixed a repository fake, and moved a misplaced OpenSpec requirement after validation identified the boundary issue. A human-readable scope and a validation step helped catch these mismatches. At the same time, the single-agent run had self-review only, so its clean self-review cannot be compared with independent review as if the assurance were equivalent.

### Were agents idle, overloaded, blocked, or wasteful?

Most work (within a single unparallelisable task) was serialized to protect shared files, so waiting and coordination overhead are plausible costs, but I also understand that the evidence may not quantify them. But based on observation, most parallelisable work (multiple tasks, or multiple subtasks) were parallelised at the implementation phase (test writer, implementer, reviewer).

The comparison does show repeated work and correction: review findings required another implementation and verification round, while the single-agent run needed test and specification corrections. I see this as useful rework when it catches real defects, though unclear requirements or stale assumptions can also make it avoidable. A stronger record of blocked intervals, retry causes, and tool calls would help me tell the difference. Tool-call counts were not available for the experiments I did, so I cannot say how much resource use came from retries or unnecessary calls. On hindsight, I acknowledge that more work could be done for this aspect. But given the short duration of this project, more emphasis was given to actual implementation of the features.

### Did the benefits outweigh the costs, and when should we use coordination?

For this cross-layer, security-sensitive slice, I consider the independent assurance valuable: the review found issues in route behavior, authorization, UI state, accessibility, and date handling that were then fixed and tested. But the multi-agent evidence does not establish that the workflow was faster or more token-efficient. The single-agent worker reported 11 minutes 11 seconds and passed 205 focused tests; the coordinated run had 240 focused tests, but their suite mix differed. The multi-agent run also had a broad usage window with considerable uncertain attribution. These figures are informative descriptions, not a fair speed or quality ranking.

My working rule is to use specialist coordination when work separates naturally across API, UI, security, tests, or independent review, especially when mistakes could cross module boundaries. For a small, well-specified change, one agent can reduce handoffs. In either case, security-sensitive or consequential work still needs an independent check. This is a lesson from our experiment, not a universal threshold.

Additionally, though multi-agent coordination requires much more tokens and resources, I found the output to be substantially better, since multiple agents can provide differing perspectives due to different contexts. This makes the tests and code written substantially better. Hence the given tasks were completed with a much better result using the multi-agent workflow.

## Context Engineering

### What should be supplied up front, and what should be retrieved as needed?

I found it useful to put stable constraints up front: the approved behavior, architectural boundaries, file ownership, source revision, acceptance scope, and explicit exclusions. The handoff then points to the relevant specifications and source evidence, rather than relying on a long informal conversation. Detailed implementation context can be retrieved by the assigned role when it reaches that part of the task. This balances a shared understanding with a focused working context.

The Task 7.3 experiment shows why the boundary matters. The task-detail read model and ordering decision had to be approved before dependent API and test work proceeded. The handoff preserved those decisions and excluded lifecycle and review-queue integrations. Without those details, an agent could build against a plausible but unapproved contract or accidentally expand its scope.

### How did organization affect the agents' ability to follow instructions?

Keeping role contracts under `workflow/agents/`, decisions and acceptance criteria in OpenSpec, and task-specific context in `workflow/handoffs/` gave each kind of information a predictable home. The logs and evidence directories also made it possible to trace why a change was made and what verification supported it. I learned that organization only helps when handoffs link the right files and make the current decision easy to distinguish from older notes. A large repository history without a concise route into it can still be hard to use.

The handoff was most useful when it recorded concrete boundaries: what to change, what not to change, which source revision applied, what was already decided, and which checks remained. It should also state unknowns as unknowns. In the single-agent session, independent review, browser QA, PostgreSQL integration, and build checks were explicitly listed as not run. That prevented a passing focused suite from being mistaken for complete verification.

### When can more context make an agent less effective?

More context is not automatically better. A full project history can bury the few requirements that control a particular change, while old decisions can be mistaken for current ones. The signs I would watch for are repeated rediscovery, work outside the assigned scope, reliance on stale test expectations, or missed acceptance details despite a large prompt. In our comparison, the stale 501 assertions and misplaced requirement show that precise, current context and validation matter more than volume alone. Additionally, frequent compacting of chat session may also indicate poor context use.

My practical approach is to front-load the non-negotiable rules and approved decisions, then link to deeper references and retrieve them when needed. Handoffs should summarize the task and its state, not copy the entire repository history. When requirements conflict, the agent should expose the conflict and stop in the affected area rather than silently choosing an interpretation. In hindsight, experimentation on this could be done better, but I feel we were time-constrained in completing the project and the presentation.

### How should notes and handoffs help the next agent?

A useful handoff lets another agent start without repeating discovery. It should identify the goal, approved requirements, relevant files, ownership boundaries, decisions, source revision, completed work, verification evidence, blockers, and the next action. It should separate completed checks from unverified work and use “not available” for metrics that were not surfaced. The handoffs we structured are especially instructive because it records both the implementation scope and the limitations of its usage attribution.

## Resource-Aware Use

### What did the measured usage tell us?

From the Task 7.3 experiment, for the authorized multi-agent time window, the dashboard recorded 84,027,163 input tokens, 308,064 output tokens, 82,228,224 cached input tokens, and 96,517 reasoning tokens across 969 response records. Of those records, 318 were ambiguous and 310 unknown in automatic attribution. For the identified single-agent worker session, the ledger recorded 6,176,808 input, 30,358 output, 6,055,296 cached input, and 7,386 reasoning tokens across 70 records. Cost and tool-call counts were not available. The evidence and its caveats are documented in `workflow/experiments/task-7-3-agentic-se-analysis.md` and `workflow/experiments/task-7-3-dashboard-usage.csv`.

These totals cannot establish that one workflow used fewer resources. The multi-agent capture covers a broad window and several roles, and most uncertainly attributed input is still included in its total. Its event span also does not measure continuous active time. The single-agent session is linked by role and overlapping timestamps rather than a task Work ID. I therefore treat the figures as observations, not a controlled efficiency comparison.

### How should model and workflow choices respond to constraints?

The project description calls out SoC LLM rate limits for product features, so those features need bounded requests, guardrails, and error handling. For development agents, the evidence supports matching role and scope to the task: use a focused implementation context for bounded work, and bring in specialist analysis or review where independent expertise can reduce risk. In my opinion, model choice should be assessed against task difficulty, review needs, latency, and the platform's available usage data. Hence, we made quality assurance agents (test writer and reviewer) use the `gpt-6.1-sol` model.

### What did we learn about caching, token tracking, and persistent reasoning?

Cached input was about 97.9% of recorded input in the multi-agent window and about 98.0% in the single-agent session. Those are descriptive ratios only; they do not show that our context choices caused high cache use or reduced cache misses.

The usage dashboard and experiment extract were valuable because they made surfaced token fields and attribution uncertainty visible. A future experiment should capture comparable task boundaries, Work IDs, actual active time, tool calls, retries, and cost if available.

### Which tasks consumed the most resources, and how could use improve?

The broad Task 7.3 multi-agent window has far more recorded input tokens than the single worker session, but the tasks, number of roles, attribution, and observation windows differ too much to identify the most resource-intensive task fairly. The experiment does not isolate repeated analysis or tool calls, so I cannot claim that any particular activity dominated. The clearest improvement is better measurement: attach work identifiers consistently, keep task windows narrow, and record retries and active time separately from event spans. With that evidence, the team could compare workflows and adjust context or model choices based on results.

## Overall Reflection

This project showed me that multi-agent software engineering depends on more than developing a working multi-agent workflow. It needs approved requirements, clear ownership, small handoffs, independent verification, and honest reporting of what remains unknown. It also needs careful and conscious context engineering to make important decisions about model usage and agentic SE throughout a software project. Resource-aware practice requires measurement discipline: token totals and cache ratios are useful, but they do not prove efficiency unless the compared work is attributable and comparable.

For future work, I would keep the staged review for cross-boundary and security-sensitive changes, use a single focused worker for smaller approved tasks, and retain independent review where the consequence of a missed defect is high. I would also better plan usage instrumentation before beginning a comparison, so claims about time, retries, tool use, and cost can be better supported.

Overall, this project generally felt rushed due to the many experiments that needed to be done, and the wide scope of the project. But I definitely learnt a lot from the process and I am sure this experience will help me in becoming a better software engineer while being aware of resource usage and context engineering.
