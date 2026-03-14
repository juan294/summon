import { describe, test, expect, vi } from "vitest";
import { generateZshCompletion, generateBashCompletion } from "./completions.js";
import { VALID_KEYS, CLI_FLAGS } from "./config.js";
import { getPresetNames } from "./layout.js";

describe("generateZshCompletion", () => {
  test("returns a string starting with #compdef summon", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/^#compdef summon/);
  });

  test("contains all subcommands", () => {
    const result = generateZshCompletion();
    for (const cmd of ["add", "remove", "list", "set", "config", "setup", "completions"]) {
      expect(result).toContain(cmd);
    }
  });

  test("contains all config keys", () => {
    const result = generateZshCompletion();
    for (const key of VALID_KEYS) {
      expect(result).toContain(key);
    }
  });

  test("contains all layout presets", () => {
    const result = generateZshCompletion();
    for (const preset of getPresetNames()) {
      expect(result).toContain(preset);
    }
  });

  test("reads projects file from ~/.config/summon/projects", () => {
    const result = generateZshCompletion();
    expect(result).toContain(".config/summon/projects");
  });

  test("contains all CLI flags", () => {
    const result = generateZshCompletion();
    for (const flag of CLI_FLAGS) {
      expect(result).toContain(flag);
    }
  });

  test("contains _summon function definition", () => {
    const result = generateZshCompletion();
    expect(result).toContain("_summon()");
  });

  test("has starship preset value completion via starship CLI", () => {
    const result = generateZshCompletion();
    expect(result).toContain("starship preset --list");
    expect(result).toContain("starship_preset");
  });
});

describe("generateBashCompletion", () => {
  test("contains complete -F registration", () => {
    const result = generateBashCompletion();
    expect(result).toContain("complete -F _summon summon");
  });

  test("contains all subcommands", () => {
    const result = generateBashCompletion();
    for (const cmd of ["add", "remove", "list", "set", "config", "setup", "completions"]) {
      expect(result).toContain(cmd);
    }
  });

  test("contains all config keys", () => {
    const result = generateBashCompletion();
    for (const key of ["editor", "sidebar", "panes", "editor-size", "shell", "layout", "auto-resize"]) {
      expect(result).toContain(key);
    }
  });

  test("contains all layout presets", () => {
    const result = generateBashCompletion();
    for (const preset of ["minimal", "full", "pair", "cli", "btop"]) {
      expect(result).toContain(preset);
    }
  });

  test("reads projects file from ~/.config/summon/projects", () => {
    const result = generateBashCompletion();
    expect(result).toContain(".config/summon/projects");
  });

  test("contains all CLI flags", () => {
    const result = generateBashCompletion();
    for (const flag of CLI_FLAGS) {
      expect(result).toContain(flag);
    }
  });

  test("contains _summon function definition", () => {
    const result = generateBashCompletion();
    expect(result).toContain("_summon()");
  });

  test("has starship preset value completion via starship CLI", () => {
    const result = generateBashCompletion();
    expect(result).toContain("starship preset --list");
    expect(result).toContain("starship-preset");
  });
});

describe("layout subcommand completions", () => {
  test("zsh output contains layout in subcommands list", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/'layout:/);
  });

  test("bash output contains layout in subcommands list", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/subcommands="[^"]*\blayout\b/);
  });

  test("zsh layout completion includes actions", () => {
    const result = generateZshCompletion();
    for (const action of ["create", "save", "list", "show", "delete", "edit"]) {
      expect(result).toMatch(new RegExp(`layout\\).*${action}`, "s"));
    }
  });

  test("bash layout completion includes actions", () => {
    const result = generateBashCompletion();
    for (const action of ["create", "save", "list", "show", "delete", "edit"]) {
      expect(result).toMatch(new RegExp(`layout\\).*${action}`, "s"));
    }
  });

  test("zsh layout show/delete/edit complete with custom layout names", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["mywork", "devops"]);

    const result = generateZshCompletion();
    // The layout case should reference layout_presets for show/delete/edit
    expect(result).toMatch(/layout\)[\s\S]*?show\b.*\bdelete\b.*\bedit\b[\s\S]*?layout_presets/s);

    spy.mockRestore();
  });

  test("bash layout show/delete/edit complete with custom layout names", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["mywork", "devops"]);

    const result = generateBashCompletion();
    // The layout case should reference layout_presets for show/delete/edit
    expect(result).toMatch(/layout\)[\s\S]*?show\b.*\bdelete\b.*\bedit\b[\s\S]*?layout_presets/s);

    spy.mockRestore();
  });
});

describe("custom layout completions", () => {
  test("zsh completions include custom layout names in --layout", async () => {
    // Mock listCustomLayouts to return custom layout names
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["mywork", "devops"]);

    const result = generateZshCompletion();
    expect(result).toContain("mywork");
    expect(result).toContain("devops");

    spy.mockRestore();
  });

  test("bash completions include custom layout names in --layout", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["mywork", "devops"]);

    const result = generateBashCompletion();
    expect(result).toContain("mywork");
    expect(result).toContain("devops");

    spy.mockRestore();
  });

  test("zsh completions include custom layouts in set layout value completions", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["custom-one"]);

    const result = generateZshCompletion();
    // The layout_presets array should include custom layouts
    expect(result).toContain("custom-one");

    spy.mockRestore();
  });

  test("completions work with empty custom layouts list", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue([]);

    const zsh = generateZshCompletion();
    const bash = generateBashCompletion();
    // Should still contain preset names
    for (const preset of getPresetNames()) {
      expect(zsh).toContain(preset);
      expect(bash).toContain(preset);
    }

    spy.mockRestore();
  });
});
