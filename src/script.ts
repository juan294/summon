import { basename } from "node:path";
import type { LayoutPlan } from "./layout.js";
import type { TreeLayoutPlan, LayoutNode } from "./tree.js";
import { firstLeaf } from "./tree.js";

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

export function generateAppleScript(plan: LayoutPlan, targetDir: string, loginShell = "/bin/bash", starshipConfigPath?: string | null, envVars?: Record<string, string>): string {
  const lines: string[] = [];
  const titles: Array<[string, string]> = [];

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
  const wrapForConfig = (cmd: string): string => {
    return `${loginShell} -lc ${shellQuote(`cd ${quotedTargetDir} && ${cmd}`)}`;
  };

  const setConfigCommand = (cmd: string) => {
    add(1, `set command of cfg to "${escapeAppleScript(wrapForConfig(cmd))}"`);
  };

  const clearConfigCommand = () => {
    add(1, `set command of cfg to ""`);
  };

  add(0, 'tell application "Ghostty"');
  add(1, "activate");
  blank();

  // Surface configuration with working directory
  add(1, "set cfg to new surface configuration");
  add(1, `set initial working directory of cfg to "${escapeAppleScript(targetDir)}"`);
  if (plan.fontSize !== null) {
    add(1, `set font size of cfg to ${plan.fontSize}`);
  }
  // Build combined env vars list (Starship + user-defined)
  const allEnvVars: string[] = [];
  if (starshipConfigPath) {
    allEnvVars.push(`STARSHIP_CONFIG=${starshipConfigPath}`);
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      allEnvVars.push(`${key}=${value}`);
    }
  }
  if (allEnvVars.length > 0) {
    const escaped = allEnvVars.map(e => `"${escapeAppleScript(e)}"`).join(", ");
    add(1, `set environment variables of cfg to {${escaped}}`);
  }
  blank();

  // Get or create window for workspace
  // Note: Ghostty's `make new window` returns an unusable tab-group reference
  // (AppleScript error -2710), so we use Cmd+N via System Events as a workaround.
  if (plan.newWindow) {
    add(1, 'tell application "System Events"');
    add(2, 'tell process "Ghostty"');
    add(3, 'keystroke "n" using command down');
    add(2, "end tell");
    add(1, "end tell");
    add(1, "delay 0.5");
  }
  add(1, "set win to front window");
  add(1, "set paneRoot to terminal 1 of selected tab of win");
  blank();

  const editorCmd = plan.editor;
  const secondaryCmd = plan.secondaryEditor ?? editorCmd;
  const interactiveShellPanes: string[] = []; // panes needing STARSHIP_CONFIG export

  const formatTitle = (role: string, cmd: string | null | undefined): string => {
    return cmd ? `${role} \u00B7 ${cmd}` : role;
  };

  titles.push(["paneRoot", formatTitle("editor", editorCmd || null)]);

  // Split sidebar (far right) — set command on cfg before split
  if (plan.sidebarCommand) {
    setConfigCommand(plan.sidebarCommand);
  }
  add(1, "set paneSidebar to split paneRoot direction right with configuration cfg");
  titles.push(["paneSidebar", formatTitle("sidebar", plan.sidebarCommand || null)]);

  // Resize editor/sidebar split to match editorSize.
  // Done here (before editor column splits) so the subsequent 50/50 split
  // of paneRoot produces two equal editor columns within the resized area.
  if (plan.autoResize && plan.editorSize > 50) {
    const fraction = (plan.editorSize - 50) / 100;
    blank();
    add(1, "-- Resize editor/sidebar split");
    add(1, "delay 0.3");
    add(1, 'tell application "System Events"');
    add(2, 'tell process "Ghostty"');
    add(3, "set windowSize to size of front window");
    add(3, "set windowWidth to item 1 of windowSize");
    add(2, "end tell");
    add(1, "end tell");
    add(1, `set resizeAmount to round (windowWidth * ${fraction})`);
    add(1, `set resizeAction to "resize_split:right," & (resizeAmount as text)`);
    add(1, "perform action resizeAction on paneRoot");
    add(1, "delay 0.2");
  }

  const needsRightColumn = plan.rightColumnEditorCount > 0 || plan.hasShell;

  if (needsRightColumn) {
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
      titles.push(["paneRightCol", formatTitle("server", plan.shellCommand)]);
    }
  }

  // Split additional left column panes vertically
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

  // Split additional right column panes (editors + shell)
  if (needsRightColumn && plan.rightColumnEditorCount > 0) {
    let lastRightPane = "paneRightCol";
    let nextRight = 2;

    // Additional right column editor panes
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

    // Shell pane at bottom of right column
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
      titles.push([name, formatTitle("server", plan.shellCommand)]);
    }
  }

  blank();

  // Root pane env var exports: the root pane is never created with cfg
  // (it's either the existing front window terminal, or a new window via Cmd+N),
  // so it needs explicit exports. Split panes inherit env vars from cfg automatically.
  if (allEnvVars.length > 0) {
    for (const envVar of allEnvVars) {
      const eqIdx = envVar.indexOf("=");
      const key = envVar.slice(0, eqIdx);
      const val = envVar.slice(eqIdx + 1);
      sendCommand("paneRoot", `export ${key}=${shellQuote(val)}`);
    }
  }

  // Clear interactive shell panes for a clean start (removes "Last login" and setup commands)
  for (const pane of interactiveShellPanes) {
    sendCommand(pane, "clear");
  }

  // Root pane: cd into project directory, then launch editor
  sendCommand("paneRoot", `cd ${shellQuote(targetDir)}`);
  if (editorCmd) {
    // Shell-quote arguments to prevent metacharacter expansion ($, `, etc.)
    // The command name is left unquoted so the shell can resolve it.
    const parts = editorCmd.split(" ");
    const safeCmd = parts.length > 1
      ? `${parts[0]} ${parts.slice(1).map((a) => shellQuote(a)).join(" ")}`
      : editorCmd;
    sendCommand("paneRoot", safeCmd);
  }

  blank();

  // Set pane and tab titles
  add(1, "-- Set pane and tab titles");
  const projectName = basename(targetDir);
  add(1, `perform action "set_tab_title:${escapeAppleScript(projectName)}" on paneRoot`);
  for (const [pane, title] of titles) {
    add(1, `perform action "set_surface_title:${escapeAppleScript(title)}" on ${pane}`);
  }

  blank();

  // Focus root pane
  add(1, "focus paneRoot");

  // Window state actions
  if (plan.fullscreen) {
    blank();
    add(1, "-- Fullscreen mode");
    add(1, 'perform action "toggle_fullscreen" on paneRoot');
  } else if (plan.maximize) {
    blank();
    add(1, "-- Maximize window");
    add(1, 'perform action "toggle_maximize" on paneRoot');
  }
  if (plan.float) {
    blank();
    add(1, "-- Float on top");
    add(1, 'perform action "toggle_window_float_on_top" on paneRoot');
  }

  add(0, "end tell");

  return lines.join("\n");
}

