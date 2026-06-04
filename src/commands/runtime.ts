import { resolve } from "node:path";
import { exitWithUsageHint } from "../utils.js";
import type { CommandContext } from "./types.js";

export async function handleStatusCommand({ values }: CommandContext): Promise<void> {
  const { runMonitor, printStatusOnce } = await import("../monitor.js");
  if (values.once || !process.stdout.isTTY) {
    printStatusOnce();
    return;
  }
  await runMonitor();
}

export async function handleSnapshotCommand({ args }: CommandContext): Promise<void> {
  const [action, ...snapshotArgs] = args;
  const {
    saveSnapshot,
    readSnapshot,
    clearSnapshot,
    formatRestorationBanner,
  } = await import("../snapshot.js");

  switch (action) {
    case "save": {
      let dir = process.cwd();
      let project = "";
      let layout = "unknown";
      for (let index = 0; index < snapshotArgs.length; index++) {
        if (snapshotArgs[index] === "--dir" && snapshotArgs[index + 1]) {
          dir = snapshotArgs[++index]!;
        } else if (snapshotArgs[index] === "--project" && snapshotArgs[index + 1]) {
          project = snapshotArgs[++index]!;
        } else if (snapshotArgs[index] === "--layout" && snapshotArgs[index + 1]) {
          layout = snapshotArgs[++index]!;
        } else if (!project) {
          project = snapshotArgs[index]!;
        }
      }
      if (!project) {
        project = resolve(dir).split("/").pop() || "unknown";
      }
      const result = saveSnapshot(project, dir, layout);
      console.log(result ? `Snapshot saved for ${project}` : `No git repo found in ${dir}`);
      return;
    }
    case "show": {
      const [project] = snapshotArgs;
      if (!project) {
        exitWithUsageHint("Usage: summon snapshot show <project>");
      }
      const snapshot = readSnapshot(project);
      console.log(snapshot ? formatRestorationBanner(snapshot) : `No snapshot found for ${project}`);
      return;
    }
    case "clear": {
      const [project] = snapshotArgs;
      if (!project) {
        exitWithUsageHint("Usage: summon snapshot clear <project>");
      }
      console.log(clearSnapshot(project) ? `Snapshot cleared for ${project}` : `No snapshot found for ${project}`);
      return;
    }
    default:
      exitWithUsageHint(
        "Usage: summon snapshot <save|show|clear> [project]\n\n" +
        "Subcommands:\n" +
        "  summon snapshot save [name]    Save current workspace state\n" +
        "  summon snapshot show [name]    Show a saved snapshot\n" +
        "  summon snapshot clear [name]   Remove a saved snapshot\n\n" +
        "Examples:\n" +
        "  summon snapshot save myapp\n" +
        "  summon snapshot show myapp\n" +
        "  summon snapshot clear myapp",
      );
  }
}

export async function handleBriefingCommand(): Promise<void> {
  const { runBriefing } = await import("../briefing.js");
  await runBriefing();
}

export async function handlePortsCommand(): Promise<void> {
  const { detectAllPorts } = await import("../ports.js");
  const { green, dim, yellow, truncateLine } = await import("../ui/ansi.js");
  const { assignments, conflicts } = await detectAllPorts();

  if (assignments.length === 0) {
    console.log("No port assignments detected.");
    console.log("Run `summon add <name> <path>` to register a project.");
    return;
  }

  const termWidth = Math.min(process.stdout.columns || 80, 120);
  // Fixed columns: "  " + port(6) + " " + project(16) + " " + source(18) + " " + dot(1) + " " + state
  const FIXED_W = 2 + 6 + 1 + 16 + 1 + 18 + 1 + 1 + 1 + 6; // ~53 chars before conflict
  const conflictWidth = Math.max(0, termWidth - FIXED_W);

  console.log("  PORT   PROJECT          SOURCE             STATE");
  console.log("  " + dim("─".repeat(Math.min(60, termWidth - 2))));
  for (const assignment of assignments) {
    const portStr = String(assignment.port).padEnd(6);
    const projectStr = truncateLine(assignment.project, 16).padEnd(16);
    const sourceStr = truncateLine(assignment.source, 18).padEnd(18);
    const dot = assignment.state === "active" ? green("●") : dim("○");
    const stateStr = assignment.state === "active" ? green("active") : dim(assignment.state);
    const conflict = conflicts.has(assignment.port)
      ? truncateLine(yellow(" ← conflict"), conflictWidth)
      : "";
    console.log(`  ${portStr} ${projectStr} ${sourceStr} ${dot} ${stateStr}${conflict}`);
  }

  if (conflicts.size === 0) {
    return;
  }

  console.log();
  for (const [port, projects] of conflicts) {
    const msg = `  ⚠ Port ${port} used by: ${projects.join(", ")}`;
    console.log(yellow(truncateLine(msg, termWidth)));
  }
}
