import { execFileSync } from "node:child_process";
import type { PlannedLayout } from "../tree.js";
import { findPaneByName } from "../tree.js";
import { generateAppleScript, generateTreeAppleScript } from "../script.js";
import { ensureGhostty, ensureAccessibility, printAccessibilityHint, isAccessibilityError } from "../launch-guards.js";
import { traditionalInventory, treeInventory, parseNativeCapture } from "../pane-inventory.js";
import type { NativeMetadata, PaneDescriptor } from "../pane-inventory.js";
import type { BackendLaunchContext, BackendLaunchResult, BackendLayout, LaunchOptionsInput, TerminalBackend } from "./port.js";
import type { LayoutOptions } from "../layout.js";
import { pickConfigValue } from "../config-resolve.js";
import type { CLIOverrides } from "../config-resolve.js";
import { commandExecutable } from "../command-spec.js";
import { COMMAND_FAILURE_REASONS, checkCommand } from "../command-install.js";
import { getErrorMessage, ACCESSIBILITY_SETTINGS_PATH, QUICK_PROCESS_LIMITS, SUMMON_WORKSPACE_ENV } from "../utils.js";
import { escapeAppleScript } from "../shell-escape.js";
import { isStaticLaunchSpinner, transientLine } from "../ui/progress.js";
import { fail, err } from "../ui/output.js";
import { TabOpenError } from "../errors.js";

// The port types moved to ./port.ts (AR-M1); re-exported for the modules that import them from here.
export type { BackendLaunchContext, BackendLaunchResult, TerminalBackend } from "./port.js";

function asResult(native: NativeMetadata | undefined): BackendLaunchResult | undefined {
  return native ? { native } : undefined;
}

// --- Spinner helpers (UX-L2 #519; the line itself and isStaticLaunchSpinner are in ui/progress.ts) ---

/**
 * Run `fn` (a synchronous block) with a brief spinner on stdout.
 * In static mode (non-TTY or NO_COLOR), writes a single labelled line to stdout then runs fn.
 * In TTY mode, writes an initial spinner frame, runs fn (which may block), then clears.
 * The label is also written to stderr so pipeline consumers still get progress feedback.
 */
export function withLaunchSpinner(label: string, fn: () => void): void {
  // FE-M5/UX-M6: keep stderr progress so pipelines are not polluted
  process.stderr.write(`${label}\n`);
  if (isStaticLaunchSpinner()) {
    // Static mode: one labelled line to stdout (matches session.ts spinner convention)
    process.stdout.write(`${label}\n`);
    fn();
    return;
  }
  // Initial spinner frame on stdout for an interactive TTY, cleared afterwards
  const line = transientLine();
  line.show(label);
  try {
    fn();
  } finally {
    line.clear();
  }
}

/** The window or tab a failed launch script opened and recorded (BE-M2). */
export interface CreatedContainer {
  kind: "window" | "tab";
  id: string;
}

/**
 * The rollback mark the launch script appends to an error raised after it opened a window
 * (`--new-window`) or a tab (`--new-tab`); see emitRollbackMark in src/script.ts. An empty mark
 * means the open was not verified. Default mode reuses the user's window and never adds one.
 */
const ROLLBACK_MARK_RE = / \[summon-rollback ([^\]]*)\]/;
/** What a mark may name; any other content (an empty mark, unexpected characters) rolls back nothing. */
const ROLLBACK_TARGET_RE = /^(window|tab):([A-Za-z0-9._:-]{1,128})$/;

/** Split a launch error into the user-facing message and the container to roll back, if any. */
function parseRollbackMark(raw: string): { message: string; created?: CreatedContainer } {
  const mark = ROLLBACK_MARK_RE.exec(raw);
  if (!mark) return { message: raw };
  const message = raw.replace(mark[0], "");
  const target = ROLLBACK_TARGET_RE.exec(mark[1]!);
  if (!target) return { message };
  return { message, created: { kind: target[1] as CreatedContainer["kind"], id: target[2]! } };
}

/**
 * Best-effort rollback: close exactly the window or tab a failed launch created (BE-S26 #322,
 * BE-M2), found by its recorded id, never the front window. Silently ignored if Ghostty is not
 * running, does not answer in time, or the container is already gone.
 */
export function closeCreatedContainer(created: CreatedContainer): void {
  const id = escapeAppleScript(created.id);
  const closeScript = created.kind === "window"
    ? `tell application "Ghostty"
  repeat with w in windows
    if (id of w as text) is "${id}" then
      close window w
      return
    end if
  end repeat
end tell`
    : `tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      if (id of t as text) is "${id}" then
        close tab t
        return
      end if
    end repeat
  end repeat
end tell`;
  try {
    execFileSync("osascript", [], { input: closeScript, encoding: "utf-8", ...QUICK_PROCESS_LIMITS });
  } catch {
    // Silently ignore — rollback is best-effort
  }
}