function paneVar(name: string): string {
  return `pane_${name.replace(/-/g, "_")}`;
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

  const add = (indent: number, line: string) => {
    lines.push("    ".repeat(indent) + line);
  };
  const blank = () => lines.push("");

  const sendCommand = (pane: string, cmd: string) => {
    add(1, `input text "${escapeAppleScript(cmd)}" to ${pane}`);
    add(1, `send key "enter" to ${pane}`);
  };

  const quotedTargetDir = shellQuote(targetDir);
  const wrapForConfig = (cmd: string): string => {
    return `${loginShell} -lc ${shellQuote(`cd ${quotedTargetDir} && ${cmd}`)}`;
  };

  const setConfigCommand = (cmd: string) => {
    add(1, `set command of cfg to "${escapeAppleScript(wrapForConfig(cmd))}"`);
  };

  const clearConfigCommand = () => {
    add(1, `set command of cfg to ""`);
  };

  const formatTitle = (name: string, cmd: string): string => {
    return cmd ? `${name} \u00B7 ${cmd}` : name;
  };

  // --- Initialization ---

  add(0, 'tell application "Ghostty"');
  add(1, "activate");
  blank();

  // Surface configuration with working directory
  add(1, "set cfg to new surface configuration");
  add(1, `set initial working directory of cfg to "${escapeAppleScript(targetDir)}"`);
  if (plan.fontSize !== null) {
    add(1, `set font size of cfg to ${plan.fontSize}`);
  }

  // Build combined env vars list (Starship + user-defined)
  const allEnvVars: string[] = [];
  if (starshipConfigPath) {
    allEnvVars.push(`STARSHIP_CONFIG=${starshipConfigPath}`);
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      allEnvVars.push(`${key}=${value}`);
    }
  }
  if (allEnvVars.length > 0) {
    const escaped = allEnvVars.map(e => `"${escapeAppleScript(e)}"`).join(", ");
    add(1, `set environment variables of cfg to {${escaped}}`);
  }
  blank();

  // Get or create window for workspace
  const rootLeaf = firstLeaf(plan.tree);
  const rootPaneVar = paneVar(rootLeaf.name);

  if (plan.newWindow) {
    add(1, "set win to make new window with configuration cfg");
    add(1, "delay 0.3");
  } else {
    add(1, "set win to front window");
  }
  add(1, `set ${rootPaneVar} to terminal 1 of selected tab of win`);
  blank();

  // --- Recursive Tree Traversal ---

  let firstRightSplitDone = false;

  function traverse(node: LayoutNode, currentPaneVar: string): void {
    if (node.type === "pane") {
      // Leaf node — nothing to do during traversal.
      // It was already handled as "current pane" by its parent split.
      return;
    }

    // SplitNode: get the first leaf of the second child
    const secondLeaf = firstLeaf(node.second);
    const secondLeafVar = paneVar(secondLeaf.name);

    // Set config command for the new pane
    if (secondLeaf.command) {
      setConfigCommand(secondLeaf.command);
    } else {
      clearConfigCommand();
    }

    // Split the current pane
    add(1, `set ${secondLeafVar} to split ${currentPaneVar} direction ${node.direction} with configuration cfg`);

    // Auto-resize after the FIRST right-split at the root level
    if (node.direction === "right" && !firstRightSplitDone && plan.autoResize && plan.editorSize > 50) {
      firstRightSplitDone = true;
      const fraction = (plan.editorSize - 50) / 100;
      blank();
      add(1, "-- Resize editor/sidebar split");
      add(1, "delay 0.3");
      add(1, 'tell application "System Events"');
      add(2, 'tell process "Ghostty"');
      add(3, "set windowSize to size of front window");
      add(3, "set windowWidth to item 1 of windowSize");
      add(2, "end tell");
      add(1, "end tell");
      add(1, `set resizeAmount to round (windowWidth * ${fraction})`);
      add(1, `set resizeAction to "resize_split:right," & (resizeAmount as text)`);
      add(1, `perform action resizeAction on ${currentPaneVar}`);
      add(1, "delay 0.2");
    }

    // Recurse into first child (stays in current pane variable)
    traverse(node.first, currentPaneVar);
    // Recurse into second child (uses the new pane variable)
    traverse(node.second, secondLeafVar);
  }

  traverse(plan.tree, rootPaneVar);
  blank();

  // --- Root Pane Commands ---

  // Env var exports for root pane: only needed when NOT using new-window mode
  if (allEnvVars.length > 0 && !plan.newWindow) {
    for (const envVar of allEnvVars) {
      const eqIdx = envVar.indexOf("=");
      const key = envVar.slice(0, eqIdx);
      const val = envVar.slice(eqIdx + 1);
      sendCommand(rootPaneVar, `export ${key}=${shellQuote(val)}`);
    }
  }

  // Root pane: cd into project directory, then launch command
  sendCommand(rootPaneVar, `cd ${shellQuote(targetDir)}`);
  if (rootLeaf.command) {
    const parts = rootLeaf.command.split(" ");
    const safeCmd = parts.length > 1
      ? `${parts[0]} ${parts.slice(1).map((a) => shellQuote(a)).join(" ")}`
      : rootLeaf.command;
    sendCommand(rootPaneVar, safeCmd);
  }

  blank();

  // --- Pane and Tab Titles ---

  add(1, "-- Set pane and tab titles");
  const projectName = basename(targetDir);
  add(1, `perform action "set_tab_title:${escapeAppleScript(projectName)}" on ${rootPaneVar}`);

  // Collect all leaf panes with commands in a single pass
  function collectLeavesWithCommands(node: LayoutNode): Array<[string, string]> {
    if (node.type === "pane") {
      return [[node.name, node.command]];
    }
    return [...collectLeavesWithCommands(node.first), ...collectLeavesWithCommands(node.second)];
  }
  for (const [leafName, cmd] of collectLeavesWithCommands(plan.tree)) {
    titles.push([paneVar(leafName), formatTitle(leafName, cmd)]);
  }

  for (const [pane, title] of titles) {
    add(1, `perform action "set_surface_title:${escapeAppleScript(title)}" on ${pane}`);
  }

  blank();

  // --- Focus root pane ---

  add(1, `focus ${rootPaneVar}`);

  // --- Window State ---

  if (plan.fullscreen) {
    blank();
    add(1, "-- Fullscreen mode");
    add(1, `perform action "toggle_fullscreen" on ${rootPaneVar}`);
  } else if (plan.maximize) {
    blank();
    add(1, "-- Maximize window");
    add(1, `perform action "toggle_maximize" on ${rootPaneVar}`);
  }
  if (plan.float) {
    blank();
    add(1, "-- Float on top");
    add(1, `perform action "toggle_window_float_on_top" on ${rootPaneVar}`);
  }

  add(0, "end tell");

  return lines.join("\n");
}

