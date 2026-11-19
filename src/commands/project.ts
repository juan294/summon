import { existsSync } from "node:fs";
import {
  addProject,
  getProject,
  removeProject,
  listProjects,
} from "../config.js";
import { withTrustPrompt } from "../trust.js";
import { promptUser, exitWithUsageHint, PromptCancelled, CANCELLED_EXIT_CODE } from "../utils.js";
import { fail, warn } from "../ui/output.js";
import { unverifiedMessage } from "../status-record.js";
import { parseMenuNumber, projectArgOrExit } from "../validation.js";
import type { ProjectRow } from "../monitor.js";
import { validateProjectNameOrExit } from "../validation.js";
// PE-H1 (#473): Re-export from new leaf module for backward compatibility with callers.
export { resolveTargetDirectory, expandHome } from "../cli/resolve-target.js";
import { expandHome, printProjectSuggestions } from "../cli/resolve-target.js";
import type { CommandContext } from "./types.js";
import { escapeControlChars } from "../ui/sanitize.js";
import { sym } from "../ui/symbols.js";

/** Compute column widths from actual data lengths (UX-H6). */
function computeColumnWidths(rows: { name: string }[]): { nameWidth: number } {
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  return { nameWidth };
}

export async function handleAddCommand({ args }: CommandContext): Promise<void> {
  const [name, path] = args;
  if (!name || !path) {
    exitWithUsageHint("Usage: summon add <name> <path>");
  }
  validateProjectNameOrExit(name);
  const resolved = expandHome(path);
  const pathExists = existsSync(resolved);
  if (!pathExists) {
    warn(`path does not exist: ${resolved}`);
  }
  addProject(name, resolved);
  // UX-M1 (#395): distinguish between clean registration and registration with a warning
  if (pathExists) {
    console.log(`${sym.ok} Registered: ${name} → ${resolved}`);
  } else {
    console.log(`${sym.warn} Registered with warning: ${name} → ${resolved} (path does not exist)`);
  }
}

export async function handleRemoveCommand({ args }: CommandContext): Promise<void> {
  const [name] = args;
  if (!name) {
    exitWithUsageHint("Usage: summon remove <name>");
  }
  const existed = removeProject(name);
  if (existed) {
    console.log(`${sym.ok} Removed: ${name}`);
    return;
  }

  fail(`Project not found: ${name}`);
  printProjectSuggestions(name);
  console.error("Run 'summon list' to see registered projects.");
  process.exit(1);
}

/**
 * `summon list`, or `summon list --json` for the Rex workspace picker: one JSON array of `{ name, directory }` in
 * registry order, names as read (the picker validates them before offering).
 */
