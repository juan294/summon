import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();
const mockAddProject = vi.fn();
const mockRemoveProject = vi.fn();
const mockGetProject = vi.fn();
const mockListProjects = vi.fn();
const mockFocusWorkspace = vi.fn();
const mockLaunch = vi.fn();
const mockPromptUser = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});
const mockLoadProjectRows = vi.fn();
const mockRenderRow = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

vi.mock("node:os", () => ({
  homedir: () => "/Users/tester",
}));

vi.mock("../config.js", () => ({
  addProject: (...args: unknown[]) => mockAddProject(...args),
  removeProject: (...args: unknown[]) => mockRemoveProject(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
}));

const mockReadStatusRecord = vi.fn((_project: string): unknown => null);
const mockDetection = vi.fn((): unknown => ({ ok: true, backend: "rex", placement: "inside-rex", server: "unix:///s", rexBinary: "/r", notices: [] }));
const mockCloseLauncherTab = vi.fn();
vi.mock("../status-record.js", () => ({ readStatusRecord: (project: string) => mockReadStatusRecord(project) }));
vi.mock("../backend.js", () => ({ resolveBackendForLaunch: () => mockDetection() }));
const mockStartWatch = vi.fn();
vi.mock("../backends/rex/launcher-tab.js", () => ({ closeLauncherTabAfterRexLaunch: (...args: unknown[]) => mockCloseLauncherTab(...args), startLauncherTabWatch: (...args: unknown[]) => mockStartWatch(...args) }));
vi.mock("../launcher.js", () => ({
  focusWorkspace: (...args: unknown[]) => mockFocusWorkspace(...args),
  launch: (...args: unknown[]) => mockLaunch(...args),
}));

// PromptCancelled must be exported from the utils mock because project.ts uses instanceof.
class MockPromptCancelled extends Error {
  constructor(msg = "Cancelled") { super(msg); this.name = "PromptCancelled"; }
}

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    promptUser: (...args: unknown[]) => mockPromptUser(...args),
    exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
    PromptCancelled: MockPromptCancelled,
  };
});

const mockLoadProjectRow = vi.fn();
vi.mock("../monitor.js", () => ({
  loadProjectRows: (...args: unknown[]) => mockLoadProjectRows(...args),
  loadProjectRow: (...args: unknown[]) => mockLoadProjectRow(...args),
  renderRow: (...args: unknown[]) => mockRenderRow(...args),
  isLiveState: (state: string) => state === "active" || state === "active-long" || state === "partial",
}));

const {
  handleAddCommand,
  handleListCommand,
  handleOpenCommand,
  handleRemoveCommand,
  resolveTargetDirectory,
} = await import("./project.js");

function makeContext(overrides: Partial<Parameters<typeof handleOpenCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "open",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockListProjects.mockReturnValue(new Map<string, string>());
  mockRenderRow.mockReturnValue("project row");
  mockFocusWorkspace.mockReturnValue({kind:"focused",terminalId:"00000000-0000-4000-8000-000000000001"});
  Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
});

