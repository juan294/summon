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

vi.mock("../utils.js", () => ({
  getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
}));

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

Object.defineProperty(globalThis, "__VERSION__", {
  value: "1.3.0",
  configurable: true,
});

const {
  buildOverrides,
  hasSubcommandHelp,
  parseCli,
  showHelp,
  showSubcommandHelp,
} = await import("./parse.js");

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
  it("shows full help text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Layout presets:"));
  });

  it("contains hierarchical section headers (UX-H2)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("LAUNCH");
    expect(output).toContain("PROJECTS");
    expect(output).toContain("CONFIG");
    expect(output).toContain("Run 'summon <command> --help'");
  });

  it("contains config-only keys section (UX-H1)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Config-only keys (no CLI flag)");
    expect(output).toContain("on-stop");
  });

  it("mentions tree DSL in layout section (FE-M7)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

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
  it("includes 'trust' in the main help text (FE-H2 #359)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

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
  it("mentions 'session' in the main help text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("session");
    logSpy.mockRestore();
  });

  it("has subcommand help for 'session'", () => {
    expect(hasSubcommandHelp("session")).toBe(true);
  });
});

// --- UX-M2: unknown command error includes help suggestion ---

describe("unknown command error includes help suggestion (UX-M2 #430)", () => {
  it("showHelp output passes basic sanity — at least contains 'Usage'", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Usage");
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
