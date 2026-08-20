#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function metricFromLine(line, label) {
  const match = line.match(new RegExp(`(?:^\\s*|:\\s*)${label}(?:\\s{2,}|:)`, "i"));
  if (!match || match.index === undefined) return null;
  const totals = line.slice(match.index + match[0].length);
  const passed = Number(totals.match(/(\d+)\s+passed\b/i)?.[1] ?? 0);
  const failed = Number(totals.match(/(\d+)\s+failed\b/i)?.[1] ?? 0);
  return { passed, failed };
}

function summaryLineTotals(report) {
  const lines = report?.total?.lines;
  if (lines) return { covered: Number(lines.covered), total: Number(lines.total) };

  const totals = report?.totals;
  if (totals) {
    return {
      covered: Number(totals.covered_lines),
      total: Number(totals.num_statements),
    };
  }

  let covered = 0;
  let total = 0;
  for (const file of Object.values(report ?? {})) {
    if (!file || typeof file !== "object" || !file.statementMap || !file.s) {
      throw new Error("Coverage report format was not recognized");
    }
    const lineHits = new Map();
    for (const [statementId, location] of Object.entries(file.statementMap)) {
      const line = Number(location?.start?.line);
      const hits = Number(file.s[statementId]);
      if (!Number.isInteger(line) || line <= 0 || !Number.isFinite(hits) || hits < 0) {
        throw new Error("Coverage-final report contained invalid statement evidence");
      }
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, hits));
    }
    covered += [...lineHits.values()].filter((hits) => hits > 0).length;
    total += lineHits.size;
  }
  return { covered, total };
}

/**
 * Aggregate Vitest/Jest console totals and line evidence from one or more
 * coverage reports. Coverage is weighted from covered/total line counts;
 * averaging package percentages would over-weight smaller suites.
 */
export function aggregateCoverageEvidence({ log, reports }) {
  const cleanLog = String(log ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const lines = cleanLog.split("\n");
  let testLines = lines.map((line) => metricFromLine(line, "Tests"))
    .filter(Boolean);
  if (testLines.length === 0) {
    testLines = lines.flatMap((line) => {
      if (/Test Files?/i.test(line) || !/\d+\s+(?:passed|failed)\b/i.test(line)) return [];
      return [{
        passed: Number(line.match(/(\d+)\s+passed\b/i)?.[1] ?? 0),
        failed: Number(line.match(/(\d+)\s+failed\b/i)?.[1] ?? 0),
      }];
    }).slice(-1);
  }
  let fileLines = lines.map((line) => metricFromLine(line, "Test Files"))
    .filter(Boolean);
  if (fileLines.length === 0) {
    fileLines = lines.map((line) => metricFromLine(line, "Test Suites"))
      .filter(Boolean);
  }
  const sum = (values, key) => values.reduce((total, value) => total + value[key], 0);
  const passed = sum(testLines, "passed");
  const failed = sum(testLines, "failed");
  const testFiles = fileLines.length > 0
    ? sum(fileLines, "passed") + sum(fileLines, "failed")
    : null;
  if (testLines.length === 0 || passed + failed <= 0 || (testFiles !== null && testFiles <= 0)) {
    throw new Error("Test output did not contain complete suite totals");
  }

  let covered = 0;
  let total = 0;
  for (const report of reports) {
    const lineTotals = summaryLineTotals(report);
    const suiteCovered = lineTotals.covered;
    const suiteTotal = lineTotals.total;
    if (!Number.isFinite(suiteCovered) || !Number.isFinite(suiteTotal)
        || suiteCovered < 0 || suiteTotal <= 0 || suiteCovered > suiteTotal) {
      throw new Error("Coverage report did not contain valid line totals");
    }
    covered += suiteCovered;
    total += suiteTotal;
  }
  if (reports.length === 0 || total <= 0) throw new Error("Coverage reports were absent");

  return {
    testCount: passed + failed,
    testFiles,
    passed,
    failed,
    coverage: Math.round((covered / total) * 10_000) / 100,
  };
}

export function aggregateRootsCoverage({ log, summaries }) {
  return aggregateCoverageEvidence({ log, reports: summaries });
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "dist",
  "html",
  "lcov-report",
  "node_modules",
  "node_modules.nosync",
]);

function findReports(root, filename) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) visit(path);
      if (entry.isFile() && entry.name === filename) found.push(path);
    }
  };
  visit(root);
  return found.sort();
}

/**
 * Prefer one repository-root aggregate over nested package reports. When no
 * aggregate exists, use every same-format nested report. Never combine summary
 * and coverage-final formats, which could describe the same executed files.
 */
export function discoverCoverageReportPaths(repoDirectory) {
  const root = resolve(repoDirectory);
  const candidates = [
    {
      root: [join(root, "coverage", "coverage-summary.json"), join(root, "coverage-summary.json")],
      filename: "coverage-summary.json",
    },
    {
      root: [join(root, "coverage", "coverage-final.json"), join(root, "coverage-final.json")],
      filename: "coverage-final.json",
    },
    {
      root: [join(root, "coverage.json")],
      filename: "coverage.json",
    },
  ];

  for (const candidate of candidates) {
    const rootReport = candidate.root.find((path) => existsSync(path));
    if (rootReport) return [rootReport];
    const nested = findReports(root, candidate.filename);
    if (nested.length > 0) return nested;
  }
  return [];
}

/* v8 ignore start -- filesystem CLI; aggregation is covered through the export. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [logPath, ...reportArguments] = process.argv.slice(2);
  const reportPaths = reportArguments[0] === "--discover" && reportArguments[1]
    ? discoverCoverageReportPaths(reportArguments[1])
    : reportArguments[0] === "--discover" ? [] : reportArguments;
  if (!logPath || reportPaths.length === 0) {
    console.error("Usage: aggregate-roots-coverage.mjs <test-log> <coverage-report>...");
    process.exitCode = 2;
  } else {
    try {
      const result = aggregateCoverageEvidence({
        log: readFileSync(logPath, "utf8"),
        reports: reportPaths.map((path) => JSON.parse(readFileSync(path, "utf8"))),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Coverage aggregation failed");
      process.exitCode = 1;
    }
  }
}
/* v8 ignore stop */
