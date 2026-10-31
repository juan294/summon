import type { CommandContext } from "./types.js";
import { fail, note, out } from "../ui/output.js";
import { projectArgOrExit } from "../validation.js";
import { readStatusRecord } from "../status-record.js";
import { printProjectSuggestions } from "../cli/resolve-target.js";
import { allWorkspaceBackends, workspaceBackendFor } from "../backends/workspace.js";

/**
 * `summon clean <project>` (plan P17): the record's own backend closes its workspace when Summon's own check shows it
 * empty (Rex; a Ghostty window is never closed). `--orphans`: every backend reviews its earlier launches of the project
 * (P13 late adoption in command form). Each backend first removes its stale launch files (AR-M1: the steps live under
 * src/backends/).
 */

function sweptLaunches(project: string, current: string | undefined): number {
  return allWorkspaceBackends().reduce((total, backend) => total + (backend.sweepLaunches?.(project, current) ?? 0), 0);
}

async function cleanCurrent(project: string): Promise<void> {
  const record = readStatusRecord(project);
  if (!record) {
    fail(`[${project}] has no workspace record; nothing to clean.`);
    printProjectSuggestions(project);
    process.exit(2);
  }
  const swept = sweptLaunches(project, record.launchId);
  const sweptNote = swept > 0 ? ` ${swept} stale launch file pair${swept === 1 ? "" : "s"} removed.` : "";
  workspaceBackendFor(record.backend).close(project, record, sweptNote);
}

async function cleanOrphans(project: string): Promise<void> {
  const backends = allWorkspaceBackends();
  for (const backend of backends) backend.prepareReview?.();
  const current = readStatusRecord(project);
  if (current && !current.launchId) {
    note(`${project} has a record from an older Summon; run summon ${project} to replace it, then review its launches`);
    return;
  }
  for (const backend of backends) backend.adoptBeforeReview?.(project);
  const gen = readStatusRecord(project)?.launchId ?? null;
  let reported = 0;
  for (const backend of backends) reported += backend.reviewLaunches?.(project, gen) ?? 0;
  if (reported === 0) out(`No earlier launches of [${project}] to review.`);
}

export async function handleCleanCommand({ args, values }: CommandContext): Promise<void> {
  const project = projectArgOrExit(args, 1, "Usage: summon clean <project> [--orphans]");
  if (values.orphans) await cleanOrphans(project);
  else await cleanCurrent(project);
}
