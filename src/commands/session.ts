import { launch } from "../launcher.js";
import { listProjects, getProject } from "../config.js";
import {
  listSessions,
  readSession,
  writeSession,
  deleteSession,
  isValidSessionName,
} from "../sessions.js";
import { SummonError } from "../trust.js";
import { TabOpenError } from "../errors.js";
import { exitWithUsageHint, getErrorMessage, supportsColor } from "../utils.js";
import { sym } from "../ui/symbols.js";
import { fail, err } from "../ui/output.js";
import type { CommandContext } from "./types.js";

const RESERVED = new Set(["add", "remove", "list", "show", "all"]);

/** Pause between per-project launches in a multi-project session, to reduce
 *  cross-process keystroke contention when Ghostty is creating tabs rapidly. */
const INTER_LAUNCH_DELAY_MS = 200;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Returns true when the spinner should run in static (non-animating) mode.
 *  Static mode applies when NO_COLOR is set (https://no-color.org/),
 *  SUMMON_NO_SPINNER is set, or stdout is not a TTY. */
function isStaticSpinner(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env["SUMMON_NO_SPINNER"] !== undefined) return true;
  return !supportsColor(); // covers NO_COLOR and FORCE_COLOR=0
}

async function runWithSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (isStaticSpinner()) {
    process.stdout.write(`${label}\n`);
    return fn();
  }
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
      fail("No projects found.");
      err("Run `summon add <name> <path>` to register your first project.");
      process.exit(1);
    }
    projects = Array.from(registry.keys());
  } else {
    if (!name) {
      err("Usage: summon session <name>");
      err("       summon session --all");
      const sessions = listSessions();
      if (sessions.length > 0) {
        err("\nSaved sessions:");
        for (const s of sessions) {
          err(`  ${s}`);
        }
      } else {
        err("\nNo sessions found.");
        err("Run `summon session add <name> <project> [...]` to create one.");
      }
      process.exit(1);
    }

    const sessionProjects = readSession(name);
    if (sessionProjects === null) {
      fail(`Session not found: ${name}`);
      err("Run 'summon session list' to see saved sessions.");
      process.exit(1);
    }

    if (sessionProjects.length === 0) {
      fail(`Session is empty: ${name}`);
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
    fail(`Unknown project(s): ${missing.join(", ")}`);
    err("Register them with: summon add <name> <path>");
    process.exit(1);
  }

  const total = projects.length;
  const launched: string[] = [];
  const skippedUntrusted: string[] = [];
  const failedTab: string[] = [];
  // Treat first-launch placement the same regardless of whether earlier
  // projects were skipped: the first *successful* launch opens the window,
  // every subsequent one opens a new tab.
  let openedFirst = false;
  const baseOverrides = { ...ctx.overrides };

  for (let i = 0; i < total; i++) {
    const proj = projects[i]!;
    const dir = getProject(proj)!;
    const overrides = { ...baseOverrides, "new-tab": openedFirst ? "true" : undefined };
    if (openedFirst) {
      delete overrides["new-window"];
    }
    try {
      await runWithSpinner(`[${i + 1}/${total}] Summoning ${proj}...`, () => launch(dir, overrides));
      console.log(`[${i + 1}/${total}] Launched ${proj}`);
      launched.push(proj);
      openedFirst = true;
    } catch (caught) {
      // Trust failures are recoverable: warn, tell user how to fix, continue.
      if (caught instanceof SummonError) {
        console.warn(`[${i + 1}/${total}] Skipped ${proj} — untrusted .summon file.`);
        console.warn(`  Run 'summon trust ${dir}' to allow it, then re-run.`);
        skippedUntrusted.push(proj);
        continue;
      }
      // Tab-open failures are recoverable: the existing window is intact,
      // warn and continue so remaining projects still get their tabs.
      if (caught instanceof TabOpenError) {
        console.warn(`[${i + 1}/${total}] ${proj}: tab failed to open — continuing.`);
        failedTab.push(proj);
        continue;
      }
      fail(`launching ${proj}: ${getErrorMessage(caught)}`);
      if (launched.length > 0) {
        err(`Already launched: ${launched.join(", ")}`);
      }
      process.exit(1);
    }
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, INTER_LAUNCH_DELAY_MS));
    }
  }

  const parts = [`${launched.length} launched`];
  if (failedTab.length > 0) {
    parts.push(`${failedTab.length} failed (tab did not open): ${failedTab.join(", ")}`);
  }
  if (skippedUntrusted.length > 0) {
    parts.push(`${skippedUntrusted.length} skipped (untrusted): ${skippedUntrusted.join(", ")}`);
  }
  console.log(`${sym.ok} Session complete: ${parts.join(", ")}.`);
}

async function cmdAdd(rest: string[], _ctx: CommandContext): Promise<void> {
  const [name, ...projectArgs] = rest;

  if (!name || projectArgs.length === 0) {
    exitWithUsageHint("Usage: summon session add <name> <project> [<project> ...]");
  }

  if (RESERVED.has(name)) {
    fail(`"${name}" is a reserved session name. Choose a different name.`);
    err(`Reserved names: ${Array.from(RESERVED).join(", ")}`);
    process.exit(1);
  }

  if (!isValidSessionName(name)) {
    fail(
      `Invalid session name: "${name}". Names must start with a letter and contain only letters, digits, hyphens, and underscores.`,
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
    fail(`Unknown project(s): ${missing.join(", ")}`);
    err("Register them with: summon add <name> <path>");
    process.exit(1);
  }

  writeSession(name, projectArgs);
  console.log(`${sym.ok} Session saved: ${name} (${projectArgs.length} project(s): ${projectArgs.join(", ")})`);
}

async function cmdRemove(rest: string[]): Promise<void> {
  const [name] = rest;

  if (!name) {
    exitWithUsageHint("Usage: summon session remove <name>");
  }

  if (!isValidSessionName(name)) {
    fail(`Invalid session name: "${name}". Names must start with a letter and contain only letters, digits, hyphens, and underscores.`);
    process.exit(1);
  }

  const removed = deleteSession(name);
  if (!removed) {
    fail(`Session not found: ${name}`);
    err("Run 'summon session list' to see saved sessions.");
    process.exit(1);
  }

  console.log(`${sym.ok} Removed session: ${name}`);
}

async function cmdList(): Promise<void> {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("No sessions found.");
    console.log("Run `summon session add <name> <project> [...]` to create one.");
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

  if (!isValidSessionName(name)) {
    fail(`Invalid session name: "${name}". Names must start with a letter and contain only letters, digits, hyphens, and underscores.`);
    process.exit(1);
  }

  const projects = readSession(name);
  if (projects === null) {
    fail(`Session not found: ${name}`);
    err("Run 'summon session list' to see saved sessions.");
    process.exit(1);
  }

  for (const proj of projects) {
    console.log(proj);
  }
}
