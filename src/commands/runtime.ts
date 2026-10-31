import { resolve } from "node:path";
import { exitWithUsageHint } from "../utils.js";
import { validateProjectNameOrExit } from "../validation.js";
import type { CommandContext } from "./types.js";
import { isLiveState } from "../status.js";
import type { ContextSnapshot } from "../snapshot.js";

export async function handleStatusCommand({ values }: CommandContext): Promise<void> {
  const { runMonitor, printStatusOnce } = await import("../monitor.js");
  if (values.once || !process.stdout.isTTY) {
    await printStatusOnce();
    return;
  }
  await runMonitor();
}

export async function handleSnapshotCommand({ args, values }: CommandContext): Promise<void> {
  const [action, ...snapshotArgs] = args;
  const {
    saveSnapshot,
    collectSnapshot,
    writeSnapshotFile,
    readSnapshot,
    clearSnapshot,
    formatRestorationBanner,
  } = await import("../snapshot.js");

  switch (action) {
    case "save": {
      const dir = values.dir ?? process.cwd();
      const project = values.project ?? snapshotArgs[0] ?? (resolve(dir).split("/").pop() || "unknown");
      const layout = values.layout ?? "unknown";
      validateProjectNameOrExit(project, "snapshot project name");
      let snapshot: ContextSnapshot | null;
      if (values.launch === undefined) {
        snapshot = saveSnapshot(project, dir, layout);
      } else {
        // Generation-checked save (plan P12): the cleanup trap of launch <id> may write the
        // snapshot only while the record still belongs to that launch. The git reads happen
        // before the lock; only the ownership check and the file write hold it.
        const { isLaunchId } = await import("../launch-identity.js");
        if (!isLaunchId(values.launch)) {
          exitWithUsageHint("Usage: summon snapshot save --launch <launch-id> (a UUID written by summon)");
        }
        const { withOwnedRecord } = await import("../status.js");
        snapshot = collectSnapshot(project, dir, layout);
        const collected = snapshot;
        const { outcome } = withOwnedRecord(project, { launchId: values.launch }, () => {
          if (collected) writeSnapshotFile(collected);
          return null;
        });
        if (outcome === "superseded") return;
      }
      console.log(snapshot ? `Snapshot saved for ${project}` : `No git repo found in ${dir}`);
      return;
    }
    case "show": {
      const [project] = snapshotArgs;
      if (!project) {
        exitWithUsageHint("Usage: summon snapshot show <project>");
      }
      validateProjectNameOrExit(project, "snapshot project name");
      const snapshot = readSnapshot(project);
      console.log(snapshot ? formatRestorationBanner(snapshot) : `No snapshot found for ${project}`);
      return;
    }
    case "clear": {
      const [project] = snapshotArgs;
      if (!project) {
        exitWithUsageHint("Usage: summon snapshot clear <project>");
      }
      validateProjectNameOrExit(project, "snapshot project name");
      console.log(clearSnapshot(project) ? `Snapshot cleared for ${project}` : `No snapshot found for ${project}`);
      return;
    }
    default:
      exitWithUsageHint(
        "Usage: summon snapshot <save|show|clear> [project]\n\n" +
        "Subcommands:\n" +
        "  summon snapshot save [name]    Save current workspace state (--launch <id>: only while that launch owns the record)\n" +
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
  const { sym } = await import("../ui/symbols.js");
  const { assignments, conflicts, projectCount } = await detectAllPorts();

  if (assignments.length === 0) {
    if (projectCount === 0) {
      console.log("No port assignments detected.");
      console.log("Run `summon add <name> <path>` to register a project.");
    } else {
      console.log(`No port assignments detected in ${projectCount} registered project${projectCount === 1 ? "" : "s"}.`);
      console.log("Ports are read from PORT-style variables in a trusted .summon, --port/-p flags of dev-server scripts in package.json, and framework config files.");
    }
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
    const dot = isLiveState(assignment.state) ? (assignment.state === "active" ? green(sym.dotFilled) : yellow(sym.dotFilled)) : dim(sym.dotEmpty);
    const stateStr = assignment.state === "active" ? green("active") : assignment.state === "partial" ? yellow("partial") : dim(assignment.state);
    const conflict = conflicts.has(assignment.port)
      ? truncateLine(yellow(" ← conflict"), conflictWidth)
      : "";
    console.log(`  ${portStr} ${projectStr} ${sourceStr} ${dot} ${stateStr}${conflict}`);
  }

  if (conflicts.size === 0) {
    console.log(`${green(sym.ok)} No port conflicts`);
    return;
  }

  console.log();
  for (const [port, projects] of conflicts) {
    const msg = `  ⚠ Port ${port} used by: ${projects.join(", ")}`;
    console.log(yellow(truncateLine(msg, termWidth)));
  }
}
