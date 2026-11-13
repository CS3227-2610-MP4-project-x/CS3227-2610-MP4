# thegrimbee Reflection

This reflection covers my part of the project: the Product Manager features (projects, tasks, review queue, Progress Report), the database, CI and deployment setup, and the shared AI gateway. It also covers the agent workflow I ran in Claude Code to build them. My teammate's Codex setup is theirs, so it isn't covered here.

**How to read the numbers.** Token counts come from the agents' local usage logs, with each response counted once. Dollar figures are *estimates*: measured tokens multiplied by public API list prices. We use a subscription, so they are not a bill. I use them only to compare workflows. Every comparison here is one run per arm, so treat the conclusions as working rules, not proof.

**Summary of what I learned**

1. Multi-agent coordination buys **independent checking before commit**. It does not buy efficiency. For routine work, one agent plus one fresh reviewer gets most of the benefit for about half the cost.
2. Coordination overhead is real and measurable. About half the cost of a full pipeline run went into the coordinating session and the planner, not into writing code or tests.
3. A safeguard counts only once it has been **seen working in a real session**. One of mine had been switched off the whole time, and its unit tests passed.
4. Resource settings must be judged against how *I* actually work. A longer prompt cache looked like a saving but would have cost more, because my waits between rounds were usually longer than an hour.
5. Context engineering matters in the app too. Every AI call goes through one gateway that decides what the model sees, in what structure, and within what budget.

---

## Part 1: Multi-Agent Software Engineering

### 1.1 How I designed the coordination

I used seven roles, each with one written contract: analyst, orchestrator (planner), test-writer, implementer, frontend checker, reviewer, and commit agent. For a full-pipeline task the sequence was:

| Step | Who | What happens |
|---|---|---|
| 1 | Analyst | Explores the code, writes a brief, candidate edit paths, a draft spec change and numbered open decisions, each with a recommendation. **Stops.** |
| 2 | Me | Approve or change the decisions. They are recorded in the design document and the spec is validated. |
| 3 | Orchestrator | Writes the plan and the handoff: role order, write paths per role, at most two fix rounds. |
| 4 | Test-writer, then implementer | Tests first, then code to pass them (the git history shows test commits before feature commits). |
| 5 | Frontend (UI tasks only) | Exercises the rendered UI against the spec. Read-only. |
| 6 | Reviewer | Checks every acceptance criterion. Read-only. At most two fix rounds, then escalation to me. Security-relevant tasks also get a dedicated security review. |
| 7 | Main session | Runs lint, type-check, tests and build. |
| 8 | Commit agent | Makes scoped commits, only when I authorise it. |

Two coordination patterns sit inside this:

- **Orchestrator–subagent.** My main session is the real orchestrator: it launches every worker and sends fix rounds back to the same worker. The `orchestrator` *subagent* only plans and writes the handoff.
- **Generator–verifier.** Test-writer/implementer against reviewer, capped at two rounds.

I set subagent spawn depth to **1**, so agents cannot launch other agents. In the tasks I'd run so far, no subagent ever tried to delegate, so the limit cost nothing measurable. Its benefit is that every result, approval and disagreement comes back through the session I am watching.

I also chose to create worktrees by hand rather than use the built-in worktree isolation. The built-in option branches from the default branch, and our feature branches are cut from `dev`.

### 1.2 Verifying that the pattern was actually followed

I didn't want to trust what the handoff said happened, so I checked the subagent transcripts. Each one records its role and spawn depth, and fix rounds show up as resumptions of the same worker. Doing this showed that **handoffs drift from reality**:

- One handoff named the reviewer as Opus; it was Sonnet.
- One handoff said no second review ran; the transcript had one, and its findings had never been recorded or acted on.
- Several roles had no usage block at all, and most resource fields said "not available" even though the data existed locally.

I back-filled the handoffs from the transcripts, flagging discrepancies rather than rewriting the history.

