import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteFileSync = vi.fn();
const mockListConfig = vi.fn();
const mockRemoveConfig = vi.fn();
const mockSaveCustomLayout = vi.fn();
const mockSetConfig = vi.fn();
const mockIsCustomLayout = vi.fn();
const mockResolveConfig = vi.fn();
const mockOptsToConfigMap = vi.fn();
const mockValidateFloatFlag = vi.fn();
const mockValidateIntFlag = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});
const mockValidateLayoutNameOrExit = vi.fn();
const mockValidateLayoutOrExit = vi.fn();

vi.mock("node:fs", () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock("../config.js", () => ({
  BOOLEAN_KEYS: new Set(["auto-resize", "new-window", "fullscreen", "maximize", "float"]),
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
  listConfig: (...args: unknown[]) => mockListConfig(...args),
  removeConfig: (...args: unknown[]) => mockRemoveConfig(...args),
  saveCustomLayout: (...args: unknown[]) => mockSaveCustomLayout(...args),
  setConfig: (...args: unknown[]) => mockSetConfig(...args),
  isCustomLayout: (...args: unknown[]) => mockIsCustomLayout(...args),
}));

vi.mock("../layout.js", () => ({
  PANES_DEFAULT: 2,
  PANES_MIN: 1,
  EDITOR_SIZE_DEFAULT: 75,
  EDITOR_SIZE_MIN: 10,
  EDITOR_SIZE_MAX: 90,
}));

vi.mock("../launcher.js", () => ({
  resolveConfig: (...args: unknown[]) => mockResolveConfig(...args),
  optsToConfigMap: (...args: unknown[]) => mockOptsToConfigMap(...args),
}));

vi.mock("../validation.js", () => ({
  ENV_KEY_RE: /^[A-Za-z_][A-Za-z0-9_]*$/,
  validateFloatFlag: (...args: unknown[]) => mockValidateFloatFlag(...args),
  validateIntFlag: (...args: unknown[]) => mockValidateIntFlag(...args),
}));

vi.mock("../utils.js", () => ({
  SAFE_COMMAND_RE: /^[A-Za-z0-9._-]+$/,
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
}));

vi.mock("./layout-support.js", () => ({
  validateLayoutNameOrExit: (...args: unknown[]) => mockValidateLayoutNameOrExit(...args),
  validateLayoutOrExit: (...args: unknown[]) => mockValidateLayoutOrExit(...args),
}));

const {
  handleConfigCommand,
  handleExportCommand,
  handleFreezeCommand,
  handleSetCommand,
} = await import("./config.js");

function makeContext(overrides: Partial<Parameters<typeof handleSetCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "set",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListConfig.mockReturnValue(new Map<string, string>());
  mockResolveConfig.mockReturnValue({ opts: { panes: 3 } });
  mockOptsToConfigMap.mockReturnValue(new Map([["panes", "3"]]));
  mockIsCustomLayout.mockReturnValue(false);
});

describe("handleSetCommand", () => {
  it("requires a config key", async () => {
    await expect(handleSetCommand(makeContext())).rejects.toThrow(
      "usage:Usage: summon set <key> [value]",
    );
  });

  it("rejects unknown keys", async () => {
    await expect(handleSetCommand(makeContext({ args: ["unknown", "x"] }))).rejects.toThrow(
      'usage:Error: Unknown config key "unknown". Valid keys: editor, sidebar, panes, editor-size, shell, layout, auto-resize, starship-preset, new-window, fullscreen, maximize, float, font-size, on-start, on-stop, env.<KEY>',
    );
  });

  it("validates environment variable names", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(handleSetCommand(makeContext({ args: ["env.BAD-NAME", "1"] }))).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith('Error: invalid environment variable name "BAD-NAME".');
  });

  it("validates numeric, layout, boolean, float, and preset values", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await handleSetCommand(makeContext({ args: ["panes", "4"] }));
    await handleSetCommand(makeContext({ args: ["editor-size", "70"] }));
    await handleSetCommand(makeContext({ args: ["layout", "pair"] }));
    await handleSetCommand(makeContext({ args: ["font-size", "14.5"] }));
    await expect(handleSetCommand(makeContext({ args: ["auto-resize", "maybe"] }))).rejects.toThrow("exit:1");
    await expect(handleSetCommand(makeContext({ args: ["starship-preset", "bad preset"] }))).rejects.toThrow("exit:1");

    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(1, "panes", "4", 1);
    expect(mockValidateIntFlag).toHaveBeenNthCalledWith(2, "editor-size", "70", 10, 90);
    expect(mockValidateLayoutOrExit).toHaveBeenCalledWith("pair", "layout");
    expect(mockValidateFloatFlag).toHaveBeenCalledWith("font-size", "14.5");
    expect(errorSpy).toHaveBeenCalledWith('Error: auto-resize must be "true" or "false", got "maybe".');
    expect(errorSpy).toHaveBeenCalledWith('Error: invalid starship preset name "bad preset".');
  });

  it("rejects empty command values for command-like keys", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(handleSetCommand(makeContext({ args: ["editor", ""] }))).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith("Error: editor cannot be set to an empty string.");
    expect(errorSpy).toHaveBeenCalledWith("To reset to default, run: summon set editor (without a value)");
  });

  it("sets config values when a value is provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleSetCommand(makeContext({ args: ["editor", "nvim"] }));

    expect(mockSetConfig).toHaveBeenCalledWith("editor", "nvim");
    expect(logSpy).toHaveBeenCalledWith("Set editor → nvim");
  });

  it("removes config values when no value is provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleSetCommand(makeContext({ args: ["editor"] }));

    expect(mockRemoveConfig).toHaveBeenCalledWith("editor");
    expect(logSpy).toHaveBeenCalledWith("Removed editor (will use default)");
  });
});

