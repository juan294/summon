import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
} from "../config.js";
import { focusWorkspace, launch } from "../launcher.js";
import { promptUser, exitWithUsageHint, PromptCancelled } from "../utils.js";
import { validateProjectNameOrExit } from "../validation.js";
import type { CommandContext } from "./types.js";

// Output helpers for consistent prefixes (UX-H5)
const sym = {
  ok: "✓",
  warn: "!",
  err: "✗",
  info: "→",
} as const;

function expandHome(path: string): string {
  return resolve(path.replace(/^~/, homedir()));
}

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

  console.error(`Error: Project not found: ${name}`);
  console.error("Run 'summon list' to see registered projects.");
  process.exit(1);
}

export async function handleListCommand(): Promise<void> {
  const projects = listProjects();
  if (projects.size === 0) {
    console.log("No projects registered. Use: summon add <name> <path>");
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
    console.error("Error: No projects registered. Use: summon add <name> <path>");
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
      answer = await promptUser(`Select [1-${rows.length}]: `);
    } catch (err) {
      if (err instanceof PromptCancelled) {
        process.exit(130);
      }
      throw err;
    }
    const index = parseInt(answer, 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= rows.length) {
      console.error(`Invalid selection. Enter a number between 1 and ${rows.length}.`);
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

export function resolveTargetDirectory(target: string): string {
  if (target === "." || target === "..") {
    return resolve(target);
  }
  if (target.startsWith("/") || target.startsWith("~")) {
    return expandHome(target);
  }
  if (target.startsWith("./") || target.startsWith("../") || target.includes("/")) {
    return resolve(target);
  }

  const projectPath = getProject(target);
  if (!projectPath) {
    console.error(`Error: Unknown project: ${target}`);
    console.error(`Register it with: summon add ${target} /path/to/project`);
    console.error("Or see available:  summon list");
    process.exit(1);
  }

  return projectPath;
}
