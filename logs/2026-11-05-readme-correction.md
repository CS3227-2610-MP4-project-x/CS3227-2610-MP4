
## Follow-up (2026-11-06): README update

- The user asked to update the README. Updated `workflow/agents/README.md`:
  - "Who orchestrates" no longer claims Claude Code subagents cannot nest. It now says nesting is allowed (three layers by default) and that this repository sets the spawn depth to 1.
  - The delegation-depth row in the Enforcement table no longer lists the Codex `[agents]` settings removed in `48e62bc`.
  - The secret-file deny row now states the documented limits: commands that read files without naming them, and scripts that open files themselves, are not covered.
- Human has approved the changes.
