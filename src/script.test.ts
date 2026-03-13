import { describe, it, expect } from "vitest";
import { generateAppleScript } from "./script.js";
import { planLayout, getPreset } from "./layout.js";

describe("generateAppleScript", () => {
  it("generates valid AppleScript structure", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/project");

    expect(script).toContain('tell application "Ghostty"');
    expect(script).toContain("new surface configuration");
    expect(script).not.toContain("new window");
    expect(script).toContain("front window");
    expect(script).toContain("selected tab");
    expect(script).toContain("end tell");
  });

  it("sets working directory", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/Users/me/code/myapp");

    expect(script).toContain('set initial working directory of cfg to "/Users/me/code/myapp"');
  });

  it("full preset creates correct splits", () => {
    const plan = planLayout(getPreset("full"));
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // 2 down splits: paneLeft2 + server pane
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(2);

    expect(script).toContain("paneSidebar");
    expect(script).toContain("paneRightCol");
    expect(script).toContain("paneLeft2");
  });

  it("minimal preset creates minimal splits", () => {
    const plan = planLayout(getPreset("minimal"));
    const script = generateAppleScript(plan, "/tmp");

    // Only 1 right split: sidebar
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(1);

    // No down splits
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(0);

    // No right column
    expect(script).not.toContain("paneRightCol");
  });

  it("pair preset creates correct splits", () => {
    const plan = planLayout(getPreset("pair"));
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // 1 down split: server below right column editor
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(1);

    expect(script).toContain("paneSidebar");
    expect(script).toContain("paneRightCol");
  });

  it("sends editor command to root pane via input text", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    // Root pane gets command via input text (buffered until summon exits)
    expect(script).toContain('input text "claude" to paneRoot');
    expect(script).toContain('send key "enter" to paneRoot');
  });

  it("sends cd to root pane before editor command", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/Users/me/code/myapp");

    // Root pane must cd into the project directory first (single-quoted to prevent shell expansion)
    expect(script).toContain("input text \"cd '/Users/me/code/myapp'\" to paneRoot");
    const cdIndex = script.indexOf("input text \"cd '/Users/me/code/myapp'\" to paneRoot");
    const editorIndex = script.indexOf('input text "claude" to paneRoot');
    expect(cdIndex).toBeLessThan(editorIndex);
  });

  it("sets sidebar command on config before split", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    // Sidebar command set on cfg before the split creates the pane
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'lazygit'\"");
    const cmdIndex = script.indexOf("set command of cfg to \"/bin/bash -lc 'lazygit'\"");
    const splitIndex = script.indexOf("paneSidebar to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sets editor command on config for split editor panes", () => {
    const plan = planLayout(getPreset("pair"));
    const script = generateAppleScript(plan, "/tmp");

    // Right column editor gets command via config
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'claude'\"");
    const cmdIndex = script.indexOf("set command of cfg to \"/bin/bash -lc 'claude'\"");
    const splitIndex = script.indexOf("paneRightCol to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sends custom server command via config", () => {
    const plan = planLayout({ server: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'npm run dev'\"");
  });

  it("does not use delay for pane initialization when auto-resize is off", () => {
    const plan = planLayout({ autoResize: false });
    const script = generateAppleScript(plan, "/tmp");

    // No fixed delay — commands set via config, not input text
    expect(script).not.toContain("delay");
  });

  it("includes resize by default with editorSize > 50", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("-- Resize editor/sidebar split");
    expect(script).toContain("perform action resizeAction on paneRoot");
  });

  it("skips command for plain shell server", () => {
    const plan = planLayout({ server: "true" });
    const script = generateAppleScript(plan, "/tmp");

    // Root pane gets cd + editor command via input text
    // Sidebar and right editor get commands via config
    // Server pane has no command (plain shell)
    const inputTexts = (script.match(/input text/g) ?? []).length;
    expect(inputTexts).toBe(2); // cd + editor on root pane
  });

  it("skips command for empty editor", () => {
    const plan = planLayout({ editor: "" });
    const script = generateAppleScript(plan, "/tmp");

    // No editor commands sent to root pane
    expect(script).not.toContain('input text "" to paneRoot');
  });

  it("mtop preset uses secondary editor in right column via config", () => {
    const plan = planLayout(getPreset("mtop"));
    const script = generateAppleScript(plan, "/tmp");

    // Left column root pane gets primary editor via input text
    expect(script).toContain('input text "claude" to paneRoot');

    // Right column gets secondary editor (mtop) via config
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'mtop'\"");
  });

  it("focuses root pane", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("focus paneRoot");
  });

  it("uses current tab in front window instead of new window", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("front window");
    expect(script).toContain("selected tab");
    expect(script).not.toContain("new window");
  });

  it("escapes special characters in paths and commands", () => {
    const plan = planLayout({ editor: 'vim "test"', sidebarCommand: "path\\to\\bin" });
    const script = generateAppleScript(plan, '/Users/me/my "project"');

    expect(script).toContain('my \\"project\\"');
    expect(script).toContain('vim \\"test\\"');
    expect(script).toContain("path\\\\to\\\\bin");
  });

  it("escapes newlines and carriage returns in commands", () => {
    const plan = planLayout({ editor: "vim", sidebarCommand: "cmd\ninjection\rtest" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("cmd\\ninjection\\rtest");
    expect(script).not.toContain("\n" + "injection");
  });

  it("generates resize commands when autoResize is enabled", () => {
    const plan = planLayout({ autoResize: true, editorSize: 85 });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("-- Resize editor/sidebar split");
    expect(script).toContain("delay 0.3");
    expect(script).toContain('tell application "System Events"');
    expect(script).toContain('tell process "Ghostty"');
    expect(script).toContain("set windowSize to size of front window");
    expect(script).toContain("set windowWidth to item 1 of windowSize");
    expect(script).toContain("set resizeAmount to round (windowWidth * 0.35)");
    expect(script).toContain('set resizeAction to "resize_split:right," & (resizeAmount as text)');
    expect(script).toContain("perform action resizeAction on paneRoot");
  });

  it("does not generate resize commands when autoResize is disabled", () => {
    const plan = planLayout({ editorSize: 85, autoResize: false });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).not.toContain("resize_split");
    expect(script).not.toContain("perform action");
  });

  it("uses paneRoot for resize when no right column exists", () => {
    const plan = planLayout({ autoResize: true, editorSize: 80, editorPanes: 1, server: "false" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("perform action resizeAction on paneRoot");
  });

  it("resizes before editor column split for equal columns", () => {
    const plan = planLayout({ autoResize: true, editorSize: 75 });
    const script = generateAppleScript(plan, "/tmp");

    const resizeIndex = script.indexOf("perform action resizeAction");
    const rightColIndex = script.indexOf("paneRightCol to split");
    expect(resizeIndex).toBeGreaterThan(-1);
    expect(rightColIndex).toBeGreaterThan(-1);
    expect(resizeIndex).toBeLessThan(rightColIndex);
  });

  it("does not generate resize commands when editorSize is 50", () => {
    const plan = planLayout({ autoResize: true, editorSize: 50 });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).not.toContain("resize_split");
  });

  it("cli preset creates server-only right column with no editor panes", () => {
    const plan = planLayout(getPreset("cli"));
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column (server-only)
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // No down splits — single server pane, no editors in right column
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(0);

    // Right column exists but has no editor panes
    expect(script).toContain("paneRightCol");
    expect(script).not.toContain("paneRight2");

    // Server pane uses cleared command (plain shell, server="true")
    expect(script).toContain('set command of cfg to ""');
  });

  it("wraps config commands with the specified login shell", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp", "/bin/zsh");

    // Sidebar command wrapped in login shell
    expect(script).toContain("set command of cfg to \"/bin/zsh -lc 'lazygit'\"");
  });

  it("wraps server command in login shell", () => {
    const plan = planLayout({ server: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp", "/bin/zsh");

    expect(script).toContain("set command of cfg to \"/bin/zsh -lc 'npm run dev'\"");
  });

  it("escapes single quotes in wrapped config commands", () => {
    const plan = planLayout({ sidebarCommand: "cmd 'arg'" });
    const script = generateAppleScript(plan, "/tmp", "/bin/bash");

    // escapeAppleScript doubles backslashes: '\'' → '\\''
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'cmd '\\\\''arg'\\\\'''\"");
  });

  it("does not wrap input text commands with login shell", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp", "/bin/zsh");

    // Root pane editor is sent via input text, not config — should NOT be wrapped
    expect(script).toContain('input text "claude" to paneRoot');
    expect(script).not.toContain('input text "/bin/zsh');
  });

  it("escapes shell metacharacters in root pane editor command", () => {
    // $HOME should not expand when typed into the shell
    const plan1 = planLayout({ editor: "vim $HOME" });
    const script1 = generateAppleScript(plan1, "/tmp");
    // The command name stays unquoted, but the argument is shell-quoted
    expect(script1).toContain("input text \"vim '$HOME'\" to paneRoot");

    // Backtick command substitution should not expand
    const plan2 = planLayout({ editor: "vim `whoami`" });
    const script2 = generateAppleScript(plan2, "/tmp");
    expect(script2).toContain("input text \"vim '`whoami`'\" to paneRoot");

    // $() command substitution should not expand (each word is individually quoted)
    const plan3 = planLayout({ editor: "vim $(rm -rf /)" });
    const script3 = generateAppleScript(plan3, "/tmp");
    expect(script3).toContain("input text \"vim '$(rm' '-rf' '/)'\"" + " to paneRoot");
  });

  it("escapes single quotes in root pane editor command arguments", () => {
    const plan = planLayout({ editor: "cmd 'arg'" });
    const script = generateAppleScript(plan, "/tmp");
    // Single quotes in the argument are POSIX-escaped, then escapeAppleScript doubles backslashes
    expect(script).toContain("input text \"cmd ''\\\\''arg'\\\\'''\" to paneRoot");
  });

  it("leaves plain editor command without arguments unchanged", () => {
    const plan = planLayout({ editor: "claude" });
    const script = generateAppleScript(plan, "/tmp");
    expect(script).toContain('input text "claude" to paneRoot');
  });

  it("escapes shell metacharacters in targetDir cd command", () => {
    const plan = planLayout();

    // $() command substitution should not expand
    const script1 = generateAppleScript(plan, "/Users/me/$(whoami)/project");
    expect(script1).toContain("cd '/Users/me/$(whoami)/project'");
    expect(script1).not.toContain('cd "');

    // Backtick command substitution should not expand
    const script2 = generateAppleScript(plan, "/Users/me/`id`/project");
    expect(script2).toContain("cd '/Users/me/`id`/project'");

    // Single quotes in path are POSIX-escaped (backslash doubled by escapeAppleScript)
    const script3 = generateAppleScript(plan, "/Users/me/it's a project");
    expect(script3).toContain("cd '/Users/me/it'\\\\''s a project'");
  });

  it("clears config command for right column when both editors are empty", () => {
    const plan = planLayout({ editorPanes: 2, editor: "", secondaryEditor: "" });
    const script = generateAppleScript(plan, "/tmp");

    // With both editors empty, secondaryCmd is "" (falsy), so clearConfigCommand is called
    // before the right column split
    const lines = script.split("\n");
    const clearIndex = lines.findIndex((l) => l.includes('set command of cfg to ""'));
    const rightColIndex = lines.findIndex((l) => l.includes("paneRightCol to split"));
    expect(clearIndex).toBeGreaterThan(-1);
    expect(rightColIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(rightColIndex);
  });

  it("multi-pane right column creates additional down splits", () => {
    const plan = planLayout({ editorPanes: 4 });
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // 2 down splits: paneLeft2 + paneRight2 (2 editors per column)
    // Plus 1 server pane = 3 down splits total
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(3);

    expect(script).toContain("paneRight2");
    expect(script).toContain("paneLeft2");
    // Server pane at bottom of right column
    expect(script).toContain("paneRight3");
  });
});
