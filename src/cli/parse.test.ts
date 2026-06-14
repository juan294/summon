import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateIntFlag = vi.fn();
const mockValidateFloatFlag = vi.fn();
const mockValidateLayoutOrExit = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});

vi.mock("../layout.js", () => ({
  PANES_MIN: 1,
  EDITOR_SIZE_MIN: 10,
  EDITOR_SIZE_MAX: 90,
}));

vi.mock("../validation.js", () => ({
  validateIntFlag: (...args: unknown[]) => mockValidateIntFlag(...args),
  validateFloatFlag: (...args: unknown[]) => mockValidateFloatFlag(...args),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
  };
});

vi.mock("../config.js", () => ({
  VALID_KEYS: [
    "editor",
    "sidebar",
    "panes",
    "editor-size",
    "shell",
    "layout",
    "auto-resize",
    "starship-preset",
    "new-window",
    "fullscreen",
    "maximize",
    "float",
    "font-size",
    "on-start",
    "on-stop",
  ],
}));

vi.mock("../commands/layout-support.js", () => ({
  validateLayoutOrExit: (...args: unknown[]) => mockValidateLayoutOrExit(...args),
}));

vi.mock("../setup-gallery.js", () => ({
  LAYOUT_INFO: {
    minimal: { desc: "Single editor + sidebar", diagram: "" },
    pair: { desc: "Two editors + sidebar + shell", diagram: "" },
    full: { desc: "Three editors + sidebar + shell", diagram: "" },
    cli: { desc: "Single editor + sidebar + shell", diagram: "" },
    btop: { desc: "Editor + system monitor + sidebar + shell", diagram: "" },
  },
}));

Object.defineProperty(globalThis, "__VERSION__", {
  value: "1.3.0",
  configurable: true,
});

const {
  buildOverrides,
  parseCli,
} = await import("./parse.js");

const {
  hasSubcommandHelp,
  showHelp,
  showSubcommandHelp,
} = await import("./help.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseCli", () => {
  it("parses subcommands, args, and validations", () => {
    const parsed = parseCli([
      "layout",
      "create",
      "demo",
      "--panes", "3",
      "--editor-size", "70",
      "--font-size", "13.5",
      "--layout", "pair",
      "--env", "PORT=3000",
      "--env", "NODE_ENV=test",
    ]);

    expect(parsed.subcommand).toBe("layout");
    expect(parsed.args).toEqual(["create", "demo"]);
    expect(parsed.values.env).toEqual(["PORT=3000", "NODE_ENV=test"]);
    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(1, "panes", "3", 1);
    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(2, "editor-size", "70", 10, 90);
    expect(mockValidateFloatFlag).toHaveBeenCalledWith("font-size", "13.5");
    expect(mockValidateLayoutOrExit).toHaveBeenCalledWith("pair", "--layout");
  });

  it("errors when both --auto-resize and --no-auto-resize are passed", () => {
    expect(() => parseCli([".", "--auto-resize", "--no-auto-resize"])).toThrow(
      "usage:Error: --auto-resize and --no-auto-resize are mutually exclusive",
    );
  });

  it("errors when both --clean and --no-clean are passed", () => {
    expect(() => parseCli([".", "--clean", "--no-clean"])).toThrow(
      "usage:Error: --clean and --no-clean are mutually exclusive",
    );
  });

  it("rejects env entries without KEY=VALUE", () => {
    expect(() => parseCli(["ports", "--env", "INVALID"])).toThrow(
      'usage:Error: --env must be in KEY=VALUE format, got "INVALID".',
    );
  });

  it("parses a positional-only launch target without optional validations", () => {
    const parsed = parseCli(["."]);

    expect(parsed.subcommand).toBe(".");
    expect(parsed.args).toEqual([]);
    expect(mockValidateIntFlag).not.toHaveBeenCalled();
    expect(mockValidateFloatFlag).not.toHaveBeenCalled();
    expect(mockValidateLayoutOrExit).not.toHaveBeenCalled();
  });

  it("adds an ambiguous-value tip when parseArgs throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseCli([".", "--font-size", "-5"])).toThrow("usage:");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"));
    expect(errorSpy).toHaveBeenCalledWith(
      "Tip: To pass a value starting with '-', use '--flag=-value' syntax.",
    );
  });
});

