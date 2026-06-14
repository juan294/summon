import { basename, resolve } from "node:path";
import type { LayoutPlan } from "./layout.js";
import type { TreeLayoutPlan, LayoutNode } from "./tree.js";
import { firstLeaf, walkLeaves } from "./tree.js";
import { GHOSTTY_APP_NAME, SUMMON_WORKSPACE_ENV } from "./utils.js";
import { escapeAppleScript, shellQuote, shellDoubleQuote } from "./shell-escape.js";

// --- AppleScript timing constants (empirically tuned for Ghostty responsiveness) ---

/** Delay before querying window size for resize (allows split to render). */
const RESIZE_QUERY_DELAY = 0.3;

/** Delay after resize action (allows Ghostty to process). */
const RESIZE_SETTLE_DELAY = 0.2;

/** Delay after creating a new window. */
const NEW_WINDOW_DELAY = 0.5;

/** Max Cmd+T / Cmd+N attempts before giving up. */
const KEYSTROKE_ATTEMPTS = 2;
/** Pause after `set frontmost to true`, before sending the keystroke. */
const KEYSTROKE_SETTLE_DELAY = 0.15;
/** Poll iterations waiting for the tab/window count to increase (per attempt). */
const TAB_POLL_ATTEMPTS = 12;
/** Delay between count polls. */
const TAB_POLL_INTERVAL = 0.05;

/** Editor size at which auto-resize is a no-op (50% = equal split already). */
const AUTO_RESIZE_THRESHOLD = 50;

// --- Shared helpers ---

/** Closures for building AppleScript lines. */
interface ScriptBuilder {
  add: (indent: number, line: string) => void;
  blank: () => void;
  sendCommand: (pane: string, cmd: string) => void;
  setInitialInput: (cmd: string) => void;
  clearInitialInput: () => void;
  setCwd: (cwd: string) => void;
}

/** Build the common closures used by both generators. */
function buildScriptBuilder(
  lines: string[],
): ScriptBuilder {
  const add = (indent: number, line: string) => {
    lines.push("    ".repeat(indent) + line);
  };
  const blank = () => lines.push("");

  const sendCommand = (pane: string, cmd: string) => {
    add(1, `input text "${escapeAppleScript(cmd)}" to ${pane}`);
    add(1, `send key "enter" to ${pane}`);
  };

  // initial input writes bytes to the PTY before the shell reads — the shell
  // starts normally (interactive login, all rc files sourced) and receives
  // the raw command as if the user typed it. Shell-agnostic: works for bash,
  // zsh, fish, ksh without any wrapper or flag differences.
  const setInitialInput = (cmd: string) => {
    add(1, `set initial input of cfg to "${escapeAppleScript(cmd)}\\n"`);
  };

  const clearInitialInput = () => {
    add(1, `set initial input of cfg to ""`);
  };

  const setCwd = (cwd: string) => {
    add(1, `set initial working directory of cfg to "${escapeAppleScript(cwd)}"`);
  };

  return { add, blank, sendCommand, setInitialInput, clearInitialInput, setCwd };
}

/** Build combined env vars list (workspace marker + Starship + tab title + user-defined). */
function buildEnvVarsList(
  starshipConfigPath: string | null | undefined,
  envVars: Record<string, string> | undefined,
  projectName?: string,
): string[] {
  const allEnvVars: string[] = [`${SUMMON_WORKSPACE_ENV}=1`];
  if (projectName) {
    allEnvVars.push(`SUMMON_TAB_TITLE=${projectName}`);
  }
  if (starshipConfigPath) {
    allEnvVars.push(`STARSHIP_CONFIG=${starshipConfigPath}`);
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      allEnvVars.push(`${key}=${value}`);
    }
  }
  return allEnvVars;
}

