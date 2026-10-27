"""Black-box checks for the human-invoked local usage dashboard.

All provider histories and handoff records in this module are synthetic.  Each
test invokes the same command as the skills with isolated input and state roots.
"""

from __future__ import annotations

from contextlib import closing
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PRIVATE_TEXT = "SYNTHETIC_PRIVATE_TRANSCRIPT_SENTINEL"


def write_jsonl(path: Path, *records: dict, trailing: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record) + "\n" for record in records) + trailing,
        encoding="utf-8",
    )


def codex_usage(
    *, session: str, timestamp: str, input_tokens: int = 100, output_tokens: int = 40
) -> tuple[dict, dict]:
    return (
        {
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": {"id": session, "model": "synthetic-codex-model"},
        },
        {
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "token_usage_record": {
                        "input_tokens": input_tokens,
                        "cached_input_tokens": 20,
                        "output_tokens": output_tokens,
                        "reasoning_output_tokens": 10,
                    },
                    "total_token_usage": {
                        "input_tokens": input_tokens * 10,
                        "output_tokens": output_tokens * 10,
                    },
                },
            },
        },
    )


def claude_usage(
    *, session: str, message: str, timestamp: str, output_tokens: int | None = 12
) -> dict:
    usage = {
        "input_tokens": 30,
        "cache_read_input_tokens": 5,
        "cache_creation_input_tokens": 3,
    }
    if output_tokens is not None:
        usage["output_tokens"] = output_tokens
    return {
        "type": "assistant",
        "sessionId": session,
        "uuid": message,
        "timestamp": timestamp,
        "message": {
            "id": message,
            "model": "synthetic-claude-model",
            "usage": usage,
            "content": [{"type": "text", "text": PRIVATE_TEXT}],
        },
    }


class DashboardCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="agent-usage-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.codex_root = self.root / "codex"
        self.claude_root = self.root / "claude"
        self.work_repo = self.root / "repository"
        self.state = self.root / "private-state"
        self.output = self.root / "report" / "index.html"
        self.codex_root.mkdir()
        self.claude_root.mkdir()
        self.work_repo.mkdir()

    def generate(self) -> str:
        environment = dict(os.environ)
        environment["HOME"] = str(self.root / "isolated-home")
        environment["CODEX_HOME"] = str(self.root / "unused-codex-home")
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "tools.agent_usage_dashboard",
                "generate",
                "--codex-root",
                str(self.codex_root),
                "--claude-root",
                str(self.claude_root),
                "--repo",
                str(self.work_repo),
                "--state",
                str(self.state),
                "--output",
                str(self.output),
            ],
            cwd=PROJECT_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            f"dashboard command failed:\n{completed.stdout}\n{completed.stderr}",
        )
        self.assertTrue(self.output.is_file(), "command did not write the requested HTML")
        return self.output.read_text(encoding="utf-8")

    def ledger_rows(self) -> list[sqlite3.Row]:
        databases = list(self.state.rglob("*.sqlite*")) + list(self.state.rglob("*.db"))
        self.assertTrue(databases, "command did not create a local SQLite ledger")
        with closing(sqlite3.connect(databases[0])) as connection:
            connection.row_factory = sqlite3.Row
            tables = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            for table in tables:
                name = table[0]
                columns = {
                    row[1] for row in connection.execute(f'PRAGMA table_info("{name}")')
                }
                if {"provider", "session_id", "input_tokens", "output_tokens"} <= columns:
                    return connection.execute(f'SELECT * FROM "{name}"').fetchall()
        self.fail("SQLite ledger has no normalized response table")

    def diagnostic_rows(self) -> list[sqlite3.Row]:
        databases = list(self.state.rglob("*.sqlite*")) + list(self.state.rglob("*.db"))
        self.assertTrue(databases, "command did not create a local SQLite ledger")
        with closing(sqlite3.connect(databases[0])) as connection:
            connection.row_factory = sqlite3.Row
            tables = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            for table in tables:
                name = table[0]
                columns = {
                    row[1] for row in connection.execute(f'PRAGMA table_info("{name}")')
                }
                if {"provider", "code", "detail"} <= columns:
                    return connection.execute(f'SELECT * FROM "{name}"').fetchall()
        self.fail("SQLite ledger has no diagnostic table")

    def rendered_tables(self, html: str) -> dict[str, str]:
        """Run the generated report script with a minimal DOM to observe its rows."""
        if shutil.which("node") is None:
            self.skipTest("Node.js is unavailable for report interaction check")
        scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, re.DOTALL)
        self.assertGreaterEqual(len(scripts), 2, "report has no embedded data and script")
        harness = r"""
const vm = require('node:vm');
const payload = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const elements = new Map();
const canvas = {scale(){},clearRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){}};
const document = {
  getElementById(id) {
    if (id === 'usage-data') return {textContent: JSON.stringify(payload.data)};
    if (!elements.has(id)) elements.set(id, {
      value: id === 'group' ? 'session' : '',
      selectedOptions: [{text: 'Session'}],
      textContent: '', innerHTML: '', clientWidth: 600,
      getContext(){return canvas}, addEventListener(){},
    });
    return elements.get(id);
  },
  querySelectorAll(){return []},
};
const context = vm.createContext({document, devicePixelRatio: 1});
vm.runInContext(payload.script, context);
const tables = {all: elements.get('rows').innerHTML};
for (const provider of ['codex', 'claude']) {
  elements.get('provider').value = provider;
  vm.runInContext('render()', context);
  tables[provider] = elements.get('rows').innerHTML;
}
process.stdout.write(JSON.stringify(tables));
"""
        completed = subprocess.run(
            ["node", "-e", harness],
            input=json.dumps({"data": json.loads(scripts[-2]), "script": scripts[-1]}),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def test_one_invocation_collects_both_providers_and_writes_offline_report(self) -> None:
        """Collection, provider separation, graph/filter controls, and privacy."""
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            *codex_usage(session="codex-session-A", timestamp="2026-01-02T03:04:05Z"),
            {"type": "response_item", "payload": {"content": PRIVATE_TEXT}},
        )
        write_jsonl(
            self.claude_root / "projects" / "synthetic.jsonl",
            claude_usage(
                session="claude-session-A",
                message="claude-response-A",
                timestamp="2026-01-03T04:05:06Z",
            ),
        )

        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual({row["provider"] for row in rows}, {"codex", "claude"})
        self.assertEqual({row["session_id"] for row in rows}, {
            "codex-session-A", "claude-session-A"
        })
        self.assertIn("codex-session-A", html)
        self.assertIn("claude-session-A", html)
        for control in ("Codex", "Claude", "Work", "Agent", "Model", "Phase"):
            self.assertIn(control.lower(), html.lower())
        self.assertIn("time", html.lower())
        self.assertIn("csv", html.lower())
        self.assertNotIn('src="http', html.lower())
        self.assertNotIn('href="http', html.lower())
        self.assertNotIn(PRIVATE_TEXT, html)
        self.assertNotIn(str(self.root), html)
        for generated in self.state.rglob("*"):
            if generated.is_file():
                self.assertNotIn(PRIVATE_TEXT.encode(), generated.read_bytes())

    def test_rescan_deduplicates_responses_and_ignores_cumulative_codex_usage(self) -> None:
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            *codex_usage(session="codex-session-B", timestamp="2026-02-01T00:00:00Z"),
        )
        self.generate()
        first = self.ledger_rows()
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["input_tokens"], 100)
        self.assertEqual(first[0]["output_tokens"], 40)

        self.generate()
        second = self.ledger_rows()
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0]["input_tokens"], 100)
        self.assertEqual(second[0]["output_tokens"], 40)

    def test_missing_usage_malformed_line_and_partial_line_are_reported(self) -> None:
        source = self.claude_root / "projects" / "synthetic.jsonl"
        partial = json.dumps(
            claude_usage(
                session="claude-session-partial",
                message="response-later",
                timestamp="2026-02-02T00:00:01Z",
            )
        )
        write_jsonl(
            source,
            claude_usage(
                session="claude-session-missing",
                message="response-missing",
                timestamp="2026-02-02T00:00:00Z",
                output_tokens=None,
            ),
            trailing="{malformed json}\n" + partial[:-1],
        )
        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["output_tokens"])
        self.assertIn("diagnostic", html.lower())
        self.assertNotIn("claude-session-partial", html)
        self.assertNotIn(PRIVATE_TEXT, html)

        with source.open("a", encoding="utf-8") as stream:
            stream.write(partial[-1] + "\n")
        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 2)
        self.assertIn("claude-session-partial", html)

    def test_explicit_handoff_match_and_ambiguous_match(self) -> None:
        for session in ("explicit-session", "ambiguous-session", "unmatched-session"):
            write_jsonl(
                self.claude_root / "projects" / f"{session}.jsonl",
                claude_usage(
                    session=session,
                    message=f"{session}-response",
                    timestamp="2026-03-01T00:00:00Z",
                ),
            )
        handoffs = self.work_repo / "workflow" / "handoffs"
        handoffs.mkdir(parents=True)
        (handoffs / "synthetic.md").write_text(
            """# Synthetic task handoff

### Session implementer / synthetic-1
- Provider: claude
- Provider session ID: explicit-session
- Work ID: WORK-EXPLICIT
- Agent: implementer

### Session implementer / synthetic-2
- Provider: claude
- Provider session ID: ambiguous-session
- Work ID: WORK-ONE
- Agent: implementer

### Session reviewer / synthetic-3
- Provider: claude
- Provider session ID: ambiguous-session
- Work ID: WORK-TWO
- Agent: reviewer
""",
            encoding="utf-8",
        )
        html = self.generate()
        self.assertIn("WORK-EXPLICIT", html)
        self.assertIn("explicit-session", html)
        self.assertIn("ambiguous-session", html)
        self.assertIn("unmatched-session", html)
        self.assertIn("ambiguous", html.lower())
        self.assertIn("unknown", html.lower())

    def test_equal_session_ids_stay_separate_in_provider_groups(self) -> None:
        """A session identifier has meaning only inside its provider namespace."""
        shared = "shared-provider-session"
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            *codex_usage(session=shared, timestamp="2026-04-01T00:00:00Z"),
        )
        write_jsonl(
            self.claude_root / "projects" / "synthetic.jsonl",
            claude_usage(
                session=shared,
                message="shared-response",
                timestamp="2026-04-01T00:00:01Z",
            ),
        )
        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["provider"] for row in rows}, {"codex", "claude"})
        tables = self.rendered_tables(html)
        self.assertEqual(len(re.findall(r"<tr\b", tables["all"])), 2)
        self.assertEqual(len(re.findall(r"<tr\b", tables["codex"])), 1)
        self.assertEqual(len(re.findall(r"<tr\b", tables["claude"])), 1)
        self.assertIn("codex", tables["all"])
        self.assertIn("claude", tables["all"])

    def test_unsupported_provider_shape_has_generic_diagnostic(self) -> None:
        """Unknown records are counted as coverage gaps without copying content."""
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            {"type": "session_meta", "payload": {"id": "unsupported-session"}},
            {
                "type": "future_usage_event",
                "payload": {"usage": {"tokens": 99}, "content": PRIVATE_TEXT},
            },
        )
        html = self.generate()
        diagnostics = self.diagnostic_rows()
        self.assertTrue(
            any(row["provider"] == "codex" for row in diagnostics),
            "unsupported Codex record shape was silently ignored",
        )
        self.assertIn("diagnostic", html.lower())
        self.assertNotIn(PRIVATE_TEXT, html)
        self.assertTrue(all(PRIVATE_TEXT not in row["detail"] for row in diagnostics))

    def test_invalid_optional_metric_is_unknown_with_diagnostic(self) -> None:
        record = claude_usage(
            session="invalid-optional-session",
            message="invalid-optional-response",
            timestamp="2026-04-02T00:00:00Z",
        )
        record["message"]["usage"]["cache_read_input_tokens"] = PRIVATE_TEXT
        record["message"]["usage"]["reasoning_tokens"] = -1
        write_jsonl(self.claude_root / "projects" / "synthetic.jsonl", record)
        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["cached_input_tokens"])
        self.assertIsNone(rows[0]["reasoning_tokens"])
        self.assertTrue(
            any(row["provider"] == "claude" for row in self.diagnostic_rows()),
            "invalid optional metrics were left without a coverage diagnostic",
        )
        self.assertNotIn(PRIVATE_TEXT, html)

    def test_codex_same_timestamp_and_usage_without_ids_are_two_responses(self) -> None:
        metadata, usage = codex_usage(
            session="duplicate-looking-session", timestamp="2026-04-03T00:00:00Z"
        )
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            metadata,
            usage,
            usage,
        )
        self.generate()
        self.assertEqual(
            len(self.ledger_rows()),
            2,
            "two distinct per-response events with the same metrics were collapsed",
        )
        self.generate()
        self.assertEqual(len(self.ledger_rows()), 2)

    def test_archiving_idless_codex_jsonl_does_not_duplicate_response(self) -> None:
        """A normal provider archive move preserves the collected response identity."""
        source = self.codex_root / "sessions" / "synthetic.jsonl"
        write_jsonl(
            source,
            *codex_usage(session="archived-session", timestamp="2026-04-03T01:00:00Z"),
        )
        self.generate()
        first = self.ledger_rows()
        self.assertEqual(len(first), 1)
        before = (first[0]["input_tokens"], first[0]["output_tokens"])

        archived = self.codex_root / "archived_sessions" / source.name
        archived.parent.mkdir(parents=True)
        source.rename(archived)
        self.generate()
        second = self.ledger_rows()
        self.assertEqual(
            len(second),
            1,
            "archiving the same ID-less JSONL produced a duplicate response",
        )
        self.assertEqual(
            (second[0]["input_tokens"], second[0]["output_tokens"]), before
        )

    def test_unreadable_history_reports_generic_diagnostic(self) -> None:
        source = self.claude_root / "projects" / "unreadable.jsonl"
        write_jsonl(
            source,
            claude_usage(
                session="unreadable-session",
                message="unreadable-response",
                timestamp="2026-04-03T02:00:00Z",
            ),
        )
        source.chmod(0)
        try:
            if os.access(source, os.R_OK):
                self.skipTest("this account can read mode-000 files")
            html = self.generate()
            diagnostics = self.diagnostic_rows()
            self.assertTrue(
                any(row["provider"] == "claude" and "unreadable" in row["code"]
                    for row in diagnostics),
                "unreadable history had no generic coverage diagnostic",
            )
            self.assertNotIn(PRIVATE_TEXT, html)
            self.assertNotIn(str(source), html)
        finally:
            source.chmod(0o600)

    def test_session_total_is_input_plus_output_without_cache_subsets(self) -> None:
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            *codex_usage(session="total-session", timestamp="2026-04-04T00:00:00Z"),
        )
        html = self.generate()
        self.assertTrue(
            re.search(r"<th[^>]*>\s*Total(?: tokens)?\s*</th>", html, re.IGNORECASE),
            "per-session usage table has no total-token column",
        )
        table = self.rendered_tables(html)["codex"]
        self.assertIn(">140<", table)

    def test_current_codex_layout_reads_top_level_usage_records(self) -> None:
        """Top-level usage records count once; running totals and model context do not add rows."""
        usage = {
            "input_tokens": 200,
            "cached_input_tokens": 50,
            "cache_write_input_tokens": 7,
            "output_tokens": 30,
            "reasoning_output_tokens": 4,
            "total_tokens": 230,
        }
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            {"timestamp": "2026-05-01T00:00:00Z", "type": "session_meta",
             "payload": {"id": "current-codex-session", "session_id": "current-codex-session"}},
            {"timestamp": "2026-05-01T00:00:01Z", "type": "turn_context",
             "payload": {"model": "synthetic-current-model", "turn_id": "turn-1"}},
            {"timestamp": "2026-05-01T00:00:02Z", "type": "world_state",
             "payload": {"content": PRIVATE_TEXT}},
            {"timestamp": "2026-05-01T00:00:03Z", "type": "token_usage_record",
             "payload": {"session_id": "current-codex-session", "turn_id": "turn-1",
                         "response_id": "response-1", "usage": usage,
                         "thread_token_usage": {"input_tokens": 9999, "output_tokens": 9999}}},
            {"timestamp": "2026-05-01T00:00:04Z", "type": "event_msg",
             "payload": {"type": "token_count",
                         "info": {"last_token_usage": usage, "total_token_usage": usage}}},
        )
        html = self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 1, "running totals were recorded as extra responses")
        row = rows[0]
        self.assertEqual(row["session_id"], "current-codex-session")
        self.assertEqual(row["response_id"], "response-1")
        self.assertEqual(row["model"], "synthetic-current-model")
        self.assertEqual(
            (row["input_tokens"], row["output_tokens"], row["cached_input_tokens"],
             row["cache_write_tokens"], row["reasoning_tokens"]),
            (200, 30, 50, 7, 4),
        )
        codes = {d["code"] for d in self.diagnostic_rows() if d["provider"] == "codex"}
        self.assertFalse(
            codes & {"unsupported_record", "missing_usage", "optional_metric_unavailable",
                     "per_response_usage_unavailable"},
            f"current Codex layout produced coverage gaps: {codes}",
        )
        self.assertNotIn(PRIVATE_TEXT, html)

    def test_codex_running_totals_alone_are_a_coverage_gap(self) -> None:
        totals = {"input_tokens": 10, "output_tokens": 5}
        write_jsonl(
            self.codex_root / "sessions" / "synthetic.jsonl",
            {"type": "session_meta", "payload": {"id": "totals-only-session"}},
            {"timestamp": "2026-05-02T00:00:00Z", "type": "event_msg",
             "payload": {"type": "token_count",
                         "info": {"last_token_usage": totals, "total_token_usage": totals}}},
        )
        self.generate()
        self.assertEqual(len(self.ledger_rows()), 0, "running totals were treated as per-response usage")
        self.assertTrue(
            any(d["code"] == "per_response_usage_unavailable" for d in self.diagnostic_rows()),
            "missing per-response Codex usage had no coverage diagnostic",
        )

    def test_claude_thinking_tokens_are_reported_as_reasoning(self) -> None:
        record = claude_usage(
            session="thinking-session",
            message="thinking-response",
            timestamp="2026-05-03T00:00:00Z",
        )
        record["message"]["usage"]["output_tokens_details"] = {"thinking_tokens": 7}
        write_jsonl(self.claude_root / "projects" / "synthetic.jsonl", record)
        self.generate()
        rows = self.ledger_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["reasoning_tokens"], 7)
        self.assertFalse(
            any(d["code"] == "optional_metric_unavailable" for d in self.diagnostic_rows()),
            "reported thinking tokens were still flagged as unavailable",
        )


if __name__ == "__main__":
    unittest.main()
