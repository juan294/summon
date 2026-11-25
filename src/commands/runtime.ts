import { resolve } from "node:path";
import { exitWithUsageHint } from "../utils.js";
import { validateProjectNameOrExit } from "../validation.js";
import type { CommandContext } from "./types.js";
import { isLiveState } from "../status-record.js";
import type { WorkspaceState } from "../status-record.js";
import type { ContextSnapshot } from "../snapshot.js";
import type { LivePortRow, PortsReport } from "../ports.js";
import { escapeControlChars } from "../ui/sanitize.js";

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
        const { withOwnedRecord } = await import("../status-record.js");
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

/** `summon ports --json`: every claim and live port (ephemeral ones flagged), both conflict kinds, the live notes. */
function portsJson(report: PortsReport): string {
  const conflicts = [
    ...[...report.conflicts].map(([port, projects]) => ({ port, kind: "claimed", projects })),
    ...report.held.map((held) => ({ port: held.port, kind: "held", holder: held.holder, pane: held.pane, process: held.process, claimants: held.claimants })),
  ].sort((a, b) => a.port - b.port);
  return JSON.stringify({ claims: report.assignments, live: report.live, conflicts, notes: report.notes }, null, 2);
}

interface PortRow {
  port: number;
  project: string;
  source: string;
  state: WorkspaceState;
  detail: string;
  conflict: boolean;
}

/**
 * Claims first, each with what holds its port now; then the live ports no claim of their own project covers.
 * An unclaimed ephemeral port is hidden (owner decision D1) and counted.
 */
function portRows(report: PortsReport, holderLabel: (pane: string, process: string | null) => string): { rows: PortRow[]; hidden: LivePortRow[] } {
  const heldBy = new Map(report.held.flatMap((held) => held.claimants.map((c) => [`${held.port}\n${c.project}`, held] as const)));
  const claimed = new Set(report.assignments.map((a) => a.port));
  const ownClaims = new Set(report.assignments.map((a) => `${a.port}\n${a.project}`));
  const holders = new Set(report.held.map((held) => `${held.port}\n${held.holder}`));
  const rows: PortRow[] = report.assignments.map((a) => {
    const own = report.live.find((l) => l.port === a.port && l.project === a.project);
    const held = heldBy.get(`${a.port}\n${a.project}`);
    const detail = own ? `listening: ${holderLabel(own.pane, own.process)}`
      : held ? `held by ${escapeControlChars(held.holder)}/${holderLabel(held.pane, held.process)}` : "";
    return { port: a.port, project: a.project, source: a.source, state: a.state, detail, conflict: report.conflicts.has(a.port) || held !== undefined };
  });
  const hidden: LivePortRow[] = [];
  const shown = new Set<string>();
  for (const l of report.live) {
    const key = `${l.port}\n${l.project}`;
    if (ownClaims.has(key) || shown.has(`${key}\n${l.pane}`)) continue;
    if (l.ephemeral && !claimed.has(l.port)) {
      // One holder bound on two addresses (127.0.0.1 and ::1) is one hidden port.
      if (!hidden.some((h) => h.port === l.port && h.project === l.project && h.pane === l.pane)) hidden.push(l);
      continue;
    }
    shown.add(`${key}\n${l.pane}`);
    rows.push({ port: l.port, project: l.project, source: "live", state: l.state, detail: holderLabel(l.pane, l.process), conflict: holders.has(key) });
  }
  rows.sort((a, b) => a.port - b.port);
  return { rows, hidden };
}

function hiddenLine(hidden: readonly LivePortRow[]): string {
  const projects = [...new Set(hidden.map((l) => l.project))];
  const what = `${hidden.length} ephemeral live port${hidden.length === 1 ? "" : "s"} hidden`;
  // inspect lists the recorded panes only; a pane split by hand is in --json alone.
  if (projects.length === 1 && hidden.every((l) => l.recorded)) return `${what}; summon inspect ${escapeControlChars(projects[0]!)} lists them.`;
  if (projects.length === 1) return `${what} (${escapeControlChars(projects[0]!)}); summon ports --json lists them.`;
  // Past a few projects a name list outgrows the line; agents hold one in nearly every workspace.
  const where = projects.length <= 3 ? `(${escapeControlChars(projects.join(", "))})` : `in ${projects.length} workspaces`;
  return `${what} ${where}; summon ports --json lists them.`;
}