/**
 * Emit unified cleanup trap: on-stop → snapshot → marker removal.
 *
 * SE-L1: on-stop execution context
 *
 * The on-stop command is inlined into a shell EXIT/HUP trap that runs inside the
 * root Ghostty pane (the terminal itself), not in the Node.js launcher process.
 *
 * Execution scope:
 *   - **cwd**: the project directory (options.targetDir), set via `cd` before the
 *     editor command in emitRootPaneCommand. The trap inherits that working directory.
 *   - **environment**: the user's login shell environment as started by Ghostty, plus
 *     any env vars set via surface configuration (SUMMON_WORKSPACE, STARSHIP_CONFIG,
 *     user-defined env.* keys). The trap inherits the full pane environment.
 *   - **trust**: the on-stop command is sourced from a .summon file that has already
 *     passed the trust gate (assertTrustedContent) before launch(). Additionally,
 *     confirmDangerousCommands() warns the user if the value contains shell metacharacters.
 *     The command is NOT passed through shellQuote — it is inlined as a trusted shell
 *     fragment, which is required so it can use shell features (pipes, redirects, etc.).
 *     escapeAppleScript() is applied at the outer boundary (sendCommand) to keep the
 *     AppleScript string safe.
 *   - **stdout/stderr**: redirected to $HOME/.config/summon/logs/cleanup-<project>.log.
 *     The command's output is NOT shown in the terminal.
 *
 * // SE-L1: on-stop runs in the project directory with the user's login environment
 */
function emitCleanupTrap(
  { sendCommand }: ScriptBuilder,
  rootPaneVar: string,
  projectName: string,
  options?: { onStop?: string; targetDir?: string; layout?: string },
): void {
  const parts: string[] = [];

  // Ensure log directory exists for cleanup error logging.
  // SE-L3: mode 700 restricts access to the log directory to the owning user only,
  // consistent with STATUS_DIR/SNAPSHOTS_DIR which are also created with 0o700.
  const logDir = `"$HOME/.config/summon/logs"`;
  parts.push(`mkdir -p -m 700 ${logDir}`);

  if (options?.onStop) {
    // Inline the on-stop command directly (no eval wrapper).
    // Redirect errors to a log file instead of suppressing them.
    const logFile = `"$HOME/.config/summon/logs/cleanup-${shellDoubleQuote(projectName)}.log"`;
    parts.push(`${options.onStop} >> ${logFile} 2>&1`);
  }

  if (options?.targetDir) {
    parts.push(
      `summon snapshot save`
      + ` --dir "${shellDoubleQuote(options.targetDir)}"`
      + ` --project "${shellDoubleQuote(projectName)}"`
      + ` --layout "${shellDoubleQuote(options.layout ?? "unknown")}"`
      + ` 2>/dev/null`,
    );
  }

  const markerPath = `"$HOME/.config/summon/status/${shellDoubleQuote(projectName)}.active"`;
  const pidPath = `"$HOME/.config/summon/status/${shellDoubleQuote(projectName)}.pid"`;
  parts.push(`rm -f ${markerPath} ${pidPath} 2>/dev/null`);

  const body = parts.join("; ");
  // body: paths/names pre-escaped via shellDoubleQuote; onStop is a trusted shell command
  // fragment (not a value) — quoting it would break execution. escapeAppleScript applied
  // by sendCommand at the outer boundary.
  sendCommand(rootPaneVar, `__summon_cleanup() { ${body}; }; trap '__summon_cleanup' EXIT HUP`); // lint-allow-escape: pre-escaped parts; onStop is trusted command fragment from validated config
}

function emitRootPanePidBootstrap(
  { sendCommand }: ScriptBuilder,
  rootPaneVar: string,
  projectName: string,
): void {
  const statusDir = '"$HOME/.config/summon/status"';
  const pidPath    = `"$HOME/.config/summon/status/${shellDoubleQuote(projectName)}.pid"`;
  const markerPath = `"$HOME/.config/summon/status/${shellDoubleQuote(projectName)}.active"`;
  sendCommand(rootPaneVar, `mkdir -p ${statusDir} && printf '%s\\n' "$$" > ${pidPath} && : > ${markerPath}`); // lint-allow-escape: statusDir is constant; pidPath/markerPath pre-escaped via shellDoubleQuote above
}

