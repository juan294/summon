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
import { getErrorMessage, ACCESSIBILITY_SETTINGS_PATH, QUICK_PROCESS_LIMITS } from "../utils.js";
import { escapeAppleScript } from "../shell-escape.js";
import { isStaticLaunchSpinner, transientLine } from "../ui/progress.js";
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
