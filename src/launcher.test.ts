import { describe, it, expect, vi, beforeEach } from "vitest";

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
  readKVFile: (path: string) => mockReadKVFile(path),
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
const { getConfig } = await import("./config.js");
const { existsSync } = await import("node:fs");

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all commands are installed (resolveCommand uses encoding: "utf-8")
  mockExecSync.mockImplementation((cmd: string) => {
    if (typeof cmd === "string" && cmd.startsWith("command -v "))
      return "/usr/bin/stub\n";
    return "";
  });
  vi.mocked(existsSync).mockReturnValue(true);
  mockReadKVFile.mockReturnValue(new Map<string, string>());
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

  it("exits with error if Ghostty.app is not found", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path) === "/Applications/Ghostty.app") return false;
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
});

describe("script execution", () => {
  it("executes generated script via osascript", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace");

    expect(mockExecSync).toHaveBeenCalledWith(
      "osascript",
      expect.objectContaining({ input: 'tell application "Ghostty"\nend tell' }),
    );
  });

  it("prints script to stdout in dry-run mode without executing", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith('tell application "Ghostty"\nend tell');
    // osascript should NOT have been called
    expect(mockExecSync).not.toHaveBeenCalledWith(
      "osascript",
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it("passes correct plan and directory to generateAppleScript", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace", { layout: "minimal" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        leftColumnCount: 1,
        rightColumnEditorCount: 0,
        hasServer: false,
      }),
      "/tmp/workspace",
    );
  });
});

describe("config resolution", () => {
  it("project config overrides global config", () => {
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "claude";
      return undefined;
    });
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
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", {});
    // Preset minimal sets editorPanes=1, but project overrides to 4
    expect(opts.editorPanes).toBe(4);
    // Preset minimal sets server=false, no override → stays false
    expect(opts.server).toBe("false");
  });

  it("unknown preset warns and falls through to defaults", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadKVFile.mockReturnValue(new Map([["layout", "bogus"]]));
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", {});
    expect(warnSpy).toHaveBeenCalledWith(
      'Unknown layout preset: "bogus". Valid presets: minimal, full, pair, cli, mtop. Using defaults.',
    );
    expect(opts.editorPanes).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("unknown preset warning lists all valid presets", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadKVFile.mockReturnValue(new Map([["layout", "invalid"]]));
    vi.mocked(getConfig).mockReturnValue(undefined);

    resolveConfig("/tmp/workspace", {});

    const warnMsg = warnSpy.mock.calls[0]![0] as string;
    expect(warnMsg).toContain("minimal");
    expect(warnMsg).toContain("full");
    expect(warnMsg).toContain("pair");
    expect(warnMsg).toContain("cli");
    expect(warnMsg).toContain("mtop");
    warnSpy.mockRestore();
  });
});

describe("command dependency checks", () => {
  it("checks editor and sidebar commands before launching", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace");

    // Default editor=claude, sidebar=lazygit
    expect(mockExecSync).toHaveBeenCalledWith("command -v claude", {
      encoding: "utf-8",
    });
    expect(mockExecSync).toHaveBeenCalledWith("command -v lazygit", {
      encoding: "utf-8",
    });
  });

  it("already-installed commands proceed without prompting", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace");

    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("offers to install a known missing command (claude)", async () => {
    let claudeCallCount = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v claude") {
        claudeCallCount++;
        if (claudeCallCount <= 1) throw new Error("not found");
        return "/usr/bin/claude\n";
      }
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v obscure-tool") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "obscure-tool";
      if (key === "sidebar") return "htop";
      return undefined;
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("shows correct CLI syntax in error message", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v obscure-tool") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "obscure-tool";
      if (key === "sidebar") return "htop";
      return undefined;
    });

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

  it("skips check when editor and sidebar are empty strings", async () => {
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "";
      if (key === "sidebar") return "";
      return undefined;
    });

    await launch("/tmp/workspace");

    const commandChecks = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((c) => typeof c === "string" && c.startsWith("command -v "));
    expect(commandChecks).toEqual([]);
  });

  it("exits when user declines install", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v claude") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

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
  it("checks secondaryEditor binary when mtop preset is used", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace", { layout: "mtop" });

    expect(mockExecSync).toHaveBeenCalledWith("command -v mtop", {
      encoding: "utf-8",
    });
  });
});

describe("ensureCommand error paths", () => {
  it("exits when install command throws an error", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v claude") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    mockExecFileSync.mockImplementation(() => {
      throw new Error("install failed");
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v claude") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    vi.mocked(getConfig).mockReturnValue(undefined);

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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v lazygit") {
        lazygitCallCount++;
        if (lazygitCallCount <= 1) throw new Error("not found");
        return "/usr/bin/lazygit\n";
      }
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v lazygit") throw new Error("not found");
      // brew check (called without encoding, with stdio: "ignore")
      if (cmd === "command -v brew") throw new Error("not found");
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      if (typeof cmd === "string" && cmd === "osascript")
        return "";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

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
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "foo; rm -rf /";
      return undefined;
    });

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
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "`evil`";
      return undefined;
    });

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
    vi.mocked(getConfig).mockImplementation((key: string) => {
      if (key === "editor") return "my-editor.v2";
      if (key === "sidebar") return "htop";
      return undefined;
    });

    await launch("/tmp/workspace");

    expect(mockExecSync).toHaveBeenCalledWith("command -v my-editor.v2", {
      encoding: "utf-8",
    });
  });
});

describe("input validation", () => {
  it("warns and uses default when panes is NaN", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { panes: "abc" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is zero", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { panes: "0" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is negative", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { panes: "-2" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "0" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is out of range", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "150" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is NaN", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "big" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid panes value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { panes: "5" });
    expect(opts.editorPanes).toBe(5);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid editorSize value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getConfig).mockReturnValue(undefined);

    const { opts } = resolveConfig("/tmp/workspace", { "editor-size": "60" });
    expect(opts.editorSize).toBe(60);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("osascript error handling", () => {
  it("shows user-friendly error when osascript execution fails", async () => {
    vi.mocked(getConfig).mockReturnValue(undefined);
    mockExecSync.mockImplementation((cmd: string, opts?: Record<string, unknown>) => {
      if (cmd === "osascript" && opts?.input) {
        throw new Error("osascript execution failed");
      }
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
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
      expect.stringContaining("Failed to execute workspace script"),
    );
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("path resolution", () => {
  it("passes resolved full paths to generateAppleScript", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v claude") return "/Users/me/.local/bin/claude\n";
      if (cmd === "command -v lazygit") return "/opt/homebrew/bin/lazygit\n";
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "/Users/me/.local/bin/claude",
        sidebarCommand: "/opt/homebrew/bin/lazygit",
      }),
      "/tmp/workspace",
    );
  });

  it("resolves only the binary part of compound server commands", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "command -v npm") return "/usr/local/bin/npm\n";
      if (typeof cmd === "string" && cmd.startsWith("command -v "))
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(getConfig).mockReturnValue(undefined);

    await launch("/tmp/workspace", { server: "npm run dev" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        serverCommand: "/usr/local/bin/npm run dev",
      }),
      "/tmp/workspace",
    );
  });
});
