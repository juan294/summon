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

vi.mock("../launcher.js", () => ({
  focusWorkspace: (...args: unknown[]) => mockFocusWorkspace(...args),
  launch: (...args: unknown[]) => mockLaunch(...args),
}));

// PromptCancelled must be exported from the utils mock because project.ts uses instanceof.
class MockPromptCancelled extends Error {
  constructor(msg = "Cancelled") { super(msg); this.name = "PromptCancelled"; }
}

vi.mock("../utils.js", () => ({
  promptUser: (...args: unknown[]) => mockPromptUser(...args),
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
  PromptCancelled: MockPromptCancelled,
}));

vi.mock("../monitor.js", () => ({
  loadProjectRows: (...args: unknown[]) => mockLoadProjectRows(...args),
  renderRow: (...args: unknown[]) => mockRenderRow(...args),
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(false);

    await handleAddCommand(makeContext({ args: ["demo", "~/code/demo"] }));

    expect(mockAddProject).toHaveBeenCalledWith("demo", "/Users/tester/code/demo");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: path does not exist: /Users/tester/code/demo"));
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
  it("uses ⚠ (not !) as warn glyph in warn message to console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(false);

    await handleAddCommand(makeContext({ args: ["demo", "~/code/demo"] }));

    const warnMsg = warnSpy.mock.calls.map(c => c[0] as string).join("\n");
    expect(warnMsg).toContain("⚠");
    expect(warnMsg).not.toMatch(/^!/m);
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockRemoveProject.mockReturnValue(false);

    await expect(handleRemoveCommand(makeContext({ args: ["missing"] }))).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith("Error: Project not found: missing");
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon list' to see registered projects.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("handleListCommand", () => {
  it("prints an empty-state hint", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleListCommand();

    expect(logSpy).toHaveBeenCalledWith("No projects found.");
    expect(logSpy).toHaveBeenCalledWith("Run `summon add <name> <path>` to register your first project.");
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([]);

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith("No projects found.");
    expect(errorSpy).toHaveBeenCalledWith("Run `summon add <name> <path>` to register your first project.");
  });

  it("re-prompts invalid selections and focuses active workspaces", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadProjectRows.mockReturnValue([
      { name: "api", directory: "/tmp/api", state: "active", uptime: "1h", gitBranch: "main" },
      { name: "web", directory: "/tmp/web", state: "stopped", uptime: null, gitBranch: "develop" },
    ]);
    mockPromptUser
      .mockResolvedValueOnce("nope")
      .mockResolvedValueOnce("1");

    await handleOpenCommand(makeContext({ overrides: { dryRun: true } }));

    expect(errorSpy).toHaveBeenCalledWith("Invalid selection. Enter a number between 1 and 2.");
    expect(mockFocusWorkspace).toHaveBeenCalledWith("api");
    expect(logSpy).toHaveBeenCalledWith("Switched to [api]");
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
  it("handleRemoveCommand uses console.error (not process.stdout.write) for missing project", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockRemoveProject.mockReturnValue(false);

    await expect(handleRemoveCommand(makeContext({ args: ["ghost"] }))).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Project not found"));
    // Error must NOT go to stdout
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("Project not found");

    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("handleOpenCommand uses console.error (not process.stdout.write) for no projects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockLoadProjectRows.mockReturnValue([]);

    await expect(handleOpenCommand(makeContext())).rejects.toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No projects found"));
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("No projects found");

    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("resolveTargetDirectory uses console.error (not process.stdout.write) for unknown project", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockGetProject.mockReturnValue(undefined);

    expect(() => resolveTargetDirectory("unknown-project")).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not a known command or registered project"));
    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdoutCalls).not.toContain("not a known command or registered project");

    errorSpy.mockRestore();
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
    mockGetProject.mockReturnValue("/work/demo");

    expect(resolveTargetDirectory("demo")).toBe("/work/demo");
  });

  it("exits on unknown project names", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockGetProject.mockReturnValue(undefined);

    expect(() => resolveTargetDirectory("missing")).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(`Error: "missing" is not a known command or registered project. Try: summon --help`);
    expect(errorSpy).toHaveBeenCalledWith("To register as a project: summon add missing /path/to/project");
    expect(errorSpy).toHaveBeenCalledWith("Or see available:         summon list");
  });
});
