"""Measure subagent cache writes/reads and the cache writes that followed a >5-minute gap.

Used for the D7 counterfactual in temp/reflection-notes.md (git-ignored) section 3a: writes after a
5-60 minute gap would have been cache reads under a 1-hour TTL.

Usage: python -I cache_ttl.py <project_dir>
Read-only. Prints one row per subagent transcript plus per-role totals.
"""
import json, sys, glob, os
from datetime import datetime

GAP = 300  # seconds: 5-minute TTL
LONG = 3600  # seconds: 1-hour TTL

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

rows = []
for path in glob.glob(os.path.join(sys.argv[1], "*", "subagents", "agent-*.jsonl")):
    meta_path = path[:-len(".jsonl")] + ".meta.json"
    role = "?"
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            m = json.load(f)
        role = m.get("agentType") or m.get("subagent_type") or m.get("type") or "?"
    seen = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            msg = rec.get("message") or {}
            u = msg.get("usage")
            mid = msg.get("id")
            if not u or not mid or rec.get("type") != "assistant":
                continue
            seen[mid] = (ts(rec["timestamp"]), msg.get("model", "?"), u)  # last copy wins
    if not seen:
        continue
    resp = sorted(seen.values(), key=lambda r: r[0])
    w5 = w1 = rd = inp = resume_w = gaps = recov_w = 0
    gap_list = []
    prev = None
    for t, model, u in resp:
        cc = u.get("cache_creation") or {}
        a5 = cc.get("ephemeral_5m_input_tokens", 0) or 0
        a1 = cc.get("ephemeral_1h_input_tokens", 0) or 0
        if not cc:
            a5 = u.get("cache_creation_input_tokens", 0) or 0
        w5 += a5; w1 += a1
        rd += u.get("cache_read_input_tokens", 0) or 0
        inp += u.get("input_tokens", 0) or 0
        if prev is not None and t - prev > GAP:
            gaps += 1
            resume_w += a5 + a1
            gap_list.append(round((t - prev) / 60))
            if t - prev <= LONG:
                recov_w += a5 + a1
        prev = t
    rows.append((role, os.path.basename(path)[6:14], resp[0][1], len(resp), gaps, w5, w1, rd, inp, resume_w, recov_w, "/".join(map(str, gap_list))))

rows.sort()
print("role,agent,model,responses,gaps>5m,write5m,write1h,read,uncached,writes_after_gap,writes_after_5_60min_gap,gap_minutes")
for r in rows:
    print(",".join(str(x) for x in r))
tot = {}
for r in rows:
    t = tot.setdefault(r[0], [0] * 7)
    for i, v in enumerate(r[4:11]):
        t[i] += v
print("\nrole totals: gaps,write5m,write1h,read,uncached,writes_after_gap,writes_after_5_60min_gap")
for k, v in sorted(tot.items()):
    print(k, v)