**Enforcement had the same problem.** Each role has write limits (for example, the test-writer may only touch `tests/`). I wrote a hook script and unit-tested it. When I finally tested it in a real session, by asking the test-writer to create a file under `src/` and the analyst to edit a workflow file, **both writes succeeded**. The script was correct, but Claude Code never ran it: I had registered it in the agent frontmatter, where it did not take effect in our setup. I moved it into the project settings, where it reads the role from the hook input, and re-ran the check. That time the write was blocked: the first real block event in the project. Two gaps remain, and I've recorded them openly: a shell redirect (`echo x > src/file`) bypasses a hook that watches only the Write and Edit tools, and the secrets-file deny rule has not yet been seen firing.

> **Lesson:** a rule is evidence only once you've seen it fire in the real flow. Testing the script alone proved its logic, not that it was switched on.

### 1.3 Idle, overloaded and blocked agents

- **Blocked:** no agent waited on another agent. Workers did sit idle for hours between fix rounds, but they were waiting for **me** to read the review and decide. Human latency was the bottleneck, not agent coordination.
- **Parallel work:** where write paths didn't overlap, the test-writer and implementer ran at the same time without collisions.
- **Overloaded:** the heaviest workers were the implementer and test-writer on large tasks (up to about 67k output tokens and 59 responses in one run). The most loaded component, though, was the **main session**. It used the most input tokens in five of six early tasks, because it re-reads a growing conversation every time it relays a result.
- **Turn limits:** I capped each role at about twice its largest observed run. In one experiment the high-effort reviewer hit its 25-turn cap and returned nothing, so the run was wasted. For risky reviews I now size the limit for high effort.

### 1.4 Retries and repeated work

- Every role reloads the shared context. In the comparison below, the pipeline made about 35M cache-read tokens against 22M for a single agent.
- Fresh re-reviewers re-read everything. That costs something, but it turned out to be worth it (§1.6).
- Learning to run the pipeline was itself a cost: one whole side session went on working out how to drive it step by step.
- The commit agent ran six times on one pipeline task against twice on a single-agent task.

### 1.5 Conflicts and disagreements

No conflict was settled agent-to-agent. The two-round cap meant disagreement turned into **escalation to me**, which is what I wanted. Examples:

- A validator failure (a 500-character limit) led me to split a requirement and decide the extent of three open questions.
- I decided each of four reviewer findings on the LLM gateway.
- On the project-members task, old home-page tests banned every `/projects/` link, which conflicted with the approved "Create project" link. The test-writer stopped work on those assertions and I chose the rule (allow creation, block project-board links).

One weakness I should admit: on several tasks I accepted the analyst's recommendations wholesale ("resolve the open decisions as you recommend"). That turns the human gate into a rubber stamp. On the tasks that mattered I did decide or override, but the gate is only as good as the attention I give it.

### 1.6 Did the benefits outweigh the costs? Two experiments

Running the same pipeline every time gave me nothing to compare, so I ran two controlled comparisons.

**Experiment 1: full pipeline vs a single agent** on two sibling tasks with the same layers (project creation and membership with the pipeline; task creation and editing with one agent). Afterwards, the same reviewer with the same prompt checked both final diffs as a common yardstick.

| | Full pipeline | Single agent |
|---|---|---|
| Estimated cost | $27 | $11 (+$3 to fix issues) |
| Agent working time / my time | 1 h 35 min / ~1 h | 25 min / ~30 min |
| Found by the pipeline's own reviewer, before commit | 7 should-fix | none (no reviewer) |
| Found by the same independent review of both, after commit | 1 should-fix | 3 should-fix |
| Must-fix issues | 0 | 0 |

- The single agent cost around half as much and used about a quarter of the agent time, even though its code change was larger.
- About **half the pipeline's cost was coordination**: the main session relaying results, plus the planner.
- What the pipeline bought was **independent review before commit**. Two of the single agent's three should-fix issues were missing tests for decisions it had made itself: an agent grading its own work. Fixing them took five minutes, after which both features were at the same level.
- Confounders: one run each; different features; the pipeline run was my first and fully manual, and the single-agent task ran second and reused what the first one built.

**Experiment 2: reviewer effort, and resume vs fresh re-review**, on the riskiest task (task status changes with competing writes). Findings were merged, shuffled and labelled without showing which run produced them, then judged real or false.

