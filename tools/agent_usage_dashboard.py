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
                      connection: sqlite3.Connection) -> tuple[list[tuple[dict[str, Any], int]], int, str | None, str | None, bool]:
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


def _codex_records(root: Path, connection: sqlite3.Connection) -> None:
    files = list(_jsonl_files(root / "sessions")) + list(_jsonl_files(root / "archived_sessions"))
    if not files:
        _diagnose(connection, "codex", "no_files", "No Codex JSONL session files were found.")
    for path in sorted(set(files)):
        file_key = _file_key("codex", root, path)
        records, offset, current_session, current_model, readable = _complete_records(
            path, "codex", file_key, connection
        )
        recognized = {"session_meta", "event_msg", "response_item", "turn_context",
                      "compaction", "checkpoint", "config_snapshot", "custom_tool",
                      "world_state"}
        # Newer Codex writes per-response usage as top-level token_usage_record
        # records; its token_count events then carry only running totals.
        usage_records = running_totals = 0
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
                session_id = _string(payload.get("session_id")) or current_session
                if session_id is None:
                    _diagnose(connection, "codex", "missing_session", "Token usage record has no session identity.")
                    continue
                _save_response(connection, _response(
                    "codex", session_id,
                    _string(payload.get("response_id")) or _string(payload.get("turn_id")),
                    record.get("timestamp"), current_model, _codex_metrics(connection, usage),
                    "Codex top-level token_usage_record", str(line_start),
                ))
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
        if running_totals and not usage_records:
            _diagnose(connection, "codex", "per_response_usage_unavailable",
                      "Codex running totals were found without per-response usage records.")
        if readable:
            _save_checkpoint(path, "codex", file_key, offset, current_session, current_model, connection)


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


def _attribute(connection: sqlite3.Connection, entries: list[dict[str, str]]) -> None:
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


def _render(snapshot: dict[str, Any]) -> str:
    # JSON is embedded in an inert script node; escape HTML-significant chars.
    data = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local Agent Usage Dashboard</title><style>
