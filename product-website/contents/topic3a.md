<frontmatter>
  title: Engineering process
  pageNav: 3
  pageNavTitle: "Process"
</frontmatter>

# Engineering process

The team uses spec-driven development and coordinated specialist roles to make changes reviewable. The process is designed to keep each agent's scope narrow and make handoffs explicit.

<div class="process-list">
  <section class="process-step">
    <span class="step-no">01</span>
    <div><h2>Record the behavior</h2><p>OpenSpec proposals, designs, and requirements describe the behavior and architecture before implementation begins. A human reviews and approves requirements.</p></div>
  </section>
  <section class="process-step">
    <span class="step-no">02</span>
    <div><h2>Assign clear ownership</h2><p>An analyst gathers source-linked context. An orchestrator assigns non-overlapping paths and records the handoff. Implementers work only within those approved paths.</p></div>
  </section>
  <section class="process-step">
    <span class="step-no">03</span>
    <div><h2>Verify the change</h2><p>Tests are assigned separately. A reviewer checks the implementation against each acceptance criterion, and a frontend agent inspects rendered UI when the change is visible.</p></div>
  </section>
  <section class="process-step">
    <span class="step-no">04</span>
    <div><h2>Leave a usable handoff</h2><p>Session summaries record source revision, scoped work, checks, generated artifacts, gaps, and platform-reported resource metrics. Missing metrics are reported as unavailable, never estimated.</p></div>
  </section>
</div>

## Context and resource choices

Work begins with relevant requirements, architecture decisions, and owned paths. Agents retrieve additional context only where needed. The intended AI features also limit context: the criteria check filters diffs, while the progress report summarizes bounded activity and refuses ranges that exceed its budget.

## Reviewable evidence

The project emphasizes tests, source-linked handoffs, and human review. These artifacts help the team compare planned behavior with implementation and understand the cost of coordination.