| | Medium | High | Resumed re-review | Fresh re-review |
|---|---|---|---|---|
| Estimated cost | $0.56 | $1.01 | $0.40 | $0.43 |
| Thinking share of output | 32% | 48% | 16% | 37% |
| Real findings (must / should / nit) | 0 / 1 / 0 | 1 / 3 / 0 | 0 / 1 / 1 | 0 / 2 / 2 |
| False findings | 5 | 5 | 2 | 1 |

- High effort cost 1.8× as much and found the only must-fix (the outcome when two people change a task at once) plus two real issues medium missed, with no extra false alarms.
- The resumed reviewer mostly re-confirmed its own earlier findings. The fresh one, given the list of fixes, checked every fix. They cost about the same because the resumed reviewer's cache had expired and it paid to rewrite it.

### 1.7 When to use multi-agent coordination, and when not

From these results I now decide the workflow **before** starting a task, rather than defaulting to the pipeline.

**Single agent + one fresh reviewer before commit**, when all of these hold:
1. No open product or design decision beyond the spec change I approve.
2. The backend contract already exists and is tested.
3. There is an established pattern to copy.
4. No new risky logic: state transitions, competing writes, authorisation rules, cross-module contracts.
5. The write paths fit in one layer, or one module plus its pages.

**Full pipeline** when any of these appear: an open decision, risky logic (with the reviewer at high effort), a new authorisation rule or data exposure, a migration, an AI feature (which also needs a security pass), or UI with no reference design.

I tested the rule on the next task that met all five conditions (the PM task controls). The fresh reviewer caught a must-fix before commit: the page could report an edit as successful when it had failed. That's exactly the self-grading gap Experiment 1 predicted.

Sometimes I skipped agents entirely. A small timestamp fix on the dashboard was done directly, and an investigation that only needed exploration used the analyst alone. Splitting a small, localised task into roles just adds handoffs.

### 1.8 A limit of reviews: passing review is not a working app

After the dashboard task closed with clean reviews and passing tests, it failed at runtime. The service tests used mocks, and the reviewers read code statically. Neither caught a query on a column that didn't exist, or concurrent queries on a single database client. When the existing database tests were run against a fresh local PostgreSQL, **all six failed**. After the fix they passed, and nine regression tests were added. My rule now: run the database tests against a migrated schema before calling a backend read "ready". Agent review, however independent, cannot replace executing the code against the real dependency.

---

## Part 2: Context Engineering

### 2.1 System prompts and agent definitions

- **One source per role.** Each role's contract lives once in `workflow/agents/`. The platform agent files are thin: they set the model, effort, tools and turn limit, then point to the contract. That avoids two copies of the same instructions drifting apart.
- **Responsibilities and boundaries, not scripts.** The contracts say what a role owns, what it may write, when it must stop and ask, and what its report must contain. They leave *how* to do the work to the agent.
- **Read-only roles get read-only tools.** The reviewer and frontend checker have no Edit or Write tools at all. That is stronger than telling them not to edit.
- **Length is judged by our own evidence.** Our shared `AGENTS.md` is long (about 200 lines). I didn't trim it to match a general rule of thumb. The test I'd apply is whether agents broke or ignored rules in it, and I didn't find such a violation in the transcripts. Changing it is a team decision anyway, because the file is shared.

### 2.2 Upfront context vs retrieval on demand

My working rule: **supply upfront what is decided and stable; let agents retrieve what is large or exploratory.**

- **Upfront:** the approved spec change, the recorded decisions, the handoff (write paths, role order, fix-round cap), and the analyst's candidate edit paths. These are small and authoritative, and an agent that rediscovers them may get them wrong.
- **Retrieved on demand:** the analyst explores the codebase itself. Workers open source files as they need them rather than having whole modules pasted in.
- A seeded handoff let a fresh orchestrator plan the project-members task **without re-exploring product code**. A good handoff saves exactly that rediscovery cost.

### 2.3 How organisation affects whether instructions are followed

