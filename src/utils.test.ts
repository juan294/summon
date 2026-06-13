import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock child_process before importing utils.
// AR-M1 #603: include execFile (with promisify.custom so that promisify(execFile)
// returns an async function that yields {stdout, stderr}) so gitOutput's dynamic
// import works in this test file.
import { promisify as _utilPromisify } from "node:util";
const mockExecFileSync = vi.fn();

// Async implementation that powers the execFile mock (via promisify.custom).
// Returns {stdout, stderr} to match the real execFile promisified signature.
type ExecFileCbResult = { stdout: string; stderr: string };
let _mockExecFileAsyncImpl: (...args: unknown[]) => Promise<ExecFileCbResult> = async () => ({ stdout: "", stderr: "" });
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[_utilPromisify.custom] =
  async (...args: unknown[]): Promise<ExecFileCbResult> => _mockExecFileAsyncImpl(...args);

// Helpers to control the async execFile mock behavior in tests
const mockExecFileAsync = {
  mockResolveOnce(stdout: string) {
    const origImpl = _mockExecFileAsyncImpl;
    let used = false;
    _mockExecFileAsyncImpl = async (...args: unknown[]) => {
      if (!used) { used = true; _mockExecFileAsyncImpl = origImpl; return { stdout, stderr: "" }; }
      return origImpl(...args);
    };
  },
  mockReject(err: Error) {
    _mockExecFileAsyncImpl = async () => { throw err; };
  },
  reset() {
    _mockExecFileAsyncImpl = async () => ({ stdout: "", stderr: "" });
  },
};

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
    execFile: mockExecFile,
  };
});

