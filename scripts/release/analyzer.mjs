// @ts-check
/**
 * Release evidence analyzer — pure logic, no I/O, no process access.
 *
 * Implements the E2E Pro release invariant (docs/release/e2e-pro-playbook.md
 * decisions D03, D04, D06, D14, D16, D19). The whole contract is:
 *
 *   release_ok = passed_count > 0
 *            and required_misses is empty
 *            and blocking_failures is empty
 *            and evidence names the exact candidate
 *            and every required result has its declared oracles
 *            and every fixture was cleaned up
 *            and no exception is expired, unapproved, or covers a required probe
 *
 * Fail-closed: anything unparseable, unknown, or missing is a block, never a
 * pass. Mirrors trust.ts's corrupt-DB-means-deny-all posture.
 *
 * Kept out of src/ deliberately: package.json `files` ships everything tsup
 * emits, and this is a release-only tool that end users must never receive.
 * Tested from src/release/analyzer.test.ts.
 */

/** Schema version this analyzer understands. */
export const SCHEMA_VERSION = 1;

/** Result statuses that may appear in a manifest. Anything else fails closed. */
const VALID_STATUS = new Set(["passed", "failed", "skipped"]);

/** Fixture cleanup states that count as clean. */
const CLEAN = "removed";

/**
 * @typedef {{ code: string, detail: string }} Block
 * @typedef {{ ok: boolean, blocks: Block[] }} Analysis
 */

/**
 * Parse an ISO-8601 timestamp, returning null when unusable.
 * @param {unknown} value
 * @returns {number | null} epoch ms, or null
 */