describe("handleConfigCommand", () => {
  it("prints effective defaults when config is empty", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleConfigCommand();

    expect(logSpy).toHaveBeenCalledWith("No machine config set. Effective defaults:");
    expect(logSpy).toHaveBeenCalledWith("  panes → 2");
    expect(logSpy).toHaveBeenCalledWith("\nCustomize with: summon set <key> <value>");
  });

  it("prints stored config entries including unknown and empty values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListConfig.mockReturnValue(new Map([
      ["editor", ""],
      ["auto-resize", ""],
      ["panes", "4"],
      ["unknown", "mystery"],
    ]));

    await handleConfigCommand();

    expect(logSpy).toHaveBeenCalledWith("Machine config:");
    expect(logSpy).toHaveBeenCalledWith("  editor → (plain shell)");
    expect(logSpy).toHaveBeenCalledWith("  auto-resize → (empty)");
    expect(logSpy).toHaveBeenCalledWith("  panes → 4");
    expect(logSpy).toHaveBeenCalledWith("  unknown → mystery  (unknown key — will be ignored)");
    expect(logSpy).toHaveBeenCalledWith("    Remove with: summon set unknown");
  });
});

describe("handleFreezeCommand", () => {
  it("requires a layout name", async () => {
    await expect(handleFreezeCommand(makeContext({ args: [] }))).rejects.toThrow("usage:");
  });

  it("rejects freezing over an existing custom layout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockIsCustomLayout.mockReturnValue(true);

    await expect(handleFreezeCommand(makeContext({ args: ["team"] }))).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Layout "team" already exists. Delete it first: summon layout delete team',
    );
  });

  it("freezes the resolved config into a custom layout", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleFreezeCommand(makeContext({ args: ["team"] }));

    expect(mockValidateLayoutNameOrExit).toHaveBeenCalledWith("team");
    expect(mockResolveConfig).toHaveBeenCalledWith(process.cwd(), {});
    expect(mockOptsToConfigMap).toHaveBeenCalledWith({ panes: 3 });
    expect(mockSaveCustomLayout).toHaveBeenCalledWith("team", new Map([["panes", "3"]]));
    expect(logSpy).toHaveBeenCalledWith(
      'Frozen current config as layout "team". Launch with: summon . --layout team',
    );
  });
});

describe("handleExportCommand", () => {
  it("prints commented defaults when config is empty", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await handleExportCommand(makeContext());

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("# No machine config set. All values use defaults."));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("# editor=vim"));
  });

  it("writes exported config to the provided output path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListConfig.mockReturnValue(new Map([
      ["editor", "nvim"],
      ["panes", "4"],
      ["env.PORT", "3000"],
    ]));

    await handleExportCommand(makeContext({ args: ["./out.summon"] }));

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${process.cwd()}/out.summon`,
      expect.stringContaining("editor=nvim"),
      { mode: 0o644 },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${process.cwd()}/out.summon`,
      expect.stringContaining("env.PORT=3000"),
      { mode: 0o644 },
    );
    expect(logSpy).toHaveBeenCalledWith(`Exported to: ${process.cwd()}/out.summon`);
  });
});