// Mock node:fs for isGhosttyInstalled tests.
// writeFileSync and renameSync are passed through to the real implementations
// so that atomicWrite (which uses them) works correctly in tests.
const mockExistsSync = vi.fn((_path: string) => false);
const mockMkdirSync = vi.fn();
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (path: string) => mockExistsSync(path),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
});

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
const { SAFE_COMMAND_RE, GHOSTTY_PATHS, GHOSTTY_APP_NAME, SUMMON_WORKSPACE_ENV, resolveCommand, promptUser, getErrorMessage, exitWithUsageHint, formatUserError, checkAccessibility, openAccessibilitySettings, isAccessibilityError, isGhosttyInstalled, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT, ACCESSIBILITY_REQUIRED_MSG, PromptCancelled, isDebug, debugLog, supportsColor, confirm, gitSafeEnv, resetGitSafeEnvCache, atomicWrite, resetGitOutputCache } = await import("./utils.js");

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
      "/usr/bin/which",
      ["vim"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
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

  it("throws PromptCancelled on Ctrl+C (close event)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Simulate Ctrl+C: question never calls back, close handler fires instead
    mockQuestion.mockImplementation(() => {}); // no callback
    mockOn.mockImplementation((_event: string, cb: () => void) => cb());

    await expect(promptUser("Q: ")).rejects.toThrow(PromptCancelled);
    await expect(promptUser("Q: ")).rejects.toThrow("Cancelled");

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

// UX-H1 (#598): formatUserError — consistent branded error prefix
describe("formatUserError", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("includes 'summon: error:' prefix in no-color mode", () => {
    process.env = { ...originalEnv, NO_COLOR: "1" };
    delete (process.env as Record<string, string | undefined>)["FORCE_COLOR"];
    const result = formatUserError("something went wrong");
    expect(result).toContain("summon: error:");
    expect(result).toContain("something went wrong");
  });

  it("does not include raw ANSI codes in no-color mode", () => {
    process.env = { ...originalEnv, NO_COLOR: "1" };
    delete (process.env as Record<string, string | undefined>)["FORCE_COLOR"];
    const result = formatUserError("msg");
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/\x1b\[/);
  });

  it("includes ANSI codes in color mode", () => {
    process.env = { ...originalEnv, FORCE_COLOR: "1" };
    delete (process.env as Record<string, string | undefined>)["NO_COLOR"];
    const result = formatUserError("msg");
    // eslint-disable-next-line no-control-regex
    expect(result).toMatch(/\x1b\[/);
    expect(result).toContain("summon: error:");
    expect(result).toContain("msg");
  });

  it("always ends with the supplied message", () => {
    const msg = "directory not found";
    process.env = { ...originalEnv, NO_COLOR: "1" };
    delete (process.env as Record<string, string | undefined>)["FORCE_COLOR"];
    expect(formatUserError(msg)).toMatch(new RegExp(`${msg}$`));
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
      expect.objectContaining({ encoding: "utf-8", timeout: 2000 }),
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

  it("ACCESSIBILITY_ENABLE_HINT names Ghostty specifically", () => {
    expect(ACCESSIBILITY_ENABLE_HINT).toContain("Ghostty");
  });

  it("ACCESSIBILITY_REQUIRED_MSG names Ghostty specifically", () => {
    expect(ACCESSIBILITY_REQUIRED_MSG).toContain("Ghostty");
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

describe("isDebug", () => {
  it("returns false when SUMMON_DEBUG is not set", () => {
    delete process.env["SUMMON_DEBUG"];
    expect(isDebug()).toBe(false);
  });

  it("returns true when SUMMON_DEBUG is '1'", () => {
    process.env["SUMMON_DEBUG"] = "1";
    expect(isDebug()).toBe(true);
    delete process.env["SUMMON_DEBUG"];
  });

  it("returns false when SUMMON_DEBUG is set to a value other than '1'", () => {
    process.env["SUMMON_DEBUG"] = "true";
    expect(isDebug()).toBe(false);
    delete process.env["SUMMON_DEBUG"];
  });
});

describe("debugLog", () => {
  it("does not write to stderr when SUMMON_DEBUG is not set", () => {
    delete process.env["SUMMON_DEBUG"];
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("should not appear");
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("writes to stderr when SUMMON_DEBUG=1", () => {
    process.env["SUMMON_DEBUG"] = "1";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("hello", "world");
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]?.[0] as string;
    expect(output).toMatch(/^\[summon:debug /);
    expect(output).toContain("hello world");
    writeSpy.mockRestore();
    delete process.env["SUMMON_DEBUG"];
  });

  it("includes a timestamp in the debug output", () => {
    process.env["SUMMON_DEBUG"] = "1";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("timestamped");
    const output = writeSpy.mock.calls[0]?.[0] as string;
    // ISO timestamp pattern
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    writeSpy.mockRestore();
    delete process.env["SUMMON_DEBUG"];
  });
});

// ---------------------------------------------------------------------------
// FE-M6 — supportsColor() is lazy (evaluated at call time)
// ---------------------------------------------------------------------------

describe("supportsColor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Remove color-related env vars for a clean baseline
    delete process.env["FORCE_COLOR"];
    delete process.env["NO_COLOR"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("is exported as a function", () => {
    expect(typeof supportsColor).toBe("function");
  });

  it("returns true when FORCE_COLOR=1 is set", () => {
    process.env["FORCE_COLOR"] = "1";
    expect(supportsColor()).toBe(true);
  });

  it("returns false when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    expect(supportsColor()).toBe(false);
  });

  it("NO_COLOR takes precedence over FORCE_COLOR", () => {
    process.env["FORCE_COLOR"] = "1";
    process.env["NO_COLOR"] = "1";
    expect(supportsColor()).toBe(false);
  });

  it("reflects env changes between calls (lazy evaluation)", () => {
    delete process.env["FORCE_COLOR"];
    delete process.env["NO_COLOR"];
    const first = supportsColor();

    process.env["FORCE_COLOR"] = "1";
    const second = supportsColor();

    // The second call should return true regardless of first
    expect(second).toBe(true);
    // And they should differ if first was false (non-TTY environment)
    if (!first) {
      expect(second).not.toBe(first);
    }
  });

  it("returns false when FORCE_COLOR=0", () => {
    process.env["FORCE_COLOR"] = "0";
    expect(supportsColor()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FE-M8 — PromptCancelled + confirm() Escape/Ctrl+C/Enter cancel
// ---------------------------------------------------------------------------

// Mock readline for confirm tests (raw mode)
const mockStdinSetRawMode = vi.fn();
const mockStdinResume = vi.fn();
const mockStdinPause = vi.fn();
const mockStdinSetEncoding = vi.fn();
const mockStdinOnce = vi.fn();
const mockStdinOff = vi.fn();
const mockStdinOn = vi.fn();

// ---------------------------------------------------------------------------
// gitSafeEnv
// ---------------------------------------------------------------------------

describe("gitSafeEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetGitSafeEnvCache(); // PE-M2: reset memoized cache so each test gets a fresh env snapshot
  });

  afterEach(() => {
    process.env = originalEnv;
    resetGitSafeEnvCache();
  });

  it("returns an object (the cleaned env)", () => {
    const result = gitSafeEnv();
    expect(typeof result).toBe("object");
  });

  it("strips GIT_DIR from the returned env", () => {
    process.env["GIT_DIR"] = "/some/repo/.git";
    const result = gitSafeEnv();
    expect("GIT_DIR" in result).toBe(false);
  });

  it("strips GIT_WORK_TREE from the returned env", () => {
    process.env["GIT_WORK_TREE"] = "/some/repo";
    const result = gitSafeEnv();
    expect("GIT_WORK_TREE" in result).toBe(false);
  });

  it("strips GIT_INDEX_FILE from the returned env", () => {
    process.env["GIT_INDEX_FILE"] = "/some/index";
    const result = gitSafeEnv();
    expect("GIT_INDEX_FILE" in result).toBe(false);
  });

  it("strips all three git context vars when all are set", () => {
    process.env["GIT_DIR"] = "/a";
    process.env["GIT_WORK_TREE"] = "/b";
    process.env["GIT_INDEX_FILE"] = "/c";
    const result = gitSafeEnv();
    expect("GIT_DIR" in result).toBe(false);
    expect("GIT_WORK_TREE" in result).toBe(false);
    expect("GIT_INDEX_FILE" in result).toBe(false);
  });

  it("preserves other env vars", () => {
    process.env["MY_CUSTOM_VAR"] = "hello";
    const result = gitSafeEnv();
    expect(result["MY_CUSTOM_VAR"]).toBe("hello");
  });

  it("does not modify process.env (returns a new object)", () => {
    process.env["GIT_DIR"] = "/some/.git";
    gitSafeEnv();
    // process.env should still have GIT_DIR — we only stripped from the returned copy
    expect(process.env["GIT_DIR"]).toBe("/some/.git");
  });

  // PE-M2 #608: memoization — same object returned on repeated calls
  it("returns the same object reference on repeated calls (memoized)", () => {
    const first = gitSafeEnv();
    const second = gitSafeEnv();
    expect(first).toBe(second); // strict reference equality
  });

  it("resetGitSafeEnvCache causes next call to recompute", () => {
    const before = gitSafeEnv();
    resetGitSafeEnvCache();
    const after = gitSafeEnv();
    // After reset, a new object is created (different reference)
    expect(after).not.toBe(before);
  });
});

describe("PromptCancelled", () => {
  it("is an Error subclass", () => {
    expect(new PromptCancelled() instanceof Error).toBe(true);
  });

  it("has a default message", () => {
    expect(new PromptCancelled().message).toBeTruthy();
  });

  it("can be detected with instanceof", () => {
    const err = new PromptCancelled();
    expect(err instanceof PromptCancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BE-H1 — atomicWrite: unique temp path prevents concurrent write corruption
// ---------------------------------------------------------------------------

describe("atomicWrite", () => {
  // Use importActual to get real fs functions — vi.mock("node:fs") replaces the module,
  // so top-level imports from "node:fs" in tests go through the mock too.
  let realFs: typeof import("node:fs");

  beforeAll(async () => {
    realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  });

  const testDir = join(tmpdir(), `summon-atomicWrite-test-${process.pid}`);
  let targetPath: string;

  beforeEach(() => {
    realFs.mkdirSync(testDir, { recursive: true });
    targetPath = join(testDir, `target-${Date.now()}.json`);
  });

  afterEach(() => {
    // Clean up target and any stray temp files
    try { realFs.unlinkSync(targetPath); } catch { /* ok if already removed */ }
    // Remove any leftover fixed-suffix .tmp file (should not exist with the fix)
    try { realFs.unlinkSync(`${targetPath}.tmp`); } catch { /* ok */ }
  });

  // BE-M4 #605: cleanup orphaned .tmp on rename failure
  it("removes temp file when renameSync fails (BE-M4 #605)", async () => {
    const fsMock = await import("node:fs");
    const origRenameSync = realFs.renameSync;
    let capturedTmpPath: string | null = null;

    const renameSpy = vi.spyOn(fsMock, "renameSync").mockImplementationOnce((src) => {
      capturedTmpPath = src as string;
      throw new Error("EXDEV: cross-device rename");
    });

    expect(() => atomicWrite(targetPath, "should-fail")).toThrow("EXDEV");

    renameSpy.mockRestore();
    void origRenameSync; // keep reference

    // The orphaned tmp file must have been cleaned up by atomicWrite's catch block
    expect(capturedTmpPath).not.toBeNull();
    expect(realFs.existsSync(capturedTmpPath!)).toBe(false);
  });

  it("writes content to the target path", () => {
    atomicWrite(targetPath, "hello");
    expect(realFs.readFileSync(targetPath, "utf-8")).toBe("hello");
  });

  it("overwrites an existing file atomically", () => {
    realFs.writeFileSync(targetPath, "old content");
    atomicWrite(targetPath, "new content");
    expect(realFs.readFileSync(targetPath, "utf-8")).toBe("new content");
  });

  it("uses a unique temp path per write (not a shared .tmp suffix)", async () => {
    // Capture the temp path that atomicWrite uses by intercepting renameSync.
    // The temp path must include process.pid and a random hex segment so that
    // two concurrent processes writing the same target never collide on the same
    // temp file (regression guard for BE-H1: was `${path}.tmp` — fixed path).
    const capturedTmpPaths: string[] = [];
    const origRenameSync = realFs.renameSync;

    // Patch the real renameSync (what atomicWrite calls through the mock passthrough)
    // by temporarily wrapping it via the module mock.
    // Instead, spy on the module mock's renameSync which delegates to real.
    // Simplest approach: use the node:fs mock which spreads real, so we spy on it.
    const fsMock = await import("node:fs");
    const renameSpy = vi.spyOn(fsMock, "renameSync").mockImplementation((src, dest) => {
      capturedTmpPaths.push(src as string);
      origRenameSync(src as string, dest as string);
    });

    atomicWrite(targetPath, "content-1");
    atomicWrite(targetPath, "content-2");

    renameSpy.mockRestore();

    // Both writes must have used different temp paths
    expect(capturedTmpPaths).toHaveLength(2);
    const [tmp1, tmp2] = capturedTmpPaths as [string, string];

    // Each temp path must NOT be the bare fixed suffix `${targetPath}.tmp`
    expect(tmp1).not.toBe(`${targetPath}.tmp`);
    expect(tmp2).not.toBe(`${targetPath}.tmp`);

    // Each temp path must be different from the other (unique per write)
    expect(tmp1).not.toBe(tmp2);

    // Each temp path must embed the process pid
    expect(tmp1).toContain(`.${process.pid}.`);
    expect(tmp2).toContain(`.${process.pid}.`);

    // Final content is the last write
    expect(realFs.readFileSync(targetPath, "utf-8")).toBe("content-2");
  });
});

describe("confirm", () => {
  let originalStdin: typeof process.stdin;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    originalStdin = process.stdin;
    // Replace process.stdin with a mock that supports raw mode
    const mockStdin = {
      isTTY: true,
      setRawMode: mockStdinSetRawMode,
      resume: mockStdinResume,
      pause: mockStdinPause,
      setEncoding: mockStdinSetEncoding,
      once: mockStdinOnce,
      off: mockStdinOff,
      on: mockStdinOn,
      removeListener: mockStdinOff,
    };
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true, configurable: true });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true, configurable: true });
    vi.clearAllMocks();
  });

  function simulateKeypress(key: string): void {
    mockStdinOnce.mockImplementation((_event: string, cb: (key: string) => void) => {
      cb(key);
    });
  }

  it("returns true for 'y' input", async () => {
    simulateKeypress("y");
    expect(await confirm("Continue?")).toBe(true);
    const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("Continue?");
    expect(output).toContain("[y/N]");
  });

  it("returns true for 'Y' input", async () => {
    simulateKeypress("Y");
    expect(await confirm("Continue?")).toBe(true);
  });

  it("returns false for 'n' input", async () => {
    simulateKeypress("n");
    expect(await confirm("Continue?")).toBe(false);
  });

  it("returns false for 'N' input", async () => {
    simulateKeypress("N");
    expect(await confirm("Continue?")).toBe(false);
  });

  it("returns false for Enter (empty input — default no)", async () => {
    simulateKeypress("\r");
    expect(await confirm("Continue?")).toBe(false);
  });

  it("returns false for newline (empty input — default no)", async () => {
    simulateKeypress("\n");
    expect(await confirm("Continue?")).toBe(false);
  });

  it("throws PromptCancelled for Escape key", async () => {
    simulateKeypress("\x1b");
    await expect(confirm("Continue?")).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("throws PromptCancelled for Ctrl+C", async () => {
    simulateKeypress("\x03");
    await expect(confirm("Continue?")).rejects.toBeInstanceOf(PromptCancelled);
  });
});

// ---------------------------------------------------------------------------
// runPool
// ---------------------------------------------------------------------------

const { runPool, ioConcurrency, gitOutput, gitOutputSync } = await import("./utils.js");

describe("runPool", () => {
  it("returns empty array for empty input", async () => {
    const results = await runPool([], 4, async (x: number) => x * 2);
    expect(results).toEqual([]);
  });

  it("preserves input order in output", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runPool(items, 2, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("propagates results correctly for each item", async () => {
    const items = ["a", "b", "c"];
    const results = await runPool(items, 3, async (x) => x.toUpperCase());
    expect(results).toEqual(["A", "B", "C"]);
  });

  it("never exceeds limit concurrent tasks", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const limit = 3;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runPool(items, limit, async (_item) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      // Yield to allow other tasks to start if the pool allows it
      await Promise.resolve();
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(limit);
  });

  it("handles limit=1 (serial execution)", async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await runPool(items, 1, async (x) => {
      order.push(x);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("handles limit larger than items (all run concurrently)", async () => {
    const items = [1, 2, 3];
    const results = await runPool(items, 100, async (x) => x + 1);
    expect(results).toEqual([2, 3, 4]);
  });

  it("passes index as second argument to fn", async () => {
    const items = ["x", "y", "z"];
    const indices: number[] = [];
    await runPool(items, 2, async (_item, idx) => {
      indices.push(idx);
    });
    // All indices must be present (order may vary for concurrent runs)
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  // ---------------------------------------------------------------------------
  // QA-M1 (#597) — rejection contract: runPool rejects on the first failing task.
  // Callers that need per-item resilience must catch inside fn (all four
  // consumers in briefing/ports/monitor/snapshot already do this).
  // ---------------------------------------------------------------------------

  it("rejects when a middle item's fn rejects (propagates first rejection)", async () => {
    const boom = new Error("task-2 exploded");
    const items = [1, 2, 3];
    const promise = runPool(items, 3, async (x) => {
      if (x === 2) throw boom;
      return x;
    });
    await expect(promise).rejects.toThrow("task-2 exploded");
    await expect(promise).rejects.toBe(boom);
  });

  it("rejects when the first item's fn rejects", async () => {
    const items = ["a", "b", "c"];
    await expect(
      runPool(items, 2, async (x) => {
        if (x === "a") throw new Error("first-item-error");
        return x;
      }),
    ).rejects.toThrow("first-item-error");
  });

  it("rejects when the last item's fn rejects", async () => {
    const items = [10, 20, 30];
    await expect(
      runPool(items, 1, async (x) => {
        if (x === 30) throw new Error("last-item-error");
        return x;
      }),
    ).rejects.toThrow("last-item-error");
  });

  it("preserves order and respects concurrency cap on all-success runs (unaffected by rejection logic)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const limit = 2;
    const items = [1, 2, 3, 4, 5, 6];

    const results = await runPool(items, limit, async (x) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await Promise.resolve();
      inFlight--;
      return x * 100;
    });

    expect(results).toEqual([100, 200, 300, 400, 500, 600]);
    expect(maxInFlight).toBeLessThanOrEqual(limit);
  });
});

describe("ioConcurrency", () => {
  it("returns a number between 2 and 8 inclusive", () => {
    const c = ioConcurrency();
    expect(typeof c).toBe("number");
    expect(c).toBeGreaterThanOrEqual(2);
    expect(c).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// AR-M1 #603: gitOutput / gitOutputSync shared helpers
// ---------------------------------------------------------------------------

// gitOutput dynamically imports execFile (lazily cached); the mock is set up above with promisify.custom.
describe("gitOutput (AR-M1 #603)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSync.mockImplementation(() => "/usr/bin/stub\n");
    mockExecFileAsync.reset();
    resetGitOutputCache(); // force re-initialization with current mock
  });

  it("resolves with trimmed stdout from execFile", async () => {
    mockExecFileAsync.mockResolveOnce("  develop\n");
    const result = await gitOutput("/some/dir", ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(result).toBe("develop");
  });

  it("rejects when execFile throws (non-git directory)", async () => {
    mockExecFileAsync.mockReject(new Error("fatal: not a git repo"));
    await expect(gitOutput("/not/a/repo", ["rev-parse", "HEAD"])).rejects.toThrow("fatal: not a git repo");
  });

  it("passes git -C <dir> <args> and timeout+encoding to execFile", async () => {
    // Verify the call is made with the right args by capturing via the mock
    let capturedArgs: unknown[] | null = null;
    const origImpl = _mockExecFileAsyncImpl;
    _mockExecFileAsyncImpl = async (...args: unknown[]) => {
      capturedArgs = args;
      return { stdout: "main\n", stderr: "" };
    };
    await gitOutput("/my/repo", ["log", "--oneline"]);
    _mockExecFileAsyncImpl = origImpl;
    expect(capturedArgs).not.toBeNull();
    // The promisify.custom receives the same args as promisified fn: (cmd, args, opts)
    expect(capturedArgs![0]).toBe("git");
    expect(capturedArgs![1]).toEqual(["-C", "/my/repo", "log", "--oneline"]);
    expect((capturedArgs![2] as Record<string, unknown>)["timeout"]).toBe(5000);
    expect((capturedArgs![2] as Record<string, unknown>)["encoding"]).toBe("utf-8");
  });
});

describe("gitOutputSync (AR-M1 #603)", () => {
  // execFileSync is mocked at the top of this file; default mock returns "/usr/bin/stub\n"
  it("returns trimmed stdout (no trailing newline)", () => {
    mockExecFileSync.mockReturnValueOnce("  develop\n");
    const result = gitOutputSync("/some/dir", ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(result).toBe("develop");
  });

  it("passes git -C <dir> <args> to execFileSync with gitSafeEnv", () => {
    mockExecFileSync.mockReturnValueOnce("main\n");
    gitOutputSync("/my/repo", ["status", "--porcelain"]);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["-C", "/my/repo", "status", "--porcelain"],
      expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
    );
  });

  it("throws on non-zero exit (propagates execFileSync error)", () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error("fatal: not a git repo"); });
    expect(() => gitOutputSync("/not/a/repo", ["rev-parse", "HEAD"])).toThrow("fatal: not a git repo");
  });
});
