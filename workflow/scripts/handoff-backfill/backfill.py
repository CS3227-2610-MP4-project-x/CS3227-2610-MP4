"""Backfill Claude Code usage into handoffs. Usage: backfill.py <claude_project_dir> <handoffs_dir> [--write]"""
import json, os, re, sys, importlib.util
CRLF = chr(13) + chr(10)
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("inv", os.path.join(HERE, "inventory_lib.py"))
inv = importlib.util.module_from_spec(spec); spec.loader.exec_module(inv)

ROOT, HDIR = sys.argv[1], sys.argv[2]
WRITE = "--write" in sys.argv
SGT = timezone(timedelta(hours=8))
TODAY = "2026-11-05"

# task -> (root session prefixes with labels, {exact header line: [agent id prefixes]}, notes)
TASKS = {
    "ci-github-actions": (
        [("85ef727f", "spec session"), ("df975a13", "implementation session")],
        {"### Session `implementer / not available`": ["a98ade9a"],
         "### Session `reviewer / not available`": ["aec514cb"],
         "### Session `commit-pr / not available`": ["a8d1ac00"],
         "### Session `orchestrator / not available`": ["a4a7329e", "a75ef6a0"]},
        ["The analyst ran in the separate spec session (`85ef727f…`) and has no session block in this handoff; its usage is in the table.",
         "The orchestrator block covers two subagents: handoff creation (`a4a7329e…`) and consolidation (`a75ef6a0…`)."]),
    "environment-configuration": (
        [("e7217dab", "")],
        {"### Session `orchestrator / not available`": ["aa4cf381"],
         "### Session `analyst / not available`": ["ac86349a"],
         "### Session `commit-pr / not available` (spec commits)": ["a19e9c78"],
         "### Session `implementer / not available`": ["a83b67c1"],
         "### Session `test-writer / not available`": ["ab5e7a9f"],
         "### Session `reviewer / not available`": ["a1ad7815"]},
        ["The earlier `tokens total` figures in the session blocks came from the Agent tool result and measure something different from the per-response transcript sums below. Both are kept; the transcript sums are the per-response provider usage."]),
    "data-persistence-schema": (
        [("efbad984", "")],
        {"### Session `orchestrator / not available`": ["a828e3bd"],
         "### Session `implementer / not available`": ["a3b09557"],
         "### Session `test-writer / not available` (follow-up: task 2.4 review decisions)": ["af9d6b2d"]},
        ["The analyst (`aeb721b6…`), the first test-writer run (`a695c138…`), the reviewer (`a1c1b3bf…`), and two commit-pr runs (`a1253e2c…`, `a346f7e0…`) ran but have no session block in this handoff; their usage is in the table."]),
    "llm-gateway-soc-adapter": (
        [("7ee26398", "")],
        {"### Session `orchestrator / not available`": ["a856fcf2"],
         "### Session `test-writer / not available`": ["a9620652", "a0b2821e"],
         "### Session `implementer / not available`": ["ad4671e6"],
         "### Session `reviewer / not available`": ["ac740d39"],
         "### Session `analyst / not available`": ["a2a9ee7b"]},
        ["The test-writer block covers the first run (`a9620652…`) and the test-side fix run \"Strengthen AC3 model test\" (`a0b2821e…`).",
         "Two commit-pr runs (`ab4f7e2b…`, `a2f30ea1…`) have no session block; their usage is in the table."]),
    "llm-gateway-secret-redaction": (
        [("3c8a44c0", "")],
        {"### Session `orchestrator / not available`": ["abd8ff8a"],
         "### Session `test-writer / not available`": ["a22a061f"],
         "### Session `implementer / not available`": ["a8dfbd85"],
         "### Session `reviewer / not available`": ["a3c0b109"],
         "### Session `analyst / not available`": ["a772c628"]},
        ["Fix rounds were sent to the running test-writer, implementer, and orchestrator with `SendMessage`, so each of those transcripts includes its fix rounds.",
         "Two commit-pr runs (`ad89689b…`, `a76c0d85…`) have no session block; their usage is in the table."]),
    "llm-gateway-core": (
        [("fc037bf9", "")],
        {"### Session `orchestrator / not available`": ["a8a609c7"],
         "### Session `test-writer / not available`": ["a9fe87dd"],
         "### Session `implementer / not available`": ["aab50b52"],
         "### Session `reviewer / not available`": ["a0b359c2", "a895d42e"]},
        ["The reviewer ran on `claude-sonnet-5-5` (from `.claude/agents/reviewer.md`), not Opus 5.5 as the block previously said; the model fields are corrected.",
         "The transcript shows a second reviewer subagent, \"Re-review fix round 2\" (`a895d42e…`, 23:06–23:07 SGT, after the commit-pr run). The reviewer block still says no second pass was run. Needs human confirmation of what that re-review found; the narrative was not changed.",
         "The analyst (`aa4a9a7f…`) and commit-pr (`ac0cd284…`) have no session block; their usage is in the table."]),
}


