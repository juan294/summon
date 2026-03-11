import { describe, it, expect } from "vitest";
import { generateAppleScript } from "./script.js";
import { planLayout, getPreset } from "./layout.js";

describe("generateAppleScript", () => {
  it("generates valid AppleScript structure", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp/project");

    expect(script).toContain('tell application "Ghostty"');
    expect(script).toContain("new surface configuration");
    expect(script).toContain("new window with configuration cfg");
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

  it("sends editor command to editor panes", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain('input text "claude" to paneRoot');
    expect(script).toContain('send key "enter" to paneRoot');
  });

  it("sends sidebar command", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain('input text "lazygit" to paneSidebar');
    expect(script).toContain('send key "enter" to paneSidebar');
  });

  it("sends custom server command", () => {
    const plan = planLayout({ server: "npm run dev" });
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain('input text "npm run dev"');
  });

  it("skips command for plain shell server", () => {
    const plan = planLayout({ server: "true" });
    const script = generateAppleScript(plan, "/tmp");

    // 3 editors (2 left + 1 right) + 1 sidebar = 4 input texts
    // Server pane exists but no command sent
    const inputTexts = (script.match(/input text/g) ?? []).length;
    expect(inputTexts).toBe(4);
  });

  it("skips command for empty editor", () => {
    const plan = planLayout({ editor: "" });
    const script = generateAppleScript(plan, "/tmp");

    // No editor commands sent
    expect(script).not.toContain('input text "" to paneRoot');
    // Sidebar still gets a command
    expect(script).toContain('input text "lazygit" to paneSidebar');
  });

  it("mtop preset uses secondary editor in right column", () => {
    const plan = planLayout(getPreset("mtop"));
    const script = generateAppleScript(plan, "/tmp");

    // Left column gets primary editor
    expect(script).toContain('input text "claude" to paneRoot');

    // Right column gets secondary editor (mtop)
    expect(script).toContain('input text "mtop" to paneRightCol');
  });

  it("focuses root pane", () => {
    const plan = planLayout();
    const script = generateAppleScript(plan, "/tmp");

    expect(script).toContain("focus paneRoot");
  });

  it("escapes special characters in paths and commands", () => {
    const plan = planLayout({ editor: 'vim "test"', sidebarCommand: "path\\to\\bin" });
    const script = generateAppleScript(plan, '/Users/me/my "project"');

    expect(script).toContain('my \\"project\\"');
    expect(script).toContain('vim \\"test\\"');
    expect(script).toContain("path\\\\to\\\\bin");
  });
});