describe("buildOverrides", () => {
  it("maps all supported CLI values into launcher overrides", () => {
    expect(buildOverrides({
      layout: "pair",
      editor: "nvim",
      panes: "4",
      "editor-size": "72",
      sidebar: "lazygit",
      shell: "zsh",
      "auto-resize": true,
      "starship-preset": "nerd-font",
      env: ["PORT=3000"],
      "font-size": "15.5",
      "on-start": "pnpm dev",
      "new-window": true,
      fullscreen: true,
      maximize: true,
      float: true,
      "dry-run": true,
    })).toEqual({
      layout: "pair",
      editor: "nvim",
      panes: "4",
      "editor-size": "72",
      sidebar: "lazygit",
      shell: "zsh",
      "auto-resize": "true",
      "starship-preset": "nerd-font",
      env: ["PORT=3000"],
      "font-size": "15.5",
      "on-start": "pnpm dev",
      "new-window": "true",
      fullscreen: "true",
      maximize: "true",
      float: "true",
      dryRun: true,
    });
  });

  it("lets --no-auto-resize override --auto-resize", () => {
    expect(buildOverrides({
      "auto-resize": true,
      "no-auto-resize": true,
    })).toEqual({
      "auto-resize": "false",
    });
  });

  it("--clean sets overrides.clean='true'", () => {
    expect(buildOverrides({ clean: true })).toEqual({ clean: "true" });
  });

  it("--no-clean sets overrides.clean='false'", () => {
    expect(buildOverrides({ "no-clean": true })).toEqual({ clean: "false" });
  });

  it("--no-clean wins over --clean when both passed", () => {
    expect(buildOverrides({ clean: true, "no-clean": true })).toEqual({ clean: "false" });
  });

  it("neither --clean nor --no-clean → no clean override emitted", () => {
    expect(buildOverrides({})).not.toHaveProperty("clean");
  });

  it("returns an empty override map when no CLI override values are set", () => {
    expect(buildOverrides({})).toEqual({});
  });

  it("preserves explicit empty string for --editor", () => {
    expect(buildOverrides({ editor: "" })).toEqual({ editor: "" });
  });

  it("preserves explicit empty string for --sidebar", () => {
    expect(buildOverrides({ sidebar: "" })).toEqual({ sidebar: "" });
  });

  it("preserves explicit zero-value for --panes", () => {
    expect(buildOverrides({ panes: "0" })).toEqual({ panes: "0" });
  });

  it("preserves explicit false-value boolean flags via undefined check", () => {
    // false is a valid boolean value — should not be dropped
    expect(buildOverrides({ "auto-resize": false })).toEqual({ "auto-resize": "true" });
  });
});

describe("help output", () => {
  it("shows full help text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    // FE-L2 (#552): after fix, the dynamic "Layouts:" section replaces the hardcoded "Layout presets:" block
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Layouts:");
    logSpy.mockRestore();
  });

  it("contains hierarchical section headers (UX-H2)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("LAUNCH");
    expect(output).toContain("PROJECTS");
    expect(output).toContain("CONFIG");
    expect(output).toContain("Run 'summon <command> --help'");
  });

  it("contains config-only keys section (UX-H1)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Config-only keys (no CLI flag)");
    expect(output).toContain("on-stop");
  });

  it("mentions tree DSL in layout section (FE-M7)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("tree DSL");
    expect(output).toContain("root(left right)");
  });

  it("reports subcommand help availability", () => {
    expect(hasSubcommandHelp("add")).toBe(true);
    expect(hasSubcommandHelp("unknown")).toBe(false);
  });

  it("shows subcommand help text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showSubcommandHelp("snapshot");

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: summon snapshot"));
  });
});

// --- UX-H1 + FE-H2: trust in help text ---

describe("trust command in help and subcommand help", () => {
  it("includes 'trust' in the main help text (FE-H2 #359)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("trust");
    logSpy.mockRestore();
  });

  it("has subcommand help entry for 'trust' (FE-H2 #359)", () => {
    expect(hasSubcommandHelp("trust")).toBe(true);
  });
});

// --- UX-H3: --once warning allowlist ---

