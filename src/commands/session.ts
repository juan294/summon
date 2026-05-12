import { launch } from "../launcher.js";
import { listProjects, getProject } from "../config.js";
import {
  listSessions,
  readSession,
  writeSession,
  deleteSession,
  isValidSessionName,
} from "../sessions.js";
import { exitWithUsageHint, getErrorMessage } from "../utils.js";
import type { CommandContext } from "./types.js";

const RESERVED = new Set(["add", "remove", "list", "show", "all"]);

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

async function runWithSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn();
  let frame = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]} ${label}`);
  }, 80);
  return fn().finally(() => {
    clearInterval(timer);
    process.stdout.write("\r\x1b[K");
  });
}

export async function handleSessionCommand(ctx: CommandContext): Promise<void> {
  const [sub, ...rest] = ctx.args;
  switch (sub) {
    case "add":
      return cmdAdd(rest, ctx);
    case "remove":
      return cmdRemove(rest);
    case "list":
      return cmdList();
    case "show":
      return cmdShow(rest);
    default:
      return cmdLaunch(ctx, sub);
  }
}

async function cmdLaunch(ctx: CommandContext, name: string | undefined): Promise<void> {
  const all = ctx.values["all"] === true;

  let projects: string[];

  if (all) {
    const registry = listProjects();
    if (registry.size === 0) {
      console.error("Error: No projects registered. Use: summon add <name> <path>");
      process.exit(1);
    }
    projects = Array.from(registry.keys());
  } else {
    if (!name) {
      console.error("Usage: summon session <name>");
      console.error("       summon session --all");
      const sessions = listSessions();
      if (sessions.length > 0) {
        console.error("\nSaved sessions:");
        for (const s of sessions) {
          console.error(`  ${s}`);
        }
      } else {
        console.error("\nNo saved sessions. Use: summon session add <name> <project> [...]");
      }
      process.exit(1);
    }

    const sessionProjects = readSession(name);
    if (sessionProjects === null) {
      console.error(`Error: Session not found: ${name}`);
      console.error("Run 'summon session list' to see saved sessions.");
      process.exit(1);
    }

    if (sessionProjects.length === 0) {
      console.error(`Error: Session is empty: ${name}`);
      process.exit(1);
    }

    projects = sessionProjects;
  }

  // Validate all projects exist before launching any
  const missing: string[] = [];
  for (const proj of projects) {
    if (getProject(proj) === undefined) {
      missing.push(proj);
    }
  }
  if (missing.length > 0) {
    console.error(`Error: Unknown project(s): ${missing.join(", ")}`);
    console.error("Register them with: summon add <name> <path>");
    process.exit(1);
  }

  const total = projects.length;
  const launched: string[] = [];
  const baseOverrides = { ...ctx.overrides };

  for (let i = 0; i < total; i++) {
    const proj = projects[i]!;
    const dir = getProject(proj)!;
    const overrides = { ...baseOverrides, "new-tab": i > 0 ? "true" : undefined };
    if (i > 0) {
      delete overrides["new-window"];
    }
    try {
      await runWithSpinner(`[${i + 1}/${total}] Summoning ${proj}...`, () => launch(dir, overrides));
      console.log(`[${i + 1}/${total}] Launched ${proj}`);
      launched.push(proj);
    } catch (err) {
      console.error(`Error launching ${proj}: ${getErrorMessage(err)}`);
      if (launched.length > 0) {
        console.error(`Already launched: ${launched.join(", ")}`);
      }
      process.exit(1);
    }
  }

  console.log(`✓ Session complete: ${total} project(s) launched.`);
}

async function cmdAdd(rest: string[], _ctx: CommandContext): Promise<void> {
  const [name, ...projectArgs] = rest;

  if (!name || projectArgs.length === 0) {
    exitWithUsageHint("Usage: summon session add <name> <project> [<project> ...]");
  }

  if (RESERVED.has(name)) {
    console.error(`Error: "${name}" is a reserved session name. Choose a different name.`);
    console.error(`Reserved names: ${Array.from(RESERVED).join(", ")}`);
    process.exit(1);
  }

  if (!isValidSessionName(name)) {
    console.error(
      `Error: Invalid session name: "${name}". Names must start with a letter and contain only letters, digits, hyphens, and underscores.`,
    );
    process.exit(1);
  }

  const missing: string[] = [];
  for (const proj of projectArgs) {
    if (getProject(proj) === undefined) {
      missing.push(proj);
    }
  }
  if (missing.length > 0) {
    console.error(`Error: Unknown project(s): ${missing.join(", ")}`);
    console.error("Register them with: summon add <name> <path>");
    process.exit(1);
  }

  writeSession(name, projectArgs);
  console.log(`✓ Session saved: ${name} (${projectArgs.length} project(s): ${projectArgs.join(", ")})`);
}

async function cmdRemove(rest: string[]): Promise<void> {
  const [name] = rest;

  if (!name) {
    exitWithUsageHint("Usage: summon session remove <name>");
  }

  const removed = deleteSession(name);
  if (!removed) {
    console.error(`Error: Session not found: ${name}`);
    console.error("Run 'summon session list' to see saved sessions.");
    process.exit(1);
  }

  console.log(`✓ Removed session: ${name}`);
}

async function cmdList(): Promise<void> {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("No saved sessions.");
    return;
  }
  console.log("Saved sessions:");
  for (const s of sessions) {
    console.log(`  ${s}`);
  }
}

async function cmdShow(rest: string[]): Promise<void> {
  const [name] = rest;

  if (!name) {
    exitWithUsageHint("Usage: summon session show <name>");
  }

  const projects = readSession(name);
  if (projects === null) {
    console.error(`Error: Session not found: ${name}`);
    console.error("Run 'summon session list' to see saved sessions.");
    process.exit(1);
  }

  for (const proj of projects) {
    console.log(proj);
  }
}
