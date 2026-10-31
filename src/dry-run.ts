/**
 * Dry-run output for both backends (AR-M2, extracted from launcher.ts): the layout header, the shared extras, then what
 * the backend renders (AR-M1: the AppleScript a Ghostty launch would run, or the `session.create` request a Rex launch
 * would send) and its notes. Runs no terminal command.
 */
import type { PlannedLayout } from "./tree.js";
import type { BackendLaunchContext, TerminalBackend } from "./backends/port.js";
import { getPresetConfigPath } from "./starship.js";
import { note } from "./ui/output.js";

/** What a dry run prints from: the launch context, the backend and the Starship preset. */
export interface DryRunInputs {
  ctx: BackendLaunchContext;
  backend: TerminalBackend;
  starshipPreset: string | undefined;
}

/**
 * Print the dry run: the layout headers, the Starship preset, the backend and the launch identity, then what the
 * backend would run, then its notes.
 */
export function printDryRun(layout: PlannedLayout, { ctx, backend, starshipPreset }: DryRunInputs): void {
  const headerLines = ["-- summon dry-run", layoutHeader(layout), `-- Target: ${ctx.targetDir}`];
  const starshipConfigPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
  if (starshipPreset) headerLines.push(`-- Starship preset: ${starshipPreset} (${starshipConfigPath})`);
  headerLines.push(`-- Backend: ${backend.id}`);
  headerLines.push(`-- Launch: ${ctx.launchId}`);
  const { body, notes } = backend.dryRun(layout, ctx, starshipConfigPath, headerLines);
  console.log(`${headerLines.join("\n")}\n${body}`);
  for (const line of notes) note(line);
}

/** The `-- Layout:` header of either layout kind. */
function layoutHeader(layout: PlannedLayout): string {
  if (layout.kind === "tree") {
    const paneCount = layout.plan.leaves.length;
    return `-- Layout: tree layout, ${paneCount} ${paneCount === 1 ? "pane" : "panes"}`;
  }
  const plan = layout.plan;
  const totalPanes = plan.leftColumnCount + plan.rightColumnEditorCount;
  return `-- Layout: ${totalPanes} editor ${totalPanes === 1 ? "pane" : "panes"}, editor=${plan.editor}, sidebar=${plan.sidebarCommand}, shell=${plan.hasShell}`;
}
