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
      exitWithUsageHint("Usage: summon snapshot <save|show|clear> [project]");
  }
}

export async function handleBriefingCommand(): Promise<void> {
  const { runBriefing } = await import("../briefing.js");
  runBriefing();
}

export async function handlePortsCommand(): Promise<void> {
  const { detectAllPorts } = await import("../ports.js");
  const { green, dim, yellow } = await import("../ui/ansi.js");
  const { assignments, conflicts } = detectAllPorts();

  if (assignments.length === 0) {
    console.log("No port assignments detected across registered projects.");
    return;
  }

  console.log("  PORT   PROJECT          SOURCE             STATE");
  console.log("  " + dim("─".repeat(60)));
  for (const assignment of assignments) {
    const portStr = String(assignment.port).padEnd(6);
    const projectStr = assignment.project.padEnd(16);
    const sourceStr = assignment.source.padEnd(18);
    const dot = assignment.state === "active" ? green("●") : dim("○");
    const stateStr = assignment.state === "active" ? green("active") : dim(assignment.state);
    const conflict = conflicts.has(assignment.port) ? yellow(" ← conflict") : "";
    console.log(`  ${portStr} ${projectStr} ${sourceStr} ${dot} ${stateStr}${conflict}`);
  }

  if (conflicts.size === 0) {
    return;
  }

  console.log();
  for (const [port, projects] of conflicts) {
    console.log(yellow(`  ⚠ Port ${port} used by: ${projects.join(", ")}`));
  }
}
