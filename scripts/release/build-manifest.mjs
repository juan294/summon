#!/usr/bin/env node
// @ts-check
/**
 * build-manifest — turn a vitest JSON run into a release evidence manifest.
 *
 * Uses vitest's built-in JSON reporter rather than a custom reporter: the
 * built-in output is a stable contract, and the transformation stays a plain
 * testable function.
 *
 * Grouping: a probe is one top-level `describe` in src/release/. Its status is
 * `passed` only when every test inside it passed. Any failure or skip
 * downgrades the whole probe -- a partially-run probe is not a pass.
 *
 * Refuses to emit an unattributed manifest: with no resolvable candidate it
 * writes nothing, so the analyzer blocks on a missing file rather than
 * accepting evidence that names no commit.
 *
 * Usage:
 *   node scripts/release/build-manifest.mjs \
 *     --results .release-results.json \
 *     [--fixtures .release-fixtures.json] \
 *     [--candidate <sha>] [--out <path>] [--environment <name>]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

/** Probes that must pass for a release. Everything under src/release/ is required. */
const REQUIRED_PREFIX = "release.";

/**
 * @param {string[]} argv
 * @returns {Record<string,string>}
 */
function parseArgs(argv) {
  /** @type {Record<string,string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[arg.slice(2)] = "";
    else {
      out[arg.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * Collapse vitest assertion results into one row per probe.
 *
 * @param {any} report parsed vitest --reporter=json output
 * @returns {Array<Record<string, any>>}
 */
export function groupIntoProbes(report) {
  /** @type {Map<string, {statuses: string[], start: number, end: number, failures: string[]}>} */
  const byProbe = new Map();

  for (const file of report?.testResults ?? []) {
    for (const assertion of file?.assertionResults ?? []) {
      // ancestorTitles[0] is the top-level describe == probeId.
      const probeId = assertion?.ancestorTitles?.[0];
      if (typeof probeId !== "string" || !probeId.startsWith(REQUIRED_PREFIX)) continue;

      const entry = byProbe.get(probeId) ?? {
        statuses: [],
        start: Number.POSITIVE_INFINITY,
        end: 0,
        failures: [],
      };
      entry.statuses.push(assertion.status);
      if (assertion.status === "failed") {
        entry.failures.push(assertion.fullName ?? assertion.title ?? "unnamed");
      }
      const duration = Number(assertion.duration ?? 0);
      entry.start = Math.min(entry.start, Number(file.startTime ?? 0));
      entry.end = Math.max(entry.end, Number(file.startTime ?? 0) + duration);
      byProbe.set(probeId, entry);
    }
  }

  return [...byProbe.entries()].map(([probeId, entry]) => {
    /** @type {"passed"|"failed"|"skipped"} */
    let status = "passed";
    if (entry.statuses.includes("failed")) status = "failed";
    else if (entry.statuses.some((s) => s !== "passed")) status = "skipped";

    return {
      probeId,
      required: true,
      status,
      owner: "maintainer",
      startedAt: new Date(entry.start).toISOString(),
      finishedAt: new Date(entry.end).toISOString(),
      runner: "vitest",
      oracles: {
        assertions: entry.statuses.length,
        ...(entry.failures.length > 0 ? { failures: entry.failures } : {}),
      },
      fixtures: [],
    };
  });
}

/**
 * @param {string | undefined} explicit
 * @returns {string | null}
 */
function resolveCandidate(explicit) {
  if (explicit) return explicit;
  const fromEnv = process.env["SUMMON_RELEASE_CANDIDATE"];
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultsPath = args["results"] || ".release-results.json";

  const candidate = resolveCandidate(args["candidate"]);
  if (!candidate) {
    process.stderr.write(
      "BLOCKED by build-manifest — no candidate could be resolved\n\n" +
        "WHY: neither --candidate, SUMMON_RELEASE_CANDIDATE, nor `git rev-parse HEAD` produced a commit.\n\n" +
        "FIX:\n  Re-run with SUMMON_RELEASE_CANDIDATE=$(git rev-parse HEAD).\n" +
        "  No manifest was written; the analyzer will block on the missing file.\n",
    );
    return 2;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resultsPath, "utf-8"));
  } catch (err) {
    process.stderr.write(
      `BLOCKED by build-manifest — cannot read vitest results at ${resultsPath}\n\n` +
        `WHY: ${err instanceof Error ? err.message : String(err)}\n\n` +
        "FIX:\n  Run: pnpm test:release\n",
    );
    return 2;
  }

  const results = groupIntoProbes(report);

  // Attach fixture cleanup evidence, which the JSON reporter cannot carry.
  const fixturesPath = args["fixtures"] || ".release-fixtures.json";
  if (existsSync(fixturesPath) && results.length > 0) {
    try {
      const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));
      const cleanupProbe = results.find((r) => r.probeId === "release.cleanup") ?? results[0];
      cleanupProbe.fixtures = fixtures;
    } catch {
      /* absent fixture evidence surfaces as MISSING_ORACLE, not a crash */
    }
  }

  const outPath = args["out"] || join("docs", "release", "evidence", `${candidate}.json`);
  const manifest = {
    version: 1,
    release: {
      baseline: args["baseline"] || null,
      candidate,
      deployedIdentity: args["deployed"] || null,
      environment: args["environment"] || (process.env["CI"] ? "ci-ubuntu" : "local-macos"),
      generatedAt: new Date().toISOString(),
    },
    results,
    cadence: [],
    exceptions: [],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  process.stdout.write(
    `build-manifest: wrote ${outPath} (${results.length} probes, candidate ${candidate})\n`,
  );
  return 0;
}

// Only run when invoked directly, so tests can import groupIntoProbes.
if (process.argv[1] && process.argv[1].endsWith("build-manifest.mjs")) {
  process.exit(main());
}
