import type { CommandContext } from "./types.js";
import { readStatus } from "../status.js";
import { focusWorkspace } from "../launcher.js";
import { readNativeInventory } from "../ghostty-native.js";
import { validateProjectNameOrExit } from "../validation.js";
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
        `  ${pane.name}  ${pane.terminalId}  PID ${pane.pid ?? "UNAVAILABLE"}  ${pane.tty ?? "UNAVAILABLE"}  ${displayText(pane.title ?? "UNAVAILABLE")}`,
      );
    if (explanation) console.log(explanation);
  }
  if (!available) process.exit(2);
}

/** Native titles are process-controlled text; terminal table output cannot contain controls. */
function displayText(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex -- display native titles without terminal control effects
    /[\x00-\x1f\x7f-\x9f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
