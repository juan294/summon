/**
 * The launch-side backend for a detected context (AR-M1): the one place that maps a `LaunchContext` to its
 * `TerminalBackend`. The launcher, `summon session` and `open` dispatch through the result.
 *
 * The Rex backend is loaded only when Rex is detected (PE-L2): a Ghostty launch never loads the Rex launch, app,
 * status or launcher-tab modules.
 */
import { callerRexSession } from "../backend.js";
import type { LaunchContext } from "../backend.js";
import { GhosttyBackend } from "./ghostty/backend.js";
import type { TerminalBackend } from "./port.js";

export interface TerminalBackendOptions {
  /** `--new-window` given on the command line (Rex: a fresh session, the P2 switch is skipped). */
  newWindow?: boolean;
}

export async function createTerminalBackend(context: LaunchContext, options: TerminalBackendOptions = {}): Promise<TerminalBackend> {
  if (context.backend === "ghostty") return GhosttyBackend;
  const { createRexBackend } = await import("./rex/backend.js");
  return createRexBackend(context, { callerSession: callerRexSession(context), newWindow: options.newWindow === true });
}
