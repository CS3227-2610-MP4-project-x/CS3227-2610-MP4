<frontmatter>
  title: Role workflows
  pageNav: 3
  pageNavTitle: "Workflows"
</frontmatter>

# Role workflows

The product is designed around two project roles. The workflows below distinguish repository capabilities already represented in the application from product experiences that are still planned.

<div class="column-grid role-grid">
  <section class="role-section">
    <p class="eyebrow">DEVELOPER</p>
    <h2>Bring work evidence into the task</h2>
    <p>The repository includes a commit picker for an assigned developer. It reads branches and commits from the project's linked repository and supports attaching authored commits to a task.</p>
    <p class="workflow-state">Available in the current implementation</p>
    <hr>
    <h3>Acceptance Criteria Check</h3>
    <p>An advisory check against submitted work is part of the intended developer workflow. It is not yet available as a shipped task experience.</p>
    <p class="workflow-state planned">Planned · advisory output</p>
  </section>
  <section class="role-section">
    <p class="eyebrow">PRODUCT MANAGER</p>
    <h2>Connect a project repository</h2>
    <p>Project Settings includes the GitHub repository setup flow. A project is designed to link one repository through the GitHub App integration.</p>
    <p class="workflow-state">Available in the current implementation</p>
    <hr>
    <h3>Review and report</h3>
    <p>Task management, the review queue, and an AI-assisted Progress Report are intended product-manager workflows. The task lifecycle is still in development, so these are not described as live features.</p>
    <p class="workflow-state planned">Planned · decisions stay human-owned</p>
  </section>
</div>

<div class="callout-note"><strong>Human control:</strong> AI results are designed to inform review. The product manager remains responsible for task decisions.</div>
