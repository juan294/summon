/**
 * The launch-side backend for a detected context (AR-M1): the one place that maps a `LaunchContext` to its
 * `TerminalBackend`. The launcher, `summon session` and `open` dispatch through the result.
 */
import { callerRexSession } from "../backend.js";
import type { LaunchContext } from "../backend.js";
import { GhosttyBackend } from "./ghostty.js";
import type { TerminalBackend } from "./port.js";
import { createRexBackend } from "./rex/backend.js";

export interface TerminalBackendOptions {
  /** `--new-window` given on the command line (Rex: a fresh session, the P2 switch is skipped). */
  newWindow?: boolean;
}

export function createTerminalBackend(context: LaunchContext, options: TerminalBackendOptions = {}): TerminalBackend {
  if (context.backend === "ghostty") return GhosttyBackend;
  return createRexBackend(context, { callerSession: callerRexSession(context), newWindow: options.newWindow === true });
}
