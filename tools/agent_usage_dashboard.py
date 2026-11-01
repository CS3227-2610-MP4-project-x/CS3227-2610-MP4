"""Collect local Codex and Claude token usage and render an offline dashboard.

Collection is deliberately a one-shot operation: importing this module has no
side effects, and provider roots are scanned only by the explicit ``generate``
command.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Any, Iterable


SCHEMA = """
CREATE TABLE IF NOT EXISTS responses (
  response_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  response_id TEXT,
  observed_at TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  tool_calls INTEGER,
  metric_source TEXT NOT NULL,
  work_id TEXT,
  agent TEXT,
  phase TEXT,
  attribution_status TEXT NOT NULL DEFAULT 'unknown'
);
CREATE TABLE IF NOT EXISTS diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  code TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoints (
  file_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  byte_offset INTEGER NOT NULL,
  session_id TEXT,
  model TEXT,
  prefix_digest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codex_transcript_sessions (
  transcript_path_hash TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY(transcript_path_hash, session_id)
);
CREATE TABLE IF NOT EXISTS codex_thread_sources (
  transcript_path_hash TEXT PRIMARY KEY
);
CREATE INDEX IF NOT EXISTS responses_session_idx ON responses(provider, session_id);
CREATE INDEX IF NOT EXISTS responses_time_idx ON responses(observed_at);
"""

RESPONSE_COLUMNS = (
    "response_key", "provider", "session_id", "response_id", "observed_at",
    "model", "input_tokens", "output_tokens", "cached_input_tokens",
    "cache_write_tokens", "reasoning_tokens", "tool_calls", "metric_source",
    "work_id", "agent", "phase", "attribution_status",
)


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _timestamp(value: Any) -> str | None:
    text = _string(value)
    if text is None:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _key(provider: str, session_id: str, response_id: str | None,
         observed_at: str | None, metrics: dict[str, Any],
         source_position: str | None) -> str:
    identity = response_id or json.dumps(
        [source_position, observed_at, *(metrics[name] for name in (
            "input_tokens", "output_tokens", "cached_input_tokens",
            "cache_write_tokens", "reasoning_tokens", "tool_calls"))],
        separators=(",", ":"),
    )
    return hashlib.sha256(f"{provider}\0{session_id}\0{identity}".encode()).hexdigest()


def _response(provider: str, session_id: str, response_id: str | None,
              timestamp: Any, model: Any, metrics: dict[str, Any], source: str,
              source_position: str) -> dict[str, Any]:
    observed = _timestamp(timestamp)
    return {
        "response_key": _key(provider, session_id, response_id, observed, metrics, source_position),
        "provider": provider,
        "session_id": session_id,
        "response_id": response_id,
        "observed_at": observed,
        "model": _string(model),
        **metrics,
        "metric_source": source,
        "work_id": None,
        "agent": None,
        "phase": None,
        "attribution_status": "unknown",
    }


def _diagnose(connection: sqlite3.Connection, provider: str, code: str,
              detail: str) -> None:
    # Diagnostics are fixed vocabulary, never source text or paths.
    connection.execute(
        "INSERT INTO diagnostics(provider, code, detail) VALUES (?, ?, ?)",
        (provider, code, detail),
    )


def _jsonl_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return ()
    return sorted(path for path in root.rglob("*.jsonl") if path.is_file())


def _file_key(provider: str, root: Path, path: Path) -> str:
    relative = path.relative_to(root).as_posix()
    return hashlib.sha256(f"{provider}\0{relative}".encode()).hexdigest()


def _normalized_path_hash(path: Path) -> str:
    normalized = os.path.normcase(os.path.realpath(os.path.expanduser(str(path))))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _prefix_digest(path: Path, length: int) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        remaining = length
        while remaining:
            chunk = stream.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            digest.update(chunk)
            remaining -= len(chunk)
    return digest.hexdigest()


def _complete_records(path: Path, provider: str, file_key: str,
                      connection: sqlite3.Connection, force_from_start: bool = False) -> tuple[list[tuple[dict[str, Any], int]], int, str | None, str | None, bool]:
    """Read complete lines from the saved offset; leave a partial tail for retry."""
    try:
        size = path.stat().st_size
        saved = connection.execute(
            "SELECT byte_offset, session_id, model, prefix_digest FROM checkpoints WHERE file_key=?",
            (file_key,),
        ).fetchone()
        offset, session_id, model = (saved[0], saved[1], saved[2]) if saved else (0, None, None)
        if saved and (offset > size or _prefix_digest(path, offset) != saved[3]):
            offset, session_id, model = 0, None, None
        if force_from_start:
            offset, session_id, model = 0, None, None
        records: list[tuple[dict[str, Any], int]] = []
        complete_offset = offset
        with path.open("rb") as stream:
            stream.seek(offset)
            while True:
                line_start = stream.tell()
                line = stream.readline()
                if not line:
                    break
                if not line.endswith(b"\n"):
                    _diagnose(connection, provider, "partial_line", "Incomplete trailing JSONL record was skipped.")
                    break
                complete_offset = stream.tell()
                try:
                    record = json.loads(line.decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    _diagnose(connection, provider, "malformed_line", "Malformed JSONL record was skipped.")
                    continue
                if not isinstance(record, dict):
                    _diagnose(connection, provider, "unsupported_record", "Non-object JSONL record was skipped.")
                    continue
                records.append((record, line_start))
        return records, complete_offset, session_id, model, True
    except (OSError, UnicodeError):
        _diagnose(connection, provider, "unreadable_file", "A provider history file could not be read.")
        return [], 0, None, None, False


def _save_checkpoint(path: Path, provider: str, file_key: str, offset: int,
                     session_id: str | None, model: str | None,
                     connection: sqlite3.Connection) -> None:
    try:
        digest = _prefix_digest(path, offset)
        connection.execute(
            "INSERT INTO checkpoints(file_key, provider, byte_offset, session_id, model, prefix_digest) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(file_key) DO UPDATE SET "
            "provider=excluded.provider, byte_offset=excluded.byte_offset, session_id=excluded.session_id, "
            "model=excluded.model, prefix_digest=excluded.prefix_digest",
            (file_key, provider, offset, session_id, model, digest),
        )
    except (OSError, UnicodeError):
        _diagnose(connection, provider, "unreadable_file", "A provider history file could not be checkpointed.")


def _optional_metrics_diagnostic(connection: sqlite3.Connection, provider: str,
                                  usage: dict[str, Any], fields: tuple[str, ...]) -> None:
    if any(_integer(usage.get(field)) is None for field in fields):
        _diagnose(connection, provider, "optional_metric_unavailable",
                  "One or more optional token metrics are missing or invalid.")


def _save_response(connection: sqlite3.Connection, response: dict[str, Any]) -> None:
    placeholders = ",".join("?" for _ in RESPONSE_COLUMNS)
    names = ",".join(RESPONSE_COLUMNS)
    values = [response[name] for name in RESPONSE_COLUMNS]
    connection.execute(
        f"INSERT OR IGNORE INTO responses ({names}) VALUES ({placeholders})", values
    )


def _save_codex_thread_response(connection: sqlite3.Connection,
                                response: dict[str, Any],
                                legacy_session: str | None,
                                source_position: str) -> bool:
    """Repair the old parent key only when the measured response is identical."""
    if legacy_session and legacy_session != response["session_id"]:
        legacy_key = _key("codex", legacy_session, response["response_id"],
                          response["observed_at"], response, source_position)
        measurement_fields = [field for field in RESPONSE_COLUMNS if field not in {
            "response_key", "session_id", "work_id", "agent", "phase", "attribution_status",
        }]
        previous = connection.execute(
            "SELECT " + ",".join(measurement_fields) + " FROM responses WHERE response_key=?",
            (legacy_key,),
        ).fetchone()
        if previous is not None:
            expected = tuple(response[field] for field in measurement_fields)
            target = connection.execute(
                "SELECT " + ",".join(measurement_fields) + " FROM responses WHERE response_key=?",
                (response["response_key"],),
            ).fetchone()
            if tuple(previous) != expected or (target is not None and tuple(target) != expected):
                _diagnose(connection, "codex", "thread_identity_conflict",
                          "A legacy response identity conflicts with thread-specific measurements; its relationship remains ambiguous.")
                return False
            if target is None:
                connection.execute(
                    "UPDATE responses SET response_key=?, session_id=? WHERE response_key=?",
                    (response["response_key"], response["session_id"], legacy_key),
                )
            else:
                # Both rows describe exactly the same provider response. Keep
                # the thread-keyed row rather than counting the old row twice.
                connection.execute("DELETE FROM responses WHERE response_key=?", (legacy_key,))
    _save_response(connection, response)
    return True


def _codex_metrics(connection: sqlite3.Connection, usage: dict[str, Any]) -> dict[str, Any]:
    # Codex renamed cache_write_tokens to cache_write_input_tokens; accept either.
    cache_write = usage.get("cache_write_input_tokens", usage.get("cache_write_tokens"))
    metrics = {
        "input_tokens": _integer(usage.get("input_tokens")),
        "output_tokens": _integer(usage.get("output_tokens")),
        "cached_input_tokens": _integer(usage.get("cached_input_tokens")),
        "cache_write_tokens": _integer(cache_write),
        "reasoning_tokens": _integer(usage.get("reasoning_output_tokens")),
        "tool_calls": None,
    }
    _optional_metrics_diagnostic(
        connection, "codex", metrics,
        ("cached_input_tokens", "cache_write_tokens", "reasoning_tokens"),
    )
    if metrics["input_tokens"] is None or metrics["output_tokens"] is None:
        _diagnose(connection, "codex", "incomplete_usage", "A Codex response has missing or invalid token metrics.")
    return metrics


def _codex_records(root: Path, connection: sqlite3.Connection) -> dict[str, set[str]]:
    transcript_sessions: dict[str, set[str]] = {}
    reader_upgrade = connection.execute("PRAGMA user_version").fetchone()[0] < 1
    verified_hashes: set[str] = set()
    files = list(_jsonl_files(root / "sessions")) + list(_jsonl_files(root / "archived_sessions"))
    if not files:
        _diagnose(connection, "codex", "no_files", "No Codex JSONL session files were found.")
    for path in sorted(set(files)):
        file_key = _file_key("codex", root, path)
        transcript_hash = _normalized_path_hash(path)
        saved_mapping = connection.execute(
            "SELECT 1 FROM codex_transcript_sessions WHERE transcript_path_hash=? LIMIT 1",
            (transcript_hash,),
        ).fetchone()
        file_upgrade = reader_upgrade or connection.execute(
            "SELECT 1 FROM codex_thread_sources WHERE transcript_path_hash=?",
            (transcript_hash,),
        ).fetchone() is None
        records, offset, current_session, current_model, readable = _complete_records(
            path, "codex", file_key, connection,
            force_from_start=file_upgrade or saved_mapping is None,
        )
        recognized = {"session_meta", "event_msg", "response_item", "turn_context",
                      "compaction", "checkpoint", "config_snapshot", "custom_tool",
                      "world_state"}
        # Newer Codex writes per-response usage as top-level token_usage_record
        # records; its token_count events then carry only running totals.
        usage_records = running_totals = 0
        file_usage_sessions: set[str] = set()
        for record, line_start in records:
            kind = record.get("type")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                _diagnose(connection, "codex", "unsupported_record", "Record payload has an unsupported shape.")
                continue
            if kind == "session_meta":
                current_session = _string(payload.get("id")) or _string(record.get("session_id"))
                current_model = _string(payload.get("model"))
                continue
            if kind == "turn_context":
                current_model = _string(payload.get("model")) or current_model
                continue
            if kind == "token_usage_record":
                usage_records += 1
                usage = payload.get("usage")
                if not isinstance(usage, dict):
                    _diagnose(connection, "codex", "missing_usage", "Per-response token usage is unavailable.")
                    usage = {}
                legacy_session = _string(payload.get("session_id")) or current_session
                session_id = _string(payload.get("thread_id")) or legacy_session
                if session_id is None:
                    _diagnose(connection, "codex", "missing_session", "Token usage record has no session identity.")
                    continue
                response = _response(
                    "codex", session_id,
                    _string(payload.get("response_id")) or _string(payload.get("turn_id")),
                    record.get("timestamp"), current_model, _codex_metrics(connection, usage),
                    "Codex top-level token_usage_record", str(line_start),
                )
                if not _save_codex_thread_response(connection, response, legacy_session, str(line_start)):
                    file_usage_sessions.add(legacy_session)
                file_usage_sessions.add(session_id)
                continue
            if kind != "event_msg" or payload.get("type") != "token_count":
                if kind not in recognized:
                    _diagnose(connection, "codex", "unsupported_record", "Record type is not supported by the Codex usage reader.")
                continue
            info = payload.get("info")
            if not isinstance(info, dict):
                _diagnose(connection, "codex", "missing_usage", "Token-count event has no usage object.")
                info = {}
            usage = info.get("token_usage_record")
            if not isinstance(usage, dict) and ("last_token_usage" in info or "total_token_usage" in info):
                # Running totals are not per-response usage; never record them.
                running_totals += 1
                continue
            if not isinstance(usage, dict):
                _diagnose(connection, "codex", "missing_usage", "Per-response token usage is unavailable.")
                usage = {}
            session_id = current_session or _string(record.get("session_id")) or _string(payload.get("session_id"))
            if session_id is None:
                _diagnose(connection, "codex", "missing_session", "Token-count event has no session identity.")
                continue
            response = _response(
                "codex", session_id,
                _string(info.get("response_id")) or _string(info.get("turn_id")),
                record.get("timestamp") or payload.get("timestamp"),
                _string(info.get("model")) or current_model,
                _codex_metrics(connection, usage), "Codex token_usage_record per-response event",
                str(line_start),
            )
            _save_response(connection, response)
            file_usage_sessions.add(session_id)
        if running_totals and not usage_records:
            _diagnose(connection, "codex", "per_response_usage_unavailable",
                      "Codex running totals were found without per-response usage records.")
        if readable:
            _save_checkpoint(path, "codex", file_key, offset, current_session, current_model, connection)
        if readable and file_upgrade:
            # All complete records were replayed, so replace this source's old
            # parent-only mapping instead of making the corrected join ambiguous.
            connection.execute(
                "DELETE FROM codex_transcript_sessions WHERE transcript_path_hash=?",
                (transcript_hash,),
            )
            connection.execute(
                "INSERT OR IGNORE INTO codex_thread_sources(transcript_path_hash) VALUES (?)",
                (transcript_hash,),
            )
        if readable:
            verified_hashes.add(transcript_hash)
        if file_usage_sessions:
            connection.executemany(
                "INSERT OR IGNORE INTO codex_transcript_sessions(transcript_path_hash, session_id) VALUES (?, ?)",
                [(transcript_hash, session_id) for session_id in file_usage_sessions],
            )
        stored_sessions = {row[0] for row in connection.execute(
            "SELECT session_id FROM codex_transcript_sessions WHERE transcript_path_hash=?",
            (transcript_hash,),
        )}
        if stored_sessions:
            transcript_sessions[transcript_hash] = stored_sessions
    # Source mappings are deliberately retained when files move or disappear,
    # matching the ledger's retention behavior. They contain hashes and parsed
    # session IDs only, never source paths or transcript content.
    for transcript_hash, session_id in connection.execute(
        "SELECT transcript_path_hash, session_id FROM codex_transcript_sessions"
    ):
        transcript_sessions.setdefault(transcript_hash, set()).add(session_id)
    if reader_upgrade:
        if set(transcript_sessions) - verified_hashes:
            _diagnose(connection, "codex", "thread_upgrade_sources_unavailable",
                      "Some retained transcript identities could not be reverified during the thread-aware reader upgrade.")
        connection.execute("PRAGMA user_version=1")
    return transcript_sessions


def _claude_records(root: Path, connection: sqlite3.Connection) -> None:
    files = list(_jsonl_files(root))
    if not files:
        _diagnose(connection, "claude", "no_files", "No Claude JSONL session files were found.")
    for path in files:
        file_key = _file_key("claude", root, path)
        records, offset, _, _, readable = _complete_records(path, "claude", file_key, connection)
        recognized = {"assistant", "user", "system", "summary", "file-history-snapshot",
                      "queue-operation", "progress", "last-prompt", "custom-title", "agent"}
        for record, line_start in records:
            if record.get("type") != "assistant":
                if record.get("type") not in recognized:
                    _diagnose(connection, "claude", "unsupported_record", "Record type is not supported by the Claude usage reader.")
                continue
            message = record.get("message")
            if not isinstance(message, dict):
                _diagnose(connection, "claude", "missing_usage", "Assistant record has no message object.")
                continue
            session_id = _string(record.get("sessionId"))
            usage = message.get("usage")
            response_id = _string(message.get("id")) or _string(record.get("uuid"))
            if session_id is None or response_id is None:
                _diagnose(connection, "claude", "missing_usage", "Assistant record lacks session, response, or usage metadata.")
                continue
            if not isinstance(usage, dict):
                _diagnose(connection, "claude", "missing_usage", "Assistant record has no token usage object.")
                usage = {}
            tool_calls = None
            content = message.get("content")
            if isinstance(content, list):
                tool_calls = sum(1 for item in content if isinstance(item, dict) and item.get("type") == "tool_use")
            # Current transcripts report thinking under output_tokens_details.
            details = usage.get("output_tokens_details")
            reasoning = (details["thinking_tokens"]
                         if isinstance(details, dict) and "thinking_tokens" in details
                         else usage.get("reasoning_tokens"))
            metrics = {
                "input_tokens": _integer(usage.get("input_tokens")),
                "output_tokens": _integer(usage.get("output_tokens")),
                "cached_input_tokens": _integer(usage.get("cache_read_input_tokens")),
                "cache_write_tokens": _integer(usage.get("cache_creation_input_tokens")),
                "reasoning_tokens": _integer(reasoning),
                "tool_calls": tool_calls,
            }
            _optional_metrics_diagnostic(
                connection, "claude", metrics,
                ("cached_input_tokens", "cache_write_tokens", "reasoning_tokens"),
            )
            if metrics["input_tokens"] is None or metrics["output_tokens"] is None:
                _diagnose(connection, "claude", "incomplete_usage", "A Claude response has missing or invalid token metrics.")
            _save_response(connection, _response(
                "claude", session_id, response_id, record.get("timestamp"),
                message.get("model"), metrics, "Claude assistant message usage",
                str(line_start),
            ))
        if readable:
            _save_checkpoint(path, "claude", file_key, offset, None, None, connection)


def _handoff_records(repo: Path) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    roots = [repo / "workflow" / "handoffs", repo / "logs"]
    fields = {"provider": "provider", "provider session id": "session_id",
              "work id": "work_id", "agent": "agent", "phase": "phase"}
    for base in roots:
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.md")):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeError):
                continue
            active: dict[str, str] | None = None
            for line in lines:
                if line.startswith("### Session "):
                    if active and active.get("provider") and active.get("session_id"):
                        entries.append(active)
                    active = {}
                    continue
                if active is None:
                    continue
                stripped = line.strip()
                if stripped.startswith("-"):
                    label, separator, value = stripped[1:].partition(":")
                    key = fields.get(label.strip().lower()) if separator else None
                    if key and value.strip():
                        active[key] = value.strip()
            if active and active.get("provider") and active.get("session_id"):
                entries.append(active)
    return entries


def _hook_records(path: Path, connection: sqlite3.Connection) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    if not path.exists():
        return records
    allowed = {"event", "session_id", "agent_id", "agent_type", "transcript_path_hash"}
    try:
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    item = json.loads(line)
                except (json.JSONDecodeError, UnicodeError):
                    _diagnose(connection, "codex", "malformed_hook_record", "A Codex lifecycle metadata record was malformed.")
                    continue
                if not isinstance(item, dict) or item.get("provider") != "codex":
                    continue
                record = {key: value for key, value in item.items()
                          if key in allowed and isinstance(value, str) and value}
                if record.get("event") in {"SubagentStart", "SubagentStop"}:
                    records.append(record)
    except (OSError, UnicodeError):
        _diagnose(connection, "codex", "hook_metadata_unavailable", "Codex lifecycle metadata could not be read.")
    return records


def _resolve_started_calls(root: Path, records: list[dict[str, str]],
                           transcript_sessions: dict[str, set[str]]) -> list[dict[str, str]]:
    """Verify calls lacking stop references using explicit first-record lineage."""
    stopped = {(r.get("session_id"), r.get("agent_id")) for r in records
               if r.get("event") == "SubagentStop" and r.get("transcript_path_hash")}
    requested = {r["agent_id"] for r in records if r.get("agent_id")
                 and (r.get("session_id"), r["agent_id"]) not in stopped}
    if not requested:
        return records
    lineage: dict[str, set[tuple[str, str]]] = {}
    files = list(_jsonl_files(root / "sessions")) + list(_jsonl_files(root / "archived_sessions"))
    for path in files:
        transcript_hash = _normalized_path_hash(path)
        sessions = transcript_sessions.get(transcript_hash, set())
        if len(sessions) != 1 or not sessions.intersection(requested):
            continue
        try:
            with path.open(encoding="utf-8") as stream:
                first = stream.readline()
            if not first.endswith("\n"):
                continue
            record = json.loads(first)
            if not isinstance(record, dict):
                continue
            payload = record.get("payload")
            if record.get("type") != "session_meta" or not isinstance(payload, dict):
                continue
            child = _string(payload.get("id"))
            source = payload.get("source")
            subagent = source.get("subagent") if isinstance(source, dict) else None
            spawn = subagent.get("thread_spawn") if isinstance(subagent, dict) else None
            parent = _string(spawn.get("parent_thread_id")) if isinstance(spawn, dict) else None
            if child in sessions and parent and parent != child:
                lineage.setdefault(child, set()).add((parent, transcript_hash))
        except (OSError, UnicodeError, ValueError):
            continue
    resolved = []
    for record in records:
        child = record.get("agent_id")
        parents = {parent for parent, _ in lineage.get(child, set())}
        if ((record.get("session_id"), child) not in stopped and len(parents) == 1
                and record.get("session_id") in parents):
            transcript_hash = min(value for _, value in lineage[child])
            resolved.append({**record, "transcript_path_hash": transcript_hash,
                             "relationship_source": "explicit_thread_metadata"})
        elif parents and (len(parents) != 1 or record.get("session_id") not in parents):
            resolved.append({**record, "relationship_source": "ambiguous_thread_metadata"})
        else:
            resolved.append(record)
    return resolved


def _attribute(connection: sqlite3.Connection, entries: list[dict[str, str]],
                transcript_sessions: dict[str, set[str]],
                hook_records: list[dict[str, str]]) -> None:
    mapping: dict[tuple[str, str], list[dict[str, str]]] = {}
    for entry in entries:
        provider = entry.get("provider", "").lower()
        if provider not in {"codex", "claude"}:
            continue
        mapping.setdefault((provider, entry["session_id"]), []).append(entry)
    connection.execute("UPDATE responses SET work_id=NULL, agent=NULL, phase=NULL, attribution_status='unknown'")
    for (provider, session_id), matches in mapping.items():
        if len(matches) == 1:
            entry = matches[0]
            connection.execute(
                "UPDATE responses SET work_id=?, agent=?, phase=?, attribution_status='matched' WHERE provider=? AND session_id=?",
                (entry.get("work_id"), entry.get("agent"), entry.get("phase"), provider, session_id),
            )
        else:
            connection.execute(
                "UPDATE responses SET attribution_status='ambiguous' WHERE provider=? AND session_id=?",
                (provider, session_id),
            )

    # SubagentStop.session_id is the parent. Join the child only through the
    # exact hashed transcript path, and accept only one hook identity and one
    # usage session for that hash. Duplicate identical stop records collapse;
    # conflicting identities or sessions remain ambiguous.
    by_hash: dict[str, set[tuple[str, str, str]]] = {}
    for record in hook_records:
        transcript_hash = record.get("transcript_path_hash")
        parent_id = record.get("session_id")
        agent_id = record.get("agent_id")
        agent_type = record.get("agent_type")
        if (record.get("event") == "SubagentStop" or record.get("relationship_source") == "explicit_thread_metadata") and transcript_hash and parent_id and (agent_id or agent_type):
            by_hash.setdefault(transcript_hash, set()).add(
                (parent_id, agent_id or "", agent_type or "")
            )
    child_assignments: dict[str, set[tuple[str, str | None, str | None]]] = {}
    ambiguous_children: set[str] = set()
    for transcript_hash, identities in by_hash.items():
        sessions = transcript_sessions.get(transcript_hash, set())
        if len(identities) != 1 or len(sessions) != 1:
            ambiguous_children.update(sessions)
            continue
        parent_id, agent_id, agent_type = next(iter(identities))
        child_session = next(iter(sessions))
        if child_session == parent_id:
            # Reject this invalid child relation without downgrading any exact
            # root-session attribution already obtained from a handoff.
            continue
        parent_matches = mapping.get(("codex", parent_id), [])
        # A direct handoff entry for the same child conflicts with hook-derived
        # identity unless it independently describes that same agent label.
        child_matches = mapping.get(("codex", child_session), [])
        if len(child_matches) > 1 or (child_matches and child_matches[0].get("agent") and
                                      child_matches[0].get("agent") != agent_type):
            ambiguous_children.add(child_session)
            continue
        agent_label = (f"{agent_type} [{agent_id}]" if agent_type and agent_id
                       else agent_type or agent_id)
        child_entry = child_matches[0] if len(child_matches) == 1 else {}
        parent_entry = parent_matches[0] if len(parent_matches) == 1 else {}
        conflict = any(
            child_entry.get(field) and parent_entry.get(field)
            and child_entry[field] != parent_entry[field]
            for field in ("work_id", "phase")
        )
        if conflict:
            ambiguous_children.add(child_session)
            continue
        work_id = child_entry.get("work_id") or parent_entry.get("work_id")
        phase = child_entry.get("phase") or parent_entry.get("phase")
        child_assignments.setdefault(child_session, set()).add((agent_label, work_id, phase))
    for child_session, assignments in child_assignments.items():
        if child_session in ambiguous_children or len(assignments) != 1:
            ambiguous_children.add(child_session)
            continue
        agent_label, work_id, phase = next(iter(assignments))
        connection.execute(
            "UPDATE responses SET work_id=?, agent=?, phase=?, attribution_status='matched' "
            "WHERE provider='codex' AND session_id=?",
            (work_id, agent_label, phase, child_session),
        )
    for child_session in ambiguous_children:
        connection.execute(
            "UPDATE responses SET work_id=NULL, agent=NULL, phase=NULL, attribution_status='ambiguous' "
            "WHERE provider='codex' AND session_id=?",
            (child_session,),
        )


def _snapshot(connection: sqlite3.Connection, scan_seconds: float) -> dict[str, Any]:
    connection.row_factory = sqlite3.Row
    responses = [dict(row) for row in connection.execute(
        "SELECT " + ",".join(RESPONSE_COLUMNS) + " FROM responses ORDER BY observed_at, provider, session_id, response_key"
    )]
    diagnostics = [dict(row) for row in connection.execute(
        "SELECT provider, code, detail FROM diagnostics ORDER BY id"
    )]
    return {"responses": responses, "diagnostics": diagnostics,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "scan_seconds": round(scan_seconds, 3)}


def _subagent_calls(records: list[dict[str, str]],
                    transcript_sessions: dict[str, set[str]],
                    responses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose captured calls; attach usage only through an exact unique join.

    A lifecycle identity alone can show that a call occurred, but it cannot
    establish a child usage session. Never substitute the parent's usage.
    """
    calls: dict[tuple[str, str], dict[str, Any]] = {}
    hash_identities: dict[str, set[tuple[str, str]]] = {}
    candidates: dict[tuple[str, str], set[str]] = {}
    for record in records:
        parent = record.get("session_id")
        identity = record.get("agent_id") or record.get("agent_type")
        if not parent or not identity:
            continue
        key = (parent, identity)
        call = calls.setdefault(key, {
            "provider": "codex", "parent_session_id": parent,
            "agent_id": record.get("agent_id"), "agent": None,
            "session_id": None, "usage_status": "No separate usage reported",
        })
        if record.get("relationship_source") == "ambiguous_thread_metadata":
            call["usage_status"] = "Ambiguous session relationship"
        label = record.get("agent_type")
        if label:
            call["agent"] = label
        transcript_hash = record.get("transcript_path_hash")
        if (record.get("event") == "SubagentStop" or record.get("relationship_source") == "explicit_thread_metadata") and transcript_hash:
            hash_identities.setdefault(transcript_hash, set()).add(key)
            candidates.setdefault(key, set()).add(transcript_hash)

    by_session: dict[str, list[dict[str, Any]]] = {}
    for response in responses:
        if response["provider"] == "codex":
            by_session.setdefault(response["session_id"], []).append(response)
    session_claims: dict[str, set[tuple[str, str]]] = {}
    for key, hashes in candidates.items():
        for transcript_hash in hashes:
            for session in transcript_sessions.get(transcript_hash, set()):
                session_claims.setdefault(session, set()).add(key)
    for key, hashes in candidates.items():
        # Multiple different transcript relationships are ambiguous even when
        # one happens to resolve to a known session.
        if len(hashes) != 1:
            calls[key]["usage_status"] = "Ambiguous session relationship"
            continue
        transcript_hash = next(iter(hashes))
        sessions = transcript_sessions.get(transcript_hash, set())
        if len(hash_identities[transcript_hash]) != 1 or len(sessions) > 1:
            calls[key]["usage_status"] = "Ambiguous session relationship"
            continue
        if not sessions:
            continue
        session = next(iter(sessions))
        measured = by_session.get(session, [])
        if session == key[0]:
            calls[key]["usage_status"] = "Only parent usage reported"
        elif len(session_claims[session]) > 1 or any(
                row["attribution_status"] == "ambiguous" for row in measured):
            calls[key]["usage_status"] = "Ambiguous session relationship"
        if (session != key[0] and len(session_claims[session]) == 1 and measured
                and all(row["attribution_status"] == "matched" for row in measured)):
            calls[key]["session_id"] = session
            calls[key]["usage_status"] = "Measured child usage"
    return list(calls.values())


def _render(snapshot: dict[str, Any]) -> str:
    # JSON is embedded in an inert script node; escape HTML-significant chars.
    data = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local Agent Usage Dashboard</title><style>
:root{color-scheme:dark;--bg:#10151d;--panel:#171f2b;--line:#293545;--ink:#e8eef6;--muted:#97a7bb;--a:#61d6bd;--b:#8ba7ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 75% -15%,#25364b 0,transparent 45%),var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:36px 28px}header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:24px}h1{font-size:30px;letter-spacing:-.04em;margin:0}p{color:var(--muted);margin:.35em 0 0}.eyebrow{color:var(--a);text-transform:uppercase;letter-spacing:.15em;font-size:11px;font-weight:700}.panel{background:linear-gradient(145deg,#1b2532,#151c27);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 12px 30px #0002}.filters{display:flex;flex-wrap:wrap;gap:10px}.filters label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.1em}.filters select,.filters input{display:block;color:var(--ink);background:#101720;border:1px solid var(--line);padding:9px;border-radius:8px;min-width:130px;margin-top:5px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:16px;background:#111923;border:1px solid var(--line);border-radius:10px}.card small{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.12em}.card strong{font-size:23px;display:block;margin-top:5px}.cols{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}canvas{width:100%;height:240px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}td{font-variant-numeric:tabular-nums}.disclosure{color:var(--a);background:transparent;border:1px solid var(--line);border-radius:5px;padding:3px 7px;margin-right:8px;cursor:pointer}.disclosure:focus-visible{outline:2px solid var(--a);outline-offset:3px}.child-row{background:#101720}.child-row td:nth-child(2){padding-left:28px}.child-row[hidden]{display:none}.usage-note{display:block;color:var(--muted);font-size:11px}.badge{padding:3px 7px;border-radius:99px;background:#263346;color:#b9c9dc;font-size:11px}.action{color:var(--a);background:#15251f;border:1px solid #30564b;padding:9px 12px;border-radius:8px;cursor:pointer}h2{font-size:15px;margin:0 0 12px}.empty{color:var(--muted);padding:20px 0}@media(max-width:850px){.cols{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){main{padding:22px 14px}header{display:block}.cards{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<header><div><div class="eyebrow">Local · on demand · offline</div><h1>Agent usage</h1><p>Observed provider usage, with unknown metrics left unknown.</p></div><button class="action" id="export">Export filtered CSV</button></header>
<section class="panel filters" aria-label="Filters">
<label>Provider<select id="provider"><option value="">All providers</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
<label>Group<select id="group"><option value="session">Session</option><option value="work_id">Work</option><option value="agent">Agent</option></select></label>
<label>Work<input id="work" placeholder="Any work"></label><label>Agent<input id="agent" placeholder="Any agent"></label>
<label>Model<input id="model" placeholder="Any model"></label><label>Phase<input id="phase" placeholder="Any phase"></label>
<label>From<input id="from" type="date"></label><label>To<input id="to" type="date"></label></section>
<section class="cards"><div class="card"><small>Responses</small><strong id="responses">—</strong></div><div class="card"><small>Input tokens</small><strong id="input">—</strong></div><div class="card"><small>Output tokens</small><strong id="output">—</strong></div><div class="card"><small>Observed total</small><strong id="total">—</strong></div></section>
<div class="cols"><section class="panel"><h2>Tokens over time</h2><canvas id="chart" aria-label="Observed token usage by time"></canvas><p>Only records with timestamps and known token values are plotted.</p></section><section class="panel"><h2>Collection coverage</h2><div id="coverage"></div></section></div>
<section class="panel"><h2>Usage by <span id="group-title">session</span></h2><div class="scroll"><table><thead><tr><th>Provider</th><th>Session / group</th><th>Timestamp (SGT)</th><th>Work</th><th>Agent</th><th>Model</th><th>Input</th><th>Output</th><th>Total</th><th>Cache read</th><th>Cache write</th><th>Reasoning</th><th>Tools</th><th>Attribution</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<section class="panel"><h2>Diagnostics</h2><div id="diagnostics"></div></section>
</main><script id="usage-data" type="application/json">""" + data + """</script><script>
const DATA=JSON.parse(document.getElementById('usage-data').textContent);const $=id=>document.getElementById(id);const fmt=n=>n===null||n===undefined?'Unknown':Number(n).toLocaleString();const esc=s=>String(s??'Unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filtered(){return DATA.responses.filter(r=>{const v=id=>$(id).value.trim().toLowerCase();const date=(r.observed_at||'').slice(0,10);return(!v('provider')||r.provider===v('provider'))&&(!v('work')||(r.work_id||'').toLowerCase().includes(v('work')))&&(!v('agent')||(r.agent||'').toLowerCase().includes(v('agent')))&&(!v('model')||(r.model||'').toLowerCase().includes(v('model')))&&(!v('phase')||(r.phase||'').toLowerCase().includes(v('phase')))&&(!v('from')||date>=v('from'))&&(!v('to')||date<=v('to'))})}
function sumKnown(rows,key){const vals=rows.map(r=>r[key]);return vals.length&&vals.every(v=>Number.isFinite(v))?vals.reduce((a,v)=>a+v,0):null}
function chart(rows){const c=$('chart'),ctx=c.getContext('2d'),dpr=devicePixelRatio||1,w=c.clientWidth,h=240;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const points=rows.filter(r=>r.observed_at&&r.input_tokens!==null&&r.output_tokens!==null).map(r=>({x:new Date(r.observed_at).getTime(),y:r.input_tokens+r.output_tokens,p:r.provider})).filter(p=>Number.isFinite(p.x));if(!points.length){ctx.fillStyle='#97a7bb';ctx.fillText('No fully observed, timestamped usage in this selection',12,32);return}const min=Math.min(...points.map(p=>p.x)),max=Math.max(...points.map(p=>p.x)),top=Math.max(1,...points.map(p=>p.y));ctx.strokeStyle='#344355';ctx.fillStyle='#97a7bb';ctx.font='11px system-ui';for(let i=0;i<4;i++){const y=16+(h-38)*i/3;ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(w-10,y);ctx.stroke();ctx.fillText(Math.round(top*(3-i)/3).toLocaleString(),2,y+4)}for(const provider of ['codex','claude']){const ps=points.filter(p=>p.p===provider).sort((a,b)=>a.x-b.x);ctx.strokeStyle=provider==='codex'?'#61d6bd':'#8ba7ff';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ps.forEach((p,i)=>{const x=42+(max===min ? 0.5 : (p.x-min)/(max-min))*(w-58),y=h-22-p.y/top*(h-52);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);ctx.fillRect(x-2,y-2,4,4)});ctx.stroke()}ctx.fillStyle='#97a7bb';ctx.fillText(new Date(min).toLocaleDateString(),40,h-4);if(max!==min)ctx.fillText(new Date(max).toLocaleDateString(),w-75,h-4)}
function metadata(list,key){const values=list.map(r=>r[key]);return values.length&&values[0]!==null&&values.every(v=>v===values[0])?values[0]:'Unknown'}
function latestTime(list){return list.map(r=>r.observed_at?Date.parse(r.observed_at):NaN).filter(Number.isFinite).reduce((max,value)=>Math.max(max,value),-Infinity)}
function timestamp(list){const time=latestTime(list);return time===-Infinity?'Unknown':new Date(time+8*60*60*1000).toISOString().slice(0,19).replace('T',' ')+' SGT'}
function compareGroups(a,b,group){const groupKey=entry=>group==='session'?entry[1][0].session_id:(entry[1][0][group]||'Unknown');const latest=entry=>latestTime(entry[1]);const timeA=latest(a),timeB=latest(b);if(timeA!==timeB){if(timeA===-Infinity)return 1;if(timeB===-Infinity)return -1;return timeB-timeA}const providerA=a[1][0].provider,providerB=b[1][0].provider;if(providerA!==providerB)return providerA<providerB?-1:1;const keyA=String(groupKey(a)),keyB=String(groupKey(b));return keyA===keyB?0:keyA<keyB?-1:1}
function usageCells(key,list){
  const first=list[0]||{},input=sumKnown(list,'input_tokens'),output=sumKnown(list,'output_tokens');
  const attribution=!list.length?'unknown':list.some(x=>x.attribution_status==='ambiguous')?'ambiguous':list.every(x=>x.attribution_status==='matched')?'matched':'unknown';
  const cells=[first.provider||'codex',key,timestamp(list),metadata(list,'work_id'),metadata(list,'agent'),metadata(list,'model'),
    input,output,input===null||output===null?null:input+output,
    ...['cached_input_tokens','cache_write_tokens','reasoning_tokens','tool_calls'].map(k=>sumKnown(list,k)),attribution];
  return cells.map((value,index)=>'<td>'+esc(index>=6&&index<=12?fmt(value):value)+'</td>');
}
function childUsageRow({call,usage}){
  const label=(call.agent||'Unknown agent')+(call.agent_id?' ['+call.agent_id+']':'');
  const cells=usageCells(label,usage);
  const status=call.session_id&&!usage.length?'No usage matches the current filters':call.usage_status;
  cells[1]='<td>'+esc(label)+'<small class="usage-note">'+esc(status)+'</small></td>';
  cells[4]='<td>'+esc(label)+'</td>';
  return '<tr class="child-row">'+cells.join('')+'</tr>';
}
function usageRow(key,list,group,index,rows){
  const cells=usageCells(key,list);
  if(group!=='session')return '<tr class="usage-row">'+cells.join('')+'</tr>';
  const detailId='session-details-'+index,first=list[0];
  cells[1]='<td><button class="disclosure" type="button" aria-expanded="false" aria-controls="'+detailId+'" aria-label="Show subagents for '+esc(key)+'">▸</button>'+esc(key)+'</td>';
  const calls=(DATA.subagents||[])
    .filter(call=>call.provider===first.provider&&call.parent_session_id===first.session_id)
    .map(call=>({call,usage:call.session_id?rows.filter(row=>row.provider===call.provider&&row.session_id===call.session_id):[]}));
  calls.sort((a,b)=>{
    const timeA=latestTime(a.usage),timeB=latestTime(b.usage);
    if(timeA===timeB)return String(a.call.agent_id||a.call.agent||'').localeCompare(String(b.call.agent_id||b.call.agent||''));
    return timeA===-Infinity?1:timeB===-Infinity?-1:timeB-timeA;
  });
  const details=calls.map(childUsageRow).join('')||'<tr><td colspan="14" class="empty">No captured subagent calls for this session.</td></tr>';
  const headings=['Provider','Subagent','Timestamp (SGT)','Work','Agent','Model','Input','Output','Total','Cache read','Cache write','Reasoning','Tools','Attribution'];
  return '<tr class="usage-row">'+cells.join('')+'</tr><tr id="'+detailId+'" class="child-row" hidden><td colspan="14">'
    +'<table aria-label="Subagent usage for '+esc(key)+'"><thead><tr>'+headings.map(label=>'<th>'+label+'</th>').join('')+'</tr></thead>'
    +'<tbody>'+details+'</tbody></table></td></tr>';
}
function render(){const rows=filtered(),input=sumKnown(rows,'input_tokens'),output=sumKnown(rows,'output_tokens');$('responses').textContent=fmt(rows.length);$('input').textContent=fmt(input);$('output').textContent=fmt(output);$('total').textContent=input===null||output===null?'Unknown':fmt(input+output);$('group-title').textContent=$('group').selectedOptions[0].text.toLowerCase();const group=$('group').value;const buckets=new Map();for(const r of rows){const key=group==='session'?r.provider+' / '+r.session_id:r.provider+' / '+(r[group]||'Unknown');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r)}$('rows').innerHTML=[...buckets.entries()].sort((a,b)=>compareGroups(a,b,group)).map(([key,list],index)=>usageRow(key,list,group,index,rows)).join('')||'<tr><td colspan="14" class="empty">No matching usage records.</td></tr>';chart(rows);const counts={codex:rows.filter(r=>r.provider==='codex').length,claude:rows.filter(r=>r.provider==='claude').length};$('coverage').innerHTML='<p>Codex responses: <b>'+counts.codex+'</b><br>Claude responses: <b>'+counts.claude+'</b><br>Collection time: '+fmt(DATA.scan_seconds)+' seconds<br>Generated: '+esc(DATA.generated_at)+'</p>';const diags=DATA.diagnostics.filter(d=>!$('provider').value||d.provider===$('provider').value);$('diagnostics').innerHTML=diags.map(d=>'<p><span class="badge">'+esc(d.provider)+' · '+esc(d.code)+'</span> '+esc(d.detail)+'</p>').join('')||'<p>No collection diagnostics.</p>'}
$('rows').addEventListener('click',event=>{const button=event.target.closest('.disclosure');if(!button)return;const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));button.textContent=expanded?'▸':'▾';button.setAttribute('aria-label',(expanded?'Show':'Hide')+' subagents');$(button.getAttribute('aria-controls')).hidden=expanded});
document.querySelectorAll('.filters input,.filters select').forEach(el=>el.addEventListener('input',render));$('group').addEventListener('change',render);$('export').addEventListener('click',()=>{const rows=filtered(),keys=['provider','session_id','response_id','observed_at','model','input_tokens','output_tokens','cached_input_tokens','cache_write_tokens','reasoning_tokens','tool_calls','metric_source','work_id','agent','phase','attribution_status'];const csv=[keys.join(','),...rows.map(r=>keys.map(k=>{let v=String(r[k]??'');if(/^[=+@-]/.test(v.trimStart()))v="'"+v;return '"'+v.replaceAll('"','""')+'"'}).join(','))].join(String.fromCharCode(13,10));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='agent-usage.csv';a.click();URL.revokeObjectURL(a.href)});render();
</script></body></html>"""


def generate(args: argparse.Namespace) -> int:
    started = time.monotonic()
    home = Path.home()
    codex_root = Path(args.codex_root).expanduser() if args.codex_root else Path(os.environ.get("CODEX_HOME", home / ".codex")).expanduser()
    claude_root = Path(args.claude_root).expanduser() if args.claude_root else home / ".claude" / "projects"
    state = Path(args.state).expanduser() if args.state else home / ".agent-usage-dashboard"
    output = Path(args.output).expanduser() if args.output else state / "reports" / "index.html"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(state, 0o700)
    except OSError:
        pass
    database = state / "usage.sqlite3"
    connection = sqlite3.connect(database)
    try:
        connection.executescript(SCHEMA)
        connection.execute("DELETE FROM diagnostics")
        transcript_sessions = _codex_records(codex_root, connection)
        _claude_records(claude_root, connection)
        hook_state = Path(os.environ.get("AGENT_USAGE_STATE", home / ".agent-usage-dashboard")).expanduser()
        hook_path = hook_state / "codex-lifecycle.jsonl"
        hook_records = _resolve_started_calls(
            codex_root, _hook_records(hook_path, connection), transcript_sessions,
        )
        _attribute(connection, _handoff_records(Path(args.repo).expanduser()),
                   transcript_sessions, hook_records)
        connection.commit()
        snapshot = _snapshot(connection, time.monotonic() - started)
        snapshot["subagents"] = _subagent_calls(hook_records, transcript_sessions, snapshot["responses"])
        report = _render(snapshot)
    finally:
        connection.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    try:
        os.chmod(database, 0o600)
        os.chmod(output, 0o600)
    except OSError:
        pass
    print(f"Dashboard: {output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate a local Codex and Claude usage dashboard.")
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("generate", help="collect local session usage and write an HTML report")
    command.add_argument("--codex-root", help="Codex home (contains sessions/ and archived_sessions/)")
    command.add_argument("--claude-root", help="Claude projects session root")
    command.add_argument("--repo", default=".", help="repository to inspect for structured handoffs")
    command.add_argument("--state", help="private local directory for normalized SQLite state")
    command.add_argument("--output", help="HTML report file")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate":
        return generate(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