/** Emit surface configuration block: working directory, font size, env vars. */
function emitSurfaceConfig(
  { add, blank }: ScriptBuilder,
  targetDir: string,
  fontSize: number | null,
  allEnvVars: string[],
): void {
  add(0, `tell application "${GHOSTTY_APP_NAME}"`);
  add(1, "activate");
  blank();

  // Surface configuration with working directory
  add(1, "set cfg to new surface configuration");
  add(1, `set initial working directory of cfg to "${escapeAppleScript(targetDir)}"`);
  if (fontSize !== null) {
    add(1, `set font size of cfg to ${fontSize}`);
  }
  const escaped = allEnvVars.map(e => `"${escapeAppleScript(e)}"`).join(", ");
  add(1, `set environment variables of cfg to {${escaped}}`);
  blank();
}

/** Emit env var exports to the root pane via input text. */
function emitRootPaneEnvExports(
  { sendCommand }: ScriptBuilder,
  rootPaneVar: string,
  allEnvVars: string[],
): void {
  for (const envVar of allEnvVars) {
    const eqIdx = envVar.indexOf("=");
    const key = envVar.slice(0, eqIdx);
    const val = envVar.slice(eqIdx + 1);
    sendCommand(rootPaneVar, `export ${key}=${shellQuote(val)}`);
  }
}

/** Emit cd + optional command to root pane via input text. */
function emitRootPaneCommand(
  { sendCommand }: ScriptBuilder,
  rootPaneVar: string,
  targetDir: string,
  command: string | null | undefined,
): void {
  sendCommand(rootPaneVar, `cd ${shellQuote(targetDir)}`);
  // Clear setup noise (exports, cd) so the pane starts clean
  sendCommand(rootPaneVar, "clear");
  if (command) {
    sendCommand(rootPaneVar, command);
  }
}

/** Emit pane and tab titles block. */
function emitTitles(
  { add, blank }: ScriptBuilder,
  rootPaneVar: string,
  targetDir: string,
  titles: Array<[string, string]>,
  projectName?: string,
): void {
  add(1, "-- Set pane and tab titles");
  const tabTitle = projectName ? `[${projectName}]` : basename(targetDir);
  add(1, `perform action "set_tab_title:${escapeAppleScript(tabTitle)}" on ${rootPaneVar}`);
  for (const [pane, title] of titles) {
    add(1, `perform action "set_surface_title:${escapeAppleScript(title)}" on ${pane}`);
  }
  blank();
}

/** Emit auto-resize block: query window size via System Events and resize split. */
function emitAutoResize(
  { add, blank }: ScriptBuilder,
  paneVar: string,
  editorSize: number,
): void {
  const fraction = (editorSize - AUTO_RESIZE_THRESHOLD) / 100;
  blank();
  add(1, "-- Resize editor/sidebar split");
  add(1, `delay ${RESIZE_QUERY_DELAY}`);
  add(1, 'tell application "System Events"');
  add(2, `tell process "${GHOSTTY_APP_NAME}"`);
  add(3, "set windowSize to size of front window");
  add(3, "set windowWidth to item 1 of windowSize");
  add(2, "end tell");
  add(1, "end tell");
  add(1, `set resizeAmount to round (windowWidth * ${fraction})`);
  add(1, `set resizeAction to "resize_split:right," & (resizeAmount as text)`);
  add(1, `perform action resizeAction on ${paneVar}`);
  add(1, `delay ${RESIZE_SETTLE_DELAY}`);
}