- **A fixed source-of-truth order.** OpenSpec specs first, then UI guidance, then existing code, then `AGENTS.md`. When two disagree, the agent stops and reports the conflict instead of guessing.
- **Stale and current status mixed together hurts.** Our handoffs accumulated historical reports next to the current status, so a fresh worker had to work out which instructions still applied. I now keep current status separate from history.
- **Where config lives matters as much as what it says.** The hook in §1.2 was correctly written but put in a place the platform ignored. That cost me more than any wording problem did.

### 2.4 What belongs in a handoff

From the drift I found in §1.2, a handoff should record, per role:

- the requirement and decisions it implements, and **who decided** them;
- write paths and the role order;
- the actual model and effort used (read from the transcript, not from intent);
- every review round's findings and **what was decided about each** (an unrecorded re-review is wasted spend);
- the commands run and their results;
- open questions and known gaps;
- usage figures the platform reports, with "not available" where it reports none. **Never estimate.**

### 2.5 When more context made agents less effective

- **The coordinating session.** As a task went on, the main session's context grew with every relayed result, and it became the largest input-token consumer. The signal was its input share climbing far above any worker's. The fix is to keep relays short and point to files rather than paste them.
- **The resumed reviewer.** It carried its own earlier findings in context and mostly re-checked those, missing fixes for findings it hadn't raised itself. The signal was few tool calls (9 against 30 for the fresh reviewer) for the same cost. Starting fresh with just the list of fixes was more effective.
- **Mixed-status handoffs** (§2.3). The signal was workers spending turns reconciling old instructions before starting.

### 2.6 Context engineering inside the app

Every AI feature goes through **one gateway**. It builds the prompt, redacts secrets, reserves quota, calls the provider, validates the output (with one retry) and records usage. No feature can bypass these steps.

- **Structured prompts.** Fixed instructions go in the system message. Untrusted content (task text, diffs, activity) goes into named data sections of the user message. Section names are code constants, and any section tag inside the content is neutralised. Untrusted text never reaches the system message, so it is treated as data, not instructions.
- **Curated input.**
  - *Acceptance Criteria Check* (Developer): only the criteria and a filtered diff. Lockfiles, generated files and binaries are dropped. Files left out because of the budget are listed in the result.
  - *Progress Report* (Product Manager): only structured activity, never diffs, at most 7 days. Each item carries its task ID, so every statement must cite real tasks in that project, or the answer is rejected and retried once.
- **Explicit budgets.** Input is capped by a token budget (estimated from characters, because the provider has no token-counting endpoint). Over budget, the report is **refused rather than silently truncated**.
- **Order of operations.** Redaction runs on each whole segment *before* filtering and budgeting, so truncation cannot split a secret into a fragment no pattern matches. The number of redactions shown in the report comes from the server, not the model.
- **The retry resends identical messages.** Invalid output is never fed back to the model.

---

## Part 3: Resource-Aware Use

### 3.1 Choosing models and effort

I matched model and effort to how much each role's output drives everything after it, then corrected the choices with measurements:

| Role | Model / effort | Reasoning |
|---|---|---|
| Analyst | Sonnet / high | Its decisions shape the whole task; cheap even at high effort (6–8k output). |
| Orchestrator, test-writer, implementer | Opus / medium | The largest generation work. |
| Reviewer, frontend | Sonnet / medium; **high for risky logic** | Experiment 2: medium missed the must-fix on competing writes. |
| Commit agent | Sonnet / low | It ran on Opus for a few responses of mechanical git work, so it moved to a cheaper model. |

Turn limits are set at about twice each role's largest observed run, never guessed. When a run legitimately needs more (the high-effort reviewer), the limit is raised for that case.

### 3.2 Reducing cache misses, and a fix that didn't work

Most of an agent's input is re-reading the same context, and that is cheap only while it's cached: on Opus a 5-minute cache write costs about 25 times a cache read. Across my early tasks, **91–94% of input tokens were cache reads**, so caching inside a run already worked well. The misses came from **resuming** an agent after a gap. The main session used a 1-hour cache; subagents used the 5-minute default.

I set a 1-hour cache on the three heaviest roles, expecting fix rounds to stay warm. Then I priced it against what had actually happened. A 1-hour write costs more than a 5-minute one, and it only pays off for gaps of 5–60 minutes. My gaps were mostly longer. In one recount, 9 of 13 waits were over an hour.

