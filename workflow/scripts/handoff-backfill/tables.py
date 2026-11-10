"""Build per-task usage tables from the inventory logic (read-only)."""
import json, sys, os
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("inv", os.path.join(os.path.dirname(__file__), "inventory_lib.py"))
inv = importlib.util.module_from_spec(spec); spec.loader.exec_module(inv)

ROOT = sys.argv[1]
OUT = sys.argv[2]
SGT = timezone(timedelta(hours=8))

TASKS = {
    "ci-github-actions": [("85ef727f-2cac-49d0-b3f7-17373a2be4e7", "spec session"), ("df975a13-14f2-4add-a3df-74fe2205aa89", "implementation session")],
    "environment-configuration": [("e7217dab-f623-446f-a6c0-943cdd334d82", "")],
    "data-persistence-schema": [("efbad984", "")],
    "llm-gateway-soc-adapter": [("7ee26398-01da-45e2-bfd9-4e1f93abb5c8", "")],
    "llm-gateway-secret-redaction": [("3c8a44c0-2879-4a23-92b3-f0730edb1d76", "")],
    "llm-gateway-core": [("fc037bf9", "")],
}


def full_sid(prefix):
    for f in os.listdir(ROOT):
        if f.endswith(".jsonl") and f.startswith(prefix):
            return f[:-6]
    raise SystemExit("missing " + prefix)


def invocations(path):
    n = 0
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        if r.get("type") != "user" or r.get("isMeta"):
            continue
        c = (r.get("message") or {}).get("content")
        if isinstance(c, str) or (isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "text" for x in c)
                                  and not any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c)):
            n += 1
    return n


def sgt(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(SGT)


def fmt(n):
    return f"{n:,}"


result = {}
for task, roots in TASKS.items():
    rows = []
    for prefix, label in roots:
        sid = full_sid(prefix)
        p = os.path.join(ROOT, sid + ".jsonl")
        t = inv.usage_of(p)
        rows.append(dict(role="main session" + (f" ({label})" if label else ""), agent_id="", session=sid, inv=None, **t))
        sd = os.path.join(ROOT, sid, "subagents")
        if os.path.isdir(sd):
            for f in sorted(os.listdir(sd)):
                if not f.endswith(".meta.json"):
                    continue
                meta = json.load(open(os.path.join(sd, f), encoding="utf-8"))
                jp = os.path.join(sd, f[:-len(".meta.json")] + ".jsonl")
                t = inv.usage_of(jp)
                rows.append(dict(role=meta.get("agentType"), agent_id=f[len("agent-"):-len(".meta.json")], session=sid,
                                 desc=meta.get("description"), inv=invocations(jp), **t))
    rows.sort(key=lambda r: r["start"])
    result[task] = rows

json.dump(result, open(OUT, "w", encoding="utf-8"), indent=1, default=str)
for task, rows in result.items():
    print("==", task)
    for r in rows:
        s, e = sgt(r["start"]), sgt(r["end"])
        tin = r["input"] + r["cache_read"] + r["cache_write"]
        share = f"{100*r['cache_read']/tin:.0f}%" if tin else "-"
        print(f"{r['role']:<40} {r['agent_id'][:17]:<17} {r['models']:<18} inv={r['inv']} resp={r['responses']} "
              f"{s:%m-%d %H:%M}->{e:%m-%d %H:%M} in={fmt(r['input'])} cr={fmt(r['cache_read'])} cw={fmt(r['cache_write'])} "
              f"out={fmt(r['output'])} think={fmt(r['thinking'])} tools={r['tool_calls']} crshare={share} | {r.get('desc','')}")
