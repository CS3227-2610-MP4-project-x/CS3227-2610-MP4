# Agent workflow

The repository uses five reusable role profiles under `workflow/agents/`, with thin platform definitions under `.codex/agents/` and `.claude/agents/`. Role contracts and platform adapters are shared across tasks; do not create a new role definition per ticket.

Start each task by checking the existing plan and handoff records. Assign one human owner (Developer A or Developer B), approved requirement IDs, exact write paths, and dependencies. Use separate worktrees for concurrent writers and never assign overlapping paths. Reuse a suitable existing worker session when available; otherwise start the same role with the current handoff as context.

The orchestrator consolidates worker notes in `workflow/handoffs/` using `workflow/agent-handoff-template.md`. Every worker records session resource metrics that the platform exposes; unavailable values are labeled, never estimated. The reviewer has read-only permissions. Human developers retain requirement approval, conflict decisions, and merge decisions.
