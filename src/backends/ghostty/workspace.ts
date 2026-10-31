/**
 * Ghostty record port (AR-M1): what Summon does with a recorded Ghostty workspace. Liveness comes from the per-launch
 * sidecars (P12, read.ts); focus, inspect and title use the exact native identity the launch captured.
 */
import { existsSync, readdirSync } from "node:fs";
import { focusTerminal, readNativeInventory, titleTerminal } from "./native.js";
import type { NativeFailure } from "../port.js";
import { escapeControlChars } from "../../ui/sanitize.js";
import { launchLiveness, unlinkIgnoringMissing } from "../../status-record.js";
import { isLaunchId, launchArtifactPaths, launchesDir } from "../../launch-identity.js";
import type { ResolvedStatus } from "../../status.js";
import { PROJECT_NAME_RE } from "../../validation.js";
import { printProjectSuggestions } from "../../cli/resolve-target.js";
import { out } from "../../ui/output.js";
import type { WorkspaceBackend } from "../port.js";

/** Resolve a recorded exact UUID without activating or querying the application. */
function resolveWorkspaceTerminal(projectName: string, paneName: string | undefined, status: ResolvedStatus | null): { kind: "target"; terminalId: string } | NativeFailure {
  if (!PROJECT_NAME_RE.test(projectName)) return { kind: "unavailable", code: "missing", reason: "Invalid project name. Run summon inspect <project>." };
  if (status?.backend === "rex") return { kind: "unavailable", code: "missing", reason: `[${projectName}] runs in Rex; its panes are Rex blocks, not Ghostty terminals. Run summon inspect ${projectName}.` };
  if (!status?.native) return { kind: "unavailable", code: "missing", reason: "Exact native identity is unavailable. Select in Ghostty or explicitly relaunch when ready to capture identity; run summon inspect <project>." };
  const terminalId = paneName === undefined ? status.native.rootTerminalId : status.native.panes.find(p => p.name === paneName)?.terminalId;
  if (!terminalId) return { kind: "unavailable", code: "missing", reason: `Unknown pane. Valid panes: ${status.native.panes.map(p => p.name).join(", ")}. Run summon inspect ${projectName}.` };
  return { kind: "target", terminalId };
}

/** Ghostty per-launch files of launches other than the current one whose shell is proven dead (its pid, not its marker). */
function sweepDeadGhosttyLaunches(project: string, currentLaunchId: string | undefined): number {
  let names: string[];
  try {
    names = readdirSync(launchesDir(project));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = /^(.+)\.pid$/.exec(name);
    if (!match || !isLaunchId(match[1]) || match[1] === currentLaunchId) continue;
    const launchId = match[1];
    const paths = launchArtifactPaths(project, launchId);
    if (existsSync(paths.manifest)) continue; // a Rex launch: handled by adoption
    if (launchLiveness(project, launchId) !== "dead") continue;
    if (unlinkIgnoringMissing(paths.pid) && unlinkIgnoringMissing(paths.active)) removed += 1;
  }
  return removed;
}

/** Native failures are observations; they never overwrite root-shell workspace state. */
function inspectGhostty(project: string, status: ResolvedStatus | null, json: boolean): void {
  const missing =
    "Exact native identity is unavailable. Select in Ghostty or explicitly relaunch when ready to capture identity.";
  const inventory = status?.native
    ? readNativeInventory(status.native.panes.map((p) => p.terminalId))
    : undefined;
  const reason = !status?.native
    ? missing
    : inventory?.kind !== "available"
      ? inventory?.reason
      : undefined;
  const panes = (status?.native?.panes ?? []).map((pane) => {
    const observation =
      inventory?.kind === "available"
        ? inventory.panes.find((p) => p.terminalId === pane.terminalId)
        : undefined;
    return {
      name: pane.name,
      terminalId: pane.terminalId,
      pid: observation?.pid ?? null,
      tty: observation?.tty ?? null,
      title: observation?.title ?? null,
      availability: observation ? "available" : "unavailable",
    };
  });
  const available =
    !reason &&
    panes.length > 0 &&
    panes.every((p) => p.availability === "available");
  const explanation =
    reason ??
    (!available
      ? "A recorded pane is closed or unavailable. Inspect in Ghostty; explicitly relaunch when ready to capture new identity."
      : undefined);
  const result = {
    project,
    state: status?.state ?? "stopped", // no record: never launched
    availability: available ? "available" : "unavailable",
    ...(explanation ? { reason: explanation } : {}),
    panes,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${project}: ${result.state} (${result.availability})`);
    for (const pane of panes)
      console.log(
        `  ${pane.name}  ${pane.terminalId}  PID ${pane.pid ?? "UNAVAILABLE"}  ${pane.tty ?? "UNAVAILABLE"}  ${escapeControlChars(pane.title ?? "UNAVAILABLE")}`,
      );
    if (explanation) console.log(explanation);
  }
  if (!status) printProjectSuggestions(project);
  if (!available) process.exit(2);
}

export const GhosttyWorkspace: WorkspaceBackend = {
  id: "ghostty",
  focus(project, status, pane) {
    const target = resolveWorkspaceTerminal(project, pane, status);
    return target.kind === "target" ? focusTerminal(target.terminalId) : target;
  },
  inspect: inspectGhostty,
  title(project, status, scope, operation, pane) {
    const target = resolveWorkspaceTerminal(project, pane, status);
    return target.kind === "target" ? titleTerminal(target.terminalId, scope, operation) : target;
  },
  // No stillRunningNotice: a Ghostty window is not tracked once another launch replaces its record.
  close(project, _record, sweptNote) {
    out(`[${project}] is a Ghostty workspace; nothing to close.${sweptNote}`);
  },
  sweepLaunches: sweepDeadGhosttyLaunches,
  reviewLaunches(project, current) {
    const swept = sweepDeadGhosttyLaunches(project, current ?? undefined);
    if (swept > 0) out(`${swept} stale Ghostty launch file pair${swept === 1 ? "" : "s"} of [${project}] removed.`);
    return swept;
  },
};