/** Emit window state actions (fullscreen, maximize, float). */
function emitWindowState(
  { add, blank }: ScriptBuilder,
  rootPaneVar: string,
  flags: { fullscreen: boolean; maximize: boolean; float: boolean },
): void {
  if (flags.fullscreen) {
    blank();
    add(1, "-- Fullscreen mode");
    add(1, `perform action "toggle_fullscreen" on ${rootPaneVar}`);
  } else if (flags.maximize) {
    blank();
    add(1, "-- Maximize window");
    add(1, `perform action "toggle_maximize" on ${rootPaneVar}`);
  }
  if (flags.float) {
    blank();
    add(1, "-- Float on top");
    add(1, `perform action "toggle_window_float_on_top" on ${rootPaneVar}`);
  }
}

/** Format a pane title: "role · cmd" or just "role" when cmd is falsy. */
function formatTitle(role: string, cmd: string | null | undefined): string {
  return cmd ? `${role} \u00B7 ${cmd}` : role;
}

// --- Internal helpers for script generation ---

function paneVar(name: string): string {
  return `pane_${name.replace(/-/g, "_")}`;
}

/**
 * Close all panes in the selected tab except the first, clearing restored session panes.
 *
 * BE-L2 #496: The prelude is scoped to `selected tab of front window`, which is the tab
 * summon will reuse in default mode (no --new-window). When --new-window is set, summon
 * opens a fresh Ghostty window via Cmd+N — there are no stale panes to clean in a new
 * window, and running the prelude would incorrectly close panes in the PREVIOUS front
 * window (an unrelated session). The `newWindow` guard below prevents this.
 */
function emitClosePrelude(sb: ScriptBuilder, cleanRestoredPanes: boolean, newWindow?: boolean): void {
  // Skip when disabled or when --new-window is active (fresh window has no stale panes,
  // and running would close panes in the previous unrelated front window — BE-L2 #496).
  if (!cleanRestoredPanes || newWindow) return;
  const { add, blank } = sb;
  add(1, "-- Clear restored panes from previous Ghostty session");
  add(1, "set targetTab to selected tab of front window");
  add(1, "repeat while (count of terminals of targetTab) > 1");
  add(2, "close last terminal of targetTab");
  add(1, "end repeat");
  add(1, "delay 0.1");
  blank();
}

/**
 * Emit a verified keystroke pattern: snapshot a count, send Cmd+key with retries,
 * poll for the count to increase, raise an error sentinel if all attempts fail.
 * When the count query throws (future Ghostty incompatibility), degrades to a
 * single keystroke + fixed delay rather than aborting.
 */
function emitVerifiedKeystroke(
  sb: ScriptBuilder,
  key: "n" | "t",
  beforeVar: string,
  openedVar: string,
  countExpr: string,
  errorSentinel: string,
): void {
  const { add } = sb;
  add(1, `set ${beforeVar} to -1`);
  add(1, "try");
  add(2, `set ${beforeVar} to ${countExpr}`);
  add(1, "end try");
  add(1, `set ${openedVar} to false`);
  add(1, `repeat ${KEYSTROKE_ATTEMPTS} times`);
  add(2, 'tell application "System Events"');
  add(3, `tell process "${GHOSTTY_APP_NAME}" to set frontmost to true`);
  add(2, "end tell");
  add(2, `delay ${KEYSTROKE_SETTLE_DELAY}`);
  add(2, 'tell application "System Events"');
  add(3, `tell process "${GHOSTTY_APP_NAME}"`);
  add(4, `keystroke "${key}" using command down`); // lint-allow-escape: key is typed "n"|"t" (TypeScript literal union) — compile-time constant, no user input
  add(3, "end tell");
  add(2, "end tell");
  add(2, `if ${beforeVar} is equal to -1 then`);
  add(3, `delay ${NEW_WINDOW_DELAY}`);
  add(3, `set ${openedVar} to true`);
  add(3, "exit repeat");
  add(2, "end if");
  add(2, `repeat ${TAB_POLL_ATTEMPTS} times`);
  add(3, `delay ${TAB_POLL_INTERVAL}`);
  add(3, `if (${countExpr}) > ${beforeVar} then`);
  add(4, `set ${openedVar} to true`);
  add(4, "exit repeat");
  add(3, "end if");
  add(2, "end repeat");
  add(2, `if ${openedVar} then exit repeat`);
  add(1, "end repeat");
  add(1, `if not ${openedVar} then`);
  add(2, `error "${errorSentinel}"`);
  add(1, "end if");
}

