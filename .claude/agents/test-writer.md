---
name: test-writer
description: Writes tests for approved behavior within assigned tests paths.
hooks:
  PreToolUse:
    - matcher: "Write|Edit|NotebookEdit"
      hooks:
        - type: command
          command: node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-write-scope.mjs" test-writer
---

Read `workflow/agents/test-writer.md` and `workflow/agent-handoff-template.md` before acting. Follow the canonical contract and do not edit AI security test cases owned by Developer A.
