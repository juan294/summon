import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing utils
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock node:fs for isGhosttyInstalled tests
const mockExistsSync = vi.fn((_path: string) => false);
vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

// Mock readline for promptUser tests
const mockQuestion = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: mockClose,
    on: (event: string, cb: () => void) => mockOn(event, cb),
    off: (event: string, cb: () => void) => mockOff(event, cb),
  }),
}));

// Import after mocks
const { SAFE_COMMAND_RE, GHOSTTY_PATHS, GHOSTTY_APP_NAME, SUMMON_WORKSPACE_ENV, resolveCommand, promptUser, getErrorMessage, exitWithUsageHint, checkAccessibility, openAccessibilitySettings, isAccessibilityError, isGhosttyInstalled, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT } = await import("./utils.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockImplementation(() => "/usr/bin/stub\n");
});

describe("SAFE_COMMAND_RE", () => {
  it("matches simple command names", () => {
    expect(SAFE_COMMAND_RE.test("vim")).toBe(true);
    expect(SAFE_COMMAND_RE.test("nvim")).toBe(true);
    expect(SAFE_COMMAND_RE.test("claude")).toBe(true);
  });

  it("matches command names with dots", () => {
    expect(SAFE_COMMAND_RE.test("my-editor.v2")).toBe(true);
    expect(SAFE_COMMAND_RE.test("node.js")).toBe(true);
  });

  it("matches command names with hyphens", () => {
    expect(SAFE_COMMAND_RE.test("my-editor")).toBe(true);
    expect(SAFE_COMMAND_RE.test("git-flow")).toBe(true);
  });

  it("matches command names with plus signs", () => {
    expect(SAFE_COMMAND_RE.test("g++")).toBe(true);
    expect(SAFE_COMMAND_RE.test("c++")).toBe(true);
  });

  it("matches command names with underscores", () => {
    expect(SAFE_COMMAND_RE.test("my_tool")).toBe(true);
    expect(SAFE_COMMAND_RE.test("_private")).toBe(true);
  });

  it("matches command names starting with digits after first char", () => {
    expect(SAFE_COMMAND_RE.test("python3")).toBe(true);
    expect(SAFE_COMMAND_RE.test("node18")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(SAFE_COMMAND_RE.test("")).toBe(false);
  });

  it("rejects commands with semicolons (shell injection)", () => {
    expect(SAFE_COMMAND_RE.test("foo; rm -rf /")).toBe(false);
  });

  it("rejects commands with backticks", () => {
    expect(SAFE_COMMAND_RE.test("`evil`")).toBe(false);
  });

  it("rejects commands with dollar signs", () => {
    expect(SAFE_COMMAND_RE.test("$HOME")).toBe(false);
  });

  it("rejects commands with spaces", () => {
    expect(SAFE_COMMAND_RE.test("foo bar")).toBe(false);
  });

  it("rejects commands with pipe", () => {
    expect(SAFE_COMMAND_RE.test("cmd|evil")).toBe(false);
  });

  it("rejects commands with ampersand", () => {
    expect(SAFE_COMMAND_RE.test("cmd&evil")).toBe(false);
  });

  it("rejects commands starting with a hyphen", () => {
    expect(SAFE_COMMAND_RE.test("-flag")).toBe(false);
  });

  it("rejects commands starting with a dot", () => {
    expect(SAFE_COMMAND_RE.test(".hidden")).toBe(false);
  });

  it("rejects commands starting with a plus", () => {
    expect(SAFE_COMMAND_RE.test("+plus")).toBe(false);
  });
});

describe("GHOSTTY_PATHS", () => {
  it("contains /Applications/Ghostty.app", () => {
    expect(GHOSTTY_PATHS).toContain("/Applications/Ghostty.app");
  });

  it("contains ~/Applications/Ghostty.app (expanded)", () => {
    const homeApps = GHOSTTY_PATHS.find(
      (p) => p.endsWith("/Applications/Ghostty.app") && p !== "/Applications/Ghostty.app",
    );
    expect(homeApps).toBeDefined();
  });

  it("has exactly 2 paths", () => {
    expect(GHOSTTY_PATHS).toHaveLength(2);
  });
});

describe("shared constants", () => {
  it("GHOSTTY_APP_NAME is 'Ghostty'", () => {
    expect(GHOSTTY_APP_NAME).toBe("Ghostty");
  });

  it("SUMMON_WORKSPACE_ENV is 'SUMMON_WORKSPACE'", () => {
    expect(SUMMON_WORKSPACE_ENV).toBe("SUMMON_WORKSPACE");
  });
});

describe("resolveCommand", () => {
  it("returns path when command is found", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    expect(resolveCommand("vim")).toBe("/usr/bin/vim");
  });

  it("returns null when command is not found", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(resolveCommand("nonexistent")).toBeNull();
  });

  it("trims trailing newline from path", () => {
    mockExecFileSync.mockReturnValue("/usr/local/bin/nvim\n");
    expect(resolveCommand("nvim")).toBe("/usr/local/bin/nvim");
  });

  it("calls execFileSync with correct arguments", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    resolveCommand("vim");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", 'command -v "$1"', "--", "vim"],
      { encoding: "utf-8" },
    );
  });

  it("returns null for invalid command names (SAFE_COMMAND_RE check)", () => {
    expect(resolveCommand("foo; rm -rf /")).toBeNull();
    // Should NOT call execFileSync for invalid commands
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns null for commands with backticks without calling shell", () => {
    expect(resolveCommand("`evil`")).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns null for commands with dollar signs without calling shell", () => {
    expect(resolveCommand("$HOME")).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns null for empty string without calling shell", () => {
    expect(resolveCommand("")).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("resolves valid command names with special chars (dots, hyphens, plus)", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/my-editor.v2\n");
    expect(resolveCommand("my-editor.v2")).toBe("/usr/bin/my-editor.v2");
    expect(mockExecFileSync).toHaveBeenCalled();
  });
});

