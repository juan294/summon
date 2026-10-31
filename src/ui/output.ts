/**
 * output.ts — thin output writer abstraction (#568 FE-S1, #598 UX-H1)
 *
 * Central indirection over process.stdout/stderr.write so all user-facing I/O
 * flows through one place. Honors NO_COLOR / FORCE_COLOR via supportsColor().
 *
 * Helpers:
 *   out(msg)  — informational stdout line (equivalent to console.log)
 *   err(msg)  — raw stderr line, no prefix (for hint/continuation lines)
 *   note(msg) — advisory stderr line: "summon: note: <msg>"
 *   warn(msg) — warning on stderr: "summon: warning: <msg>"
 *   fail(msg) — branded error to stderr: "summon: error: <msg>" with red ✗ when colors are on
 *
 * note() and err() take `{ routine: true }` for a line that is housekeeping, nothing to act on
 * (D1): the Rex launcher-tab watch reads writingRoutine() and lets that write through, while any
 * unmarked write keeps the launcher tab open.
 *
 * debugLog (SUMMON_DEBUG) and progress/spinner lines are intentionally NOT
 * routed here — they have distinct semantics and are handled in utils.ts /
 * ui/progress.ts (used by both backends) respectively.
 */

import { formatUserError } from "../utils.js";

/**
 * Write an informational message to stdout, followed by a newline.
 * Equivalent to console.log for single-argument plain-string output.
 */
export function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** How a stderr line is classed for the Rex launcher-tab watch (D1). */
export interface StderrOptions {
  /** Housekeeping the user need not read: it does not keep the launcher tab open. */
  routine?: boolean;
}

let routineWrite = false;

/** Whether the stderr write in progress was marked routine at its source (read by the D1 watch). */
export function writingRoutine(): boolean {
  return routineWrite;
}

function writeStderr(text: string, options: StderrOptions | undefined): void {
  if (!options?.routine) {
    process.stderr.write(text);
    return;
  }
  routineWrite = true;
  try {
    process.stderr.write(text);
  } finally {
    routineWrite = false;
  }
}

/** Advisory stderr line: "summon: note: <msg>" (not an error; the command continues). */
export function note(msg: string, options?: StderrOptions): void {
  writeStderr(`summon: note: ${msg}\n`, options);
}

/** Warning on stderr: "summon: warning: <msg>" (UX-M2; not an error, the command continues). */
export function warn(msg: string): void {
  process.stderr.write(`summon: warning: ${msg}\n`);
}

/**
 * Write a raw (unprefixed) message to stderr, followed by a newline.
 * Use for hint/continuation lines that follow a fail(), note() or warn() call,
 * or blank separator lines (pass "").
 */
export function err(msg: string, options?: StderrOptions): void {
  writeStderr(`${msg}\n`, options);
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
