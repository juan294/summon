import { basename, resolve } from "node:path";
import type { LayoutPlan } from "./layout.js";
import type { TreeLayoutPlan, LayoutNode } from "./tree.js";
import { firstLeaf, walkLeaves } from "./tree.js";
import { GHOSTTY_APP_NAME, SUMMON_WORKSPACE_ENV } from "./utils.js";

// --- AppleScript timing constants (empirically tuned for Ghostty responsiveness) ---

/** Delay before querying window size for resize (allows split to render). */
const RESIZE_QUERY_DELAY = 0.3;

/** Delay after resize action (allows Ghostty to process). */
const RESIZE_SETTLE_DELAY = 0.2;

/** Delay after creating a new window. */
const NEW_WINDOW_DELAY = 0.5;

/** Editor size at which auto-resize is a no-op (50% = equal split already). */
const AUTO_RESIZE_THRESHOLD = 50;

function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** POSIX single-quote escaping: wrap in single quotes, escape embedded single quotes. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// --- Shared helpers ---

/** Closures for building AppleScript lines. */
interface ScriptBuilder {
  add: (indent: number, line: string) => void;
  blank: () => void;
  sendCommand: (pane: string, cmd: string) => void;
  setConfigCommand: (cmd: string, paneCwd?: string) => void;
  clearConfigCommand: () => void;
}

/** Build the common closures used by both generators. */
function buildScriptBuilder(
  lines: string[],
  targetDir: string,
  loginShell: string,
): ScriptBuilder {
  const add = (indent: number, line: string) => {
    lines.push("    ".repeat(indent) + line);
  };
  const blank = () => lines.push("");

  const sendCommand = (pane: string, cmd: string) => {
    add(1, `input text "${escapeAppleScript(cmd)}" to ${pane}`);
    add(1, `send key "enter" to ${pane}`);
  };

  // Config-launched panes run in a restricted shell without PATH (--noprofile --norc).
  // Wrap in the user's login shell so commands like npm can find their interpreters.
  // Input-text commands (root pane) run in an already-initialized shell — no wrapping needed.
  const quotedTargetDir = shellQuote(targetDir);
  // Env vars are now set on surface config, so no need to embed exports in the -lc argument.
  const wrapForConfig = (cmd: string, paneCwd?: string): string => {
    const dir = paneCwd
      ? shellQuote(resolve(targetDir, paneCwd))
      : quotedTargetDir;
    return `${loginShell} -lc ${shellQuote(`cd ${dir} && ${cmd}`)}`;
  };

  const setConfigCommand = (cmd: string, paneCwd?: string) => {
    add(1, `set command of cfg to "${escapeAppleScript(wrapForConfig(cmd, paneCwd))}"`);
  };

  const clearConfigCommand = () => {
    add(1, `set command of cfg to ""`);
  };

  return { add, blank, sendCommand, setConfigCommand, clearConfigCommand };
}

