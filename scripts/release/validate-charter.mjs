#!/usr/bin/env node
// @ts-check
/**
 * validate-charter — enforce the exploratory-charter reporting contract.
 *
 * Playbook D10: every charter attempts all eight maneuvers and reports each as
 * PASS, FAIL, or N/A with a concrete reason. "Omitting a row invalidates the
 * charter." That rule was prose only, which meant a charter could silently drop
 * the maneuver it found inconvenient and still read as complete.
 *
 * Exit codes: 0 valid, 1 invalid, 2 usage/unreadable.
 */

import { readFileSync } from "node:fs";

export const REQUIRED_SECTIONS = [
  "Risk hypothesis",
  "Maneuvers",
  "Findings",
  "Skipped high-risk areas",
  "Fixtures and cleanup",
  "Charter decision",
];

const VALID_RESULTS = new Set(["PASS", "FAIL", "N/A"]);
const EXPECTED_MANEUVERS = 8;

/**
 * @typedef {{ code: string, detail: string }} Violation
 */

/**
 * Validate a charter report's structure.
 *
 * @param {string} markdown
 * @returns {{ ok: boolean, violations: Violation[] }}
 */
export function validateCharter(markdown) {
  /** @type {Violation[]} */
  const violations = [];
  const add = (/** @type {string} */ code, /** @type {string} */ detail) =>
    violations.push({ code, detail });

  for (const section of REQUIRED_SECTIONS) {
    // Match a heading at any level whose text is the section name.
    const heading = new RegExp(`^#{1,6}\\s+${section}\\s*$`, "im");
    if (!heading.test(markdown)) {
      add("MISSING_SECTION", `report has no "${section}" section`);
    }
  }

  // Maneuver rows look like: | 3 | Interrupt mid-flow | PASS | evidence |
  const rowPattern = /^\s*\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;
  /** @type {Map<number, {result: string, evidence: string}>} */
  const rows = new Map();

  for (const match of markdown.matchAll(rowPattern)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number < 1 || number > EXPECTED_MANEUVERS) continue;
    rows.set(number, {
      result: (match[3] ?? "").trim().toUpperCase(),
      evidence: (match[4] ?? "").trim(),
    });
  }

  for (let n = 1; n <= EXPECTED_MANEUVERS; n += 1) {
    const row = rows.get(n);
    if (!row) {
      add("MISSING_MANEUVER", `maneuver ${n} has no row — omitting a row invalidates the charter`);
      continue;
    }
    if (!VALID_RESULTS.has(row.result)) {
      add(
        "INVALID_RESULT",
        `maneuver ${n} result ${JSON.stringify(row.result || "(empty)")} is not PASS, FAIL, or N/A`,
      );
      continue;
    }
    // An N/A without a reason is an omission wearing a disguise.
    if (row.result === "N/A" && row.evidence.length === 0) {
      add("NA_WITHOUT_REASON", `maneuver ${n} is N/A but gives no reason`);
    }
    if (row.result === "FAIL" && row.evidence.length === 0) {
      add("FAIL_WITHOUT_EVIDENCE", `maneuver ${n} FAILED but records no reproduction`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Render violations using the project's BLOCKED/WHY/FIX convention.
 * @param {{ ok: boolean, violations: Violation[] }} result
 * @param {string} path
 * @returns {string}
 */
export function formatViolations(result, path) {
  if (result.ok) return "";
  const codes = [...new Set(result.violations.map((v) => v.code))].join(", ");
  return (
    `BLOCKED by validate-charter — ${path} is not a complete charter\n\n` +
    `WHY: ${codes}\n\n` +
    `FIX:\n${result.violations.map((v) => `  [${v.code}] ${v.detail}`).join("\n")}\n`
  );
}

function main() {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("Usage: validate-charter <report.md>\n");
    return 2;
  }

  let markdown;
  try {
    markdown = readFileSync(path, "utf-8");
  } catch (err) {
    process.stderr.write(
      `BLOCKED by validate-charter — cannot read ${path}\n\n` +
        `WHY: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `FIX:\n  Write the charter report before validating it.\n`,
    );
    return 2;
  }

  const result = validateCharter(markdown);
  if (!result.ok) {
    process.stderr.write(formatViolations(result, path));
    return 1;
  }

  process.stdout.write(`validate-charter: PASS — ${path} reports all 8 maneuvers\n`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("validate-charter.mjs")) {
  process.exit(main());
}