describe("handleAddCommand", () => {
  it("requires both name and path", async () => {
    await expect(handleAddCommand(makeContext({ args: ["demo"] }))).rejects.toThrow(
      "usage:Usage: summon add <name> <path>",
    );
  });

  it("rejects name containing '/'", async () => {
    await expect(handleAddCommand(makeContext({ args: ["team/api", "/tmp/x"] }))).rejects.toThrow(/usage:/);
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("rejects '..' as name", async () => {
    await expect(handleAddCommand(makeContext({ args: ["..", "/tmp/x"] }))).rejects.toThrow(/usage:/);
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("rejects leading '-'", async () => {
    await expect(handleAddCommand(makeContext({ args: ["-abc", "/tmp/x"] }))).rejects.toThrow(/usage:/);
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("rejects 65-char name", async () => {
    await expect(handleAddCommand(makeContext({ args: ["a".repeat(65), "/tmp/x"] }))).rejects.toThrow(/usage:/);
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("accepts 'my-project_2'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleAddCommand(makeContext({ args: ["my-project_2", "/tmp/x"] }));
    expect(mockAddProject).toHaveBeenCalledWith("my-project_2", "/tmp/x");
    logSpy.mockRestore();
  });

  it("accepts 'acme.web'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleAddCommand(makeContext({ args: ["acme.web", "/tmp/x"] }));
    expect(mockAddProject).toHaveBeenCalledWith("acme.web", "/tmp/x");
    logSpy.mockRestore();
  });

  it("warns when the path does not exist and registers the expanded path", async () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(false);

    await handleAddCommand(makeContext({ args: ["demo", "~/code/demo"] }));

    expect(mockAddProject).toHaveBeenCalledWith("demo", "/Users/tester/code/demo");
    // UX-M2: the one warning prefix, on stderr as before
    expect(warnSpy).toHaveBeenCalledWith("summon: warning: path does not exist: /Users/tester/code/demo\n");
    // UX-M1 (#395): message should indicate warning, not plain success
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Registered with warning"));
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("shows plain success message when path exists (UX-M1 #395)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);

    await handleAddCommand(makeContext({ args: ["demo", "/tmp/x"] }));

    const msg = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(msg).toContain("Registered: demo");
    expect(msg).not.toContain("warning");
    logSpy.mockRestore();
  });
});

describe("FE-H1/UX-H3 (#526,#530): canonical glyph vocabulary", () => {
  // UX-M2: the stderr warning uses the one "summon: warning:" prefix; the ⚠ glyph stays on the stdout summary line.
  it("prefixes the stderr warning with summon: warning: instead of a glyph", async () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(false);

    await handleAddCommand(makeContext({ args: ["demo", "~/code/demo"] }));

    const warnMsg = warnSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(warnMsg).toMatch(/^summon: warning: /);
    expect(warnMsg).not.toContain("⚠");
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("uses ✓ (not a plain letter) as ok glyph in success log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);

    await handleAddCommand(makeContext({ args: ["demo", "/tmp/x"] }));

    const logMsg = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(logMsg).toContain("✓");
    logSpy.mockRestore();
  });

  it("uses ✓ (not a plain letter) as ok glyph in remove success log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRemoveProject.mockReturnValue(true);

    await handleRemoveCommand(makeContext({ args: ["demo"] }));

    const logMsg = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(logMsg).toContain("✓");
    logSpy.mockRestore();
  });

  it("uses ⚠ (not !) as warn glyph in path-missing log message", async () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(false);

    await handleAddCommand(makeContext({ args: ["demo", "/tmp/missing"] }));

    const logMsg = logSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(logMsg).toContain("⚠");
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("handleRemoveCommand", () => {
  it("requires a project name", async () => {
    await expect(handleRemoveCommand(makeContext())).rejects.toThrow(
      "usage:Usage: summon remove <name>",
    );
  });

  it("removes an existing project", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRemoveProject.mockReturnValue(true);

    await handleRemoveCommand(makeContext({ args: ["demo"] }));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Removed: demo"));
  });

  it("exits when the project does not exist", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockRemoveProject.mockReturnValue(false);
    mockListProjects.mockReturnValue(new Map([["missing-app", "/w/missing-app"]]));

    await expect(handleRemoveCommand(makeContext({ args: ["missing"] }))).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0]));
    // UX-M3: the suggestion follows the error line directly.
    expect(allWrites).toEqual(["summon: error: Project not found: missing\n", "Did you mean: missing-app?\n"]);
    // The hint line still goes through console.error
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon list' to see registered projects.");
    expect(exitSpy).toHaveBeenCalledWith(1);
    writeSpy.mockRestore();
  });
});

describe("handleListCommand", () => {
  it("prints an empty-state hint", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleListCommand();

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("No projects registered.");
    expect(output).toContain("summon add <name> <path>");
    expect(output).toContain("summon setup");
  });

  it("prints all registered projects", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListProjects.mockReturnValue(new Map([
      ["api", "/tmp/api"],
      ["web", "/tmp/web"],
    ]));

    await handleListCommand();

    expect(logSpy).toHaveBeenNthCalledWith(1, "Registered projects:");
    expect(logSpy).toHaveBeenNthCalledWith(2, "  api → /tmp/api");
    expect(logSpy).toHaveBeenNthCalledWith(3, "  web → /tmp/web");
  });
});

describe("handleOpenCommand", () => {
  it("exits when there are no projects", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([]);

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("No projects registered.");
    expect(allWrites).toContain("summon: error:");
    writeSpy.mockRestore();
  });

  it("re-prompts invalid selections and focuses active workspaces", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" },
      { name: "web", directory: "/tmp/web", state: "stopped", uptime: null, gitBranch: "develop" },
    ]);
    mockPromptUser
      .mockResolvedValueOnce("nope")
      .mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext({ overrides: { dryRun: true } }));

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("Invalid selection. Enter a number between 1 and 2.");
    expect(mockFocusWorkspace).toHaveBeenCalledWith("api");
    expect(logSpy).toHaveBeenCalledWith("Switched to [api]");
    writeSpy.mockRestore();
  });

  it("open of a running Rex workspace closes the launcher tab like a launch; a Ghostty workspace never does (D1)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRow.mockReturnValue({ name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" });
    mockFocusWorkspace.mockReturnValue({ kind: "focused", terminalId: "block:1" });
    mockCloseLauncherTab.mockClear();
    mockReadStatusRecord.mockReturnValue({ project: "api", backend: "rex" });
    mockStartWatch.mockClear();
    mockFocusWorkspace.mockImplementation(() => { expect(mockStartWatch).toHaveBeenCalledTimes(1); return { kind: "focused", terminalId: "block:1" }; });
    await handleOpenCommand(makeContext({ args: ["api"] }));
    expect(mockCloseLauncherTab).toHaveBeenCalledWith(expect.objectContaining({ backend: "rex", placement: "inside-rex" }));
    mockFocusWorkspace.mockReturnValue({ kind: "focused", terminalId: "block:1" });
    mockCloseLauncherTab.mockClear();
    mockReadStatusRecord.mockReturnValue({ project: "api", backend: "ghostty" });
    await handleOpenCommand(makeContext({ args: ["api"] }));
    expect(mockCloseLauncherTab).not.toHaveBeenCalled();
    mockReadStatusRecord.mockReturnValue(null);
    logSpy.mockRestore();
  });

  it("launches stopped workspaces with overrides", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRows.mockReturnValue([
      { name: "web", directory: "/tmp/web", state: "stopped", uptime: null, gitBranch: "develop" },
    ]);
    mockPromptUser.mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext({ overrides: { layout: "pair" } }));

    expect(mockLaunch).toHaveBeenCalledWith("/tmp/web", { layout: "pair" });
    expect(mockFocusWorkspace).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("uses the default render width when stdout columns are unavailable", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });
    mockLoadProjectRows.mockReturnValue([
      { name: "web", directory: "/tmp/web", state: "stopped", uptime: null, gitBranch: "develop" },
    ]);
    mockPromptUser.mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext());

    expect(mockRenderRow).toHaveBeenCalledWith(
      expect.objectContaining({ name: "web" }),
      75,
      false,
    );
    expect(logSpy).toHaveBeenCalled();
  });

  // UX-M2 (#475): selecting 0 cancels without launching
  it("exits 0 with 'Cancelled.' message when user selects 0", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" },
    ]);
    mockPromptUser.mockResolvedValueOnce("0");

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:0");
    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allLogs).toContain("Cancelled.");
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // UX-M2 (#475): prompt text includes "(0 to cancel)"
  it("includes '(0 to cancel)' in the prompt text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" },
    ]);
    mockPromptUser.mockResolvedValueOnce("0");

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:0");
    // The prompt passed to promptUser must include "(0 to cancel)"
    const promptArg = mockPromptUser.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain("0 to cancel");
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shows interactive mode hint after the project list", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" },
    ]);
    mockPromptUser.mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext());

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allLogs).toMatch(/summon status.*interactive/i);
  });

  it("passes dynamic row width based on longest project name", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    mockLoadProjectRows.mockReturnValue([
      { name: "short", directory: "/tmp/short", state: "stopped", uptime: null, gitBranch: "main" },
      { name: "a-very-long-project-name", directory: "/tmp/long", state: "stopped", uptime: null, gitBranch: "dev" },
    ]);
    mockPromptUser.mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext());

    // With a 24-char project name, the render width should account for it
    // The second call to renderRow uses the same width as the first
    const [firstCall, secondCall] = mockRenderRow.mock.calls;
    expect(firstCall![1]).toBe(secondCall![1]); // same width for all rows
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("#411 FE-L1: consistent error formatting", () => {
  it("handleRemoveCommand uses stderr (not stdout) for missing project", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockRemoveProject.mockReturnValue(false);

    await expect(handleRemoveCommand(makeContext({ args: ["ghost"] }))).rejects.toThrow("exit:1");
    const stderrWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrWrites).toContain("Project not found");
    // Error must NOT go to stdout
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("Project not found");

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("handleOpenCommand uses stderr (not stdout) for no projects", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([]);

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:1");
    const stderrWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrWrites).toContain("No projects registered");
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("No projects registered");

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("resolveTargetDirectory uses stderr (not stdout) for unknown project", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockGetProject.mockReturnValue(undefined);

    expect(() => resolveTargetDirectory("unknown-project")).toThrow("exit:1");
    const stderrWrites = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderrWrites).toContain("not a known command or registered project");
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("not a known command or registered project");

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

describe("resolveTargetDirectory", () => {
  it("resolves current and relative paths directly", () => {
    expect(resolveTargetDirectory(".")).toBe(process.cwd());
    expect(resolveTargetDirectory("./demo")).toBe(`${process.cwd()}/demo`);
    expect(resolveTargetDirectory("apps/demo")).toBe(`${process.cwd()}/apps/demo`);
  });

  it("expands absolute and home-relative paths", () => {
    expect(resolveTargetDirectory("/tmp/demo")).toBe("/tmp/demo");
    expect(resolveTargetDirectory("~/code/demo")).toBe("/Users/tester/code/demo");
  });

  it("returns registered project paths", () => {
    mockListProjects.mockReturnValue(new Map([["demo", "/work/demo"]]));

    expect(resolveTargetDirectory("demo")).toBe("/work/demo");
  });

  it("exits on unknown project names", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockListProjects.mockReturnValue(new Map());

    expect(() => resolveTargetDirectory("missing")).toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Now emits unified prefix via fail() (#598)
    expect(allWrites).toContain("summon: error:");
    expect(allWrites).toContain(`"missing" is not a known command or registered project. Try: summon --help`);
    expect(allWrites).toContain("To register as a project: summon add missing /path/to/project");
    expect(allWrites).toContain("Or see available:         summon list");
    writeSpy.mockRestore();
  });
});

describe("UX-M4 (#558): empty-state messages are standardized", () => {
  it("handleListCommand uses the standard empty-state message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListProjects.mockReturnValue(new Map());

    await handleListCommand();

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("No projects registered.");
    expect(output).toContain("summon add <name> <path>");
    expect(output).toContain("summon setup");
    logSpy.mockRestore();
  });

  it("handleOpenCommand uses the standard empty-state message", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([]);

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:1");

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("No projects registered.");
    writeSpy.mockRestore();
  });
});