function executeScript(script: string, inventory: PaneDescriptor[], targetLabel?: string): NativeMetadata | undefined {
  let output = "";
  const label = `Summoning ${targetLabel ?? "workspace"}…`;
  withLaunchSpinner(label, () => {
    try {
      output = execFileSync("osascript", [], { input: script, encoding: "utf-8", timeout: 30_000 });
      process.stderr.write("✓ Workspace ready.\n");
    } catch (caught) {
      const code = (caught as NodeJS.ErrnoException).code;
      if (code === "ETIMEDOUT") {
        err("Ghostty did not respond within 30 seconds. Is Ghostty running?");
        throw new Error("Ghostty did not respond within 30 seconds. Is Ghostty running?", { cause: caught });
      }

      const { message, created } = parseRollbackMark(getErrorMessage(caught));
      fail(`failed to execute workspace script: ${message}`);

      // A verified keystroke failure means NO new tab/window was created — the existing
      // front window is intact, so DO NOT run the rollback that would close it.
      if (message.includes("summon-newtab-failed")) {
        err("Ghostty did not open a new tab after multiple attempts.");
        throw new TabOpenError("Ghostty did not open a new tab.", { cause: caught });
      }
      if (message.includes("summon-newwindow-failed")) {
        const m = "Ghostty did not open a new window after multiple attempts.";
        err(m);
        throw new Error(m, { cause: caught });
      }

      // Best-effort rollback of the window or tab this script opened (BE-S26 #322), so the user
      // is not left with a stale empty one. Only a container the script recorded is closed
      // (BE-M2): a launch into the user's own window, or a failure before the open was verified,
      // closes nothing. Skip rollback for accessibility errors — osascript couldn't run at all,
      // so no window was created (BE-M3 #377).
      if (created && !isAccessibilityError(message)) {
        closeCreatedContainer(created);
      }

      if (isAccessibilityError(message)) {
        err("");
        printAccessibilityHint();
      } else {
        err("");
        err("Is Ghostty running? Also check:");
        err(`  - ${ACCESSIBILITY_SETTINGS_PATH}`);
        err("  - System Settings > Privacy & Security > Automation");
        err("");
        err("Tip: Run 'summon doctor' to diagnose issues.");
      }
      throw new Error(`Failed to execute workspace script: ${message}`, { cause: caught });
    }
  });
  // Parsing is deliberately outside launch rollback: an already-ready workspace stays open.
  const native = parseNativeCapture(typeof output === "string" ? output : "", inventory);
  if (!native) err("summon: warning: workspace launched, but exact native targeting is unavailable. Use summon inspect or explicitly relaunch to capture identity.");
  return native;
}

/** A command the Ghostty backend resolves before launch; `set` stores the resolved command back. */
export interface GhosttyCommandEntry {
  /** Config key (`editor`, `sidebar`, `shell`) or `pane.<leaf>` for a tree pane. */
  key: string;
  /** Tree pane name; absent for a config key. */
  pane?: string;
  command: string;
  set: (resolved: string) => void;
}

/** Traditional plan fields in resolution order, with the config key each one reports under. */
const TRADITIONAL_COMMAND_FIELDS = [
  ["editor", "editor"],
  ["sidebar", "sidebarCommand"],
  ["editor", "secondaryEditor"],
  ["shell", "shellCommand"],
] as const;

/**
 * Every command a Ghostty launch resolves, in resolution order. The backend and the dry-run
 * check both read this list, so the dry run checks exactly what a real launch would.
 */
export function ghosttyCommandEntries(layout: PlannedLayout): GhosttyCommandEntry[] {
  const entries: GhosttyCommandEntry[] = [];
  if (layout.kind === "traditional") {
    const { plan } = layout;
    for (const [key, field] of TRADITIONAL_COMMAND_FIELDS) {
      const command = plan[field];
      if (command) entries.push({ key, command, set: (v) => { plan[field] = v; } });
    }
    return entries;
  }
  for (const leafName of layout.plan.leaves) {
    const pane = findPaneByName(layout.plan.tree, leafName);
    if (pane?.command) entries.push({ key: `pane.${leafName}`, pane: leafName, command: pane.command, set: (v) => { pane.command = v; } });
  }
  return entries;
}

async function resolveCommands(layout: PlannedLayout, ctx: BackendLaunchContext): Promise<void> {
  for (const entry of ghosttyCommandEntries(layout)) {
    entry.set(await ctx.ensureAndResolve(entry.command, entry.key));
  }
}

