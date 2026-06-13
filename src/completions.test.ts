import { describe, test, expect, vi } from "vitest";
import { generateZshCompletion, generateBashCompletion, generateFishCompletion } from "./completions.js";
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

describe("generateFishCompletion", () => {
  test("returns a string containing 'complete -c summon'", () => {
    const result = generateFishCompletion();
    expect(result).toContain("complete -c summon");
  });

  test("contains all subcommands with descriptions", () => {
    const result = generateFishCompletion();
    for (const cmd of ["add", "remove", "list", "set", "config", "setup", "completions"]) {
      expect(result).toContain(`-a '${cmd}'`);
    }
  });

  test("uses __fish_use_subcommand for subcommand completion", () => {
    const result = generateFishCompletion();
    expect(result).toContain("__fish_use_subcommand");
  });

  test("contains --help and --version flags", () => {
    const result = generateFishCompletion();
    expect(result).toContain("-l help");
    expect(result).toContain("-l version");
  });

  test("contains layout flag with presets", () => {
    const result = generateFishCompletion();
    expect(result).toContain("-l layout");
    for (const preset of ["minimal", "full", "pair", "cli", "btop"]) {
      expect(result).toContain(preset);
    }
  });

  test("contains common flags", () => {
    const result = generateFishCompletion();
    expect(result).toContain("-l auto-resize");
    expect(result).toContain("-l no-auto-resize");
    expect(result).toContain("-l clean");
    expect(result).toContain("-l no-clean");
    expect(result).toContain("-l dry-run");
    expect(result).toContain("-l env");
  });

  test("starts with fish comment header", () => {
    const result = generateFishCompletion();
    expect(result).toMatch(/^# summon fish completion/);
  });

  test("includes custom layout names in layout preset list", async () => {
    const config = await import("./config.js");
    const spy = vi.spyOn(config, "listCustomLayouts").mockReturnValue(["mywork", "devops"]);

    const result = generateFishCompletion();
    expect(result).toContain("mywork");
    expect(result).toContain("devops");

    spy.mockRestore();
  });
});

describe("session subcommand completions", () => {
  test("zsh output contains session in subcommands list", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/'session:/);
  });

  test("bash output contains session in subcommands list", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/subcommands="[^"]*\bsession\b/);
  });

  test("fish output contains session subcommand", () => {
    const result = generateFishCompletion();
    expect(result).toContain("session");
  });

  test("zsh session completion includes add remove list show subcommands", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/session\)[\s\S]*?add\b[\s\S]*?remove\b[\s\S]*?list\b[\s\S]*?show\b/);
  });

  test("bash session completion includes add remove list show subcommands", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/session\)[\s\S]*?add\b[\s\S]*?remove\b[\s\S]*?list\b[\s\S]*?show\b/);
  });

  test("zsh completion includes sessions directory for name expansion", () => {
    const result = generateZshCompletion();
    expect(result).toContain(".config/summon/sessions");
  });

  test("bash completion includes sessions directory for name expansion", () => {
    const result = generateBashCompletion();
    expect(result).toContain(".config/summon/sessions");
  });

  test("--all flag appears in zsh session completion", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/session\)[\s\S]*?--all/);
  });

  test("--all flag appears in bash session completion", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/session\)[\s\S]*?--all/);
  });

  test("--new-tab flag appears in all shells", () => {
    expect(generateZshCompletion()).toContain("--new-tab");
    expect(generateBashCompletion()).toContain("--new-tab");
    expect(generateFishCompletion()).toContain("new-tab");
  });
});

describe("trust subcommand in completions (FE-H2 #359)", () => {
  test("zsh completions include trust subcommand", () => {
    const result = generateZshCompletion();
    expect(result).toContain("trust");
  });

  test("bash completions include trust subcommand", () => {
    const result = generateBashCompletion();
    expect(result).toContain("trust");
  });

  test("fish completions include trust subcommand", () => {
    const result = generateFishCompletion();
    expect(result).toContain("trust");
  });
});

describe("fish in completions subcommand suggestions (FE-H2 #527)", () => {
  test("zsh completions subcommand suggests fish as a shell target", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/completions\)[\s\S]*?compadd\b.*\bfish\b/);
  });

  test("bash completions subcommand suggests fish as a shell target", () => {
    const result = generateBashCompletion();
    expect(result).toMatch(/completions\)[\s\S]*?compgen\s+-W\s+"[^"]*\bfish\b/);
  });
});

describe("missing flag completions in zsh (FE-M3 #539)", () => {
  test("zsh _arguments block includes --new-tab", () => {
    const result = generateZshCompletion();
    expect(result).toContain("--new-tab[");
  });

  test("zsh _arguments block includes --no-project-config", () => {
    const result = generateZshCompletion();
    expect(result).toContain("--no-project-config[");
  });

  test("zsh trust completion offers directory path completion", () => {
    const result = generateZshCompletion();
    expect(result).toMatch(/trust\)[\s\S]*?_directories/);
  });
});

describe("layout list --names for completions (FE-M4 #388)", () => {
  test("bash completions use 'summon layout list --names' for layout presets", () => {
    const result = generateBashCompletion();
    expect(result).toContain("summon layout list --names");
  });

  test("zsh completions use 'summon layout list --names' for layout presets", () => {
    const result = generateZshCompletion();
    expect(result).toContain("summon layout list --names");
  });
});

describe("fish completions setup snippet (UX-M8 #397)", () => {
  test("fish completions include fish shell setup snippet hint", () => {
    const result = generateFishCompletion();
    expect(result).toContain("psub");
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

describe("FE-M2 (#583) — CLI_FLAGS parity across shells", () => {
  test("CLI_FLAGS includes --no-project-config", () => {
    expect(CLI_FLAGS).toContain("--no-project-config");
  });

  test("bash completion offers every flag in CLI_FLAGS", () => {
    const bash = generateBashCompletion();
    for (const flag of CLI_FLAGS) {
      expect(bash, `bash completion missing: ${flag}`).toContain(flag);
    }
  });

  test("fish completion offers --no-project-config", () => {
    const fish = generateFishCompletion();
    expect(fish).toContain("no-project-config");
  });

  test("fish completion offers --verbose", () => {
    const fish = generateFishCompletion();
    expect(fish).toContain("verbose");
  });

  test("fish completion offers --once (status flag)", () => {
    const fish = generateFishCompletion();
    expect(fish).toContain("once");
  });
});
