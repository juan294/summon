#!/usr/bin/env python3
"""contract-metrics.py — aggregate contract-layer hook telemetry into a report.

Reads the append-only JSONL audit log written by the contract-layer hooks
(`guard-bash.sh`, `verify-edit.sh`) at `.claude/metrics/contract-events.jsonl`
and reports whether the layer is doing anything measurable:

  - block counts and block rate, per hook and per rule
  - verify-edit SELF-CORRECTION rate: a block on a file followed by a later clean
    edit of that same file in the same session = the corrective-hint loop closed
  - week-over-week trend (blocks per 100 events) to spot agents internalizing
    rules over time (declining block rate at stable volume)

Stdlib only. Read-only. Best-effort: malformed log lines are skipped, never fatal.

Usage:
  contract-metrics.py [path]          # report on a log (default .claude/metrics/...)
  contract-metrics.py --json [path]   # machine-readable metrics
  contract-metrics.py --self-test     # prove the math on a synthetic fixture

Exit codes: 0 = ok (including "no data yet"); 1 = self-test failed; 2 = bad usage.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime

DEFAULT_LOG = ".claude/metrics/contract-events.jsonl"


def iso_week(ts):
    """Return 'YYYY-Www' for an ISO-8601 'Z' timestamp, or None if unparseable."""
    try:
        dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return None
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def parse_events(lines):
    """Parse JSONL lines into event dicts, skipping blanks and malformed rows."""
    events = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            events.append(obj)
    return events


def compute(events):
    """Reduce a list of event dicts to the metrics the report renders."""
    m = {
        "total": len(events),
        "by_hook": Counter(),
        "by_hook_block": Counter(),
        "by_rule_block": Counter(),
        "files_block": Counter(),
        "weekly": defaultdict(lambda: {"events": 0, "blocks": 0}),
        "first_ts": None,
        "last_ts": None,
    }
    # (session_id, file) -> [(ts, decision), ...] for verify-edit self-correction
    groups = defaultdict(list)

    for e in events:
        hook = e.get("hook", "?")
        decision = e.get("decision", "?")
        rule = e.get("rule", "none")
        ts = e.get("ts", "") or ""
        file = e.get("file", "") or ""

        m["by_hook"][hook] += 1
        if ts:
            if m["first_ts"] is None or ts < m["first_ts"]:
                m["first_ts"] = ts
            if m["last_ts"] is None or ts > m["last_ts"]:
                m["last_ts"] = ts
        wk = iso_week(ts)
        if wk:
            m["weekly"][wk]["events"] += 1

        if decision == "block":
            m["by_hook_block"][hook] += 1
            m["by_rule_block"][f"{hook}:{rule}"] += 1
            if wk:
                m["weekly"][wk]["blocks"] += 1
            if hook == "verify-edit" and file:
                m["files_block"][file] += 1

        if hook == "verify-edit" and file:
            groups[(e.get("session_id", "") or "", file)].append((ts, decision))

    # Self-correction: a block is "corrected" if a later clean allow lands on the
    # same file in the same session (the agent took the hint and fixed it).
    sc_blocks = sc_corrected = 0
    for evs in groups.values():
        evs.sort(key=lambda x: x[0])
        for i, (_, decision) in enumerate(evs):
            if decision == "block":
                sc_blocks += 1
                if any(d == "allow" for (_, d) in evs[i + 1:]):
                    sc_corrected += 1
    m["sc_blocks"] = sc_blocks
    m["sc_corrected"] = sc_corrected
    return m


def _pct(num, den):
    return (100.0 * num / den) if den else 0.0


def render(m):
    """Render the metrics dict as a human-readable markdown report."""
    out = []
    out.append("# Contract Layer Metrics")
    if not m["total"]:
        out.append("")
        out.append("No events logged yet. The hooks write one row per evaluated")
        out.append("edit/command once projects start using the contract layer.")
        return "\n".join(out) + "\n"

    span = ""
    if m["first_ts"] and m["last_ts"]:
        span = f" | {m['first_ts'][:10]} .. {m['last_ts'][:10]}"
    out.append(f"> {m['total']} events{span}")
    out.append("")

    out.append("## Blocks by hook")
    out.append("")
    out.append("| Hook | Events | Blocks | Block rate |")
    out.append("|------|--------|--------|------------|")
    for hook in sorted(m["by_hook"]):
        ev = m["by_hook"][hook]
        bl = m["by_hook_block"][hook]
        out.append(f"| {hook} | {ev} | {bl} | {_pct(bl, ev):.1f}% |")
    out.append("")

    out.append("## Blocks by rule")
    out.append("")
    out.append("| Hook:Rule | Blocks |")
    out.append("|-----------|--------|")
    for rule, n in m["by_rule_block"].most_common():
        out.append(f"| {rule} | {n} |")
    if not m["by_rule_block"]:
        out.append("| (none) | 0 |")
    out.append("")

    out.append("## verify-edit self-correction")
    out.append("")
    out.append("Did the agent fix the file after a block (same file, same session)?")
    out.append("")
    rate = _pct(m["sc_corrected"], m["sc_blocks"])
    out.append(f"- Blocks: {m['sc_blocks']}")
    out.append(f"- Corrected by a later clean edit: {m['sc_corrected']}")
    out.append(f"- **Self-correction rate: {rate:.1f}%**")
    out.append("")

    if m["files_block"]:
        out.append("## Top files by verify-edit blocks")
        out.append("")
        for file, n in m["files_block"].most_common(10):
            out.append(f"- {file}: {n}")
        out.append("")

    out.append("## Weekly trend (blocks per 100 events)")
    out.append("")
    out.append("Declining rate at stable volume = agents internalizing the rules.")
    out.append("")
    out.append("| Week | Events | Blocks | Blocks/100 |")
    out.append("|------|--------|--------|------------|")
    for wk in sorted(m["weekly"]):
        ev = m["weekly"][wk]["events"]
        bl = m["weekly"][wk]["blocks"]
        out.append(f"| {wk} | {ev} | {bl} | {_pct(bl, ev):.1f} |")
    out.append("")
    return "\n".join(out) + "\n"


def metrics_to_json(m):
    """Flatten the metrics dict to plain JSON-serializable types."""
    return {
        "total": m["total"],
        "by_hook": dict(m["by_hook"]),
        "by_hook_block": dict(m["by_hook_block"]),
        "by_rule_block": dict(m["by_rule_block"]),
        "files_block": dict(m["files_block"]),
        "self_correction": {
            "blocks": m["sc_blocks"],
            "corrected": m["sc_corrected"],
            "rate_pct": round(_pct(m["sc_corrected"], m["sc_blocks"]), 1),
        },
        "weekly": {wk: dict(v) for wk, v in m["weekly"].items()},
        "first_ts": m["first_ts"],
        "last_ts": m["last_ts"],
    }


SELF_TEST_EVENTS = [
    {"ts": "2026-06-01T10:00:00Z", "session_id": "A", "hook": "verify-edit",
     "decision": "block", "rule": "emoji", "file": "x.md"},
    {"ts": "2026-06-01T10:05:00Z", "session_id": "A", "hook": "verify-edit",
     "decision": "allow", "rule": "none", "file": "x.md"},
    {"ts": "2026-06-01T10:10:00Z", "session_id": "A", "hook": "verify-edit",
     "decision": "block", "rule": "emoji", "file": "y.md"},
    {"ts": "2026-06-02T11:00:00Z", "session_id": "A", "hook": "guard-bash",
     "decision": "block", "rule": "error-44", "file": ""},
    {"ts": "2026-06-02T11:01:00Z", "session_id": "A", "hook": "guard-bash",
     "decision": "allow", "rule": "none", "file": ""},
    {"ts": "2026-06-09T09:00:00Z", "session_id": "B", "hook": "verify-edit",
     "decision": "allow", "rule": "none", "file": "z.md"},
]


def self_test():
    m = compute(SELF_TEST_EVENTS)
    checks = [
        ("total", m["total"], 6),
        ("verify-edit events", m["by_hook"]["verify-edit"], 4),
        ("guard-bash events", m["by_hook"]["guard-bash"], 2),
        ("verify-edit blocks", m["by_hook_block"]["verify-edit"], 2),
        ("guard-bash blocks", m["by_hook_block"]["guard-bash"], 1),
        ("emoji blocks", m["by_rule_block"]["verify-edit:emoji"], 2),
        ("sc_blocks", m["sc_blocks"], 2),
        ("sc_corrected", m["sc_corrected"], 1),
        # 06-01 and 06-02 are the same ISO week (W23); 06-09 is W24 -> 2 weeks.
        ("weeks tracked", len(m["weekly"]), 2),
    ]
    ok = True
    for name, got, want in checks:
        if got != want:
            ok = False
            print(f"SELF-TEST FAIL: {name} = {got}, expected {want}")
    if ok:
        # render must not raise on real data
        render(m)
        print("SELF-TEST PASS: 9 checks across 2 sessions/weeks")
        return 0
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Aggregate contract-layer hook telemetry.")
    ap.add_argument("path", nargs="?", default=DEFAULT_LOG,
                    help=f"JSONL event log (default {DEFAULT_LOG})")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    ap.add_argument("--self-test", action="store_true", help="run the built-in fixture test")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        with open(args.path, encoding="utf-8") as fh:
            events = parse_events(fh)
    except FileNotFoundError:
        # No log yet is a normal early state, not an error.
        if args.json:
            print(json.dumps({"total": 0, "note": "no log file yet"}))
        else:
            print(f"# Contract Layer Metrics\n\nNo log at {args.path} yet.")
        return 0

    m = compute(events)
    if args.json:
        print(json.dumps(metrics_to_json(m), indent=2))
    else:
        sys.stdout.write(render(m))
    return 0


if __name__ == "__main__":
    sys.exit(main())
