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

  add(0, 'tell application "Ghostty"');
  add(1, "activate");
  blank();

  // Surface configuration with working directory
  add(1, "set cfg to new surface configuration");
  add(1, `set initial working directory of cfg to "${escapeAppleScript(targetDir)}"`);
  blank();

  // Create window and get root pane
  add(1, "set win to new window with configuration cfg");
  add(1, "set paneRoot to terminal 1 of selected tab of win");
  blank();

  // Split sidebar (far right)
  add(1, "set paneSidebar to split paneRoot direction right with configuration cfg");

  // Track panes for command assignment
  const leftPanes: string[] = ["paneRoot"];
  const rightEditorPanes: string[] = [];
  let serverPane: string | null = null;

  const needsRightColumn = plan.rightColumnEditorCount > 0 || plan.hasServer;

  if (needsRightColumn) {
    blank();
    add(1, "set paneRightCol to split paneRoot direction right with configuration cfg");

    if (plan.rightColumnEditorCount > 0) {
      rightEditorPanes.push("paneRightCol");
    } else {
      // Right column exists only for server
      serverPane = "paneRightCol";
    }
  }

  // Split additional left column panes vertically
  let lastLeftPane = "paneRoot";
  for (let i = 2; i <= plan.leftColumnCount; i++) {
    const name = `paneLeft${i}`;
    blank();
    add(1, `set ${name} to split ${lastLeftPane} direction down with configuration cfg`);
    leftPanes.push(name);
    lastLeftPane = name;
  }

  // Split additional right column panes (editors + server)
  if (needsRightColumn && plan.rightColumnEditorCount > 0) {
    let lastRightPane = "paneRightCol";
    let nextRight = 2;

    // Additional right column editor panes
    for (let i = 2; i <= plan.rightColumnEditorCount; i++) {
      const name = `paneRight${nextRight}`;
      blank();
      add(1, `set ${name} to split ${lastRightPane} direction down with configuration cfg`);
      rightEditorPanes.push(name);
      lastRightPane = name;
      nextRight++;
    }

    // Server pane at bottom of right column
    if (plan.hasServer) {
      const name = `paneRight${nextRight}`;
      blank();
      add(1, `set ${name} to split ${lastRightPane} direction down with configuration cfg`);
      serverPane = name;
    }
  }

  blank();

  // Send commands to panes
  const editorCmd = plan.editor;
  const secondaryCmd = plan.secondaryEditor ?? editorCmd;

  // Left column: primary editor
  if (editorCmd) {
    for (const pane of leftPanes) sendCommand(pane, editorCmd);
  }

  // Right column editors: secondary editor (or primary if no secondary)
  if (secondaryCmd) {
    for (const pane of rightEditorPanes) sendCommand(pane, secondaryCmd);
  }

  // Sidebar
  if (plan.sidebarCommand) sendCommand("paneSidebar", plan.sidebarCommand);

  // Server
  if (serverPane && plan.serverCommand) sendCommand(serverPane, plan.serverCommand);

  blank();

  // Focus root pane
  add(1, "focus paneRoot");

  add(0, "end tell");

  return lines.join("\n");
}