export async function handleListCommand({ values }: Pick<CommandContext, "values"> = { values: {} }): Promise<void> {
  const projects = listProjects();
  if (values.json === true) {
    const rows = [...projects].map(([name, directory]) => ({ name, directory }));
    process.stdout.write(`${JSON.stringify(rows)}\n`);
    return;
  }
  if (projects.size === 0) {
    console.log("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
    return;
  }

  console.log("Registered projects:");
  for (const [name, path] of projects) {
    console.log(`  ${name} → ${path}`);
  }
}

/**
 * D1: switching to a running workspace of the backend this shell launches in behaves as a launch's switch does (Rex
 * inside Rex closes the launcher tab). Returns the step to run after a successful switch (the backend's output watch
 * starts now, before the switch prints anything).
 */
async function watchSwitch(project: string): Promise<() => void> {
  const { readStatusRecord } = await import("../status-record.js");
  const record = readStatusRecord(project);
  if (!record) return () => {};
  const { resolveBackendForLaunch } = await import("../backend.js");
  // The focus that follows reads the status, which looks the `rex` binary up once per process: detection shares that
  // lookup. Its `searched` list is only printed by a failed detection's notice, which this watch never shows.
  const { rexBinaryPath } = await import("../status.js");
  const detection = resolveBackendForLaunch({ discoverRex: () => ({ path: rexBinaryPath(), searched: [] }) });
  if (!detection.ok || detection.backend !== (record.backend ?? "ghostty")) return () => {};
  const { createTerminalBackend } = await import("../backends/select.js");
  const backend = await createTerminalBackend(detection);
  backend.watchOutput?.();
  return () => backend.afterSuccess?.();
}

/**
 * Focus a live workspace, launch a stopped one, refuse an unknown one: the picker and `open <project>` agree.
 * A launch offers to trust a new or changed `.summon` on a terminal, as a direct launch does (UX-M4).
 */
async function openRow(row: ProjectRow, overrides: CommandContext["overrides"]): Promise<void> {
  const { isLiveState } = await import("../monitor.js");
  // Plan P10: an unknown workspace is never launched over or focused.
  if (row.state === "unknown") {
    fail(unverifiedMessage(row.name, row.reason));
    process.exit(2);
  }
  if (isLiveState(row.state)) {
    // Loaded here so `list`, `add` and `remove` never load the status reader or the record backends (PE-L2).
    const { focusWorkspace } = await import("../workspace-focus.js");
    const armClose = await watchSwitch(row.name);
    const result = focusWorkspace(row.name, undefined, row.directory);
    if (result.kind !== "focused") { fail(result.reason); process.exit(2); }
    console.log(`Switched to [${row.name}]`);
    armClose();
    return;
  }
  await launchProject(row.directory, overrides);
}

async function launchProject(directory: string, overrides: CommandContext["overrides"]): Promise<void> {
  // AR-M2: only a launch loads the launcher; `list`, `add`, `remove` and a focus do not.
  const { launch } = await import("../launcher.js");
  await withTrustPrompt(() => launch(directory, overrides));
}

export async function handleOpenCommand({ args, overrides }: CommandContext): Promise<void> {
  if (args.length > 0) {
    const target = projectArgOrExit(args, 1, "Usage: summon open [project]");
    if (overrides.dryRun) {
      const directory = getProject(target);
      if (directory !== undefined) return launchProject(directory, overrides);
    } else {
      const { loadProjectRow } = await import("../monitor.js");
      const row = loadProjectRow(target);
      if (row) return openRow(row, overrides);
    }
    fail(`"${target}" is not a registered project. See available: summon list`);
    printProjectSuggestions(target);
    process.exit(1);
  }

  if (overrides.dryRun) {
    // Listing live rows reconciles records. A preview selects its directory entirely from disk.
    const { recordedProjectDirectories } = await import("../status.js");
    const projects = listProjects();
    const choices = [...projects, ...recordedProjectDirectories().filter(([name]) => !projects.has(name))];
    if (choices.length === 0) noProjects();
    console.log("  summon — select a project to preview\n");
    for (const [i, [name, directory]] of choices.entries()) console.log(`  ${i + 1}  ${escapeControlChars(name)} → ${escapeControlChars(directory)}`);
    const [, directory] = choices[await pickProjectIndex(choices.length)]!;
    return launchProject(directory, overrides);
  }

  const { loadProjectRows, renderRow, isLiveState } = await import("../monitor.js");

  const rows = loadProjectRows();
  if (rows.length === 0) noProjects();

  const activeCount = rows.filter((row) => isLiveState(row.state)).length;
  const { nameWidth } = computeColumnWidths(rows);
  const colPad = " ".repeat(Math.max(0, nameWidth - "name".length));
  console.log(`  summon — select a project${colPad}  ${activeCount} active / ${rows.length} total\n`);
  const width = process.stdout.columns || 80;
  const numWidth = String(rows.length).length;
  const prefixWidth = 2 + numWidth + 2; // "  N  "
  for (const [index, row] of rows.entries()) {
    const num = String(index + 1).padStart(numWidth);
    console.log(`  ${num}  ${renderRow(row, width - prefixWidth, false, { leadingPad: false })}`);
  }
  console.log(`(↑↓/jk in 'summon status' for interactive mode)`);

  await openRow(rows[await pickProjectIndex(rows.length)]!, overrides);
}

function noProjects(): never {
  fail("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
  process.exit(1);
}

async function pickProjectIndex(count: number): Promise<number> {
  while (true) {
    let answer: string;
    try {
      // UX-M2 (#475): Include cancel affordance in prompt.
      answer = await promptUser(`Select [1-${count}] (0 to cancel): `);
    } catch (err) {
      if (err instanceof PromptCancelled) {
        process.exit(CANCELLED_EXIT_CODE);
      }
      throw err;
    }
    const num = parseMenuNumber(answer);
    // UX-M2 (#475): 0 cancels immediately.
    if (num === 0) {
      console.log("Cancelled.");
      process.exit(CANCELLED_EXIT_CODE);
    }
    const index = num - 1;
    if (Number.isNaN(index) || index < 0 || index >= count) {
      fail(`Invalid selection. Enter a number between 1 and ${count}.`);
      continue;
    }
    return index;
  }
}
