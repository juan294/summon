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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
      "--auto-resize",
      "--no-auto-resize",
    ]);

    expect(parsed.subcommand).toBe("layout");
    expect(parsed.args).toEqual(["create", "demo"]);
    expect(parsed.values.env).toEqual(["PORT=3000", "NODE_ENV=test"]);
    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(1, "panes", "3", 1);
    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(2, "editor-size", "70", 10, 90);
    expect(mockValidateFloatFlag).toHaveBeenCalledWith("font-size", "13.5");
    expect(mockValidateLayoutOrExit).toHaveBeenCalledWith("pair", "--layout");
    expect(warnSpy).toHaveBeenCalledWith(
      "Warning: both --auto-resize and --no-auto-resize specified; using --no-auto-resize.",
    );
  });

  it("rejects env entries without KEY=VALUE", () => {
    expect(() => parseCli(["ports", "--env", "INVALID"])).toThrow(
      'usage:Error: --env must be in KEY=VALUE format, got "INVALID".',
    );
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
});

describe("help output", () => {
  it("shows full help text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Layout presets:"));
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
