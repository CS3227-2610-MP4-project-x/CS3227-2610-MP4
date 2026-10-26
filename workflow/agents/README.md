# Reusable agent roles

This directory contains the canonical contracts for six reusable roles. Platform adapters live in `.codex/agents/` and `.claude/agents/`; keep those adapters thin and change this directory when a role's responsibilities change.

## Roles and write permissions

| Role | Distinct responsibility | Write scope | Read-only? |
|---|---|---|---|
| Orchestrator | Decompose work, assign owners and dependencies, prevent path overlap, coordinate handoffs and integration | `workflow/handoffs/`, `workflow/plans/`, and assigned coordination records | Product source is read-only |
| Analyst | Turn product intent into scoped OpenSpec requirements and acceptance examples | Assigned OpenSpec proposal/specification files only | Code is read-only |
| Test-writer | Add tests for approved behavior and report coverage gaps | Assigned files under `tests/`, excluding AI security cases owned by Developer A | No |
| Implementer | Implement one approved, bounded task; generate a visual diff when the skill is available | Only paths assigned in the task handoff | No |
| Reviewer | Check assigned acceptance criteria and independently inspect implementation quality, tests, and risk | None | Yes, strictly |
| Commit/PR agent | Inventory the branch delta, group eligible work into scoped commits when explicitly authorized, and draft PR title/description | Git index/history only after explicit authorization; no product files | Read-only until authorized to commit |

The actual human owner remains the authority for a workstream. Developer A (Lim-ZY) and Developer B (thegrimbee) are **people**, not agents. Their ownership scopes are recorded in the repository `AGENTS.md`. A worker receives one human owner's assigned task and must not cross that boundary. The commit/PR agent may inventory the full branch across both human lanes, but that does not transfer product ownership and it commits only changes the human has authorized for integration. The analyst cannot approve requirements; the human does. The reviewer cannot edit the patch or approve a merge.

## Standard sequence

1. The orchestrator records the task, human owner, requirement IDs, source revision, write paths, dependencies, and worktree in `workflow/plans/`.
2. The analyst drafts or updates OpenSpec artifacts. The human owner reviews the requirements before implementation begins.
3. The orchestrator assigns disjoint paths. Parallel workers use separate worktrees; no two workers write to the same path. A task may reuse an existing role session when its context and permissions still fit.
4. The test-writer prepares the assigned tests; the implementer changes only implementation paths. The test-writer does not implement production code, and the implementer does not author tests.
5. The reviewer checks the completed diff read-only and returns findings to the orchestrator.
6. The orchestrator assembles one task handoff from the worker session notes. The human resolves findings and authorizes any commit work.
7. At the end of the sequence, the commit/PR agent inventories the complete branch delta, groups eligible uncommitted work into scoped commits when explicitly authorized, and drafts a PR title and description. It does not push or create a PR.
8. The human reviews the commits and PR draft, then separately decides whether to push or open a PR.

## Reuse

Keep these six role profiles checked in and invoke them for new work. Continue a suitable existing worker conversation/session when the platform supports it. If a fresh context is necessary, pass the current task handoff to a new invocation of the same role. Create new worktrees for isolation when concurrent write scopes require it, not a new role definition for every task. Do not reuse a session across unrelated human ownership scopes or incompatible permissions.

## Resource recording

Each worker session supplies the resource section of `workflow/agent-handoff-template.md`. Report provider-reported token, cost, cache, or duration metrics only when available. Do not guess or claim precision that the platform does not expose. The orchestrator is the sole writer of the consolidated handoff, so workers can report notes without colliding on shared files.
