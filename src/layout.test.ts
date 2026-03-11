import { describe, it, expect } from "vitest";
import { planLayout, isPresetName, getPreset } from "./layout.js";

describe("planLayout", () => {
  it("returns defaults when called with no options", () => {
    const plan = planLayout();
    expect(plan.editor).toBe("claude");
    expect(plan.sidebarCommand).toBe("lazygit");
    expect(plan.editorSize).toBe(75);
    expect(plan.sidebarSize).toBe(25);
  });

  it("calculates sidebar size as complement of editor size", () => {
    const plan = planLayout({ editorSize: 80 });
    expect(plan.editorSize).toBe(80);
    expect(plan.sidebarSize).toBe(20);
  });

  it("splits 1 pane: 1 left, 0 right", () => {
    const plan = planLayout({ editorPanes: 1 });
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(0);
  });

  it("splits 2 panes: 1 left, 1 right", () => {
    const plan = planLayout({ editorPanes: 2 });
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(1);
  });

  it("splits 3 panes: 2 left, 1 right", () => {
    const plan = planLayout({ editorPanes: 3 });
    expect(plan.leftColumnCount).toBe(2);
    expect(plan.rightColumnEditorCount).toBe(1);
  });

  it("splits 4 panes: 2 left, 2 right", () => {
    const plan = planLayout({ editorPanes: 4 });
    expect(plan.leftColumnCount).toBe(2);
    expect(plan.rightColumnEditorCount).toBe(2);
  });

  it("splits 5 panes: 3 left, 2 right", () => {
    const plan = planLayout({ editorPanes: 5 });
    expect(plan.leftColumnCount).toBe(3);
    expect(plan.rightColumnEditorCount).toBe(2);
  });

  it("splits 6 panes: 3 left, 3 right", () => {
    const plan = planLayout({ editorPanes: 6 });
    expect(plan.leftColumnCount).toBe(3);
    expect(plan.rightColumnEditorCount).toBe(3);
  });

  it("overrides editor and sidebar commands", () => {
    const plan = planLayout({ editor: "vim", sidebarCommand: "htop" });
    expect(plan.editor).toBe("vim");
    expect(plan.sidebarCommand).toBe("htop");
  });

  it("handles empty editor string", () => {
    const plan = planLayout({ editor: "" });
    expect(plan.editor).toBe("");
  });
});

describe("server pane toggle", () => {
  it("defaults to hasServer true with no serverCommand", () => {
    const plan = planLayout();
    expect(plan.hasServer).toBe(true);
    expect(plan.serverCommand).toBeNull();
  });

  it('server: "true" → plain shell', () => {
    const plan = planLayout({ server: "true" });
    expect(plan.hasServer).toBe(true);
    expect(plan.serverCommand).toBeNull();
  });

  it('server: "false" → no server', () => {
    const plan = planLayout({ server: "false" });
    expect(plan.hasServer).toBe(false);
    expect(plan.serverCommand).toBeNull();
  });

  it('server: "" → no server', () => {
    const plan = planLayout({ server: "" });
    expect(plan.hasServer).toBe(false);
    expect(plan.serverCommand).toBeNull();
  });

  it('server: "npm run dev" → custom command', () => {
    const plan = planLayout({ server: "npm run dev" });
    expect(plan.hasServer).toBe(true);
    expect(plan.serverCommand).toBe("npm run dev");
  });
});

describe("layout presets", () => {
  it("isPresetName recognizes valid presets", () => {
    expect(isPresetName("minimal")).toBe(true);
    expect(isPresetName("full")).toBe(true);
    expect(isPresetName("pair")).toBe(true);
    expect(isPresetName("cli")).toBe(true);
    expect(isPresetName("mtop")).toBe(true);
    expect(isPresetName("unknown")).toBe(false);
  });

  it("minimal preset: 1 editor pane, no server", () => {
    const plan = planLayout(getPreset("minimal"));
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(0);
    expect(plan.hasServer).toBe(false);
  });

  it("full preset: 3 editor panes, server enabled", () => {
    const plan = planLayout(getPreset("full"));
    expect(plan.leftColumnCount).toBe(2);
    expect(plan.rightColumnEditorCount).toBe(1);
    expect(plan.hasServer).toBe(true);
  });

  it("pair preset: 2 editor panes, server enabled", () => {
    const plan = planLayout(getPreset("pair"));
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(1);
    expect(plan.hasServer).toBe(true);
  });

  it("cli preset: 1 editor pane, server runs npm login", () => {
    const plan = planLayout(getPreset("cli"));
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(0);
    expect(plan.hasServer).toBe(true);
    expect(plan.serverCommand).toBe("npm login");
  });

  it("mtop preset: 2 editor panes with mtop as secondary editor, server enabled", () => {
    const plan = planLayout(getPreset("mtop"));
    expect(plan.leftColumnCount).toBe(1);
    expect(plan.rightColumnEditorCount).toBe(1);
    expect(plan.hasServer).toBe(true);
    expect(plan.secondaryEditor).toBe("mtop");
  });

  it("individual keys override preset values", () => {
    const preset = getPreset("minimal");
    const plan = planLayout({ ...preset, editorPanes: 4, server: "true" });
    expect(plan.leftColumnCount).toBe(2);
    expect(plan.rightColumnEditorCount).toBe(2);
    expect(plan.hasServer).toBe(true);
  });
});
