import type { CommandContext } from "./types.js";
import { readStatus } from "../status.js";
import { focusWorkspace, resolveWorkspaceTerminal } from "../launcher.js";
import { readNativeInventory, titleTerminal, validateTitleText } from "../ghostty-native.js";
import { validateProjectNameOrExit } from "../validation.js";
import { escapeControlChars } from "../pane-inventory.js";
import { inspectRex, titleRex } from "../backends/rex/status.js";
import { rexCommandGate } from "../status.js";
import type { ResolvedStatus } from "../status.js";
import { exitWithUsageHint } from "../utils.js";
import { fail } from "../ui/output.js";

function projectArg(args: string[], max: number, usage: string): string {
  if (!args[0] || args.length > max) exitWithUsageHint(usage);
  validateProjectNameOrExit(args[0]);
  return args[0];
}
export async function handleFocusCommand({
  args,
}: CommandContext): Promise<void> {
  const project = projectArg(args, 2, "Usage: summon focus <project> [pane]");
  const result = focusWorkspace(project, args[1]);
  if (result.kind !== "focused") {
    fail(result.reason);
    process.exit(2);
  }
  console.log(`Focused [${project}]${args[1] ? ` ${args[1]}` : ""}`);
}

/** Native failures are observations; they never overwrite root-shell workspace state. */
export async function handleInspectCommand({
  args,
  values,
}: CommandContext): Promise<void> {
  const project = projectArg(
    args,
    1,
    "Usage: summon inspect <project> [--json]",
  );
  const status = readStatus(project);
  if (status?.backend === "rex") return inspectRexWorkspace(project, status, values.json === true);
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
    state: status?.state ?? "unknown",
    availability: available ? "available" : "unavailable",
    ...(explanation ? { reason: explanation } : {}),
    panes,
  };
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${project}: ${result.state} (${result.availability})`);
    for (const pane of panes)
      console.log(
        `  ${pane.name}  ${pane.terminalId}  PID ${pane.pid ?? "UNAVAILABLE"}  ${pane.tty ?? "UNAVAILABLE"}  ${escapeControlChars(pane.title ?? "UNAVAILABLE")}`,
      );
    if (explanation) console.log(explanation);
  }
  if (!available) process.exit(2);
}



/** `summon inspect` for a Rex record: block ids instead of terminal ids; the tty is never available. */
function inspectRexWorkspace(project: string, status: ResolvedStatus, json: boolean): void {
  const gate = rexCommandGate(project, status);
  const inspected = gate.ok
    ? inspectRex(gate.cli, gate.identity, status.panes, project, gate.liveBlocks)
    : { availability: "unavailable" as const, reason: gate.failure.reason, panes: [] };
  const available = inspected.availability === "available";
  const reason = inspected.reason;
  const result = {
    project,
    state: status.state,
    backend: "rex",
    availability: available ? "available" : "unavailable",
    ...(reason ? { reason } : {}),
    panes: inspected.panes,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${project}: ${result.state} (${result.availability}, Rex)`);
    for (const pane of inspected.panes)
      console.log(`  ${pane.name}  ${pane.blockId ?? "UNVERIFIED"}  PID ${pane.pid ?? "UNAVAILABLE"}  UNAVAILABLE  ${escapeControlChars(pane.title ?? "UNAVAILABLE")}`);
    if (reason) console.log(reason);
  }
  if (!available) process.exit(2);
}

export async function handleTitleCommand({
  args,
  values,
}: CommandContext): Promise<void> {
  const project = projectArg(
    args,
    2,
    "Usage: summon title <project> [pane] [--set <text> | --reset]",
  );
  if (values.set !== undefined && values.reset)
    exitWithUsageHint("--set and --reset are mutually exclusive.");
  if (values.set !== undefined) {
    const invalid = validateTitleText(values.set);
    if (invalid) exitWithUsageHint(invalid);
  }
  const operation =
    values.set !== undefined
      ? { kind: "set" as const, text: values.set }
      : values.reset
        ? { kind: "reset" as const }
        : { kind: "read" as const };
  const scope = args[1] === undefined ? "tab" : "pane";
  const status = readStatus(project);
  let result;
  if (status?.backend === "rex") {
    const gate = rexCommandGate(project, status);
    if (!gate.ok) {
      fail(gate.failure.reason);
      process.exit(2);
    }
    result = titleRex(gate.cli, gate.identity, status.panes, project, scope, operation, args[1]);
  } else {
    const target = resolveWorkspaceTerminal(project, args[1], status);
    if (target.kind !== "target") {
      fail(target.reason);
      process.exit(2);
    }
    result = titleTerminal(target.terminalId, scope, operation);
  }
  if (result.kind !== "title") {
    fail(result.reason);
    process.exit(2);
  }
  console.log(
    result.override === ""
      ? "(no title override)"
      : escapeControlChars(result.override),
  );
}
