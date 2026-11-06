<frontmatter>
  title: Security and AI
  pageNav: 3
  pageNavTitle: "Trust boundaries"
</frontmatter>

# Security and AI

AI and repository integrations cross trust boundaries. The project design keeps those operations on the server, validates inputs and outputs, and leaves domain decisions with people.

<div class="column-grid security-grid">
  <section class="principle">
    <span class="principle-index">A</span>
    <h2>Keep credentials at the edge</h2>
    <p>GitHub App and SoC LLM credentials are server-side configuration. The browser receives application data, never provider tokens or private keys.</p>
  </section>
  <section class="principle">
    <span class="principle-index">B</span>
    <h2>Check who can act</h2>
    <p>Services and handlers enforce project membership, role, and assignment. Navigation is not treated as an authorization boundary.</p>
  </section>
  <section class="principle">
    <span class="principle-index">C</span>
    <h2>Constrain AI input</h2>
    <p>The planned Acceptance Criteria Check uses filtered commit diffs and a fixed input budget. The planned Progress Report uses bounded task activity rather than source diffs.</p>
  </section>
  <section class="principle">
    <span class="principle-index">D</span>
    <h2>Validate derived output</h2>
    <p>AI output is advisory and schema-validated. Evidence citations are checked against source data, and provider output cannot call task mutation services.</p>
  </section>
</div>

<div class="implementation-note">
  <div class="note-marker">NOW</div>
  <div>
    <h2>Implementation status</h2>
    <p>The codebase contains server-side GitHub repository setup and commit-evidence services. The AI gateway and safeguards are specified and represented in server modules, while the role-facing AI workflows are still in development. This page describes their intended boundaries, not a claim that the AI features are available to users.</p>
  </div>
</div>

## Security is part of the workflow

Specifications, implementation, tests, and handoffs all treat browser input, task text, provider responses, and agent-produced patches as untrusted. Secrets and production data are excluded from prompts, fixtures, and interaction summaries.