describe("UX-M5 (#559): error prefixes use 'summon: error:' style", () => {
  it("handleRemoveCommand uses 'summon: error:' prefix for project not found", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockRemoveProject.mockReturnValue(false);

    await expect(handleRemoveCommand(makeContext({ args: ["missing"] }))).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("summon: error:");
    writeSpy.mockRestore();
  });
});


describe("P2 picker focus recovery",()=>{
 it("never says Switched or launches after failed exact focus",async()=>{
  mockLoadProjectRows.mockReturnValue([{name:"demo",directory:"/tmp/demo",state:"active",uptime:"1m",gitBranch:"main"}]);
  mockPromptUser.mockResolvedValue("1");mockFocusWorkspace.mockReturnValue({kind:"unavailable",reason:"Missing exact identity; relaunch explicitly"});
  const out=vi.spyOn(console,"log").mockImplementation(()=>{});const err=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);const exit=vi.spyOn(process,"exit").mockImplementation(()=>{throw new Error("exit2");});
  await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit2");
  expect(out.mock.calls.flat().join(" ")).not.toContain("Switched");expect(mockLaunch).not.toHaveBeenCalled();expect(exit).toHaveBeenCalledWith(2);
  out.mockRestore();err.mockRestore();exit.mockRestore();
 });
});

