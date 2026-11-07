"""Read-only inventory of Claude Code sessions/subagents with de-duplicated usage."""
import json, sys, glob, os, csv
from datetime import datetime, timezone, timedelta

ROOT = sys.argv[1]
OUT = sys.argv[2]
SGT = timezone(timedelta(hours=8))


def usage_of(path):
    seen = {}
    first = last = None
    tool_calls = 0
    tool_ids = set()
    models = set()
    for line in open(path, encoding="utf-8"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        ts = r.get("timestamp")
        if ts:
            first = first or ts
            last = ts
        if r.get("type") != "assistant":
            continue
        m = r.get("message") or {}
        if m.get("model") and m.get("model") != "<synthetic>":
            models.add(m["model"])
        for c in m.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("id") not in tool_ids:
                tool_ids.add(c.get("id"))
        u = m.get("usage")
        mid = m.get("id") or r.get("uuid")
        if u and mid:
            seen[mid] = u  # last record for a message id wins (same usage repeated)
    t = dict(responses=len(seen), input=0, output=0, cache_read=0, cache_write=0, thinking=0)
    for u in seen.values():
        t["input"] += u.get("input_tokens") or 0
        t["output"] += u.get("output_tokens") or 0
        t["cache_read"] += u.get("cache_read_input_tokens") or 0
        t["cache_write"] += u.get("cache_creation_input_tokens") or 0
        t["thinking"] += (u.get("output_tokens_details") or {}).get("thinking_tokens") or 0
    t["tool_calls"] = len(tool_ids)
    t["models"] = ";".join(sorted(models))
    t["start"] = first
    t["end"] = last
    return t


def first_user_text(path):
    for line in open(path, encoding="utf-8"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("type") == "user" and not r.get("isMeta"):
            c = (r.get("message") or {}).get("content")
            if isinstance(c, str):
                txt = c
            elif isinstance(c, list):
                txt = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
            else:
                continue
            txt = " ".join(txt.split())
            if txt and not txt.startswith("<"):
                return txt[:160]
    return ""


rows = []
for p in sorted(glob.glob(os.path.join(ROOT, "*.jsonl"))):
    sid = os.path.basename(p)[:-6]
    t = usage_of(p)
    rows.append(dict(kind="root", session=sid, agent_id="", agent_type="main", description=first_user_text(p), **t))
    for mp in sorted(glob.glob(os.path.join(ROOT, sid, "subagents", "*.meta.json"))):
        meta = json.load(open(mp, encoding="utf-8"))
        jp = mp[: -len(".meta.json")] + ".jsonl"
        if not os.path.exists(jp):
            continue
        aid = os.path.basename(jp)[len("agent-"):-6]
        t = usage_of(jp)
        rows.append(dict(kind="sub", session=sid, agent_id=aid, agent_type=meta.get("agentType"),
                         description=meta.get("description", ""), **t))

with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
for r in rows:
    print(r["kind"], r["session"][:8], r["agent_id"][:8], r["agent_type"], r["models"], (r["start"] or "")[:16],
          r["output"], "|", r["description"][:90])