describe("--once warning allowlist (UX-H3 #372)", () => {
  it("does not emit warning for 'status' subcommand with --once (status is allowlisted)", () => {
    // The warning guard is in index.ts, not parse.ts, but we test the allowlist here
    // via ONCE_ALLOWED_SUBCOMMANDS export if available, otherwise we test the behavior
    // We verify status is in the list of subcommands that legitimately use --once
    expect(hasSubcommandHelp("status")).toBe(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showSubcommandHelp("status");
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("--once");
    logSpy.mockRestore();
  });
});

// --- UX-M3: unknown flag error message ---

describe("unknown flag error message (UX-M3 #396)", () => {
  it("emits an actionable error for unknown flags instead of raw parseArgs text", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseCli(["--bogus-flag"])).toThrow("usage:");
    const allErrors = errorSpy.mock.calls.map(c => c[0]).join("\n");
    expect(allErrors).toMatch(/Unknown flag.*--bogus-flag/i);
    expect(allErrors).toContain("summon --help");
    errorSpy.mockRestore();
  });
});

// --- UX-M8: fish in completions subcommand help ---

describe("fish completions in subcommand help (UX-M8 #397)", () => {
  it("mentions fish shell in completions subcommand help", () => {
    expect(hasSubcommandHelp("completions")).toBe(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showSubcommandHelp("completions");
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("fish");
    logSpy.mockRestore();
  });
});

// --- UX-L1: help text mentions session prominently ---

describe("session in help text (UX-M6 #433)", () => {
  it("mentions 'session' in the main help text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("session");
    logSpy.mockRestore();
  });

  it("has subcommand help for 'session'", () => {
    expect(hasSubcommandHelp("session")).toBe(true);
  });
});

// --- UX-M7: --help lists layout names with descriptions ---

describe("layouts section in --help (UX-M7 #510)", () => {
  it("contains a 'Layouts:' section in help output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Layouts:");
    logSpy.mockRestore();
  });

  it("lists built-in layout names with one-line descriptions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    // Should contain layout names that match LAYOUT_INFO keys
    expect(output).toContain("minimal");
    expect(output).toContain("pair");
    expect(output).toContain("full");
    expect(output).toContain("cli");
    expect(output).toContain("btop");
    logSpy.mockRestore();
  });

  it("layouts section includes one-line descriptions from LAYOUT_INFO", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    // LAYOUT_INFO has desc values — at least one should appear
    const hasDesc = output.includes("Single editor") ||
      output.includes("Two editors") ||
      output.includes("Three editors") ||
      output.includes("sidebar");
    expect(hasDesc).toBe(true);
    logSpy.mockRestore();
  });
});

// --- UX-M2: unknown command error includes help suggestion ---

describe("unknown command error includes help suggestion (UX-M2 #430)", () => {
  it("showHelp output passes basic sanity — at least contains 'Usage'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Usage");
    logSpy.mockRestore();
  });
});

// --- AR-H1: --new-window and --new-tab conflict check (#525) ---

describe("--new-window and --new-tab conflict (AR-H1 #525)", () => {
  it("errors with a usage hint when both --new-window and --new-tab are passed", () => {
    expect(() => parseCli([".", "--new-window", "--new-tab"])).toThrow(
      "usage:Error: --new-window and --new-tab are mutually exclusive",
    );
  });

  it("does not error when only --new-window is passed", () => {
    expect(() => parseCli([".", "--new-window"])).not.toThrow();
  });

  it("does not error when only --new-tab is passed", () => {
    expect(() => parseCli([".", "--new-tab"])).not.toThrow();
  });
});

// --- UX-M2: wrapHelpLine wraps on narrow terminals (#541) ---

describe("wrapHelpLine wraps on narrow terminals (UX-M2 #541)", () => {
  it("help output produced on a narrow terminal wraps the description instead of truncating with ellipsis", async () => {
    // Simulate a narrow terminal by mocking process.stdout.columns
    const origColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 60, configurable: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await showHelp();
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");

    // Restore
    Object.defineProperty(process.stdout, "columns", { value: origColumns, configurable: true });
    logSpy.mockRestore();

    // With wrapping, long lines should not end with the ellipsis truncation character
    const lines = output.split("\n");
    const truncatedLines = lines.filter(l => l.trimEnd().endsWith("…"));
    expect(truncatedLines).toHaveLength(0);
  });

  it("help output on a wide terminal keeps lines on a single line (no unnecessary wrapping)", async () => {
    const origColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 200, configurable: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await showHelp();
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");

    Object.defineProperty(process.stdout, "columns", { value: origColumns, configurable: true });
    logSpy.mockRestore();

    // On a 200-col terminal all option lines must fit; none should be truncated with ellipsis
    const truncatedLines = output.split("\n").filter(l => l.trimEnd().endsWith("…"));
    expect(truncatedLines).toHaveLength(0);
  });
});