describe("getErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts message from Error subclasses", () => {
    expect(getErrorMessage(new TypeError("type fail"))).toBe("type fail");
  });

  it("converts string to itself", () => {
    expect(getErrorMessage("plain string")).toBe("plain string");
  });

  it("converts number to string", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  it("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });
});

describe("promptUser", () => {
  it("returns trimmed user input", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("  hello  "),
    );
    const result = await promptUser("Enter: ");
    expect(result).toBe("hello");
  });

  it("passes the question string to readline", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("answer"),
    );
    await promptUser("What is your name? ");
    expect(mockQuestion).toHaveBeenCalledWith("What is your name? ", expect.any(Function));
  });

  it("closes the readline interface after answering", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("answer"),
    );
    await promptUser("Q: ");
    expect(mockClose).toHaveBeenCalled();
  });

  it("removes close listener before closing on normal answer", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("answer"),
    );
    await promptUser("Q: ");
    expect(mockOff).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("registers a close handler for Ctrl+C", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("answer"),
    );
    await promptUser("Q: ");
    expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("exits cleanly on Ctrl+C (close event)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Simulate Ctrl+C: question never calls back, close handler fires instead
    mockQuestion.mockImplementation(() => {}); // no callback
    mockOn.mockImplementation((_event: string, cb: () => void) => cb());

    await expect(promptUser("Q: ")).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(130);

    exitSpy.mockRestore();
    logSpy.mockRestore();
    mockOn.mockReset();
  });

  it("does NOT lowercase the answer (callers handle that)", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("YES"),
    );
    const result = await promptUser("Confirm? ");
    expect(result).toBe("YES");
  });

  it("returns empty string when user enters only whitespace", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("   "),
    );
    const result = await promptUser("Input: ");
    expect(result).toBe("");
  });
});

describe("exitWithUsageHint", () => {
  it("prints message and usage hint when message is provided", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => exitWithUsageHint("Bad flag")).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith("Bad flag");
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon --help' for usage information.");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints only usage hint when no message is provided", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => exitWithUsageHint()).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon --help' for usage information.");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints only usage hint when message is empty string", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => exitWithUsageHint("")).toThrow("exit");
    // Empty string is falsy, so only the usage hint is printed
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon --help' for usage information.");

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("checkAccessibility", () => {
  it("returns true when System Events responds", () => {
    mockExecFileSync.mockReturnValueOnce("Finder\n");
    const result = checkAccessibility();
    expect(result).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first process'],
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("returns false when osascript throws (accessibility denied)", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("osascript is not allowed assistive access. (-1719)");
    });
    const result = checkAccessibility();
    expect(result).toBe(false);
  });

  it("returns false for any osascript error", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("some other osascript error");
    });
    const result = checkAccessibility();
    expect(result).toBe(false);
  });
});

describe("openAccessibilitySettings", () => {
  it("calls open with the correct URL scheme", () => {
    openAccessibilitySettings();
    expect(mockExecFileSync).toHaveBeenCalledWith("open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ]);
  });

  it("does not throw when open fails", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("open failed");
    });
    expect(() => openAccessibilitySettings()).not.toThrow();
  });
});

describe("isAccessibilityError", () => {
  it("returns true for 'assistive access' message", () => {
    expect(isAccessibilityError("osascript is not allowed assistive access. (-1719)")).toBe(true);
  });

  it("returns true for '-1719' error code", () => {
    expect(isAccessibilityError("execution error: (-1719)")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isAccessibilityError("connection is invalid (-609)")).toBe(false);
  });
});

describe("accessibility constants", () => {
  it("ACCESSIBILITY_SETTINGS_PATH contains the settings path", () => {
    expect(ACCESSIBILITY_SETTINGS_PATH).toContain("Accessibility");
  });

  it("ACCESSIBILITY_ENABLE_HINT mentions terminal app", () => {
    expect(ACCESSIBILITY_ENABLE_HINT).toContain("terminal app");
  });
});

describe("isGhosttyInstalled", () => {
  it("returns true when Ghostty exists at /Applications", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === "/Applications/Ghostty.app",
    );
    expect(isGhosttyInstalled()).toBe(true);
  });

  it("returns true when Ghostty exists at ~/Applications", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith("/Applications/Ghostty.app") && p !== "/Applications/Ghostty.app",
    );
    expect(isGhosttyInstalled()).toBe(true);
  });

  it("returns false when Ghostty is not found at any known path", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isGhosttyInstalled()).toBe(false);
  });
});