export async function handlePortsCommand({ values }: Pick<CommandContext, "values"> = { values: {} }): Promise<void> {
  const { detectAllPorts, heldLine, holderLabel, liveNoteLines } = await import("../ports.js");
  const report = await detectAllPorts();
  if (values.json === true) {
    console.log(portsJson(report));
    return;
  }
  const { green, dim, yellow, truncateLine } = await import("../ui/ansi.js");
  const { sym } = await import("../ui/symbols.js");
  const { conflicts, projectCount } = report;
  const { rows, hidden } = portRows(report, holderLabel);
  const footer = (): void => {
    if (hidden.length > 0) console.log(dim(hiddenLine(hidden)));
    for (const line of liveNoteLines(report.notes)) console.log(dim(`note: ${line}`));
  };

  if (rows.length === 0) {
    if (projectCount === 0) {
      console.log("No port assignments detected.");
      console.log("Run `summon add <name> <path>` to register a project.");
    } else {
      console.log(`No port assignments detected in ${projectCount} registered project${projectCount === 1 ? "" : "s"}.`);
      console.log("Ports are read from PORT-style variables in a trusted .summon, --port/-p flags of dev-server scripts in package.json, and framework config files.");
    }
    footer();
    return;
  }

  const termWidth = Math.min(process.stdout.columns || 80, 120);
  // Fixed columns: "  " + port(6) + " " + project(16) + " " + source(18) + " " + dot(1) + " " + state
  const FIXED_W = 2 + 6 + 1 + 16 + 1 + 18 + 1 + 1 + 1 + 6; // ~53 chars before conflict
  const conflictWidth = Math.max(0, termWidth - FIXED_W);
  const withDetail = rows.some((row) => row.detail !== "");

  // The DETAIL column appears only when a live port is shown, so a static-only table keeps its layout.
  console.log(`  PORT   PROJECT          SOURCE             STATE${withDetail ? "      DETAIL" : ""}`);
  console.log("  " + dim("─".repeat(Math.min(60, termWidth - 2))));
  for (const row of rows) {
    const portStr = String(row.port).padEnd(6);
    const projectStr = truncateLine(row.project, 16).padEnd(16);
    const sourceStr = truncateLine(row.source, 18).padEnd(18);
    const dot = isLiveState(row.state) ? (row.state === "active" ? green(sym.dotFilled) : yellow(sym.dotFilled)) : dim(sym.dotEmpty);
    const stateStr = row.state === "active" ? green("active") : row.state === "partial" ? yellow("partial") : dim(row.state);
    // Under STATE: the dot, a space, the state (7 wide at most) and 2 spaces; pad from the plain state, since colors lengthen stateStr.
    const detail = withDetail ? `${" ".repeat(9 - row.state.length)}${row.detail}` : "";
    const conflict = row.conflict
      ? truncateLine(yellow(" ← conflict"), conflictWidth)
      : "";
    console.log(`  ${portStr} ${projectStr} ${sourceStr} ${dot} ${stateStr}${detail}${conflict}`);
  }

  if (conflicts.size === 0 && report.held.length === 0) {
    // An incomplete live read (the notes below) can hide a held port: no check mark over what was not read.
    console.log(report.notes.length === 0 ? `${green(sym.ok)} No port conflicts` : "No port conflicts in the claims and live ports that were read");
  } else {
    console.log();
    for (const [port, projects] of conflicts) {
      const msg = `  ⚠ Port ${port} used by: ${projects.join(", ")}`;
      console.log(yellow(truncateLine(msg, termWidth)));
    }
    // Never cut: the claimant and where it claims the port are the part the user acts on (C24, 80 columns when piped).
    for (const held of report.held) console.log(yellow(`  ⚠ ${heldLine(held)}`));
  }
  footer();
}
