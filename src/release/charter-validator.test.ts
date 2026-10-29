import { describe, it, expect } from "vitest";

// @ts-expect-error -- untyped .mjs module, exercised entirely through these tests
import { validateCharter, formatViolations } from "../../scripts/release/validate-charter.mjs";

const MANEUVERS = [
  "Try the action twice",
  "Edit after every error",
  "Interrupt mid-flow",
  "Use a second session or role",
  "Switch shell, terminal size, Node version",
  "Compare copy with outcome",
  "Read back downstream state",
  'Ask "should this exist?"',
];

interface RowOverride {
  result?: string;
  evidence?: string;
}

/** Build a well-formed charter report, with targeted damage for negative cases. */
function report(
  opts: { omit?: number[]; rows?: Record<number, RowOverride>; dropSection?: string } = {},
): string {
  const rows = MANEUVERS.map((name, i) => {
    const n = i + 1;
    if (opts.omit?.includes(n)) return null;
    const over = opts.rows?.[n] ?? {};
    const result = over.result ?? "PASS";
    const evidence = over.evidence ?? `exit 0, sandbox summon-rel-1-${n}`;
    return `| ${n} | ${name} | ${result} | ${evidence} |`;
  })
    .filter(Boolean)
    .join("\n");

  const sections: Array<[string, string]> = [
    ["Risk hypothesis", "Launch pipeline may duplicate panes on repeat invocation."],
    [
      "Maneuvers",
      `| # | Maneuver | Result | Evidence or N/A reason |\n|---:|---|---|---|\n${rows}`,
    ],
    ["Findings", "None."],
    ["Skipped high-risk areas", "None."],
    ["Fixtures and cleanup", "summon-rel-1-* removed; zero residue."],
    ["Charter decision", "PASS"],
  ];

  const body = sections
    .filter(([name]) => name !== opts.dropSection)
    .map(([name, content]) => `## ${name}\n\n${content}`)
    .join("\n\n");

  return `# Exploratory Charter — launch-pipeline\n\n- Candidate: abc123\n\n${body}\n`;
}

const codes = (md: string): string[] =>
  validateCharter(md).violations.map((v: { code: string }) => v.code);

describe("charter validator", () => {
  it("accepts a complete eight-row report", () => {
    const result = validateCharter(report());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a report with only seven rows and names the missing one", () => {
    const result = validateCharter(report({ omit: [5] }));
    expect(result.ok).toBe(false);
    const missing = result.violations.find(
      (v: { code: string }) => v.code === "MISSING_MANEUVER",
    );
    expect(missing.detail).toContain("maneuver 5");
  });

  it("rejects every omitted row, not just the first", () => {
    const result = validateCharter(report({ omit: [2, 6, 8] }));
    const missing = result.violations.filter(
      (v: { code: string }) => v.code === "MISSING_MANEUVER",
    );
    expect(missing).toHaveLength(3);
  });

  it("rejects a row with an empty result", () => {
    expect(codes(report({ rows: { 3: { result: "" } } }))).toContain("INVALID_RESULT");
  });

  it("rejects a result that is not PASS, FAIL, or N/A", () => {
    expect(codes(report({ rows: { 4: { result: "MAYBE" } } }))).toContain("INVALID_RESULT");
  });

  it("rejects N/A with no reason", () => {
    expect(codes(report({ rows: { 7: { result: "N/A", evidence: "" } } }))).toContain(
      "NA_WITHOUT_REASON",
    );
  });

  it("accepts N/A when a concrete reason is given", () => {
    const result = validateCharter(
      report({ rows: { 7: { result: "N/A", evidence: "no datastore in summon" } } }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects FAIL with no reproduction", () => {
    expect(codes(report({ rows: { 1: { result: "FAIL", evidence: "" } } }))).toContain(
      "FAIL_WITHOUT_EVIDENCE",
    );
  });

  it("accepts FAIL when a reproduction is recorded", () => {
    const result = validateCharter(
      report({ rows: { 1: { result: "FAIL", evidence: "second launch duplicates pane; see log" } } }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    "Fixtures and cleanup",
    "Skipped high-risk areas",
    "Findings",
    "Risk hypothesis",
    "Charter decision",
  ])("rejects a report missing the %s section", (section) => {
    const result = validateCharter(report({ dropSection: section }));
    expect(result.ok).toBe(false);
    const missing = result.violations.find(
      (v: { code: string }) => v.code === "MISSING_SECTION",
    );
    expect(missing.detail).toContain(section);
  });

  it("does not mistake unrelated numeric tables for maneuver rows", () => {
    const withExtra = `${report()}\n\n## Appendix\n\n| 9 | something | else | here |\n`;
    expect(validateCharter(withExtra).ok).toBe(true);
  });
});

describe("formatViolations", () => {
  it("returns empty string when valid", () => {
    expect(formatViolations({ ok: true, violations: [] }, "x.md")).toBe("");
  });

  it("uses the project BLOCKED/WHY/FIX convention", () => {
    const out = formatViolations(validateCharter(report({ omit: [5] })), "x.md");
    expect(out).toMatch(/^BLOCKED by validate-charter — /);
    expect(out).toContain("WHY:");
    expect(out).toContain("FIX:");
    expect(out).toContain("MISSING_MANEUVER");
  });
});
