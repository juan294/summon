#!/usr/bin/env node
// @ts-check
/**
 * analyze-release — CLI gate over a release evidence manifest.
 *
 * Exit codes:
 *   0  evidence is complete; the release may proceed to authorization + tag
 *   1  BLOCKED — at least one invariant failed
 *   2  usage error or unreadable input (fail-closed)
 *
 * Usage:
 *   node scripts/release/analyze-release.mjs \
 *     --manifest docs/release/evidence/<candidate>.json \
 *     --candidate "$(git rev-parse HEAD)" \
 *     [--now <ISO8601>]
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyze, formatBlocks } from "./analyzer.mjs";

const USAGE = `Usage: analyze-release --manifest <path> --candidate <sha> [--now <ISO8601>]

  --manifest   path to the evidence manifest JSON
  --candidate  the exact commit the evidence must name
  --now        override the clock (testing); defaults to the current time
`;

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[key] = "";
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

/**
 * Append-only contract telemetry, matching verify-edit.sh's log_event shape.
 * Fail-open: telemetry must never break the gate.
 *
 * @param {string} decision
 * @param {string} rule
 * @param {string} file
 */
function logEvent(decision, rule, file) {
  try {
    const dir = join(process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd(), ".claude", "metrics");
    mkdirSync(dir, { recursive: true });
    const row = {
      ts: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      session_id: process.env["SESSION_ID"] ?? "",
      hook: "analyze-release",
      decision,
      rule,
      file,
    };
    appendFileSync(join(dir, "contract-events.jsonl"), `${JSON.stringify(row)}\n`);
  } catch {
    /* telemetry is best-effort by design */
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifestPath = args["manifest"];
  const candidate = args["candidate"];

  if (!manifestPath || !candidate) {
    process.stderr.write(USAGE);
    return 2;
  }

  let raw;
  try {
    raw = readFileSync(manifestPath, "utf-8");
  } catch (err) {
    process.stderr.write(
      `BLOCKED by analyze-release — evidence manifest is unreadable\n\n` +
        `WHY: ${manifestPath} could not be read (${err instanceof Error ? err.message : String(err)})\n\n` +
        `FIX:\n  Run the release probes first:\n` +
        `    SUMMON_RELEASE_CANDIDATE=${candidate} pnpm test:release\n`,
    );
    logEvent("block", "unreadable-manifest", manifestPath);
    return 2;
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `BLOCKED by analyze-release — evidence manifest is not valid JSON\n\n` +
        `WHY: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `FIX:\n  Regenerate the manifest; do not hand-edit it.\n`,
    );
    logEvent("block", "malformed-manifest", manifestPath);
    return 2;
  }

  const now = args["now"] ? args["now"] : new Date().toISOString();
  const analysis = analyze(manifest, { now, expectedCandidate: candidate });

  if (!analysis.ok) {
    process.stderr.write(formatBlocks(analysis));
    logEvent("block", analysis.blocks.map((b) => b.code).join("|"), manifestPath);
    return 1;
  }

  const passed = manifest.results.filter((/** @type {any} */ r) => r.status === "passed").length;
  process.stdout.write(
    `analyze-release: PASS — ${passed}/${manifest.results.length} checks passed against ${candidate}\n`,
  );
  logEvent("allow", "none", manifestPath);
  return 0;
}

process.exit(main());