/**
 * Probe Ghostty for the number of terminals in the front window's selected tab.
 * Returns null when Ghostty is not running, the script errors, or output is non-numeric.
 *
 * PE-L2: This is a separate osascript call made BEFORE the main workspace script.
 * Two round-trips are intentional: this probe runs before the main AppleScript is
 * generated, and its result (pane count) influences the generated script's content
 * (the cleanRestoredPanes prelude). Inlining the count into the main script would
 * require AppleScript to conditionally close panes and then branch — adding significant
 * complexity to script.ts for minimal latency gain (probe takes ~2 s max, main script
 * executes regardless). The two-call design keeps script generation pure and testable.
 */
export function probePaneCount(): number | null {
  try {
    const out = execFileSync(
      "osascript",
      ["-e", 'tell application "Ghostty" to count of terminals of selected tab of front window'],
      { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether to auto-clean restored panes from the front window's selected tab.
 * Only cleans panes when the front tab title contains a summon project marker `[<projectName>]`.
 * This prevents destroying non-summon panes.
 * When all trigger conditions are met, sets opts.cleanRestoredPanes=true and prints a notice.
 */
export function decideCleanRestoredPanes(
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
  dryRun: boolean | undefined,
  _projectName?: string,
): void {
  if (process.env[SUMMON_WORKSPACE_ENV]) return;
  if (opts.newWindow) return;

  const cleanRaw = pickConfigValue(cliOverrides.clean, "clean", project, machineConfig);
  // Default to false — clean must be explicitly enabled via --clean or clean=true (BE-H1 #362).
  const cleanEnabled = cleanRaw === "true";
  if (!cleanEnabled) return;

  // In dry-run mode, skip the probe but honor an explicit --clean flag so the
  // generated AppleScript (printed to stdout) includes the close prelude.
  if (dryRun) {
    if (cliOverrides.clean === "true") opts.cleanRestoredPanes = true;
    return;
  }

  const count = probePaneCount();
  if (count === null || count <= 1) return;

  // Clean every pane in the front tab regardless of how it got there.
  // Users who don't want this can pass --no-clean or --new-window.
  const stale = count - 1;
  const noun = stale === 1 ? "pane" : "panes";
  console.log(`Clearing ${stale} stale ${noun} from previous session...`);
  opts.cleanRestoredPanes = true;
}

/**
 * One line per executable a real Ghostty launch would not resolve, without prompting or
 * installing. A missing command with a known install method gets an install offer, not a stop.
 */
function dryRunCommandNotes(layout: PlannedLayout): string[] {
  const notes: string[] = [];
  const checked = new Set<string>();
  for (const { key, pane, command } of ghosttyCommandEntries(layout)) {
    const executable = commandExecutable(command);
    if (!executable || checked.has(executable)) continue;
    checked.add(executable);
    const check = checkCommand(executable);
    if ("resolved" in check) continue;
    const label = pane ? `pane \`${pane}\`` : `\`${key}\``;
    const outcome = check.install ? "a real launch offers to install it" : "a real launch stops here";
    notes.push(`${label}: \`${executable}\` ${COMMAND_FAILURE_REASONS[check.failure]}; ${outcome}.`);
  }
  return notes;
}

/**
 * Ghostty adapter over the existing AppleScript launch path. Behavior is unchanged from the
 * pre-backend launcher: guards, command resolution, script generation and execution run in
 * the same order with the same messages (plan §3 seam, D8).
 */
export const GhosttyBackend: TerminalBackend = {
  id: "ghostty",
  splitsCallerWindow: true,
  opensSessionTabs: true,

  applyLaunchOptions({ opts, overrides, projectConfig, machineConfig, dryRun, projectName }: LaunchOptionsInput) {
    decideCleanRestoredPanes(opts, overrides, projectConfig, machineConfig, dryRun, projectName);
  },

  async launchTraditional(plan, ctx) {
    ensureGhostty();
    ensureAccessibility();
    await resolveCommands({ kind: "traditional", plan }, ctx);

    const starshipConfigPath = ctx.resolveStarship();
    const script = generateAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId);
    return asResult(executeScript(script, traditionalInventory(plan), ctx.projectName));
  },

  async launchTree(plan, ctx) {
    ensureGhostty();
    ensureAccessibility();
    await resolveCommands({ kind: "tree", plan }, ctx);

    const starshipConfigPath = ctx.resolveStarship();
    const script = generateTreeAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId);
    return asResult(executeScript(script, treeInventory(plan), ctx.projectName));
  },

  /** The AppleScript a real launch would run, and one note per command it would not resolve. */
  dryRun(layout: BackendLayout, ctx: BackendLaunchContext, starshipConfigPath: string | null) {
    const body = layout.kind === "tree"
      ? generateTreeAppleScript(layout.plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId)
      : generateAppleScript(layout.plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId);
    return { body, notes: dryRunCommandNotes(layout) };
  },
};