/**
 * Emit AppleScript to create or reference the front window.
 * Uses System Events keystroke (Cmd+N) for new windows in all modes.
 */
function emitNewWindow(
  sb: ScriptBuilder,
  newWindow: boolean,
): void {
  if (newWindow) {
    emitVerifiedKeystroke(
      sb, "n",
      "summonWindowsBefore", "summonWindowOpened",
      "count of windows", "summon-newwindow-failed",
    );
  }
  sb.add(1, "set win to front window");
}

/**
 * Emit AppleScript to open a new tab in the front Ghostty window via System Events Cmd+T.
 *
 * Why not `make new tab`: Ghostty's dictionary verb creates the tab but its return value
 * triggers a Cocoa Scripting coercion error (-2710) that aborts the enclosing AppleScript
 * block. Cmd+T via System Events is the same pattern summon uses for `--new-window`
 * (Cmd+N) and avoids the bug. The new tab becomes selected automatically.
 */
function emitNewTab(sb: ScriptBuilder): void {
  const { add } = sb;
  add(1, "-- Open a new tab (anchored to the front window + verified)");
  add(1, "set summonWin to front window");
  emitVerifiedKeystroke(
    sb, "t",
    "summonTabsBefore", "summonTabOpened",
    "count of tabs of summonWin", "summon-newtab-failed",
  );
}

/** Emit right column pane splits (first right pane + additional editors + optional shell). */
function emitRightColumnSplits(
  sb: ScriptBuilder,
  titles: Array<[string, string]>,
  plan: LayoutPlan,
  interactiveShellPanes: string[],
): void {
  const { add, blank, setInitialInput, clearInitialInput } = sb;
  const secondaryCmd = plan.secondaryEditor ?? plan.editor;
  const needsRightColumn = plan.rightColumnEditorCount > 0 || plan.hasShell;

  if (!needsRightColumn) return;

  blank();
  // First right column pane: editor or shell
  if (plan.rightColumnEditorCount > 0) {
    if (secondaryCmd) {
      setInitialInput(secondaryCmd);
    } else {
      clearInitialInput();
    }
    add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");
    titles.push(["paneRightCol", formatTitle("editor", secondaryCmd || null)]);
  } else {
    // Right column exists only for shell
    if (plan.shellCommand) {
      setInitialInput(plan.shellCommand);
    } else {
      clearInitialInput();
      interactiveShellPanes.push("paneRightCol");
    }
    add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");
    titles.push(["paneRightCol", formatTitle("shell", plan.shellCommand)]);
  }

  // Additional right column panes (editors + shell at bottom)
  if (plan.rightColumnEditorCount > 0) {
    let lastRightPane = "paneRightCol";
    let nextRight = 2;

    if (plan.rightColumnEditorCount > 1 && secondaryCmd) {
      setInitialInput(secondaryCmd);
    }
    for (let i = 2; i <= plan.rightColumnEditorCount; i++) {
      const name = `paneRight${nextRight}`;
      blank();
      add(1, `set ${name} to split ${lastRightPane} direction down with configuration cfg`);
      titles.push([name, formatTitle("editor", secondaryCmd || null)]);
      lastRightPane = name;
      nextRight++;
    }

    if (plan.hasShell) {
      const name = `paneRight${nextRight}`;
      blank();
      if (plan.shellCommand) {
        setInitialInput(plan.shellCommand);
      } else {
        clearInitialInput();
        interactiveShellPanes.push(name);
      }
      add(1, `set ${name} to split ${lastRightPane} direction down with configuration cfg`);
      titles.push([name, formatTitle("shell", plan.shellCommand)]);
    }
  }
}