:root{color-scheme:dark;--bg:#10151d;--panel:#171f2b;--line:#293545;--ink:#e8eef6;--muted:#97a7bb;--a:#61d6bd;--b:#8ba7ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 75% -15%,#25364b 0,transparent 45%),var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:36px 28px}header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:24px}h1{font-size:30px;letter-spacing:-.04em;margin:0}p{color:var(--muted);margin:.35em 0 0}.eyebrow{color:var(--a);text-transform:uppercase;letter-spacing:.15em;font-size:11px;font-weight:700}.panel{background:linear-gradient(145deg,#1b2532,#151c27);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 12px 30px #0002}.filters{display:flex;flex-wrap:wrap;gap:10px}.filters label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.1em}.filters select,.filters input{display:block;color:var(--ink);background:#101720;border:1px solid var(--line);padding:9px;border-radius:8px;min-width:130px;margin-top:5px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:16px;background:#111923;border:1px solid var(--line);border-radius:10px}.card small{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.12em}.card strong{font-size:23px;display:block;margin-top:5px}.cols{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}canvas{width:100%;height:240px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}td{font-variant-numeric:tabular-nums}.badge{padding:3px 7px;border-radius:99px;background:#263346;color:#b9c9dc;font-size:11px}.action{color:var(--a);background:#15251f;border:1px solid #30564b;padding:9px 12px;border-radius:8px;cursor:pointer}h2{font-size:15px;margin:0 0 12px}.empty{color:var(--muted);padding:20px 0}@media(max-width:850px){.cols{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){main{padding:22px 14px}header{display:block}.cards{grid-template-columns:1fr 1fr}}
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
<section class="panel"><h2>Usage by <span id="group-title">session</span></h2><div class="scroll"><table><thead><tr><th>Provider</th><th>Session / group</th><th>Work</th><th>Agent</th><th>Model</th><th>Input</th><th>Output</th><th>Total</th><th>Cache read</th><th>Cache write</th><th>Reasoning</th><th>Tools</th><th>Attribution</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<section class="panel"><h2>Diagnostics</h2><div id="diagnostics"></div></section>
</main><script id="usage-data" type="application/json">""" + data + """</script><script>
const DATA=JSON.parse(document.getElementById('usage-data').textContent);const $=id=>document.getElementById(id);const fmt=n=>n===null||n===undefined?'Unknown':Number(n).toLocaleString();const esc=s=>String(s??'Unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filtered(){return DATA.responses.filter(r=>{const v=id=>$(id).value.trim().toLowerCase();const date=(r.observed_at||'').slice(0,10);return(!v('provider')||r.provider===v('provider'))&&(!v('work')||(r.work_id||'').toLowerCase().includes(v('work')))&&(!v('agent')||(r.agent||'').toLowerCase().includes(v('agent')))&&(!v('model')||(r.model||'').toLowerCase().includes(v('model')))&&(!v('phase')||(r.phase||'').toLowerCase().includes(v('phase')))&&(!v('from')||date>=v('from'))&&(!v('to')||date<=v('to'))})}
function sumKnown(rows,key){const vals=rows.map(r=>r[key]);return vals.length&&vals.every(v=>Number.isFinite(v))?vals.reduce((a,v)=>a+v,0):null}
function chart(rows){const c=$('chart'),ctx=c.getContext('2d'),dpr=devicePixelRatio||1,w=c.clientWidth,h=240;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const points=rows.filter(r=>r.observed_at&&r.input_tokens!==null&&r.output_tokens!==null).map(r=>({x:new Date(r.observed_at).getTime(),y:r.input_tokens+r.output_tokens,p:r.provider})).filter(p=>Number.isFinite(p.x));if(!points.length){ctx.fillStyle='#97a7bb';ctx.fillText('No fully observed, timestamped usage in this selection',12,32);return}const min=Math.min(...points.map(p=>p.x)),max=Math.max(...points.map(p=>p.x)),top=Math.max(1,...points.map(p=>p.y));ctx.strokeStyle='#344355';ctx.fillStyle='#97a7bb';ctx.font='11px system-ui';for(let i=0;i<4;i++){const y=16+(h-38)*i/3;ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(w-10,y);ctx.stroke();ctx.fillText(Math.round(top*(3-i)/3).toLocaleString(),2,y+4)}for(const provider of ['codex','claude']){const ps=points.filter(p=>p.p===provider).sort((a,b)=>a.x-b.x);ctx.strokeStyle=provider==='codex'?'#61d6bd':'#8ba7ff';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ps.forEach((p,i)=>{const x=42+(max===min ? 0.5 : (p.x-min)/(max-min))*(w-58),y=h-22-p.y/top*(h-52);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);ctx.fillRect(x-2,y-2,4,4)});ctx.stroke()}ctx.fillStyle='#97a7bb';ctx.fillText(new Date(min).toLocaleDateString(),40,h-4);if(max!==min)ctx.fillText(new Date(max).toLocaleDateString(),w-75,h-4)}
function metadata(list,key){const values=list.map(r=>r[key]);return values.length&&values[0]!==null&&values.every(v=>v===values[0])?values[0]:'Unknown'}
function render(){const rows=filtered(),input=sumKnown(rows,'input_tokens'),output=sumKnown(rows,'output_tokens');$('responses').textContent=fmt(rows.length);$('input').textContent=fmt(input);$('output').textContent=fmt(output);$('total').textContent=input===null||output===null?'Unknown':fmt(input+output);$('group-title').textContent=$('group').selectedOptions[0].text.toLowerCase();const group=$('group').value;const buckets=new Map();for(const r of rows){const key=group==='session'?r.provider+' / '+r.session_id:r.provider+' / '+(r[group]||'Unknown');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r)}$('rows').innerHTML=[...buckets.entries()].map(([key,list])=>{const first=list[0],inputTotal=sumKnown(list,'input_tokens'),outputTotal=sumKnown(list,'output_tokens'),total=inputTotal===null||outputTotal===null?null:inputTotal+outputTotal;const cells=[first.provider,key,metadata(list,'work_id'),metadata(list,'agent'),metadata(list,'model'),inputTotal,outputTotal,total,...['cached_input_tokens','cache_write_tokens','reasoning_tokens','tool_calls'].map(k=>sumKnown(list,k)),list.some(x=>x.attribution_status==='ambiguous')?'ambiguous':list.every(x=>x.attribution_status==='matched')?'matched':'unknown'];return '<tr>'+cells.map((x,i)=>'<td>'+esc(i>=5&&i<=11?fmt(x):x)+'</td>').join('')+'</tr>'}).join('')||'<tr><td colspan="13" class="empty">No matching usage records.</td></tr>';chart(rows);const counts={codex:rows.filter(r=>r.provider==='codex').length,claude:rows.filter(r=>r.provider==='claude').length};$('coverage').innerHTML='<p>Codex responses: <b>'+counts.codex+'</b><br>Claude responses: <b>'+counts.claude+'</b><br>Collection time: '+fmt(DATA.scan_seconds)+' seconds<br>Generated: '+esc(DATA.generated_at)+'</p>';const diags=DATA.diagnostics.filter(d=>!$('provider').value||d.provider===$('provider').value);$('diagnostics').innerHTML=diags.map(d=>'<p><span class="badge">'+esc(d.provider)+' · '+esc(d.code)+'</span> '+esc(d.detail)+'</p>').join('')||'<p>No collection diagnostics.</p>'}
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
        _codex_records(codex_root, connection)
        _claude_records(claude_root, connection)
        _attribute(connection, _handoff_records(Path(args.repo).expanduser()))
        connection.commit()
        report = _render(_snapshot(connection, time.monotonic() - started))
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