/** Build combined env vars list (workspace marker + Starship + user-defined). */
function buildEnvVarsList(
  starshipConfigPath: string | null | undefined,
  envVars: Record<string, string> | undefined,
): string[] {
  const allEnvVars: string[] = [`${SUMMON_WORKSPACE_ENV}=1`];
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

/** Emit surface configuration block: working directory, font size, env vars. */
function emitSurfaceConfig(
  { add, blank }: ScriptBuilder,
  targetDir: string,
  fontSize: number | null,
  theme: string | null,
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
  if (theme !== null) {
    add(1, `set theme of cfg to "${escapeAppleScript(theme)}"`);
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
    // Shell-quote arguments to prevent metacharacter expansion ($, `, etc.)
    // The command name is left unquoted so the shell can resolve it.
    const parts = command.split(" ");
    const safeCmd = parts.length > 1
      ? `${parts[0]} ${parts.slice(1).map((a) => shellQuote(a)).join(" ")}`
      : command;
    sendCommand(rootPaneVar, safeCmd);
  }
}

/** Emit pane and tab titles block. */
function emitTitles(
  { add, blank }: ScriptBuilder,
  rootPaneVar: string,
  targetDir: string,
  titles: Array<[string, string]>,
): void {
  add(1, "-- Set pane and tab titles");
  const projectName = basename(targetDir);
  add(1, `perform action "set_tab_title:${escapeAppleScript(projectName)}" on ${rootPaneVar}`);
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
 * Emit AppleScript to create or reference the front window.
 * Uses System Events keystroke (Cmd+N) for new windows in all modes.
 */
function emitNewWindow(
  sb: ScriptBuilder,
  newWindow: boolean,
): void {
  const { add } = sb;
  if (newWindow) {
    add(1, 'tell application "System Events"');
    add(2, `tell process "${GHOSTTY_APP_NAME}"`);
    add(3, 'keystroke "n" using command down');
    add(2, "end tell");
    add(1, "end tell");
    add(1, `delay ${NEW_WINDOW_DELAY}`);
  }
  add(1, "set win to front window");
}

/** Emit right column pane splits (first right pane + additional editors + optional shell). */
function emitRightColumnSplits(
  sb: ScriptBuilder,
  titles: Array<[string, string]>,
  plan: LayoutPlan,
  interactiveShellPanes: string[],
): void {
  const { add, blank, setConfigCommand, clearConfigCommand } = sb;
  const secondaryCmd = plan.secondaryEditor ?? plan.editor;
  const needsRightColumn = plan.rightColumnEditorCount > 0 || plan.hasShell;

  if (!needsRightColumn) return;

  blank();
  // First right column pane: editor or shell
  if (plan.rightColumnEditorCount > 0) {
    if (secondaryCmd) {
      setConfigCommand(secondaryCmd);
    } else {
      clearConfigCommand();
    }
    add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");
    titles.push(["paneRightCol", formatTitle("editor", secondaryCmd || null)]);
  } else {
    // Right column exists only for shell
    if (plan.shellCommand) {
      setConfigCommand(plan.shellCommand);
    } else {
      clearConfigCommand();
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
      setConfigCommand(secondaryCmd);
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
        setConfigCommand(plan.shellCommand);
      } else {
        clearConfigCommand();
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
  const { add, blank, setConfigCommand } = sb;
  const editorCmd = plan.editor;
  let lastLeftPane = "paneRoot";
  if (plan.leftColumnCount > 1 && editorCmd) {
    setConfigCommand(editorCmd);
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
): void {
  let firstRightSplitDone = false;

  function traverse(node: LayoutNode, currentPaneVar: string): void {
    if (node.type === "pane") return;

    const secondLeaf = firstLeaf(node.second);
    const secondLeafVar = paneVar(secondLeaf.name);

    if (secondLeaf.command) {
      sb.setConfigCommand(secondLeaf.command, secondLeaf.cwd);
    } else {
      sb.clearConfigCommand();
    }

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

export function generateAppleScript(plan: LayoutPlan, targetDir: string, loginShell = "/bin/bash", starshipConfigPath?: string | null, envVars?: Record<string, string>): string {
  const lines: string[] = [];
  const titles: Array<[string, string]> = [];
  const interactiveShellPanes: string[] = [];
  const sb = buildScriptBuilder(lines, targetDir, loginShell);

  const allEnvVars = buildEnvVarsList(starshipConfigPath, envVars);

  emitSurfaceConfig(sb, targetDir, plan.fontSize, plan.theme, allEnvVars);
  emitNewWindow(sb, plan.newWindow);
  sb.add(1, "set paneRoot to terminal 1 of selected tab of win");
  sb.blank();

  titles.push(["paneRoot", formatTitle("editor", plan.editor || null)]);

  // Sidebar split
  if (plan.sidebarCommand) {
    sb.setConfigCommand(plan.sidebarCommand);
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

  for (const pane of interactiveShellPanes) {
    sb.sendCommand(pane, "clear");
  }

  emitRootPaneCommand(sb, "paneRoot", targetDir, plan.editor);
  sb.blank();

  emitTitles(sb, "paneRoot", targetDir, titles);
  sb.add(1, "focus paneRoot");
  emitWindowState(sb, "paneRoot", plan);

  sb.add(0, "end tell");
  return lines.join("\n");
}

export function generateTreeAppleScript(
  plan: TreeLayoutPlan,
  targetDir: string,
  loginShell = "/bin/bash",
  starshipConfigPath?: string | null,
  envVars?: Record<string, string>,
): string {
  const lines: string[] = [];
  const titles: Array<[string, string]> = [];
  const sb = buildScriptBuilder(lines, targetDir, loginShell);

  const allEnvVars = buildEnvVarsList(starshipConfigPath, envVars);
  const rootLeaf = firstLeaf(plan.tree);
  const rootPaneVar = paneVar(rootLeaf.name);

  emitSurfaceConfig(sb, targetDir, plan.fontSize, plan.theme, allEnvVars);
  emitNewWindow(sb, plan.newWindow);
  sb.add(1, `set ${rootPaneVar} to terminal 1 of selected tab of win`);
  sb.blank();

  emitTreeTraversal(sb, plan.tree, rootPaneVar, plan);
  sb.blank();

  const rootCwd = rootLeaf.cwd ? resolve(targetDir, rootLeaf.cwd) : targetDir;
  emitRootPaneEnvExports(sb, rootPaneVar, allEnvVars);
  emitRootPaneCommand(sb, rootPaneVar, rootCwd, rootLeaf.command);
  sb.blank();

  for (const [leafName, cmd] of collectLeavesWithCommands(plan.tree)) {
    titles.push([paneVar(leafName), formatTitle(leafName, cmd)]);
  }
  emitTitles(sb, rootPaneVar, targetDir, titles);

  sb.add(1, `focus ${rootPaneVar}`);
  emitWindowState(sb, rootPaneVar, plan);

  sb.add(0, "end tell");
  return lines.join("\n");
}
