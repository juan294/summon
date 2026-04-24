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
import { promptUser, exitWithUsageHint } from "../utils.js";
import { validateProjectNameOrExit } from "../validation.js";
import type { CommandContext } from "./types.js";

function expandHome(path: string): string {
  return resolve(path.replace(/^~/, homedir()));
}

export async function handleAddCommand({ args }: CommandContext): Promise<void> {
  const [name, path] = args;
  if (!name || !path) {
    exitWithUsageHint("Usage: summon add <name> <path>");
  }
  validateProjectNameOrExit(name);
  const resolved = expandHome(path);
  if (!existsSync(resolved)) {
    console.warn(`Warning: path does not exist: ${resolved}`);
  }
  addProject(name, resolved);
  console.log(`Registered: ${name} → ${resolved}`);
}

export async function handleRemoveCommand({ args }: CommandContext): Promise<void> {
  const [name] = args;
  if (!name) {
    exitWithUsageHint("Usage: summon remove <name>");
  }
  const existed = removeProject(name);
  if (existed) {
    console.log(`Removed: ${name}`);
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
  console.log(`  summon — select a project${" ".repeat(20)}${activeCount} active / ${rows.length} total\n`);
  const width = process.stdout.columns || 80;
  for (const [index, row] of rows.entries()) {
    console.log(`  ${index + 1}  ${renderRow(row, width - 5, false).trimStart()}`);
  }
  console.log();

  let selectedRow: (typeof rows)[number] | undefined;
  while (selectedRow === undefined) {
    const answer = await promptUser(`Select [1-${rows.length}]: `);
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
