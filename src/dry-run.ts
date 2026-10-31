/**
 * Dry-run output for both backends (AR-M2, extracted from launcher.ts): the layout header, the shared extras, then the
 * AppleScript a Ghostty launch would run or the `session.create` request a Rex launch would send. Runs no terminal command.
 */
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import type { LayoutPlan } from "./layout.js";
import type { PlannedLayout, TreeLayoutPlan } from "./tree.js";
import { readStatusRecord } from "./status-record.js";
import type { BackendId, LaunchContext } from "./backend.js";
import { ghosttyCommandEntries } from "./backends/ghostty.js";
import type { BackendLaunchContext } from "./backends/ghostty.js";
import { buildSessionCreateRequest } from "./backends/rex/layout.js";
import type { SessionCreateInput } from "./backends/rex/layout.js";
import { getPresetConfigPath } from "./starship.js";
import { commandExecutable } from "./command-spec.js";
import { COMMAND_FAILURE_REASONS, checkCommand } from "./command-install.js";
import { note } from "./ui/output.js";

/** What a dry run prints from: the launch context, the detected backend and the Starship preset. */
export interface DryRunInputs {
  ctx: BackendLaunchContext;
  launchContext: LaunchContext;
  starshipPreset: string | undefined;
}

/** Append shared optional dry-run header lines (starship preset) plus the backend and launch identity. */
function appendDryRunExtras(
  headerLines: string[],
  starshipPreset: string | undefined,
  dryRunStarshipPath: string | null,
  backend: BackendId,
  launchId: string,
): void {
  if (starshipPreset) {
    headerLines.push(`-- Starship preset: ${starshipPreset} (${dryRunStarshipPath})`);
  }
  headerLines.push(`-- Backend: ${backend}`);
  headerLines.push(`-- Launch: ${launchId}`);
}

/**
 * Rex dry run (plan P2, Phase 2): the `session.create` request a real run would send, with
 * the pane order its `block_ids` arrive in on the header. A recorded Rex workspace is noted,
 * never switched to or probed: a dry run runs no Rex command.
 */
function rexDryRunBody(headerLines: string[], layout: SessionCreateInput["layout"], ctx: BackendLaunchContext, starshipConfigPath: string | null, server: string): string {
  const project = ctx.projectName;
  const record = readStatusRecord(project);
  if (record?.backend === "rex") {
    const session = record.rex?.sessionId ?? "session id unknown";
    headerLines.push(`-- Note: ${project} is recorded as a Rex workspace (${session}); while it is running, a real run switches to it instead of creating this one`);
  }
  const { request, paneOrder } = buildSessionCreateRequest({
    layout,
    targetDir: ctx.targetDir,
    project,
    launchId: ctx.launchId,
    envVars: ctx.envVars,
    starshipConfigPath,
    onStop: ctx.onStop,
    layoutLabel: ctx.layoutLabel,
  });
  headerLines.push(`-- Server: ${server}`);
  headerLines.push(`-- Pane order (block_ids): ${paneOrder.join(", ")}`);
  return JSON.stringify(request, null, 2);
}

/** Print the dry run: the layout headers, the shared extras, then what the detected backend would run. */
function printDryRun(
  headerLines: string[],
  layout: SessionCreateInput["layout"],
  { ctx, launchContext, starshipPreset }: DryRunInputs,
  ghosttyScript: (starshipConfigPath: string | null) => string,
): void {
  const starshipConfigPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
  appendDryRunExtras(headerLines, starshipPreset, starshipConfigPath, launchContext.backend, ctx.launchId);
  const body = launchContext.backend === "rex"
    ? rexDryRunBody(headerLines, layout, ctx, starshipConfigPath, launchContext.server)
    : ghosttyScript(starshipConfigPath);
  console.log(`${headerLines.join("\n")}\n${body}`);
  // Rex does not resolve commands before launch (plan D5), so only a Ghostty dry run checks them.
  if (launchContext.backend !== "rex") {
    for (const line of dryRunCommandNotes(layout)) note(line);
  }
}

/**
 * One line per executable a real Ghostty launch would not resolve, without prompting or
 * installing. A missing command with a known install method gets an install offer, not a stop.
 */
function dryRunCommandNotes(layout: PlannedLayout): string[] {
  const notes: string[] = [];
  const checked = new Set<string>();
  for (const { key, pane, command } of ghosttyCommandEntries(layout)) {
    const executable = commandExecutable(command);
    if (!executable || checked.has(executable)) continue;
    checked.add(executable);
    const check = checkCommand(executable);
    if ("resolved" in check) continue;
    const label = pane ? `pane \`${pane}\`` : `\`${key}\``;
    const outcome = check.install ? "a real launch offers to install it" : "a real launch stops here";
    notes.push(`${label}: \`${executable}\` ${COMMAND_FAILURE_REASONS[check.failure]}; ${outcome}.`);
  }
  return notes;
}

/** Print a tree layout's dry run. */
export function printTreeDryRun(treePlan: TreeLayoutPlan, inputs: DryRunInputs): void {
  const { ctx } = inputs;
  const paneCount = treePlan.leaves.length;
  const headerLines = [
    "-- summon dry-run",
    `-- Layout: tree layout, ${paneCount} ${paneCount === 1 ? "pane" : "panes"}`,
    `-- Target: ${ctx.targetDir}`,
  ];
  printDryRun(headerLines, { kind: "tree", plan: treePlan }, inputs, (starshipConfigPath) =>
    generateTreeAppleScript(treePlan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId));
}

/** Print a traditional layout's dry run. */
export function printTraditionalDryRun(plan: LayoutPlan, inputs: DryRunInputs): void {
  const { ctx } = inputs;
  const totalPanes = plan.leftColumnCount + plan.rightColumnEditorCount;
  const headerLines = [
    "-- summon dry-run",
    `-- Layout: ${totalPanes} editor ${totalPanes === 1 ? "pane" : "panes"}, editor=${plan.editor}, sidebar=${plan.sidebarCommand}, shell=${plan.hasShell}`,
    `-- Target: ${ctx.targetDir}`,
  ];
  printDryRun(headerLines, { kind: "traditional", plan }, inputs, (starshipConfigPath) =>
    generateAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId));
}
