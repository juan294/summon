import { execFileSync } from "node:child_process";
import type { LayoutPlan } from "../layout.js";
import type { PlannedLayout, TreeLayoutPlan } from "../tree.js";
import { findPaneByName } from "../tree.js";
import { generateAppleScript, generateTreeAppleScript } from "../script.js";
import { ensureGhostty, ensureAccessibility, printAccessibilityHint, isAccessibilityError } from "../launch-guards.js";
import { traditionalInventory, treeInventory, parseNativeCapture } from "../pane-inventory.js";
import type { NativeMetadata, PaneDescriptor } from "../pane-inventory.js";
import type { BackendId } from "../backend.js";
import type { RexIdentity } from "./rex/types.js";
import { getErrorMessage, ACCESSIBILITY_SETTINGS_PATH, supportsColor } from "../utils.js";
import { fail, err } from "../ui/output.js";
import { TabOpenError } from "../errors.js";

/** Everything a backend needs after the launcher has taken the dry-run branch. */
export interface BackendLaunchContext {
  targetDir: string;
  /** User env vars (already filtered); undefined when there are none. */
  envVars: Record<string, string> | undefined;
  projectName: string;
  onStop: string | undefined;
  launchId: string;
  /** Preset name or "custom"; recorded in the status record and the Rex manifest. */
  layoutLabel: string;
  /** Resolve a configured command to its binary, installing on request. */
  ensureAndResolve: (cmd: string, key: string) => Promise<string>;
  /** Starship preset config path, or null when none applies. */
  resolveStarship: () => string | null;
}

/** Exact identity a backend captured: Ghostty's native metadata or the Rex identity. */
export interface BackendLaunchResult {
  native?: NativeMetadata;
  rex?: RexIdentity;
}

/** A backend launches a planned layout and returns the exact identity it captured, if any. */
export interface TerminalBackend {
  readonly id: BackendId;
  launchTraditional(plan: LayoutPlan, ctx: BackendLaunchContext): Promise<BackendLaunchResult | undefined>;
  launchTree(plan: TreeLayoutPlan, ctx: BackendLaunchContext): Promise<BackendLaunchResult | undefined>;
}

function asResult(native: NativeMetadata | undefined): BackendLaunchResult | undefined {
  return native ? { native } : undefined;
}

// --- Spinner helpers (UX-L2 #519) ---

const LAUNCH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Returns true when the spinner should run in static (non-animating) mode.
 *  Static: NO_COLOR set, SUMMON_NO_SPINNER set, or stdout is not a TTY. */
export function isStaticLaunchSpinner(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env["SUMMON_NO_SPINNER"] !== undefined) return true;
  return !supportsColor();
}

/** One transient stdout line: `show` replaces it, `clear` erases it. */
export interface TransientLine {
  show(label: string): void;
  clear(): void;
}

/**
 * A transient status line on stdout, shown only where the launch spinner animates (see
 * `isStaticLaunchSpinner`); elsewhere both calls write nothing. Never written to stderr.
 */
export function transientLine(): TransientLine {
  let shown = false;
  return {
    show(label) {
      if (isStaticLaunchSpinner()) return;
      process.stdout.write(`${shown ? "\r\x1b[K" : ""}${LAUNCH_SPINNER_FRAMES[0]} ${label}`);
      shown = true;
    },
    clear() {
      if (!shown) return;
      process.stdout.write("\r\x1b[K");
      shown = false;
    },
  };
}

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

/**
 * Best-effort rollback: close the Ghostty front window that was opened by a
 * failed script execution (BE-S26 #322).
 * Silently ignored if Ghostty is not running or the window is already gone.
 */
export function closeWorkspaceWindow(): void {
  const closeScript = `tell application "Ghostty"
  if (count of windows) > 0 then
    close front window
  end if
end tell`;
  try {
    execFileSync("osascript", [], { input: closeScript, encoding: "utf-8" });
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

      const message = getErrorMessage(caught);
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

      // Best-effort rollback: the AppleScript may have opened a window before failing.
      // Attempt to close it so the user is not left with a stale empty window (BE-S26 #322).
      // Skip rollback for accessibility errors — osascript couldn't run at all,
      // so no window was created (BE-M3 #377).
      if (!isAccessibilityError(message)) {
        closeWorkspaceWindow();
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
 * Ghostty adapter over the existing AppleScript launch path. Behavior is unchanged from the
 * pre-backend launcher: guards, command resolution, script generation and execution run in
 * the same order with the same messages (plan §3 seam, D8).
 */
export const GhosttyBackend: TerminalBackend = {
  id: "ghostty",

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
};