function parseTime(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Analyze a release evidence manifest against a fixed candidate.
 *
 * @param {unknown} manifest parsed evidence manifest
 * @param {{ now: number | string | Date, expectedCandidate: string }} opts
 *   `now` is injected so results are deterministic; the analyzer never reads a clock.
 * @returns {Analysis}
 */
export function analyze(manifest, opts) {
  /** @type {Block[]} */
  const blocks = [];
  const add = (/** @type {string} */ code, /** @type {string} */ detail) =>
    blocks.push({ code, detail });

  const nowMs = parseTime(
    opts?.now instanceof Date ? opts.now.toISOString() : String(opts?.now ?? ""),
  ) ?? (typeof opts?.now === "number" ? opts.now : null);

  if (nowMs === null) {
    add("MALFORMED", "analyzer requires an explicit, parseable `now`");
    return { ok: false, blocks };
  }

  // ── Structural ──────────────────────────────────────────────────────────
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    add("MALFORMED", "manifest is not an object");
    return { ok: false, blocks };
  }
  const m = /** @type {Record<string, any>} */ (manifest);

  if (m["version"] !== SCHEMA_VERSION) {
    add(
      "SCHEMA_VERSION",
      `manifest version ${JSON.stringify(m["version"])} != supported ${SCHEMA_VERSION}`,
    );
    return { ok: false, blocks };
  }

  const release = m["release"];
  if (release === null || typeof release !== "object") {
    add("MALFORMED", "manifest.release is missing");
    return { ok: false, blocks };
  }

  const results = m["results"];
  if (!Array.isArray(results) || results.length === 0) {
    add("NO_RESULTS", "manifest.results is empty — nothing was evaluated");
    return { ok: false, blocks };
  }

  // Any malformed row fails closed rather than being skipped over.
  for (const [i, r] of results.entries()) {
    if (r === null || typeof r !== "object") {
      add("MALFORMED", `results[${i}] is not an object`);
      continue;
    }
    if (typeof r.probeId !== "string" || r.probeId.length === 0) {
      add("MALFORMED", `results[${i}] has no probeId`);
    }
    if (!VALID_STATUS.has(r.status)) {
      add(
        "MALFORMED",
        `results[${i}] (${r.probeId ?? "?"}) has unknown status ${JSON.stringify(r.status)}`,
      );
    }
  }
  if (blocks.length > 0) return { ok: false, blocks };

  const required = results.filter((r) => r.required === true);
  const passed = results.filter((r) => r.status === "passed");

  // ── D03: a run with zero passing checks MUST fail ───────────────────────
  if (passed.length === 0) {
    add(
      "ZERO_PASS",
      `0 of ${results.length} checks passed — "0 passed, N skipped" is never a pass`,
    );
  }

  // ── Exceptions (evaluated before failures, which depend on them) ────────
  const exceptions = Array.isArray(m["exceptions"]) ? m["exceptions"] : [];
  const requiredIds = new Set(required.map((r) => r.probeId));
  /** @type {Set<string>} probeIds excused by a currently-valid exception */
  const excused = new Set();

  for (const [i, e] of exceptions.entries()) {
    if (e === null || typeof e !== "object") {
      add("MALFORMED", `exceptions[${i}] is not an object`);
      continue;
    }
    const label = e.id ?? `exceptions[${i}]`;

    // D04: quarantine does not excuse a required miss.
    if (typeof e.probeId === "string" && requiredIds.has(e.probeId)) {
      add(
        "EXCEPTION_ON_REQUIRED",
        `exception ${label} covers required probe ${e.probeId}; required checks cannot be excepted`,
      );
      continue;
    }

    const expires = parseTime(e.expiresAt);
    if (expires === null) {
      add("MALFORMED", `exception ${label} has an unparseable expiresAt`);
      continue;
    }
    if (expires <= nowMs) {
      add("EXPIRED_EXCEPTION", `exception ${label} expired at ${e.expiresAt}`);
      continue;
    }
    if (typeof e.approvedBy !== "string" || e.approvedBy.length === 0) {
      add("UNAPPROVED_EXCEPTION", `exception ${label} has no approvedBy`);
      continue;
    }
    if (typeof e.probeId === "string") excused.add(e.probeId);
  }

  // ── D04: required skip/fail blocks ──────────────────────────────────────
  const requiredMisses = required.filter((r) => r.status !== "passed");
  if (requiredMisses.length > 0) {
    add(
      "REQUIRED_MISS",
      `required probe(s) did not pass: ${requiredMisses
        .map((r) => `${r.probeId}=${r.status}`)
        .join(", ")}`,
    );
  }

  // Non-required failures block unless a valid exception excuses them.
  const blockingFailures = results.filter(
    (r) => r.status === "failed" && r.required !== true && !excused.has(r.probeId),
  );
  if (blockingFailures.length > 0) {
    add(
      "FAILURE",
      `failed without a valid exception: ${blockingFailures.map((r) => r.probeId).join(", ")}`,
    );
  }

  // ── D06: evidence identifies the exact candidate ────────────────────────
  const candidate = release.candidate;
  if (typeof candidate !== "string" || candidate.length === 0) {
    add("MALFORMED", "release.candidate is missing");
  } else if (candidate !== opts.expectedCandidate) {
    add(
      "CANDIDATE_MISMATCH",
      `evidence names candidate ${candidate} but ${opts.expectedCandidate} was expected`,
    );
  }

  const deployed = release.deployedIdentity;
  if (deployed !== null && deployed !== undefined) {
    if (typeof deployed !== "string" || deployed !== candidate) {
      add(
        "DEPLOYED_MISMATCH",
        `deployed identity ${String(deployed)} != candidate ${String(candidate)} — tested one artifact, shipped another`,
      );
    }
  }

  // ── D14: declared oracles must actually be present ──────────────────────
  for (const r of required) {
    const o = r.oracles;
    if (o === null || typeof o !== "object" || Object.keys(o).length === 0) {
      add("MISSING_ORACLE", `required probe ${r.probeId} recorded no oracle evidence`);
    }
  }

  // ── D19: synthetic fixtures are cleaned up ──────────────────────────────
  for (const r of results) {
    const fixtures = Array.isArray(r.fixtures) ? r.fixtures : [];
    for (const f of fixtures) {
      if (f === null || typeof f !== "object" || f.cleanupStatus !== CLEAN) {
        add(
          "DIRTY_FIXTURE",
          `fixture ${f?.id ?? "?"} from ${r.probeId} is ${f?.cleanupStatus ?? "unrecorded"}, expected "${CLEAN}"`,
        );
      }
    }
  }

  // ── D16: overdue critical cadence arcs block ────────────────────────────
  const cadence = Array.isArray(m["cadence"]) ? m["cadence"] : [];
  for (const [i, c] of cadence.entries()) {
    if (c === null || typeof c !== "object") {
      add("MALFORMED", `cadence[${i}] is not an object`);
      continue;
    }
    if (c.blocksWhenOverdue !== true) continue;

    const last = parseTime(c.lastRunAt);
    if (last === null) {
      add(
        "OVERDUE_ARC",
        `cadence obligation ${c.obligationId} has never been run (no lastRunAt)`,
      );
      continue;
    }
    const interval = Number(c.intervalDays);
    if (!Number.isFinite(interval) || interval <= 0) {
      add("MALFORMED", `cadence obligation ${c.obligationId} has an invalid intervalDays`);
      continue;
    }
    const dueMs = last + interval * 86_400_000;
    if (nowMs > dueMs) {
      const overdueDays = Math.floor((nowMs - dueMs) / 86_400_000);
      add(
        "OVERDUE_ARC",
        `cadence obligation ${c.obligationId} is ${overdueDays} day(s) overdue (interval ${interval}d)`,
      );
    }
  }

  return { ok: blocks.length === 0, blocks };
}

/**
 * Render an analysis using the project's BLOCKED/WHY/FIX corrective-hint
 * convention (see .claude/hooks/verify-edit.sh emit_block).
 *
 * @param {Analysis} analysis
 * @returns {string}
 */
export function formatBlocks(analysis) {
  if (analysis.ok) return "";
  const codes = [...new Set(analysis.blocks.map((b) => b.code))].join(", ");
  const detail = analysis.blocks.map((b) => `  [${b.code}] ${b.detail}`).join("\n");
  return (
    `BLOCKED by analyze-release — release evidence is incomplete\n\n` +
    `WHY: ${codes}\n\n` +
    `FIX:\n${detail}\n`
  );
}
