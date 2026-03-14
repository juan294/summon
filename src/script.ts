import { basename } from "node:path";
import type { LayoutPlan } from "./layout.js";

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

export function generateAppleScript(plan: LayoutPlan, targetDir: string, loginShell = "/bin/bash", starshipConfigPath?: string | null): string {
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
  const wrapForConfig = (cmd: string): string => {
    const base = `${loginShell} -lc ${shellQuote(`cd ${quotedTargetDir} && ${cmd}`)}`;
    if (!starshipConfigPath) return base;
    return `STARSHIP_CONFIG=${shellQuote(starshipConfigPath)} ${base}`;
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
  blank();

  // Use current tab in front window as root
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

  // Set STARSHIP_CONFIG in interactive shell panes for per-workspace Starship themes
  if (starshipConfigPath) {
    const exportCmd = `export STARSHIP_CONFIG=${shellQuote(starshipConfigPath)}`;
    sendCommand("paneRoot", exportCmd);
    for (const pane of interactiveShellPanes) {
      sendCommand(pane, exportCmd);
    }
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

  add(0, "end tell");

  return lines.join("\n");
}
