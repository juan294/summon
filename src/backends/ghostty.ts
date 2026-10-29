import { execFileSync } from "node:child_process";
import type { LayoutPlan } from "../layout.js";
import type { TreeLayoutPlan } from "../tree.js";
import { findPaneByName } from "../tree.js";
import { generateAppleScript, generateTreeAppleScript } from "../script.js";
import { ensureGhostty, ensureAccessibility, printAccessibilityHint, isAccessibilityError } from "../launch-guards.js";
import { traditionalInventory, treeInventory, parseNativeCapture } from "../pane-inventory.js";
import type { NativeMetadata, PaneDescriptor } from "../pane-inventory.js";
import type { BackendId } from "../backend.js";
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
  /** Resolve a configured command to its binary, installing on request. */
  ensureAndResolve: (cmd: string, key: string) => Promise<string>;
  /** Starship preset config path, or null when none applies. */
  resolveStarship: () => string | null;
}

/** A backend launches a planned layout and returns the exact identity it captured, if any. */
export interface TerminalBackend {
  readonly id: BackendId;
  launchTraditional(plan: LayoutPlan, ctx: BackendLaunchContext): Promise<NativeMetadata | undefined>;
  launchTree(plan: TreeLayoutPlan, ctx: BackendLaunchContext): Promise<NativeMetadata | undefined>;
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
  // Write initial spinner frame to stdout for interactive TTY
  process.stdout.write(`${LAUNCH_SPINNER_FRAMES[0]} ${label}`);
  try {
    fn();
  } finally {
    // Clear the spinner line
    process.stdout.write("\r\x1b[K");
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

    if (plan.editor) plan.editor = await ctx.ensureAndResolve(plan.editor, "editor");
    if (plan.sidebarCommand) plan.sidebarCommand = await ctx.ensureAndResolve(plan.sidebarCommand, "sidebar");
    if (plan.secondaryEditor) plan.secondaryEditor = await ctx.ensureAndResolve(plan.secondaryEditor, "editor");
    if (plan.shellCommand) plan.shellCommand = await ctx.ensureAndResolve(plan.shellCommand, "shell");

    const starshipConfigPath = ctx.resolveStarship();
    const script = generateAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId);
    return executeScript(script, traditionalInventory(plan), ctx.projectName);
  },

  async launchTree(plan, ctx) {
    ensureGhostty();
    ensureAccessibility();

    for (const leafName of plan.leaves) {
      const pane = findPaneByName(plan.tree, leafName);
      if (pane?.command) {
        pane.command = await ctx.ensureAndResolve(pane.command, leafName);
      }
    }

    const starshipConfigPath = ctx.resolveStarship();
    const script = generateTreeAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId);
    return executeScript(script, treeInventory(plan), ctx.projectName);
  },
};
