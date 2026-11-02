"""Black-box Codex lifecycle hook checks using isolated synthetic events."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PRIVATE_TEXT = "SYNTHETIC_PRIVATE_HOOK_CONTENT_SENTINEL"


class CodexUsageHookTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="codex-hook-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / "state"

    def invoke(self, payload: object, *, raw: bool = False) -> subprocess.CompletedProcess:
        completed = subprocess.run(
            [sys.executable, "-m", "tools.codex_usage_hook"],
            input=payload if raw else json.dumps(payload),
            cwd=PROJECT_ROOT,
            env=dict(os.environ, AGENT_USAGE_STATE=str(self.state)),
            text=True, capture_output=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "", "hook printed event or accounting data")
        return completed

    def test_four_lifecycle_events_record_only_identity_metadata(self) -> None:
        # The transcript deliberately does not exist: capture must not require
        # opening it, and neither its path nor event content may be persisted.
        transcript = self.root / PRIVATE_TEXT / "child-transcript.jsonl"
        for event in ("SessionStart", "SubagentStart", "SubagentStop", "SessionEnd"):
            self.invoke({
                "hook_event_name": event,
                "session_id": "parent-session",
                "agent_id": "agent-child",
                "agent_type": "test-writer",
                "model": "synthetic-model",
                "agent_transcript_path": str(transcript),
                "prompt": PRIVATE_TEXT,
                "last_assistant_message": PRIVATE_TEXT,
                "tool_input": {"content": PRIVATE_TEXT},
                "usage": {"input_tokens": 999999},
                "work_id": "UNTRUSTED-WORK",
            })
        captured = (self.state / "codex-lifecycle.jsonl").read_text(encoding="utf-8")
        records = [json.loads(line) for line in captured.splitlines()]
        self.assertEqual([row["event"] for row in records], [
            "SessionStart", "SubagentStart", "SubagentStop", "SessionEnd",
        ])
        for row in records:
            self.assertEqual(row["provider"], "codex")
            self.assertEqual(row["session_id"], "parent-session")
            self.assertTrue(row.get("observed_at"), "lifecycle observation has no timestamp")
            self.assertLessEqual(set(row), {
                "provider", "event", "observed_at", "session_id", "model",
                "agent_id", "agent_type", "transcript_path_hash",
            })
            if row["event"].startswith("Subagent"):
                self.assertEqual(row["agent_id"], "agent-child")
                self.assertEqual(row["agent_type"], "test-writer")
            else:
                self.assertNotIn("agent_id", row)
                self.assertNotIn("agent_type", row)
        expected_hash = hashlib.sha256(
            os.path.normcase(os.path.realpath(str(transcript))).encode("utf-8")
        ).hexdigest()
        self.assertEqual(records[2]["transcript_path_hash"], expected_hash)
        self.assertNotIn(PRIVATE_TEXT, captured)
        self.assertNotIn(str(transcript), captured)
        self.assertNotIn("999999", captured)
        self.assertNotIn("UNTRUSTED-WORK", captured)
        self.assertEqual([path.name for path in self.state.iterdir()], ["codex-lifecycle.jsonl"])
        if os.name == "posix":
            self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.state / "codex-lifecycle.jsonl").stat().st_mode & 0o777, 0o600)

    def test_bad_input_and_unsupported_events_fail_open_without_capture(self) -> None:
        for payload, raw in (("{malformed", True), ([], False),
                             ({"hook_event_name": "PostToolUse", "prompt": PRIVATE_TEXT}, False)):
            with self.subTest(payload=payload):
                self.invoke(payload, raw=raw)
        self.assertFalse(self.state.exists())

    def test_unwritable_state_fails_open(self) -> None:
        self.state.write_text("synthetic blocking file", encoding="utf-8")
        completed = self.invoke({"hook_event_name": "SessionStart", "session_id": "root"})
        self.assertEqual(completed.stderr, "")
        self.assertEqual(self.state.read_text(encoding="utf-8"), "synthetic blocking file")


if __name__ == "__main__":
    unittest.main()
