import { describe, test, expect } from "vitest";
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