def full_sid(prefix):
    for f in os.listdir(ROOT):
        if f.endswith(".jsonl") and f.startswith(prefix):
            return f[:-6]
    raise SystemExit("missing root " + prefix)


def send_counts(path):
    counts = {}
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        if r.get("type") != "assistant":
            continue
        for c in r["message"].get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "SendMessage":
                to = (c.get("input") or {}).get("to")
                if to:
                    counts[to] = counts.get(to, 0) + 1
    return counts


def sgt(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(SGT)


def n(x):
    return f"{x:,}"


def collect(roots):
    rows = []
    for prefix, label in roots:
        sid = full_sid(prefix)
        rp = os.path.join(ROOT, sid + ".jsonl")
        sends = send_counts(rp)
        t = inv.usage_of(rp)
        rows.append(dict(role="main session" + (f" ({label})" if label else ""), aid="", sid=sid, desc="whole conversation", cont=None, **t))
        sd = os.path.join(ROOT, sid, "subagents")
        if os.path.isdir(sd):
            for f in sorted(os.listdir(sd)):
                if f.endswith(".meta.json"):
                    meta = json.load(open(os.path.join(sd, f), encoding="utf-8"))
                    aid = f[len("agent-"):-len(".meta.json")]
                    t = inv.usage_of(os.path.join(sd, f"agent-{aid}.jsonl"))
                    rows.append(dict(role=meta.get("agentType"), aid=aid, sid=sid, desc=meta.get("description", ""),
                                     cont=sends.get(aid, 0), **t))
    rows.sort(key=lambda r: r["start"])
    return rows


def total(r):
    return r["input"] + r["cache_read"] + r["cache_write"] + r["output"]


def share(r):
    tin = r["input"] + r["cache_read"] + r["cache_write"]
    return f"{100 * r['cache_read'] / tin:.0f}%" if tin else "n/a"


def span(r):
    s, e = sgt(r["start"]), sgt(r["end"])
    mins = round((e - s).total_seconds() / 60)
    end = f"{e:%H:%M}" if s.date() == e.date() else f"{e:%Y-%m-%d %H:%M}"
    return f"{s:%Y-%m-%d %H:%M}–{end} SGT ({mins} min)"


def agg(rs):
    keys = ["input", "cache_read", "cache_write", "output", "thinking", "tool_calls", "responses"]
    a = {k: sum(r[k] for r in rs) for k in keys}
    a["models"] = ";".join(sorted({m for r in rs for m in r["models"].split(";") if m}))
    a["start"] = min(r["start"] for r in rs)
    a["end"] = max(r["end"] for r in rs)
    a["cont"] = sum(r["cont"] or 0 for r in rs)
    return a


SRC = "Source: local Claude Code transcript, de-duplicated by message ID; backfilled " + TODAY + "."
FIELDS = ("- Provider session ID", "- Platform and model (if surfaced)", "- Started / ended / elapsed",
          "- Resource usage (provider-reported)", "- Unavailable resource metrics")


def block_lines(rs, sid, old_usage):
    a = agg(rs)
    ids = " + ".join(f"`{r['aid']}`" for r in rs)
    runs = len(rs)
    inv_txt = f"{runs} launch{'es' if runs > 1 else ''} + {a['cont']} `SendMessage` continuation{'s' if a['cont'] != 1 else ''}"
    times = "; ".join(span(r) for r in rs)
    usage = (f"tokens in (uncached) {n(a['input'])}; cache read {n(a['cache_read'])}; cache write {n(a['cache_write'])}; "
             f"out {n(a['output'])} (thinking {n(a['thinking'])}); total {n(total(a))}; cache-read share of input {share(a)}; "
             f"tool calls {a['tool_calls']}; responses {a['responses']}; {inv_txt}. {SRC}")
    if old_usage and re.search(r"\d", old_usage):
        usage += f" Previously recorded from the Agent result: {old_usage}"
    return [f"- Provider session ID: subagent {ids} in root session `{sid}`",
            f"- Platform and model (if surfaced): Claude Code, `{a['models']}`",
            f"- Started / ended / elapsed: {times}; measured from first to last transcript record, so it includes waiting between continuations",
            f"- Resource usage (provider-reported): {usage}",
            "- Unavailable resource metrics: cost (not recorded in local transcripts)"]


def edit_blocks(text, mapping, rows):
    lines = text.split("\n")
    by_prefix = {r["aid"][:8]: r for r in rows if r["aid"]}
    for header, prefixes in mapping.items():
        idx = [i for i, l in enumerate(lines) if l == header]
        if len(idx) != 1:
            raise SystemExit(f"header not unique/found: {header!r} -> {idx}")
        h = idx[0]
        end = next((j for j in range(h + 1, len(lines)) if lines[j].startswith("### Session") or lines[j].startswith("## ")), len(lines))
        rs = [by_prefix[p] for p in prefixes]
        sid = rs[0]["sid"]
        # rename header
        lines[h] = header.replace("/ not available`", "/ " + " + ".join(r["aid"] for r in rs) + "`")
        old_usage = None
        old_elapsed = None
        insert_at = None
        keep = []
        for j in range(h + 1, end):
            l = lines[j]
            if l.startswith(FIELDS):
                if l.startswith("- Resource usage (provider-reported)"):
                    old_usage = l.split(":", 1)[1].strip()
                if l.startswith("- Started / ended / elapsed"):
                    old_elapsed = l.split(":", 1)[1].strip()
                if insert_at is None:
                    insert_at = len(keep)
                continue
            # compact single-line blocks (llm-gateway-core)
            if l.startswith("- Platform and model: Claude Code, Opus 5.5. "):
                l = "- " + l[len("- Platform and model: Claude Code, Opus 5.5. "):].replace(" Resource usage: not available.", "")
            keep.append(l)
        new = block_lines(rs, sid, old_usage)
        if old_elapsed and any(ch.isdigit() for ch in old_elapsed):
            new[2] += ". Previously recorded from the Agent result: " + old_elapsed
        if insert_at is None:
            # insert after the first bullet (compact) or after the header's blank line
            first_bullet = next((k for k, l in enumerate(keep) if l.startswith("- ")), 1)
            insert_at = first_bullet + 1
        keep[insert_at:insert_at] = new
        lines[h + 1:end] = keep
    return "\n".join(lines)


def section(rows, notes):
    out = ["## Backfilled resource usage `[ORCH]`", "",
           f"Backfilled on {TODAY} from the local Claude Code transcripts of this task's sessions. Each subagent's usage is summed over its own transcript, "
           "de-duplicated by message ID (a response logged on several lines is counted once). `Continuations` counts `SendMessage` calls from the main session "
           "to that subagent (fix rounds and follow-ups). Times are first to last transcript record, in SGT, so they include waiting time. "
           "Main-session rows cover the whole conversation, including chat not about this task. Cost is not recorded in the transcripts. Nothing was estimated.", "",
           "| Role | Agent ID | Model | Start–end (SGT) | Continuations | Input (uncached) | Cache read | Cache write | Output | of which thinking | Cache-read share | Tool calls |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        aid = f"`{r['aid']}`" if r["aid"] else f"root `{r['sid'][:8]}…`"
        cont = "n/a" if r["cont"] is None else str(r["cont"])
        out.append(f"| {r['role']} | {aid} | `{r['models']}` | {span(r)} | {cont} | {n(r['input'])} | {n(r['cache_read'])} | {n(r['cache_write'])} | "
                   f"{n(r['output'])} | {n(r['thinking'])} | {share(r)} | {r['tool_calls']} |")
    subs = [r for r in rows if r["aid"]]
    for label, rs in (("**Subagents total**", subs), ("**All sessions total**", rows)):
        a = agg(rs)
        out.append(f"| {label} | | | | | {n(a['input'])} | {n(a['cache_read'])} | {n(a['cache_write'])} | {n(a['output'])} | {n(a['thinking'])} | {share(a)} | {a['tool_calls']} |")
    a = agg(rows)
    out += ["", f"Thinking tokens were {100 * a['thinking'] / a['output']:.0f}% of all output tokens for this task.", "", "Notes:", ""]
    out += [f"- {x}" for x in notes]
    out.append("")
    return out


for task, (roots, mapping, notes) in TASKS.items():
    path = os.path.join(HDIR, task + ".md")
    text = open(path, encoding="utf-8").read()
    if "## Backfilled resource usage" in text:
        raise SystemExit("already backfilled: " + task)
    rows = collect(roots)
    text = edit_blocks(text, mapping, rows)
    lines = text.split("\n")
    k = lines.index("## Consolidated outcome `[ORCH]`")
    lines[k:k] = section(rows, notes)
    text = "\n".join(lines)
    row = (f"| {TODAY} | main session (backfill) | Backfilled provider session IDs, models, timing, and token usage from local Claude Code "
           f"transcripts; see \"Backfilled resource usage\". |")
    text = text.rstrip("\n") + "\n" + row + "\n"
    if WRITE:
        open(path, "w", encoding="utf-8", newline=CRLF).write(text)
        print("wrote", task)
    else:
        open(os.path.join(HERE, task + ".preview.md"), "w", encoding="utf-8").write(text)
        print("preview", task)
