import { describe, it, expect } from "vitest";
import { generateKeyTableConfig } from "./keybindings.js";

describe("generateKeyTableConfig", () => {
  it("generates valid key table with arrows style (default)", () => {
    const result = generateKeyTableConfig(["editor", "sidebar", "shell"], "pair");

    expect(result).toContain("# Summon workspace navigation — pair layout");
    expect(result).toContain("#   [0] editor");
    expect(result).toContain("#   [1] sidebar");
    expect(result).toContain("#   [2] shell");
    expect(result).toContain("keybind = summon-nav:left = focus_split:left");
    expect(result).toContain("keybind = summon-nav:right = focus_split:right");
    expect(result).toContain("keybind = summon-nav:up = focus_split:up");
    expect(result).toContain("keybind = summon-nav:down = focus_split:down");
    expect(result).not.toContain("focus_split:h");
  });

  it("generates vim-style keybindings", () => {
    const result = generateKeyTableConfig(["editor", "sidebar"], "minimal", "vim");

    expect(result).toContain("keybind = summon-nav:h = focus_split:left");
    expect(result).toContain("keybind = summon-nav:j = focus_split:down");
    expect(result).toContain("keybind = summon-nav:k = focus_split:up");
    expect(result).toContain("keybind = summon-nav:l = focus_split:right");
    // Arrow keys should NOT be used as triggers in vim mode
    expect(result).not.toContain("summon-nav:left");
  });

  it("maps pane names to numeric indices", () => {
    const result = generateKeyTableConfig(["editor", "sidebar", "shell"], "pair");

    expect(result).toContain("keybind = summon-nav:1 = focus_split:0");
    expect(result).toContain("keybind = summon-nav:2 = focus_split:1");
    expect(result).toContain("keybind = summon-nav:3 = focus_split:2");
    expect(result).not.toContain("focus_split:3");
  });

  it("limits numeric indices to 9 panes", () => {
    const names = Array.from({ length: 12 }, (_, i) => `pane${i}`);
    const result = generateKeyTableConfig(names, "large");

    expect(result).toContain("keybind = summon-nav:9 = focus_split:8");
    expect(result).not.toContain("keybind = summon-nav:10");
  });

  it("includes utility bindings", () => {
    const result = generateKeyTableConfig(["editor"], "minimal");

    expect(result).toContain("keybind = summon-nav:z = toggle_split_zoom");
    expect(result).toContain("keybind = summon-nav:escape = pop_key_table");
  });

  it("includes activation hint in header", () => {
    const result = generateKeyTableConfig(["editor"], "minimal");

    expect(result).toContain("keybind = alt+s = key_table:summon-nav");
  });

  it("handles single pane", () => {
    const result = generateKeyTableConfig(["main"], "tree");

    expect(result).toContain("#   [0] main");
    expect(result).toContain("keybind = summon-nav:1 = focus_split:0");
    expect(result).not.toContain("focus_split:1");
  });

  it("ends with newline", () => {
    const result = generateKeyTableConfig(["a"], "test");
    expect(result.endsWith("\n")).toBe(true);
  });
});
