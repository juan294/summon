/**
 * Focus and terminal resolution for a recorded workspace (AR-M2, moved from launcher.ts): `focus`, `title` and the
 * `open` and monitor focus paths use it without loading the launch path. Never launches.
 */
import { readStatus, rexCommandGate } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { focusRex } from "./backends/rex/status.js";
import { focusTerminal } from "./ghostty-native.js";
import type { FocusResult, NativeFailure } from "./ghostty-native.js";
import { PROJECT_NAME_RE } from "./validation.js";

/** Resolve a recorded exact UUID without activating or querying the application. */
export function resolveWorkspaceTerminal(projectName: string, paneName?: string, status?: ResolvedStatus | null): { kind: "target"; terminalId: string } | NativeFailure {
  if (!PROJECT_NAME_RE.test(projectName)) return { kind: "unavailable", code: "missing", reason: "Invalid project name. Run summon inspect <project>." };
  if (status === undefined) status = readStatus(projectName, { reconcile: true });
  if (status?.backend === "rex") return { kind: "unavailable", code: "missing", reason: `[${projectName}] runs in Rex; its panes are Rex blocks, not Ghostty terminals. Run summon inspect ${projectName}.` };
  if (!status?.native) return { kind: "unavailable", code: "missing", reason: "Exact native identity is unavailable. Select in Ghostty or explicitly relaunch when ready to capture identity; run summon inspect <project>." };
  const terminalId = paneName === undefined ? status.native.rootTerminalId : status.native.panes.find(p => p.name === paneName)?.terminalId;
  if (!terminalId) return { kind: "unavailable", code: "missing", reason: `Unknown pane. Valid panes: ${status.native.panes.map(p => p.name).join(", ")}. Run summon inspect ${projectName}.` };
  return { kind: "target", terminalId };
}

/**
 * Focus only a recorded exact identity. Legacy/stale records never launch implicitly. Under Rex
 * the shared gate refuses `unknown` and `stopped` (plan P10) and the app attached to the
 * caller's session is preferred (P7).
 */
export function focusWorkspace(projectName: string, paneName?: string): FocusResult {
  const status = PROJECT_NAME_RE.test(projectName) ? readStatus(projectName, { reconcile: true }) : null;
  if (status?.backend === "rex") {
    const gate = rexCommandGate(projectName, status);
    if (!gate.ok) return gate.failure;
    // No detection row here (focus does not launch): REX_SESSION is set by Rex terminals only, so it is the caller's session when present.
    return focusRex(gate.cli, gate.identity, status.panes, projectName, gate.liveBlocks, paneName, process.env["REX_SESSION"]);
  }
  const target = resolveWorkspaceTerminal(projectName, paneName, status);
  return target.kind === "target" ? focusTerminal(target.terminalId) : target;
}
