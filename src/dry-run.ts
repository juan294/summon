/**
 * Dry-run output for both backends (AR-M2, extracted from launcher.ts): the layout header, the shared extras, then what
 * the backend renders (AR-M1: the AppleScript a Ghostty launch would run, or the `session.create` request a Rex launch
 * would send) and its notes. Runs no terminal command.
 */
import type { LayoutPlan } from "./layout.js";
import type { TreeLayoutPlan } from "./tree.js";
import type { BackendId } from "./backend.js";
import type { BackendLaunchContext, BackendLayout, TerminalBackend } from "./backends/port.js";
import { getPresetConfigPath } from "./starship.js";
import { note } from "./ui/output.js";

/** What a dry run prints from: the launch context, the backend and the Starship preset. */
export interface DryRunInputs {
  ctx: BackendLaunchContext;
  backend: TerminalBackend;
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

/** Print the dry run: the layout headers, the shared extras, then what the backend would run, then its notes. */
function printDryRun(headerLines: string[], layout: BackendLayout, { ctx, backend, starshipPreset }: DryRunInputs): void {
  const starshipConfigPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
  appendDryRunExtras(headerLines, starshipPreset, starshipConfigPath, backend.id, ctx.launchId);
  const { body, notes } = backend.dryRun(layout, ctx, starshipConfigPath, headerLines);
  console.log(`${headerLines.join("\n")}\n${body}`);
  for (const line of notes) note(line);
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
  printDryRun(headerLines, { kind: "tree", plan: treePlan }, inputs);
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
  printDryRun(headerLines, { kind: "traditional", plan }, inputs);
}