- First analysis on past runs: the 1-hour cache would have cost **about 8% more** overall (+15% for the test-writer, +17% for the orchestrator, −5% for the implementer, from only four gaps).
- A recount on the 18 most recent runs of the same roles: **about 15% more**.

I reverted the setting. The cheaper lever is behavioural: send fix rounds within the cache window, which means keeping my own review short, or **start a fresh agent** instead of resuming a cold one. Experiment 2 showed that a fresh reviewer costs about the same once the cache has expired and does a better job.

> **Lesson:** a cache setting's value depends on the gap distribution of your own sessions, not on the setting itself.

### 3.3 Reasoning tokens

I had assumed the platform didn't report reasoning tokens; it does, per response.

- Across my early tasks, thinking was **15–32% of output tokens**.
- One reviewer spent **76%** of its output on thinking, which is why I questioned the reviewer's default effort.
- In Experiment 2, high effort raised the thinking share from 32% to 48% and thinking tokens 2.7×, but it bought three real defects. Measured this way, high effort is worth paying for on risky reviews and wasted on routine ones.

On persisted reasoning: within one agent run, keeping earlier reasoning saves re-deriving it. Across fix rounds, though, my results point the other way. A resumed reviewer's carried-over reasoning anchored it on its own earlier findings. For verification work, starting fresh was better than continuing.

### 3.4 Which tasks consumed the most, and what I did about it

1. **The coordinating session**, the largest share of input in most tasks and 35% of the pipeline task's cost. *Reduced* by choosing the single-agent mode for routine tasks, which removes most of the relaying.
2. **Test-writer and implementer on large tasks**, the largest output. *Reduced* by giving them the analyst's candidate paths and the approved spec up front, so they spend less effort finding their way around.
3. **Cache rewrites after long human waits.** *Reduced* by preferring fresh agents after long gaps, and by keeping approvals quick.
4. **Reviewers** were cheap throughout (a single bounded pass over a diff with read-only tools), even at high effort.

### 3.5 How I monitored usage

- **Transcript scripts.** Small scripts read the local transcripts, count each response once, split usage by role and phase, and price it consistently. They produced every figure in this document and the cache counterfactual.
- **A defined measure.** Raw token totals are dominated by cache reads, which re-count the same context each turn. I compare **estimated cost** instead, splitting input into new input, cache writes and cache reads. I also had to correct an earlier figure that had been scoped differently: getting the measure right was part of the work.
- **Agent active time.** Elapsed time mostly measured me, so I also estimated how long the agents were actually working, by summing short gaps between their records.
- **Usage in handoffs.** Each handoff records what the platform reports, and "not available" otherwise.

### 3.6 Resource-aware use inside the app

- **Rate limit:** 5 AI requests per minute per person.
- **Daily token quota per person:** 400k in production, 1M in development (where the evaluation fixtures run against the real model). The quota resets at midnight Singapore time.
- **Reserve, then settle.** The maximum cost is reserved before the call and settled afterwards, so concurrent requests can't overshoot. No database transaction is held open during the LLM call.
- **Cached results** don't count against the quota.
- **Cost estimate at approval:** about USD 0.01 per full-budget check, so the daily provider key budget covers thousands of checks.
- **Visibility:** the Product Manager can see the project's AI usage.
- **Separate environments:** development and production each have their own database project, deployment environment, OAuth app, GitHub App, LLM key and quota.
- **Not claimed:** whether the university's LLM provider caches prompt prefixes is undocumented. Our stable-prefix layout would benefit if it does, but I have no measurement.

---

## What I would do differently

1. **Decide the workflow per task from the start**, instead of running the full pipeline by default until the data told me not to.
2. **Check every safeguard in a real session** on the day it is added.
3. **Measure before tuning.** Pricing the cache change against my real gaps before committing it would have avoided adding and then reverting it.
4. **Run tests against the real database before calling a backend ready**, not after a user hits the failure.
5. **Treat the human gate as real work**: read the analyst's recommendations rather than accepting them wholesale, and keep review turnaround short. That improves decisions and cuts cache cost at the same time.
