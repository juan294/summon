import { describe, it, expect } from "vitest";
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import { planLayout, getPreset } from "./layout.js";
import type { TreeLayoutPlan, LayoutNode } from "./tree.js";

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

    // 2 down splits: paneLeft2 + shell pane
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

    // 1 down split: shell below right column editor
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
    const expected = "set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && lazygit'\"";
    expect(script).toContain(expected);
    const cmdIndex = script.indexOf(expected);
    const splitIndex = script.indexOf("paneSidebar to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sets editor command on config for split editor panes", () => {
    const plan = planLayout(getPreset("pair"));
    const script = generateAppleScript(plan, "/tmp");

    // Right column editor gets command via config
    const expected = "set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && claude'\"";
    expect(script).toContain(expected);
    const cmdIndex = script.indexOf(expected);
    const splitIndex = script.indexOf("paneRightCol to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sends custom shell command via config", () => {
    const plan = planLayout({ shell: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && npm run dev'\"");
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

  it("skips command for plain shell pane", () => {
    const plan = planLayout({ shell: "true" });
    const script = generateAppleScript(plan, "/tmp");

    // Root pane gets cd + editor command via input text
    // Sidebar and right editor get commands via config
    // Shell pane has no command (plain shell) — gets clear instead
    const inputTexts = (script.match(/input text/g) ?? []).length;
    expect(inputTexts).toBe(4); // env export + cd + editor on root pane + clear on shell pane
  });

  it("skips command for empty editor", () => {
    const plan = planLayout({ editor: "" });
    const script = generateAppleScript(plan, "/tmp");

    // No editor commands sent to root pane
    expect(script).not.toContain('input text "" to paneRoot');
  });

  it("btop preset uses secondary editor in right column via config", () => {
    const plan = planLayout(getPreset("btop"));
    const script = generateAppleScript(plan, "/tmp");

    // Left column root pane gets primary editor via input text
    expect(script).toContain('input text "claude" to paneRoot');

    // Right column gets secondary editor (btop) via config
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && btop'\"");
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

  it("config-launched panes cd into target directory", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/project");

    // Every non-empty config command should cd into the target directory
    const configLines = script.split("\n").filter((l) => l.includes("set command of cfg to"));
    expect(configLines.length).toBeGreaterThan(0);
    for (const line of configLines) {
      if (line.includes('""')) continue; // skip cleared commands (plain shell)
      expect(line).toContain("/tmp/project");
    }
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
    expect(script).not.toContain("perform action resizeAction");
  });

  it("uses paneRoot for resize when no right column exists", () => {
    const plan = planLayout({ autoResize: true, editorSize: 80, editorPanes: 1, shell: "false" });
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

  it("cli preset creates shell-only right column with no editor panes", () => {
    const plan = planLayout(getPreset("cli"));
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column (shell-only)
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // No down splits — single shell pane, no editors in right column
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(0);

    // Right column exists but has no editor panes
    expect(script).toContain("paneRightCol");
    expect(script).not.toContain("paneRight2");

    // Shell pane uses cleared command (plain shell, shell="true")
    expect(script).toContain('set command of cfg to ""');
  });

  it("wraps config commands with the specified login shell", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp", "/bin/zsh");

    // Sidebar command wrapped in login shell
    expect(script).toContain("set command of cfg to \"/bin/zsh -lc 'cd '\\\\''/tmp'\\\\'' && lazygit'\"");
  });

  it("wraps shell command in login shell", () => {
    const plan = planLayout({ shell: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp", "/bin/zsh");

    expect(script).toContain("set command of cfg to \"/bin/zsh -lc 'cd '\\\\''/tmp'\\\\'' && npm run dev'\"");
  });

  it("escapes single quotes in wrapped config commands", () => {
    const plan = planLayout({ sidebarCommand: "cmd 'arg'" });
    const script = generateAppleScript(plan, "/tmp", "/bin/bash");

    // escapeAppleScript doubles backslashes: '\'' → '\\''
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && cmd '\\\\''arg'\\\\'''\"");
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

  it("sets shell command on config for shell-only right column", () => {
    // editorPanes=1 → rightColumnEditorCount=0, shell="npm run dev" → shellCommand="npm run dev"
    const plan = planLayout({ editorPanes: 1, shell: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp");

    // Right column exists only for shell, and shell has a specific command
    expect(script).toContain("paneRightCol");
    // The shell command should be set via config before the right column split
    expect(script).toContain("set command of cfg to \"/bin/bash -lc 'cd '\\\\''/tmp'\\\\'' && npm run dev'\"");
    const cmdIndex = script.indexOf("npm run dev");
    const splitIndex = script.indexOf("paneRightCol to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("skips sidebar config command when sidebarCommand is empty", () => {
    const plan = planLayout({ sidebarCommand: "" });
    const script = generateAppleScript(plan, "/tmp");

    // The sidebar split should still happen
    expect(script).toContain("paneSidebar to split paneRoot direction right");

    // No "set command of cfg" should appear before the sidebar split line,
    // because an empty sidebarCommand means the config command is skipped.
    const lines = script.split("\n");
    const sidebarSplitIndex = lines.findIndex((l) => l.includes("paneSidebar to split"));
    expect(sidebarSplitIndex).toBeGreaterThan(-1);

    // Find any "set command of cfg" lines before the sidebar split
    const configCmdBeforeSidebar = lines
      .slice(0, sidebarSplitIndex)
      .filter((l) => l.includes("set command of cfg to"));
    expect(configCmdBeforeSidebar).toHaveLength(0);
  });

  it("skips shell pane when hasShell is false in multi-editor right column", () => {
    // editorPanes=2 → rightColumnEditorCount=1, shell="false" → hasShell=false
    const plan = planLayout({ editorPanes: 2, shell: "false" });
    const script = generateAppleScript(plan, "/tmp");

    // Right column should exist (for the editor), but no shell pane split
    expect(script).toContain("paneRightCol");
    // No paneRight2 (shell pane) should exist since hasShell is false
    expect(script).not.toContain("paneRight2");
    // No down splits: leftColumnCount=1 (no paneLeft2), no shell pane
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(0);
  });

  it("generates clearConfigCommand for shell pane when hasShell is true without shellCommand", () => {
    // pair preset: editorPanes=2 → rightColumnEditorCount=1, shell="true" → hasShell=true, shellCommand=null
    const plan = planLayout({ ...getPreset("pair"), shell: "true" });
    const script = generateAppleScript(plan, "/tmp");

    // The shell pane at the bottom of the right column should get clearConfigCommand()
    // which produces: set command of cfg to ""
    const lines = script.split("\n");

    // Find the shell pane split (paneRight2, since rightColumnEditorCount=1 → nextRight starts at 2)
    const shellSplitIdx = lines.findIndex((l) => l.includes("paneRight2 to split"));
    expect(shellSplitIdx).toBeGreaterThan(-1);

    // The clearConfigCommand should appear before this split
    const clearIdx = lines.findIndex(
      (l, i) => i < shellSplitIdx && l.includes('set command of cfg to ""'),
    );
    expect(clearIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(shellSplitIdx);
  });

  it("multi-pane right column creates additional down splits", () => {
    const plan = planLayout({ editorPanes: 4 });
    const script = generateAppleScript(plan, "/tmp");

    // 2 right splits: sidebar + right column
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(2);

    // 2 down splits: paneLeft2 + paneRight2 (2 editors per column)
    // Plus 1 shell pane = 3 down splits total
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(3);

    expect(script).toContain("paneRight2");
    expect(script).toContain("paneLeft2");
    // Shell pane at bottom of right column
    expect(script).toContain("paneRight3");
  });

  // --- Pane & tab title tests ---

  it("sets pane titles for default layout", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/myproject");

    // Tab title from basename of target dir
    expect(script).toContain('perform action "set_tab_title:myproject" on paneRoot');
    // Comment marker
    expect(script).toContain("-- Set pane and tab titles");
    // Surface titles for all 4 panes (root, sidebar, right col editor, shell)
    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneRoot');
    expect(script).toContain('perform action "set_surface_title:sidebar \u00B7 lazygit" on paneSidebar');
    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneRightCol');
    expect(script).toContain('perform action "set_surface_title:server" on paneRight2');
  });

  it("pane titles appear before focus", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/myproject");

    const titlesIndex = script.indexOf("-- Set pane and tab titles");
    const focusIndex = script.indexOf("focus paneRoot");
    expect(titlesIndex).toBeGreaterThan(-1);
    expect(focusIndex).toBeGreaterThan(-1);
    expect(titlesIndex).toBeLessThan(focusIndex);
  });

  it("minimal preset sets only root and sidebar titles", () => {
    const plan = planLayout(getPreset("minimal"));
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneRoot');
    expect(script).toContain('perform action "set_surface_title:sidebar \u00B7 lazygit" on paneSidebar');
    // No right column panes
    expect(script).not.toContain("set_surface_title:editor" + '" on paneRightCol');
    expect(script).not.toContain("set_surface_title:server" + '" on paneRight');
  });

  it("full preset sets titles for all panes", () => {
    const plan = planLayout(getPreset("full"));
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneRoot');
    expect(script).toContain('perform action "set_surface_title:sidebar \u00B7 lazygit" on paneSidebar');
    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneRightCol');
    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on paneLeft2');
    expect(script).toContain('perform action "set_surface_title:server" on paneRight2');
  });

  it("btop preset shows secondary editor in right column title", () => {
    const plan = planLayout(getPreset("btop"));
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('perform action "set_surface_title:editor \u00B7 btop" on paneRightCol');
  });

  it("custom shell command appears in server title", () => {
    const plan = planLayout({ shell: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('perform action "set_surface_title:server \u00B7 npm run dev" on paneRight2');
  });

  it("tab title uses basename of target directory", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/Users/me/code/my-app");

    expect(script).toContain('perform action "set_tab_title:my-app" on paneRoot');
  });

  it("escapes special characters in titles", () => {
    const plan = planLayout({ editor: 'vim "test"', sidebarCommand: "path\\to" });
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('set_surface_title:editor \u00B7 vim \\"test\\"');
    expect(script).toContain('set_surface_title:sidebar \u00B7 path\\\\to');
  });

  it("empty sidebar command shows role only in title", () => {
    const plan = planLayout({ sidebarCommand: "" });
    const script = generateAppleScript(plan, "/tmp/proj");

    // Sidebar title should be just "sidebar" without " · "
    expect(script).toContain('perform action "set_surface_title:sidebar" on paneSidebar');
    expect(script).not.toContain('set_surface_title:sidebar \u00B7');
  });

  it("cli preset shell-only right column gets server title", () => {
    const plan = planLayout(getPreset("cli"));
    const script = generateAppleScript(plan, "/tmp/proj");

    expect(script).toContain('perform action "set_surface_title:server" on paneRightCol');
  });

  // --- SUMMON_WORKSPACE marker ---

  it("always includes SUMMON_WORKSPACE=1 in surface config env vars", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", null);
    expect(script).toContain('"SUMMON_WORKSPACE=1"');
    expect(script).toContain("set environment variables of cfg to");
  });

  // --- Starship config injection tests ---

  describe("starship config injection", () => {
    const configPath = "/Users/me/.config/summon/starship/tokyo-night.toml";

    it("no STARSHIP_CONFIG references when starshipConfigPath is omitted", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj");
      expect(script).not.toContain("STARSHIP_CONFIG");
    });

    it("no STARSHIP_CONFIG references when starshipConfigPath is null", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", null);
      expect(script).not.toContain("STARSHIP_CONFIG");
    });

    it("sets environment variables on surface config", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      expect(script).toContain(`set environment variables of cfg to {"SUMMON_WORKSPACE=1", "STARSHIP_CONFIG=${configPath}"}`);
    });

    it("root pane receives export STARSHIP_CONFIG before cd (non-new-window)", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      const exportIdx = script.indexOf("export STARSHIP_CONFIG=");
      const cdIdx = script.indexOf("cd '/tmp/proj'");
      expect(exportIdx).toBeGreaterThan(-1);
      expect(cdIdx).toBeGreaterThan(-1);
      expect(exportIdx).toBeLessThan(cdIdx);
    });

    it("root pane receives export even in new-window mode (Cmd+N doesn't apply cfg)", () => {
      const plan = planLayout({ newWindow: true });
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      const exportIdx = script.indexOf("export STARSHIP_CONFIG=");
      expect(exportIdx).toBeGreaterThan(-1);
    });

    it("config-launched panes do NOT embed export in -lc argument (env on surface config)", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      // wrapForConfig should NOT contain export STARSHIP_CONFIG
      const lines = script.split("\n");
      const configLines = lines.filter((l) => l.includes("set command of cfg to"));
      for (const line of configLines) {
        expect(line).not.toContain("export STARSHIP_CONFIG");
      }
    });

    it("interactive shell panes do NOT receive export keystroke (inherit from cfg)", () => {
      const plan = planLayout(getPreset("cli"));
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      // paneRightCol is an interactive shell (no command)
      // It inherits env vars from surface config, no input text needed
      const lines = script.split("\n");
      const exportToShellPane = lines.some(
        (l) => l.includes("input text") && l.includes("export STARSHIP_CONFIG") && l.includes("paneRightCol"),
      );
      expect(exportToShellPane).toBe(false);
    });

    it("starshipConfigPath with spaces is properly escaped in surface config", () => {
      const pathWithSpaces = "/Users/me/my config/starship/tokyo night.toml";
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", pathWithSpaces);
      expect(script).toContain("STARSHIP_CONFIG=");
      expect(script).toContain("my config/starship/tokyo night.toml");
    });

    it("starshipConfigPath with single quotes is properly escaped", () => {
      const pathWithQuote = "/Users/me/it's/starship.toml";
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", pathWithQuote);
      expect(script).toContain("STARSHIP_CONFIG=");
      expect(script).toContain("starship.toml");
    });

    it("interactive shell panes receive clear even without starship config", () => {
      const plan = planLayout(getPreset("cli"));
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh");
      // No starship config, but interactive shell pane should still get clear
      const lines = script.split("\n");
      const clearLine = lines.some(
        (l) => l.includes('input text "clear"') && l.includes("paneRightCol"),
      );
      expect(clearLine).toBe(true);
    });

    it("config-launched panes do not receive clear", () => {
      const plan = planLayout(getPreset("pair"));
      const script = generateAppleScript(plan, "/tmp/proj", "/bin/zsh", configPath);
      // paneSidebar and paneRightCol have commands — they are NOT interactive
      // Only paneRight2 (plain shell) should get clear
      expect(script).not.toContain('input text "clear" to paneSidebar');
      expect(script).not.toContain('input text "clear" to paneRightCol');
      const lines = script.split("\n");
      const clearShell = lines.some(
        (l) => l.includes('input text "clear"') && l.includes("paneRight2"),
      );
      expect(clearShell).toBe(true);
    });

    it("all existing tests pass with starshipConfigPath omitted (backward compat)", () => {
      // Default call without starshipConfigPath should produce same structure
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/proj");
      expect(script).toContain('tell application "Ghostty"');
      expect(script).toContain("end tell");
      expect(script).not.toContain("STARSHIP_CONFIG");
    });
  });

  describe("window management flags", () => {
    describe("new-window flag", () => {
      it("uses System Events Cmd+N when newWindow=true", () => {
        const plan = planLayout({ newWindow: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain('tell application "System Events"');
        expect(script).toContain('keystroke "n" using command down');
        expect(script).toContain("delay 0.5");
        expect(script).toContain("set win to front window");
        expect(script).not.toContain("make new window");
      });

      it("uses front window without new window when newWindow=false (default)", () => {
        const plan = planLayout();
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain("set win to front window");
        expect(script).not.toContain('keystroke "n" using command down');
      });
    });

    describe("fullscreen flag", () => {
      it("generates toggle_fullscreen when fullscreen=true", () => {
        const plan = planLayout({ fullscreen: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain('perform action "toggle_fullscreen" on paneRoot');
      });

      it("omits fullscreen action when fullscreen=false (default)", () => {
        const plan = planLayout();
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).not.toContain("toggle_fullscreen");
      });
    });

    describe("maximize flag", () => {
      it("generates toggle_maximize when maximize=true", () => {
        const plan = planLayout({ maximize: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain('perform action "toggle_maximize" on paneRoot');
      });

      it("skips maximize when fullscreen is also true", () => {
        const plan = planLayout({ fullscreen: true, maximize: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain("toggle_fullscreen");
        expect(script).not.toContain("toggle_maximize");
      });

      it("omits maximize action when maximize=false (default)", () => {
        const plan = planLayout();
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).not.toContain("toggle_maximize");
      });
    });

    describe("float flag", () => {
      it("generates toggle_window_float_on_top when float=true", () => {
        const plan = planLayout({ float: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain('perform action "toggle_window_float_on_top" on paneRoot');
      });

      it("combines with fullscreen", () => {
        const plan = planLayout({ fullscreen: true, float: true });
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).toContain("toggle_fullscreen");
        expect(script).toContain("toggle_window_float_on_top");
      });

      it("omits float action when float=false (default)", () => {
        const plan = planLayout();
        const script = generateAppleScript(plan, "/tmp/test");
        expect(script).not.toContain("toggle_window_float_on_top");
      });
    });
  });

  describe("user environment variables", () => {
    it("sets user env vars on surface config", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp", "/bin/bash", null,
        { NODE_ENV: "development", DEBUG: "true" });
      expect(script).toContain("NODE_ENV=development");
      expect(script).toContain("DEBUG=true");
      expect(script).toContain("set environment variables of cfg to");
    });

    it("merges user env vars with Starship env var", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp", "/bin/bash", "/path/starship.toml",
        { NODE_ENV: "development" });
      expect(script).toContain("STARSHIP_CONFIG=/path/starship.toml");
      expect(script).toContain("NODE_ENV=development");
    });

    it("sends shell-quoted export to root pane (non-new-window)", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp", "/bin/bash", null,
        { NODE_ENV: "development" });
      // Value should be shell-quoted
      expect(script).toContain("export NODE_ENV='development'");
    });

    it("shell-quotes env values with metacharacters", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp", "/bin/bash", null,
        { FOO: "bar; rm -rf /" });
      // Metacharacters should be safely quoted
      expect(script).toContain("export FOO='bar; rm -rf /'");
      expect(script).not.toContain('export FOO=bar; rm -rf /');
    });

    it("exports env vars to root pane in new-window mode (Cmd+N doesn't apply cfg)", () => {
      const plan = planLayout({ newWindow: true });
      const script = generateAppleScript(plan, "/tmp", "/bin/bash", null,
        { NODE_ENV: "development" });
      expect(script).toContain("export NODE_ENV=");
    });

    it("always includes SUMMON_WORKSPACE even when no user env vars configured", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp");
      expect(script).toContain('"SUMMON_WORKSPACE=1"');
      expect(script).not.toContain("NODE_ENV");
    });
  });

  describe("font-size flag", () => {
    it("sets font size on surface config when fontSize specified", () => {
      const plan = planLayout({ fontSize: 14 });
      const script = generateAppleScript(plan, "/tmp/test");
      expect(script).toContain("set font size of cfg to 14");
    });

    it("supports decimal font sizes", () => {
      const plan = planLayout({ fontSize: 13.5 });
      const script = generateAppleScript(plan, "/tmp/test");
      expect(script).toContain("set font size of cfg to 13.5");
    });

    it("omits font size when fontSize is null (default)", () => {
      const plan = planLayout();
      const script = generateAppleScript(plan, "/tmp/test");
      expect(script).not.toContain("font size");
    });
  });
});

describe("generateTreeAppleScript", () => {
  function makePlan(tree: LayoutNode, overrides?: Partial<TreeLayoutPlan>): TreeLayoutPlan {
    // Default focusPane to the first leaf name
    const defaultFocus = (function getFirst(n: LayoutNode): string {
      return n.type === "pane" ? n.name : getFirst(n.first);
    })(tree);
    return {
      tree,
      focusPane: defaultFocus,
      autoResize: false,
      editorSize: 75,
      fontSize: null,
      newWindow: false,
      fullscreen: false,
      maximize: false,
      float: false,
      ...overrides,
    };
  }

  // --- Structure Tests ---

  it("single pane — no splits, root pane gets command", () => {
    const plan = makePlan({ type: "pane", name: "editor", command: "claude" });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('tell application "Ghostty"');
    expect(script).toContain("end tell");
    // No splits
    expect(script).not.toContain("direction right");
    expect(script).not.toContain("direction down");
    // Root pane gets command via input text
    expect(script).toContain('input text "claude" to pane_editor');
  });

  it("two panes right split — a | b", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "editor", command: "claude" },
      second: { type: "pane", name: "sidebar", command: "lazygit" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // 1 right split
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    expect(rightSplits).toBe(1);
    expect(script).not.toContain("direction down");

    // Split creates pane_sidebar from pane_editor
    expect(script).toContain("set pane_sidebar to split pane_editor direction right");
    // Root pane gets command via input text
    expect(script).toContain('input text "claude" to pane_editor');
  });

  it("two panes down split — a / b", () => {
    const plan = makePlan({
      type: "split", direction: "down",
      first: { type: "pane", name: "main", command: "claude" },
      second: { type: "pane", name: "server", command: "npm run dev" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // 1 down split
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(downSplits).toBe(1);
    expect(script).not.toContain("direction right");

    expect(script).toContain("set pane_server to split pane_main direction down");
  });

  it("three panes — a | (b / c)", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "editor", command: "claude" },
      second: {
        type: "split", direction: "down",
        first: { type: "pane", name: "git", command: "lazygit" },
        second: { type: "pane", name: "server", command: "npm run dev" },
      },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // 1 right + 1 down
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(rightSplits).toBe(1);
    expect(downSplits).toBe(1);

    // Right split creates pane_git (first leaf of second child)
    expect(script).toContain("set pane_git to split pane_editor direction right");
    // Down split creates pane_server from pane_git
    expect(script).toContain("set pane_server to split pane_git direction down");
  });

  it("four panes grid — (a / b) | (c / d)", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: {
        type: "split", direction: "down",
        first: { type: "pane", name: "a", command: "cmd-a" },
        second: { type: "pane", name: "b", command: "cmd-b" },
      },
      second: {
        type: "split", direction: "down",
        first: { type: "pane", name: "c", command: "cmd-c" },
        second: { type: "pane", name: "d", command: "cmd-d" },
      },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // 1 right + 2 down
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(rightSplits).toBe(1);
    expect(downSplits).toBe(2);

    expect(script).toContain("pane_a");
    expect(script).toContain("pane_b");
    expect(script).toContain("pane_c");
    expect(script).toContain("pane_d");
  });

  it("deep nesting — (a / b / c) | (d / e)", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: {
        type: "split", direction: "down",
        first: { type: "pane", name: "a", command: "cmd-a" },
        second: {
          type: "split", direction: "down",
          first: { type: "pane", name: "b", command: "cmd-b" },
          second: { type: "pane", name: "c", command: "cmd-c" },
        },
      },
      second: {
        type: "split", direction: "down",
        first: { type: "pane", name: "d", command: "cmd-d" },
        second: { type: "pane", name: "e", command: "cmd-e" },
      },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // 1 right + 3 down
    const rightSplits = (script.match(/direction right/g) ?? []).length;
    const downSplits = (script.match(/direction down/g) ?? []).length;
    expect(rightSplits).toBe(1);
    expect(downSplits).toBe(3);
  });

  // --- Feature Tests ---

  it("auto-resize with editorSize > 50", () => {
    const plan = makePlan(
      {
        type: "split", direction: "right",
        first: { type: "pane", name: "editor", command: "claude" },
        second: { type: "pane", name: "sidebar", command: "lazygit" },
      },
      { autoResize: true, editorSize: 75 },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain("-- Resize editor/sidebar split");
    expect(script).toContain('tell application "System Events"');
    expect(script).toContain("set resizeAmount to round (windowWidth * 0.25)");
    expect(script).toContain("perform action resizeAction on pane_editor");
  });

  it("no auto-resize when disabled", () => {
    const plan = makePlan(
      {
        type: "split", direction: "right",
        first: { type: "pane", name: "editor", command: "claude" },
        second: { type: "pane", name: "sidebar", command: "lazygit" },
      },
      { autoResize: false, editorSize: 75 },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).not.toContain("resize_split");
    expect(script).not.toContain("System Events");
  });

  it("new window mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { newWindow: true },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain("make new window with configuration cfg");
    expect(script).not.toContain("set win to front window");
  });

  it("fullscreen mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { fullscreen: true },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('perform action "toggle_fullscreen" on pane_editor');
  });

  it("maximize mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { maximize: true },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('perform action "toggle_maximize" on pane_editor');
  });

  it("float mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { float: true },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('perform action "toggle_window_float_on_top" on pane_editor');
  });

  it("font size", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { fontSize: 14 },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain("set font size of cfg to 14");
  });

  it("always includes SUMMON_WORKSPACE=1 in surface config env vars", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('"SUMMON_WORKSPACE=1"');
    expect(script).toContain("set environment variables of cfg to");
  });

  it("env vars on surface config", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project", "/bin/bash", null,
      { NODE_ENV: "development", DEBUG: "true" });

    expect(script).toContain("set environment variables of cfg to");
    expect(script).toContain("NODE_ENV=development");
    expect(script).toContain("DEBUG=true");
  });

  it("env exports for root pane in non-new-window mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project", "/bin/bash", null,
      { NODE_ENV: "development" });

    // Root pane should get export command via input text
    expect(script).toContain("export NODE_ENV='development'");
  });

  it("no env exports for root pane in new-window mode", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
      { newWindow: true },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project", "/bin/bash", null,
      { NODE_ENV: "development" });

    // Root pane inherits env vars from cfg in new-window mode
    expect(script).not.toContain("export NODE_ENV=");
  });

  it("pane titles with name and command", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "editor", command: "claude" },
      second: { type: "pane", name: "sidebar", command: "lazygit" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/myproject");

    expect(script).toContain('perform action "set_surface_title:editor \u00B7 claude" on pane_editor');
    expect(script).toContain('perform action "set_surface_title:sidebar \u00B7 lazygit" on pane_sidebar');
    // Tab title uses basename
    expect(script).toContain('perform action "set_tab_title:myproject" on pane_editor');
  });

  it("hyphenated pane names use underscores in AppleScript variables", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "my-editor", command: "claude" },
      second: { type: "pane", name: "my-sidebar", command: "lazygit" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // AppleScript variable uses underscore
    expect(script).toContain("pane_my_editor");
    expect(script).toContain("pane_my_sidebar");
    // But title uses the original name
    expect(script).toContain("set_surface_title:my-editor");
    expect(script).toContain("set_surface_title:my-sidebar");
  });

  it("pane with empty command — title shows name only", () => {
    const plan = makePlan(
      { type: "pane", name: "shell", command: "" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain('perform action "set_surface_title:shell" on pane_shell');
    expect(script).not.toContain("set_surface_title:shell \u00B7");
  });

  it("config command wraps in login shell with cd", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "editor", command: "claude" },
      second: { type: "pane", name: "sidebar", command: "lazygit" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project", "/bin/zsh");

    // The sidebar's command should be set on cfg before the split, wrapped in login shell
    expect(script).toContain("set command of cfg to \"/bin/zsh -lc 'cd '\\\\''/tmp/project'\\\\'' && lazygit'\"");
  });

  it("empty command on second child clears config command", () => {
    const plan = makePlan({
      type: "split", direction: "right",
      first: { type: "pane", name: "editor", command: "claude" },
      second: { type: "pane", name: "shell", command: "" },
    });
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // Empty command → clearConfigCommand
    const lines = script.split("\n");
    const clearIdx = lines.findIndex((l) => l.includes('set command of cfg to ""'));
    const splitIdx = lines.findIndex((l) => l.includes("pane_shell to split"));
    expect(clearIdx).toBeGreaterThan(-1);
    expect(splitIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(splitIdx);
  });

  it("root pane cd appears before root pane command", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/Users/me/code/myapp");

    const cdIdx = script.indexOf("input text \"cd '/Users/me/code/myapp'\" to pane_editor");
    const cmdIdx = script.indexOf('input text "claude" to pane_editor');
    expect(cdIdx).toBeGreaterThan(-1);
    expect(cmdIdx).toBeGreaterThan(-1);
    expect(cdIdx).toBeLessThan(cmdIdx);
  });

  it("focus is set on root pane", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain("focus pane_editor");
  });

  it("front window used when not new window", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    expect(script).toContain("set win to front window");
    expect(script).not.toContain("make new window");
  });

  it("starship config path sets environment variable", () => {
    const plan = makePlan(
      { type: "pane", name: "editor", command: "claude" },
    );
    const configPath = "/Users/me/.config/summon/starship/tokyo-night.toml";
    const script = generateTreeAppleScript(plan, "/tmp/project", "/bin/bash", configPath);

    expect(script).toContain(`STARSHIP_CONFIG=${configPath}`);
    expect(script).toContain("set environment variables of cfg to");
  });

  it("auto-resize only applies to first root-level right-split", () => {
    // The outermost split is right, so resize should apply
    const plan = makePlan(
      {
        type: "split", direction: "down",
        first: { type: "pane", name: "a", command: "cmd-a" },
        second: { type: "pane", name: "b", command: "cmd-b" },
      },
      { autoResize: true, editorSize: 75 },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // Root split is down, not right — no resize
    expect(script).not.toContain("resize_split");
  });

  it("resize appears after the first right-split", () => {
    const plan = makePlan(
      {
        type: "split", direction: "right",
        first: { type: "pane", name: "editor", command: "claude" },
        second: {
          type: "split", direction: "down",
          first: { type: "pane", name: "git", command: "lazygit" },
          second: { type: "pane", name: "server", command: "npm run dev" },
        },
      },
      { autoResize: true, editorSize: 75 },
    );
    const script = generateTreeAppleScript(plan, "/tmp/project");

    // Resize should appear after the first right-split
    const splitIdx = script.indexOf("direction right");
    const resizeIdx = script.indexOf("perform action resizeAction");
    expect(splitIdx).toBeGreaterThan(-1);
    expect(resizeIdx).toBeGreaterThan(-1);
    expect(resizeIdx).toBeGreaterThan(splitIdx);
  });
});
