# Reusable agent roles

This directory contains the canonical contracts for seven reusable roles. Platform adapters live in `.codex/agents/` and `.claude/agents/`; keep those adapters thin and change this directory when a role's responsibilities change.

## Roles and write permissions

| Role | Distinct responsibility | Write scope | Read-only? |
|---|---|---|---|
| Orchestrator | Decompose work, assign owners and dependencies, prevent path overlap, coordinate handoffs and integration | `workflow/handoffs/`, `workflow/plans/`, and assigned coordination records | Product source is read-only |
| Analyst | Explore task-relevant repository context and prior decisions, summarize them in the handoff, then draft scoped OpenSpec requirements and acceptance examples | Assigned OpenSpec proposal/specification files only; reports context brief to orchestrator for handoff | Code is read-only |
| Test-writer | Add tests for approved behavior and report coverage gaps | Assigned files under `tests/`, excluding AI security cases owned by Developer A | No |
| Implementer | Implement one approved, bounded task; generate a visual diff when the skill is available | Only paths assigned in the task handoff | No |
| Frontend | Inspect and exercise UI changes against approved intent; report specific visual/interaction updates | None | Yes, strictly; invoke only for UI changes |
| Reviewer | Check assigned acceptance criteria and independently inspect implementation quality, tests, and risk | None | Yes, strictly |
| Commit/PR agent | Inventory the branch delta, group eligible work into scoped commits when explicitly authorized, and draft PR title/description | Git index/history only after explicit authorization; no product files | Read-only until authorized to commit |

The actual human owner remains the authority for a workstream. Developer A (Lim-ZY) and Developer B (thegrimbee) are **people**, not agents. Their ownership scopes are recorded in the repository `AGENTS.md`. A worker receives one human owner's assigned task and must not cross that boundary. The commit/PR agent may inventory the full branch across both human lanes, but that does not transfer product ownership and it commits only changes the human has authorized for integration. The analyst cannot approve requirements; the human does. The reviewer cannot edit the patch or approve a merge.

## Standard sequence

1. The orchestrator records the task goal, human owner, known requirements, source revision, and worktree in `workflow/plans/`; final write paths may remain pending context discovery.
2. The analyst explores only task-relevant repository context, records a concise source-linked context brief and candidate edit paths in its handoff section, then drafts or updates OpenSpec artifacts.
3. The human owner reviews the requirements. The orchestrator uses the analyst's evidence brief to confirm final write scopes, dependencies, and disjoint assignments. Parallel workers use separate worktrees; no two workers write to the same path. A task may reuse an existing role session when its context and permissions still fit.
4. The test-writer prepares the assigned tests; the implementer changes only implementation paths. The test-writer does not implement production code, and the implementer does not author tests.
5. Only when the task changes visible UI, the frontend agent inspects the rendered changes read-only and returns concrete current-to-desired recommendations. Skip it for non-UI tasks.
6. The reviewer checks the completed diff read-only and returns findings to the orchestrator.
7. The orchestrator assembles one task handoff from the worker session notes. The human resolves findings and authorizes any commit work.
8. At the end of the sequence, the commit/PR agent inventories the complete branch delta, groups eligible uncommitted work into scoped commits when explicitly authorized, and drafts a PR title and description. It does not push or create a PR.
9. The human reviews the commits and PR draft, then separately decides whether to push or open a PR.

## Coordination limits

- **Who orchestrates.** Claude Code subagents cannot start other subagents, so in Claude Code the main session plays the orchestrator and dispatches each role directly. Invoke the `orchestrator` subagent only to write plans and consolidated handoffs.
- **Leaf workers never delegate.** Analyst, test-writer, implementer, frontend, reviewer, and commit/PR agents do their assigned work themselves and must not spawn further agents.
- **Bounded review loop.** Implementer → reviewer is a generator-verifier loop with at most two fix rounds. If findings remain after the second review, stop and escalate to the human owner.
- **Match effort to task size.** Small single-file fixes skip the agent sequence. Use the full sequence for one `tasks.md` item or larger.

## Enforcement

Instructions are backed by these checked-in controls; keep them in sync with the role contracts.

| Control | Location | Effect |
|---|---|---|
| Ask-before-run git rules | `.claude/settings.json` | `git push`, `gh pr`, `git reset --hard`, `git rebase`, and `git config` always prompt the human |
| Write-scope hook | `.claude/hooks/guard-write-scope.mjs`, declared in the test-writer and implementer adapters | Test-writer can write only under `tests/`; implementer cannot write `tests/`, `openspec/`, `specs/`, or `workflow/` |
| Tool restrictions | `.claude/agents/reviewer.md`, `.claude/agents/frontend.md` | Reviewer has read/search tools only; frontend cannot use edit tools but may run the dev server |
| Sandboxes | `.codex/agents/*.toml` | Codex reviewer and frontend run `read-only` |

The hook covers the Write, Edit, and NotebookEdit tools only; file writes made through shell commands are not blocked.

## Reuse

Keep these seven role profiles checked in and invoke applicable roles for new work. Invoke the frontend role only for tasks that change visible UI. Continue a suitable existing worker conversation/session when the platform supports it. If a fresh context is necessary, pass the current task handoff to a new invocation of the same role. Create new worktrees for isolation when concurrent write scopes require it, not a new role definition for every task. Do not reuse a session across unrelated human ownership scopes or incompatible permissions.

## Resource recording

Each worker session supplies the resource section of `workflow/agent-handoff-template.md`. Report provider-reported token, cost, cache, or duration metrics only when available. Do not guess or claim precision that the platform does not expose. The orchestrator is the sole writer of the consolidated handoff, so workers can report notes without colliding on shared files.
