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

  it("sets sidebar command on config before split", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    // Sidebar command set on cfg before the split creates the pane
    expect(script).toContain('set command of cfg to "lazygit"');
    const cmdIndex = script.indexOf('set command of cfg to "lazygit"');
    const splitIndex = script.indexOf("paneSidebar to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sets editor command on config for split editor panes", () => {
    const plan = planLayout(getPreset("pair"));
    const script = generateAppleScript(plan, "/tmp");

    // Right column editor gets command via config
    expect(script).toContain('set command of cfg to "claude"');
    const cmdIndex = script.indexOf('set command of cfg to "claude"');
    const splitIndex = script.indexOf("paneRightCol to split");
    expect(cmdIndex).toBeLessThan(splitIndex);
  });

  it("sends custom server command via config", () => {
    const plan = planLayout({ server: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain('set command of cfg to "npm run dev"');
  });

  it("does not use delay for pane initialization", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    // No fixed delay — commands set via config, not input text
    expect(script).not.toContain("delay");
  });

  it("skips command for plain shell server", () => {
    const plan = planLayout({ server: "true" });
    const script = generateAppleScript(plan, "/tmp");

    // Only root pane gets input text (for editor command)
    // Sidebar and right editor get commands via config
    // Server pane has no command (plain shell)
    const inputTexts = (script.match(/input text/g) ?? []).length;
    expect(inputTexts).toBe(1); // just root pane editor
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
    expect(script).toContain('set command of cfg to "mtop"');
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

    expect(script).toContain("-- Auto-resize sidebar (experimental)");
    expect(script).toContain("delay 0.3");
    expect(script).toContain("set windowBounds to bounds of win");
    expect(script).toContain("set windowWidth to (item 3 of windowBounds) - (item 1 of windowBounds)");
    expect(script).toContain("set resizeAmount to round (windowWidth * 0.35)");
    expect(script).toContain('set resizeAction to "resize_split:right," & (resizeAmount as text)');
    expect(script).toContain("perform action resizeAction on paneRightCol");
  });

  it("does not generate resize commands when autoResize is disabled", () => {
    const plan = planLayout({ editorSize: 85 });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).not.toContain("resize_split");
    expect(script).not.toContain("perform action");
  });

  it("uses paneRoot for resize when no right column exists", () => {
    const plan = planLayout({ autoResize: true, editorSize: 80, editorPanes: 1, server: "false" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("perform action resizeAction on paneRoot");
  });

  it("does not generate resize commands when editorSize is 50", () => {
    const plan = planLayout({ autoResize: true, editorSize: 50 });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).not.toContain("resize_split");
  });
});