/** Emit left column editor pane splits. */
function emitEditorColumnSplits(
  sb: ScriptBuilder,
  titles: Array<[string, string]>,
  plan: LayoutPlan,
): void {
  const { add, blank, setInitialInput } = sb;
  const editorCmd = plan.editor;
  let lastLeftPane = "paneRoot";
  if (plan.leftColumnCount > 1 && editorCmd) {
    setInitialInput(editorCmd);
  }
  for (let i = 2; i <= plan.leftColumnCount; i++) {
    const name = `paneLeft${i}`;
    blank();
    add(1, `set ${name} to split ${lastLeftPane} direction down with configuration cfg`);
    titles.push([name, formatTitle("editor", editorCmd || null)]);
    lastLeftPane = name;
  }
}

/**
 * Recursively traverse the layout tree and emit split AppleScript.
 * Handles auto-resize on the first right split at root level.
 */
function emitTreeTraversal(
  sb: ScriptBuilder,
  tree: LayoutNode,
  rootPaneVar: string,
  plan: TreeLayoutPlan,
  targetDir: string,
): void {
  let firstRightSplitDone = false;

  function traverse(node: LayoutNode, currentPaneVar: string): void {
    if (node.type === "pane") return;

    const secondLeaf = firstLeaf(node.second);
    const secondLeafVar = paneVar(secondLeaf.name);

    if (secondLeaf.command) {
      sb.setInitialInput(secondLeaf.command);
    } else {
      sb.clearInitialInput();
    }

    // Update working directory for this pane (custom cwd or default)
    const paneDir = secondLeaf.cwd ? resolve(targetDir, secondLeaf.cwd) : targetDir;
    sb.setCwd(paneDir);

    sb.add(1, `set ${secondLeafVar} to split ${currentPaneVar} direction ${node.direction} with configuration cfg`);

    if (node.direction === "right" && !firstRightSplitDone && plan.autoResize && plan.editorSize > AUTO_RESIZE_THRESHOLD) {
      firstRightSplitDone = true;
      emitAutoResize(sb, currentPaneVar, plan.editorSize);
    }

    traverse(node.first, currentPaneVar);
    traverse(node.second, secondLeafVar);
  }

  traverse(tree, rootPaneVar);
}

/** Collect all leaf panes with their commands in depth-first order. */
function collectLeavesWithCommands(node: LayoutNode): Array<[string, string]> {
  return walkLeaves(node, (p) => [p.name, p.command]);
}

// --- Public API ---

export function generateFocusScript(tabTitle: string): string {
  const lines: string[] = [];
  lines.push(`-- Focus workspace: ${escapeAppleScript(tabTitle)}`);
  lines.push(`tell application "${GHOSTTY_APP_NAME}"`);
  lines.push("    activate");
  lines.push("end tell");
  return lines.join("\n");
}

/**
 * Generate AppleScript for a traditional (LayoutPlan) workspace.
 *
 * This is a pure stateless function — no memoization cache (AR-M2 #544).
 * The cache was removed because it never hit in production (one script per process)
 * and created divergence with generateTreeAppleScript which had no cache.
 */
