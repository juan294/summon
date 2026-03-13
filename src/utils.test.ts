import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing utils
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Import after mocks
const { SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand } = await import("./utils.js");

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
