/**
 * progress.ts -- transient progress lines on stdout (UX-L2 #519, UX-M1).
 *
 * Shared by both backends: the Ghostty launch spinner and the Rex launch line. Never written to
 * stderr, so the Rex launcher-tab watch (D1) never counts it as something to read.
 */

import { supportsColor } from "../utils.js";

const LAUNCH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Returns true when the spinner should run in static (non-animating) mode.
 *  Static: NO_COLOR set, SUMMON_NO_SPINNER set, or stdout is not a TTY. */
export function isStaticLaunchSpinner(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env["SUMMON_NO_SPINNER"] !== undefined) return true;
  return !supportsColor();
}

/** One transient stdout line: `show` replaces it, `clear` erases it. */
export interface TransientLine {
  show(label: string): void;
  clear(): void;
}

/**
 * A transient status line on stdout, shown only where the launch spinner animates (see
 * `isStaticLaunchSpinner`); elsewhere both calls write nothing. Never written to stderr.
 */
export function transientLine(): TransientLine {
  let shown = false;
  return {
    show(label) {
      if (isStaticLaunchSpinner()) return;
      process.stdout.write(`${shown ? "\r\x1b[K" : ""}${LAUNCH_SPINNER_FRAMES[0]} ${label}`);
      shown = true;
    },
    clear() {
      if (!shown) return;
      process.stdout.write("\r\x1b[K");
      shown = false;
    },
  };
}
