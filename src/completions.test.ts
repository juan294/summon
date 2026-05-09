import { describe, test, expect } from "vitest";
import { generateZshCompletion, generateBashCompletion } from "./completions.js";
import { VALID_KEYS, CLI_FLAGS } from "./config.js";

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

  test("uses dynamic command substitution for layout presets instead of hardcoded list", () => {
    const result = generateZshCompletion();
    expect(result).toContain("summon layout list");
    // Should NOT contain hardcoded preset names in the layout completion section
    expect(result).not.toMatch(/layout_presets=\([^)]*\bsplit\b/);
    expect(result).not.toMatch(/layout_presets=\([^)]*\bgrid\b/);
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

  test("uses dynamic command substitution for layout presets instead of hardcoded list", () => {
    const result = generateBashCompletion();
    expect(result).toContain("summon layout list");
    // Should NOT contain hardcoded preset names in the layout_presets definition
    expect(result).not.toMatch(/layout_presets="[^"]*\bsplit\b/);
    expect(result).not.toMatch(/layout_presets="[^"]*\bgrid\b/);
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

  test("zsh layout show/delete/edit complete with dynamic layout names", () => {
    const result = generateZshCompletion();
    // The layout case should reference layout_presets (dynamically populated) for show/delete/edit
    expect(result).toMatch(/layout\)[\s\S]*?show\b.*\bdelete\b.*\bedit\b[\s\S]*?layout_presets/s);
  });

  test("bash layout show/delete/edit complete with dynamic layout names", () => {
    const result = generateBashCompletion();
    // The layout case should reference layout_presets (dynamically populated) for show/delete/edit
    expect(result).toMatch(/layout\)[\s\S]*?show\b.*\bdelete\b.*\bedit\b[\s\S]*?layout_presets/s);
  });
});

describe("subcommand-specific flag completions", () => {
  test("zsh doctor completion includes --fix flag", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/doctor\)[\s\S]*?compadd\s+--\s+--fix/);
  });

  test("zsh keybindings completion includes --vim flag", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/keybindings\)[\s\S]*?compadd\s+--\s+--vim/);
  });

  test("bash doctor completion includes --fix flag", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/doctor\)[\s\S]*?compgen\s+-W\s+"--fix"/);
  });

  test("bash keybindings completion includes --vim flag", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/keybindings\)[\s\S]*?compgen\s+-W\s+"--vim"/);
  });
});

describe("bash _init_completion portability", () => {
  test("bash completion has fallback when _init_completion is unavailable", () => {
    const result = generateBashCompletion();
    // Should check for _init_completion and provide a fallback
    expect(result).toContain("type _init_completion &>/dev/null");
    expect(result).toContain('local cur="${COMP_WORDS[COMP_CWORD]}"');
    expect(result).toContain('local prev="${COMP_WORDS[COMP_CWORD-1]}"');
  });

  test("bash completion still uses _init_completion when available", () => {
    const result = generateBashCompletion();
    expect(result).toContain("_init_completion || return");
  });
});

describe("freeze subcommand completions", () => {
  test("bash freeze completes with layout names", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/freeze\)[\s\S]*?layout_presets/);
  });

  test("zsh freeze completes with layout names", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/freeze\)[\s\S]*?layout_presets/);
  });
});

describe("export subcommand completions", () => {
  test("bash export completes with file paths", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/export\)[\s\S]*?compgen\s+-f/);
  });

  test("zsh export completes with file paths", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/export\)[\s\S]*?_files/);
  });
});

describe("custom layout completions", () => {
  test("zsh completions use dynamic command substitution for --layout (includes custom layouts at completion time)", () => {
    const result = generateZshCompletion();
    // Dynamic substitution means custom layouts are resolved at completion time, not bake-time
    expect(result).toContain("summon layout list");
    expect(result).toContain("layout_presets");
  });

  test("bash completions use dynamic command substitution for --layout (includes custom layouts at completion time)", () => {
    const result = generateBashCompletion();
    // Dynamic substitution means custom layouts are resolved at completion time, not bake-time
    expect(result).toContain("summon layout list");
    expect(result).toContain("layout_presets");
  });

  test("zsh completions reference layout_presets dynamically in set layout value completions", () => {
    const result = generateZshCompletion();
    // The layout_presets variable should be used in the set layout case
    expect(result).toMatch(/layout\b[\s\S]*?compadd -a layout_presets/);
  });

  test("includes --clean and --no-clean in zsh completions", () => {
    const result = generateZshCompletion();
    expect(result).toContain("--clean[");
    expect(result).toContain("--no-clean[");
  });

  test("includes clean key in bash config key completions", () => {
    const result = generateBashCompletion();
    expect(result).toContain("clean");
  });

  test("includes --clean and --no-clean in bash flag completions", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--clean");
    expect(result).toContain("--no-clean");
  });

  test("completions still use dynamic layout resolution regardless of custom layout list", () => {
    const zsh = generateZshCompletion();
    const bash = generateBashCompletion();
    // Both shells should use command substitution to resolve layouts at completion time
    expect(zsh).toContain("summon layout list");
    expect(bash).toContain("summon layout list");
  });
});
