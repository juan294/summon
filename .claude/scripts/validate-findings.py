#!/usr/bin/env python3
"""validate-findings.py — enforce the pre-launch Output Contract.

The pre-launch report declares a finding format (Finding-ID grammar + required
fields) that /remediate parses. Today that contract is prose: a malformed finding
is silently dropped by the consumer regex. This validator makes the contract
machine-checkable — it rejects a report whose findings violate the grammar, are
missing required fields, or lack a file:line ref ("no refs = no finding").

Usage:
    validate-findings.py <report.md>     # exit 0 if valid, 1 if violations
    validate-findings.py --self-test     # run bundled fixtures, exit 0/1

Stdlib only. Spec: pre-launch.md "Output Contract", remediate.md "Parser contract".
"""

import argparse
import os
import re
import sys

# Strict Finding-ID grammar (must match the /remediate consumer regex).
ID_VALID = re.compile(r"^(AR|FE|BE|PE|DO|SE|QA|UX)-(B|H|M|L|S)[0-9]+$")
# Loose "looks like someone tried to write a Finding-ID" — used to detect
# malformed IDs (lowercase, wrong severity letter, etc.) that the consumer
# would silently drop.
ID_SHAPED = re.compile(r"^[A-Za-z]{2}-[A-Za-z]?[0-9]+")
# A file:line reference, e.g. src/app.ts:42 or path/x.py:110-130.
FILELINE = re.compile(r"\S+:[0-9]+")

REQUIRED_FIELDS = [
    "Severity",
    "Time horizon",
    "Evidence type",
    "Files",
    "What's happening",
    "Why it matters",
    "Recommendation",
    "Regression risk",
    "Expected impact",
    "Effort estimate",
]


class Block:
    def __init__(self, heading_line):
        self.heading = heading_line.rstrip("\n")
        self.body_lines = []

    @property
    def first_token(self):
        # "#### SE-B1 Title" -> "SE-B1"
        parts = self.heading[4:].strip().split()
        return parts[0] if parts else ""

    @property
    def body(self):
        return "\n".join(self.body_lines)

    def field_value(self, name):
        # Return the text after "**Name:**" on its line, or None.
        m = re.search(
            r"\*\*" + re.escape(name) + r":\*\*(.*)",
            self.body,
        )
        return m.group(1).strip() if m else None


def parse_blocks(text):
    """Yield every #### block in the document (heading + following lines up to
    the next #### or ## heading)."""
    blocks = []
    current = None
    for line in text.splitlines(keepends=True):
        if line.startswith("#### "):
            current = Block(line)
            blocks.append(current)
        elif line.startswith("## ") or line.startswith("# "):
            current = None  # left the block
        elif current is not None:
            current.body_lines.append(line.rstrip("\n"))
    return blocks


def is_finding_candidate(block):
    """A #### block we should hold to the contract: it either attempts a
    Finding-ID or carries finding fields (so a dropped one is a real loss)."""
    return bool(ID_SHAPED.match(block.first_token)) or (
        "**Severity:**" in block.body
    )


def validate_text(text):
    """Return a list of (finding-label, reason) violations."""
    errors = []
    for block in parse_blocks(text):
        if not is_finding_candidate(block):
            continue
        label = block.first_token or block.heading.strip()
        if not ID_VALID.match(block.first_token):
            errors.append(
                (label, "invalid or missing Finding-ID "
                        "(want <AR|FE|BE|PE|DO|SE|QA|UX>-<B|H|M|L|S><n>)")
            )
        for field in REQUIRED_FIELDS:
            if f"**{field}:**" not in block.body:
                errors.append((label, f"missing required field: {field}"))
        files = block.field_value("Files")
        if files is not None and not FILELINE.search(files):
            errors.append(
                (label, "no file:line ref in Files (no refs = no finding)")
            )
    return errors


def validate_file(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return validate_text(fh.read())


# --- bundled fixtures for --self-test -------------------------------------

VALID_FIXTURE = """## 5. Backend

#### BE-H1 N+1 query in the orders endpoint
- **Severity:** high
- **Time horizon:** Before launch
- **Evidence type:** [evidence]
- **Files:** src/orders/api.ts:42, src/orders/repo.ts:110-130
- **What's happening:** the list endpoint issues one query per row.
- **Why it matters:** p95 latency scales with result size.
- **Recommendation:** batch the lookups with a single join.
- **Regression risk:** join must preserve per-row ordering the UI relies on.
- **Expected impact:** flat latency under load.
- **Effort estimate:** M

## 6. Performance

### Domain Model
Plain prose, not a finding.
"""

INVALID_FIXTURE = """## 5. Backend

#### be-h1 lowercase id is malformed
- **Severity:** high
- **Time horizon:** Before launch
- **Evidence type:** [evidence]
- **Files:** src/orders/api.ts:42
- **What's happening:** x
- **Why it matters:** y
- **Recommendation:** z
- **Regression risk:** none — additive index only.
- **Expected impact:** w
- **Effort estimate:** M

#### SE-B1 missing fields and no file:line
- **Severity:** launch-blocker
- **Files:** src/auth/login.ts
- **Why it matters:** y
"""


def self_test():
    ok = True
    valid_errs = validate_text(VALID_FIXTURE)
    if valid_errs:
        ok = False
        print("SELF-TEST FAIL: valid fixture reported errors:")
        for label, reason in valid_errs:
            print(f"  {label}: {reason}")
    else:
        print("SELF-TEST PASS: valid fixture clean")

    invalid_errs = validate_text(INVALID_FIXTURE)
    # Expect: bad ID on be-h1, plus SE-B1 missing several fields + no file:line.
    labels = {label for label, _ in invalid_errs}
    expect_bad_id = any(
        "invalid or missing Finding-ID" in r for _, r in invalid_errs
    )
    expect_missing = any("missing required field" in r for _, r in invalid_errs)
    expect_noref = any("no file:line ref" in r for _, r in invalid_errs)
    if invalid_errs and expect_bad_id and expect_missing and expect_noref:
        print(f"SELF-TEST PASS: invalid fixture flagged "
              f"{len(invalid_errs)} violations across {sorted(labels)}")
    else:
        ok = False
        print("SELF-TEST FAIL: invalid fixture not fully flagged:")
        for label, reason in invalid_errs:
            print(f"  {label}: {reason}")
    return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", nargs="?", help="path to the pre-launch report")
    parser.add_argument("--self-test", action="store_true",
                        help="run bundled fixtures and exit")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(0 if self_test() else 1)

    if not args.report:
        parser.error("a report path is required (or use --self-test)")
    if not os.path.isfile(args.report):
        print(f"ERROR: report not found: {args.report}", file=sys.stderr)
        sys.exit(2)

    errors = validate_file(args.report)
    if errors:
        print(f"CONTRACT VIOLATION: {len(errors)} issue(s) in {args.report}",
              file=sys.stderr)
        for label, reason in errors:
            print(f"  {label}: {reason}", file=sys.stderr)
        sys.exit(1)
    print(f"OK: report findings satisfy the Output Contract ({args.report})")
    sys.exit(0)


if __name__ == "__main__":
    main()
