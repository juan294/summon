/**
 * output.ts — thin output writer abstraction (#568 FE-S1, #598 UX-H1)
 *
 * Central indirection over process.stdout/stderr.write so all user-facing I/O
 * flows through one place. Honors NO_COLOR / FORCE_COLOR via supportsColor().
 *
 * Three helpers:
 *   out(msg)  — informational stdout line (equivalent to console.log)
 *   err(msg)  — raw stderr line, no prefix (for hint/continuation lines)
 *   fail(msg) — branded error to stderr: "summon: error: <msg>" with red ✗ when colors are on
 *
 * debugLog (SUMMON_DEBUG) and progress/spinner lines are intentionally NOT
 * routed here — they have distinct semantics and are handled in utils.ts /
 * launcher.ts respectively.
 */

import { formatUserError } from "../utils.js";

/**
 * Write an informational message to stdout, followed by a newline.
 * Equivalent to console.log for single-argument plain-string output.
 */
export function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/**
 * Write a raw (unprefixed) message to stderr, followed by a newline.
 * Use for hint/continuation lines that follow a fail() call, blank
 * separator lines (pass ""), or warnings that are not errors.
 */
export function err(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/**
 * Write a branded error message to stderr with the unified prefix:
 *   "summon: error: <msg>"              (NO_COLOR / no TTY)
 *   "\x1b[31m✗ summon: error:\x1b[0m <msg>"  (color-capable)
 *
 * This is the single canonical way to emit user-facing errors (#598).
 * Exit codes are the caller's responsibility — fail() never calls process.exit.
 */
export function fail(msg: string): void {
  process.stderr.write(`${formatUserError(msg)}\n`);
}