describe("handleOpenCommand under the four-state table (plan P10, Phase 4)", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  it("focuses a partial workspace, refuses an unknown one with its reason (exit 2) and never launches over it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "partial", uptime: "1h", gitBranch: "main", reason: "root pane closed" },
      { name: "web", directory: "/tmp/web", state: "unknown", uptime: "—", gitBranch: "—", reason: "server unreachable" },
    ]);
    mockFocusWorkspace.mockReturnValue({ kind: "focused", terminalId: "block:1" });
    mockPromptUser.mockResolvedValueOnce("1");
    await handleOpenCommand(makeContext());
    expect(mockFocusWorkspace).toHaveBeenCalledWith("api");
    expect(logSpy).toHaveBeenCalledWith("Switched to [api]");
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("1 active / 2 total"))).toBe(true);

    mockFocusWorkspace.mockClear();
    mockLaunch.mockClear();
    mockPromptUser.mockResolvedValueOnce("2");
    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:2");
    expect(mockFocusWorkspace).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});


describe("summon open <project> (guide F1: the documented direct form)", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRow.mockReset();
    mockFocusWorkspace.mockReset();
    mockLaunch.mockReset();
  });

  it("focuses a live workspace without showing the picker", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRow.mockReturnValue({ name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" });
    mockFocusWorkspace.mockReturnValue({ kind: "focused", terminalId: "block:1" });
    await handleOpenCommand(makeContext({ args: ["api"] }));
    expect(mockLoadProjectRow).toHaveBeenCalledWith("api");
    expect(mockFocusWorkspace).toHaveBeenCalledWith("api");
    expect(logSpy).toHaveBeenCalledWith("Switched to [api]");
    expect(mockLoadProjectRows).not.toHaveBeenCalled();
    expect(mockPromptUser).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("launches a stopped workspace with the forwarded overrides", async () => {
    mockLoadProjectRow.mockReturnValue({ name: "api", directory: "/tmp/api", state: "stopped", uptime: "—", gitBranch: "—" });
    await handleOpenCommand(makeContext({ args: ["api"], overrides: { layout: "minimal" } }));
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/api", { layout: "minimal" });
    expect(mockFocusWorkspace).not.toHaveBeenCalled();
  });

  it("refuses an unknown workspace with its reason (exit 2) and never launches over it", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockLoadProjectRow.mockReturnValue({ name: "web", directory: "/tmp/web", state: "unknown", uptime: "—", gitBranch: "—", reason: "server unreachable" });
    await expect(handleOpenCommand(makeContext({ args: ["web"] }))).rejects.toThrow("exit:2");
    expect(err.mock.calls.flat().join("")).toContain("[web] could not be verified: server unreachable");
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockFocusWorkspace).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("rejects an empty name or more than one positional with the usage hint", async () => {
    await expect(handleOpenCommand(makeContext({ args: ["a", "b"] }))).rejects.toThrow("usage:Usage: summon open [project]");
    await expect(handleOpenCommand(makeContext({ args: [""] }))).rejects.toThrow("usage:");
    expect(mockLoadProjectRow).not.toHaveBeenCalled();
  });

  it("names an unregistered project with suggestions (exit 1)", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockLoadProjectRow.mockReturnValue(undefined);
    mockListProjects.mockReturnValue(new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"]]));
    await expect(handleOpenCommand(makeContext({ args: ["chap"] }))).rejects.toThrow("exit:1");
    const text = err.mock.calls.flat().join("");
    expect(text).toContain('"chap" is not a registered project');
    expect(text).toContain("summon list");
    expect(text).toContain("Did you mean: chapa, chapa-cli?");
    expect(mockLaunch).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
