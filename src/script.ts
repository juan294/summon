import type { LayoutPlan } from "./layout.js";

function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export function generateAppleScript(plan: LayoutPlan, targetDir: string): string {
  const lines: string[] = [];

  const add = (indent: number, line: string) => {
    lines.push("    ".repeat(indent) + line);
  };
  const blank = () => lines.push("");

  const sendCommand = (pane: string, cmd: string) => {
    add(1, `input text "${escapeAppleScript(cmd)}" to ${pane}`);
    add(1, `send key "enter" to ${pane}`);
  };

  const setConfigCommand = (cmd: string) => {
    add(1, `set command of cfg to "${escapeAppleScript(cmd)}"`);
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

  // Split sidebar (far right) — set command on cfg before split
  if (plan.sidebarCommand) {
    setConfigCommand(plan.sidebarCommand);
  }
  add(1, "set paneSidebar to split paneRoot direction right with configuration cfg");

  const needsRightColumn = plan.rightColumnEditorCount > 0 || plan.hasServer;

  if (needsRightColumn) {
    blank();
    // First right column pane: editor or server
    if (plan.rightColumnEditorCount > 0) {
      if (secondaryCmd) {
        setConfigCommand(secondaryCmd);
      } else {
        clearConfigCommand();
      }
      add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");
    } else {
      // Right column exists only for server
      if (plan.serverCommand) {
        setConfigCommand(plan.serverCommand);
      } else {
        clearConfigCommand();
      }
      add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");
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
    lastLeftPane = name;
  }

  // Split additional right column panes (editors + server)
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
      lastRightPane = name;
      nextRight++;
    }

    // Server pane at bottom of right column
    if (plan.hasServer) {
      const name = `paneRight${nextRight}`;
      blank();
      if (plan.serverCommand) {
        setConfigCommand(plan.serverCommand);
      } else {
        clearConfigCommand();
      }
      add(1, `set ${name} to split ${lastRightPane} direction down with configuration cfg`);
    }
  }

  blank();

  // Root pane: cd into project directory, then launch editor
  sendCommand("paneRoot", `cd "${targetDir}"`);
  if (editorCmd) {
    sendCommand("paneRoot", editorCmd);
  }

  // Experimental: auto-resize sidebar to match editorSize
  if (plan.autoResize && plan.editorSize > 50) {
    const fraction = (plan.editorSize - 50) / 100;
    const resizePane = needsRightColumn ? "paneRightCol" : "paneRoot";
    blank();
    add(1, "-- Auto-resize sidebar (experimental)");
    add(1, "delay 0.3");
    add(1, "set windowBounds to bounds of win");
    add(1, "set windowWidth to (item 3 of windowBounds) - (item 1 of windowBounds)");
    add(1, `set resizeAmount to round (windowWidth * ${fraction})`);
    add(1, `set resizeAction to "resize_split:right," & (resizeAmount as text)`);
    add(1, `perform action resizeAction on ${resizePane}`);
  }

  blank();

  // Focus root pane
  add(1, "focus paneRoot");

  add(0, "end tell");

  return lines.join("\n");
}
