<frontmatter>
  title: CS3227-2610-MP4
  layout: default.md
  pageNav: 3
  pageNavTitle: "NoPressure"
</frontmatter>

<div class="masthead">
  <p class="eyebrow">SOFTWARE ENGINEERING · MULTI-AGENT SYSTEMS</p>
  <h1>Build the work.<br><span>Keep the evidence.</span></h1>
  <p class="lede">CS3227-2610-MP4 is a team project exploring a secure, AI-assisted workspace for software engineering tasks. Its product and development process are shaped by explicit specifications, scoped roles, and reviewable evidence.</p>
  <p class="status-line"><span class="status-dot"></span> Project in active development <span class="status-divider">/</span> NUS CS3227 · MP4</p>
</div>

<div class="rule-label"><span>01</span><span>Project snapshot</span></div>

<div class="column-grid snapshot-grid">
  <section class="snapshot-block">
    <p class="eyebrow">THE PRODUCT</p>
    <h2>A shared task workspace</h2>
    <p>The planned application brings project tasks, GitHub commit evidence, and role-specific AI support into one place. Work is organized around developers and a product manager, with human decisions kept in control of task state.</p>
  </section>
  <section class="snapshot-block">
    <p class="eyebrow">THE BUILD</p>
    <h2>Designed for scrutiny</h2>
    <p>Specifications record expected behavior before implementation. Server-side boundaries protect identity, repository access, and future AI calls. Tests and handoffs make the reasoning behind changes easier to inspect.</p>
  </section>
</div>

<div class="rule-label"><span>02</span><span>Implementation note</span></div>

<section class="implementation-note">
  <div class="note-marker">STATE</div>
  <div>
    <h2>What is in place</h2>
    <p>The repository currently includes GitHub sign-in plumbing, project repository setup, and a developer commit-evidence picker. The task lifecycle and review experience are still under development. Acceptance checks and progress reports describe intended advisory workflows; they are not presented here as shipped features.</p>
  </div>
</section>

<div class="rule-label"><span>03</span><span>Change trace</span></div>

<figure class="diff-note" aria-label="Illustration of a reviewed change">
  <figcaption><span>WORKFLOW / HANDOFF.md</span><span>+2 −1</span></figcaption>
  <pre><code><span class="diff-context">  acceptance:</span>
<span class="diff-remove">- status: assumed</span>
<span class="diff-add">+ status: human-approved</span>
<span class="diff-context">  owner: project team</span></code></pre>
  <p>Small, explicit changes leave a clearer trail for the next person in the loop.</p>
</figure>

<div class="next-steps">
  <a class="text-link" href="{{baseUrl}}contents/topic1.html">Explore the role workflows <span aria-hidden="true">↗</span></a>
  <a class="text-link" href="{{baseUrl}}contents/topic3a.html">See how the project is built <span aria-hidden="true">↗</span></a>
</div>
