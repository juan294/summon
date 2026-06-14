import { existsSync } from "node:fs";
import {
  addProject,
  removeProject,
  listProjects,
} from "../config.js";
import { focusWorkspace, launch } from "../launcher.js";
import { promptUser, exitWithUsageHint, PromptCancelled } from "../utils.js";
import { fail } from "../ui/output.js";
import { validateProjectNameOrExit } from "../validation.js";
// PE-H1 (#473): Re-export from new leaf module for backward compatibility with callers.
export { resolveTargetDirectory, expandHome } from "../cli/resolve-target.js";
import { expandHome } from "../cli/resolve-target.js";
import type { CommandContext } from "./types.js";
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
    console.warn(`${sym.warn} Warning: path does not exist: ${resolved}`);
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
  console.error("Run 'summon list' to see registered projects.");
  process.exit(1);
}

export async function handleListCommand(): Promise<void> {
  const projects = listProjects();
  if (projects.size === 0) {
    console.log("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
    return;
  }

  console.log("Registered projects:");
  for (const [name, path] of projects) {
    console.log(`  ${name} → ${path}`);
  }
}

export async function handleOpenCommand({ overrides }: CommandContext): Promise<void> {
  const { loadProjectRows, renderRow } = await import("../monitor.js");

  const rows = loadProjectRows();
  if (rows.length === 0) {
    fail("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
    process.exit(1);
  }

  const activeCount = rows.filter((row) => row.state === "active" || row.state === "active-long").length;
  const { nameWidth } = computeColumnWidths(rows);
  const colPad = " ".repeat(Math.max(0, nameWidth - "name".length));
  console.log(`  summon — select a project${colPad}  ${activeCount} active / ${rows.length} total\n`);
  const width = process.stdout.columns || 80;
  const numWidth = String(rows.length).length;
  const prefixWidth = 2 + numWidth + 2; // "  N  "
  for (const [index, row] of rows.entries()) {
    const num = String(index + 1).padStart(numWidth);
    console.log(`  ${num}  ${renderRow(row, width - prefixWidth, false).trimStart()}`);
  }
  console.log(`(↑↓/jk in 'summon status' for interactive mode)`);

  let selectedRow: (typeof rows)[number] | undefined;
  while (selectedRow === undefined) {
    let answer: string;
    try {
      // UX-M2 (#475): Include cancel affordance in prompt.
      answer = await promptUser(`Select [1-${rows.length}] (0 to cancel): `);
    } catch (err) {
      if (err instanceof PromptCancelled) {
        process.exit(130);
      }
      throw err;
    }
    const num = parseInt(answer, 10);
    // UX-M2 (#475): 0 cancels immediately.
    if (num === 0) {
      console.log("Cancelled.");
      process.exit(0);
    }
    const index = num - 1;
    if (Number.isNaN(index) || index < 0 || index >= rows.length) {
      fail(`Invalid selection. Enter a number between 1 and ${rows.length}.`);
      continue;
    }
    selectedRow = rows[index];
  }

  if (selectedRow.state === "active" || selectedRow.state === "active-long") {
    focusWorkspace(selectedRow.name);
    console.log(`Switched to [${selectedRow.name}]`);
    return;
  }

  await launch(selectedRow.directory, overrides);
}