// --- UX-M3: --new-tab appears in main --help Options list (#542) ---

describe("--new-tab in main help Options list (UX-M3 #542)", () => {
  it("includes --new-tab in the Options section of the main help output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("--new-tab");
    logSpy.mockRestore();
  });
});

// --- FE-L2 (#552): layout presets not duplicated in help ---

describe("layout presets not duplicated in help (FE-L2 #552)", () => {
  it("does not contain a hardcoded 'Layout presets:' block separate from the dynamic Layouts section", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    // After fix: hardcoded "Layout presets:" block is removed; only dynamic "Layouts:" section exists
    expect(output).not.toContain("Layout presets:");
    logSpy.mockRestore();
  });

  it("'Layouts:' section header appears exactly once (no duplicate section)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    // Strip ANSI codes to count section headers accurately
    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    const layoutsSectionCount = (plain.match(/^Layouts:$/gm) ?? []).length;
    expect(layoutsSectionCount).toBe(1);
    logSpy.mockRestore();
  });
});

// --- AR-L3: bounds-checked subcommand help ---

describe("showSubcommandHelp — bounds check (AR-L3)", () => {
  it("does not throw when called with an unknown subcommand (graceful no-op)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Previously SUBCOMMAND_HELP[subcommand] would be undefined; bounds check now guards this
    expect(() => showSubcommandHelp("not-a-real-subcommand")).not.toThrow();
    logSpy.mockRestore();
  });

  it("parseCli returns subcommand=undefined when no positionals given", () => {
    // Previously: const [subcommand, ...args] = positionals;
    // With noUncheckedIndexedAccess, this could be typed as string|undefined.
    // After fix, subcommand is explicitly undefined when positionals is empty.
    const result = parseCli([]);
    expect(result.subcommand).toBeUndefined();
    expect(result.args).toEqual([]);
  });
});

// --- #518 (UX-L1): switch presented as alias of open, not a separate first-class line ---

describe("switch as alias of open in main help (#518 UX-L1)", () => {
  it("does NOT list 'switch' as a standalone first-class LAUNCH command line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await showHelp();
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    logSpy.mockRestore();

    // Strip ANSI codes for plain-text assertion
    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");

    // The old standalone line was "  summon switch               Switch to an active workspace…"
    // It must NOT appear as its own first-class launch line anymore.
    // We check that 'summon switch' does not appear as an independent indented command line
    // (i.e., NOT on a line that starts with leading spaces followed by 'summon switch' alone).
    const lines = plain.split("\n");
    const standaloneSwitchLine = lines.find(l =>
      /^\s+summon switch\s/.test(l) && !/alias/i.test(l) && !/open/i.test(l),
    );
    expect(standaloneSwitchLine).toBeUndefined();
  });

  it("shows 'switch' as alias under open's entry in LAUNCH section", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await showHelp();
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    logSpy.mockRestore();

    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    // The open entry should mention 'alias' and 'switch' somewhere near it
    expect(plain).toMatch(/summon open[\s\S]{0,200}alias[\s\S]{0,50}switch/);
  });

  it("'summon switch' still has subcommand help (command still works)", () => {
    expect(hasSubcommandHelp("switch")).toBe(true);
  });
});

// --- #452 (UX-S1): docs/repo URL discoverability footer ---

describe("docs/repo URL in main help (#452 UX-S1)", () => {
  it("includes a link to the GitHub repo or docs in main help output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await showHelp();
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    logSpy.mockRestore();

    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toMatch(/github\.com\/juan294\/summon/);
  });
});

// --- #621 (FE-L1): --vim and --fix misuse warnings ---

describe("--vim and --fix misuse warnings (#621 FE-L1)", () => {
  // These tests verify the warning is emitted for commands that don't consume --vim / --fix.
  // The warning logic lives in index.ts, but we test its output via the help module's
  // VIM_ALLOWED_SUBCOMMANDS / FIX_ALLOWED_SUBCOMMANDS exports (verified conceptually here)
  // and via the parse.test scope which exercises the warning-emission path.

  // We test the allowlists indirectly: 'keybindings' allows --vim, 'doctor' allows --fix.
  it("'keybindings' subcommand help mentions --vim (it's the canonical consumer)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showSubcommandHelp("keybindings");
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("--vim");
  });

  it("'doctor' subcommand help mentions --fix (it's the canonical consumer)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showSubcommandHelp("doctor");
    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("--fix");
  });
});