export function generateAppleScript(plan: LayoutPlan, targetDir: string, starshipConfigPath?: string | null, envVars?: Record<string, string>, projectName?: string, onStop?: string): string {
  const lines: string[] = [];
  const titles: Array<[string, string]> = [];
  const interactiveShellPanes: string[] = [];
  const sb = buildScriptBuilder(lines);

  const allEnvVars = buildEnvVarsList(starshipConfigPath, envVars, projectName);

  emitSurfaceConfig(sb, targetDir, plan.fontSize, allEnvVars);
  emitClosePrelude(sb, plan.cleanRestoredPanes, plan.newWindow);
  if (plan.newTab) {
    emitNewTab(sb);
    sb.add(1, "set paneRoot to terminal 1 of selected tab of summonWin");
  } else {
    emitNewWindow(sb, plan.newWindow);
    sb.add(1, "set paneRoot to terminal 1 of selected tab of win");
  }
  sb.blank();

  titles.push(["paneRoot", formatTitle("editor", plan.editor || null)]);

  // Sidebar split
  if (plan.sidebarCommand) {
    sb.setInitialInput(plan.sidebarCommand);
  }
  sb.add(1, "set paneSidebar to split paneRoot direction right with configuration cfg");
  titles.push(["paneSidebar", formatTitle("sidebar", plan.sidebarCommand || null)]);

  if (plan.autoResize && plan.editorSize > AUTO_RESIZE_THRESHOLD) {
    emitAutoResize(sb, "paneRoot", plan.editorSize);
  }

  // Column splits
  emitRightColumnSplits(sb, titles, plan, interactiveShellPanes);
  emitEditorColumnSplits(sb, titles, plan);

  sb.blank();

  // Root pane env var exports
  emitRootPaneEnvExports(sb, "paneRoot", allEnvVars);

  if (projectName) {
    emitRootPanePidBootstrap(sb, "paneRoot", projectName);
  }

  // Cleanup trap: on-stop → snapshot → marker/pid removal
  if (projectName) {
    emitCleanupTrap(sb, "paneRoot", projectName, { onStop, targetDir });
  }

  for (const pane of interactiveShellPanes) {
    sb.sendCommand(pane, "clear");
  }

  emitRootPaneCommand(sb, "paneRoot", targetDir, plan.editor);
  sb.blank();

  emitTitles(sb, "paneRoot", targetDir, titles, projectName);
  sb.add(1, "focus paneRoot");
  emitWindowState(sb, "paneRoot", plan);

  sb.add(0, "end tell");
  return lines.join("\n");
}

export function generateTreeAppleScript(
  plan: TreeLayoutPlan,
  targetDir: string,
  starshipConfigPath?: string | null,
  envVars?: Record<string, string>,
  projectName?: string,
  onStop?: string,
): string {
  const lines: string[] = [];
  const titles: Array<[string, string]> = [];
  const sb = buildScriptBuilder(lines);

  const allEnvVars = buildEnvVarsList(starshipConfigPath, envVars, projectName);
  const rootLeaf = firstLeaf(plan.tree);
  const rootPaneVar = paneVar(rootLeaf.name);

  emitSurfaceConfig(sb, targetDir, plan.fontSize, allEnvVars);
  emitClosePrelude(sb, plan.cleanRestoredPanes, plan.newWindow);
  if (plan.newTab) {
    emitNewTab(sb);
    sb.add(1, `set ${rootPaneVar} to terminal 1 of selected tab of summonWin`);
  } else {
    emitNewWindow(sb, plan.newWindow);
    sb.add(1, `set ${rootPaneVar} to terminal 1 of selected tab of win`);
  }
  sb.blank();

  emitTreeTraversal(sb, plan.tree, rootPaneVar, plan, targetDir);
  sb.blank();

  const rootCwd = rootLeaf.cwd ? resolve(targetDir, rootLeaf.cwd) : targetDir;
  emitRootPaneEnvExports(sb, rootPaneVar, allEnvVars);

  if (projectName) {
    emitRootPanePidBootstrap(sb, rootPaneVar, projectName);
  }

  // Cleanup trap: on-stop → snapshot → marker/pid removal
  if (projectName) {
    emitCleanupTrap(sb, rootPaneVar, projectName, { onStop, targetDir });
  }

  emitRootPaneCommand(sb, rootPaneVar, rootCwd, rootLeaf.command);
  sb.blank();

  for (const [leafName, cmd] of collectLeavesWithCommands(plan.tree)) {
    titles.push([paneVar(leafName), formatTitle(leafName, cmd)]);
  }
  emitTitles(sb, rootPaneVar, targetDir, titles, projectName);

  sb.add(1, `focus ${rootPaneVar}`);
  emitWindowState(sb, rootPaneVar, plan);

  sb.add(0, "end tell");
  return lines.join("\n");
}
