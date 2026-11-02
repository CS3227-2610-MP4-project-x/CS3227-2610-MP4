"""Append privacy-minimized Codex lifecycle metadata for the usage dashboard.

Codex passes one hook event as JSON on stdin. This hook never opens or scans a
transcript and never invokes the dashboard collector.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from typing import Any


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _path_hash(value: Any) -> str | None:
    path_text = _string(value)
    if path_text is None:
        return None
    try:
        normalized = os.path.normcase(os.path.realpath(os.path.expanduser(path_text)))
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    except (OSError, UnicodeError, ValueError):
        return None


def _record(event: dict[str, Any]) -> dict[str, Any] | None:
    event_name = _string(event.get("hook_event_name"))
    if event_name not in {"SessionStart", "SessionEnd", "SubagentStart", "SubagentStop"}:
        return None

    record: dict[str, Any] = {
        "provider": "codex",
        "event": event_name,
        "observed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    session_id = _string(event.get("session_id"))
    if session_id:
        # For subagent events this is the parent session ID, per Codex's hook contract.
        record["session_id"] = session_id
    model = _string(event.get("model"))
    if model:
        record["model"] = model

    if event_name in {"SubagentStart", "SubagentStop"}:
        agent_id = _string(event.get("agent_id"))
        agent_type = _string(event.get("agent_type"))
        if agent_id:
            record["agent_id"] = agent_id
        if agent_type:
            record["agent_type"] = agent_type
    if event_name == "SubagentStop":
        transcript_hash = _path_hash(event.get("agent_transcript_path"))
        if transcript_hash:
            record["transcript_path_hash"] = transcript_hash
    return record


def main() -> int:
    # Hooks must fail open so optional local accounting never interrupts agent work.
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            return 0
        record = _record(payload)
        if record is None:
            return 0
        state = Path(os.environ.get("AGENT_USAGE_STATE", Path.home() / ".agent-usage-dashboard")).expanduser()
        # Keep the event file under the private dashboard state directory, even
        # when callers customize the state directory.
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(state, 0o700)
        except OSError:
            pass
        target = state / "codex-lifecycle.jsonl"
        with target.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
