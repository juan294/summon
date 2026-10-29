import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});
const mockValidateProjectNameOrExit = vi.fn((name: string, _label?: string) => {
  // Simulate the real behavior: reject traversal/invalid names
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(name)) {
    throw new Error(`usage:Error: project name must start with a letter, digit, or underscore. Got: "${name}".`);
  }
});
const mockRunMonitor = vi.fn();
const mockPrintStatusOnce = vi.fn();
const mockSaveSnapshot = vi.fn();
const mockReadSnapshot = vi.fn();
const mockClearSnapshot = vi.fn();
const mockFormatRestorationBanner = vi.fn();
const mockRunBriefing = vi.fn();
const mockDetectAllPorts = vi.fn();
const mockGreen = vi.fn((value: string) => `[green:${value}]`);
const mockDim = vi.fn((value: string) => `[dim:${value}]`);
const mockYellow = vi.fn((value: string) => `[yellow:${value}]`);

vi.mock("../utils.js", () => ({
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
}));

vi.mock("../validation.js", () => ({
  validateProjectNameOrExit: (name: string, label?: string) => mockValidateProjectNameOrExit(name, label),
}));

vi.mock("../monitor.js", () => ({
  runMonitor: (...args: unknown[]) => mockRunMonitor(...args),
  printStatusOnce: (...args: unknown[]) => mockPrintStatusOnce(...args),
}));

const mockCollectSnapshot = vi.fn();
const mockWriteSnapshotFile = vi.fn();
const mockWithOwnedRecord = vi.fn();

vi.mock("../status.js", () => ({
  isLiveState: (state: string) => state === "active" || state === "partial",
  withOwnedRecord: (...args: unknown[]) => mockWithOwnedRecord(...args),
}));

vi.mock("../snapshot.js", () => ({
  saveSnapshot: (...args: unknown[]) => mockSaveSnapshot(...args),
  collectSnapshot: (...args: unknown[]) => mockCollectSnapshot(...args),
  writeSnapshotFile: (...args: unknown[]) => mockWriteSnapshotFile(...args),
  readSnapshot: (...args: unknown[]) => mockReadSnapshot(...args),
  clearSnapshot: (...args: unknown[]) => mockClearSnapshot(...args),
  formatRestorationBanner: (...args: unknown[]) => mockFormatRestorationBanner(...args),
}));

vi.mock("../briefing.js", () => ({
  runBriefing: (...args: unknown[]) => mockRunBriefing(...args),
}));

vi.mock("../ports.js", () => ({
  detectAllPorts: (...args: unknown[]) => mockDetectAllPorts(...args),
}));

vi.mock("../ui/ansi.js", () => ({
  green: (value: string) => mockGreen(value),
  dim: (value: string) => mockDim(value),
  yellow: (value: string) => mockYellow(value),
  truncateLine: (value: string, _width: number) => value,
}));

vi.mock("../ui/symbols.js", () => ({
  sym: { ok: "✓", dotFilled: "●", dotEmpty: "○" },
}));

const {
  handleBriefingCommand,
  handlePortsCommand,
  handleSnapshotCommand,
  handleStatusCommand,
} = await import("./runtime.js");

function makeContext(overrides: Partial<Parameters<typeof handleStatusCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "status",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleStatusCommand", () => {
  it("prints once when explicitly requested", async () => {
    await handleStatusCommand(makeContext({ values: { once: true } }));

    expect(mockPrintStatusOnce).toHaveBeenCalledOnce();
    expect(mockRunMonitor).not.toHaveBeenCalled();
  });

  it("prints once when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    await handleStatusCommand(makeContext());

    expect(mockPrintStatusOnce).toHaveBeenCalledOnce();
    expect(mockRunMonitor).not.toHaveBeenCalled();
  });

  it("runs the monitor for interactive sessions", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    await handleStatusCommand(makeContext());

    expect(mockRunMonitor).toHaveBeenCalledOnce();
  });
});

describe("handleSnapshotCommand", () => {
  it("saves snapshots using explicit flags", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveSnapshot.mockReturnValue({ project: "demo" });

    await handleSnapshotCommand(makeContext({
      args: ["save"],
      values: { dir: "/tmp/demo", project: "api", layout: "pair" },
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", "/tmp/demo", "pair");
    expect(logSpy).toHaveBeenCalledWith("Snapshot saved for api");
  });

  it("derives the project name from the directory basename", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveSnapshot.mockReturnValue(null);

    await handleSnapshotCommand(makeContext({
      args: ["save"],
      values: { dir: "/tmp/apps/web" },
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("web", "/tmp/apps/web", "unknown");
    expect(logSpy).toHaveBeenCalledWith("No git repo found in /tmp/apps/web");
  });

  it("uses the first positional argument as the project name when present", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveSnapshot.mockReturnValue({ project: "api" });

    await handleSnapshotCommand(makeContext({
      args: ["save", "api"],
      values: { layout: "pair" },
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", process.cwd(), "pair");
    expect(logSpy).toHaveBeenCalledWith("Snapshot saved for api");
  });

  it("ignores extra positional snapshot save arguments after the project is set", async () => {
    mockSaveSnapshot.mockReturnValue({ project: "api" });

    await handleSnapshotCommand(makeContext({
      args: ["save", "api", "ignored"],
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", process.cwd(), "unknown");
  });

  it("falls back to unknown when deriving a project name from the filesystem root", async () => {
    mockSaveSnapshot.mockReturnValue({ project: "unknown" });

    await handleSnapshotCommand(makeContext({
      args: ["save"],
      values: { dir: "/" },
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("unknown", "/", "unknown");
  });

  it("shows formatted snapshots", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadSnapshot.mockReturnValue({ project: "api" });
    mockFormatRestorationBanner.mockReturnValue("banner");

    await handleSnapshotCommand(makeContext({ args: ["show", "api"] }));

    expect(mockReadSnapshot).toHaveBeenCalledWith("api");
    expect(mockFormatRestorationBanner).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("banner");
  });

  it("prints a missing snapshot message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadSnapshot.mockReturnValue(null);

    await handleSnapshotCommand(makeContext({ args: ["show", "api"] }));

    expect(logSpy).toHaveBeenCalledWith("No snapshot found for api");
  });

  it("requires a project for snapshot show", async () => {
    await expect(handleSnapshotCommand(makeContext({ args: ["show"] }))).rejects.toThrow(
      "usage:Usage: summon snapshot show <project>",
    );
  });

  it("clears an existing snapshot", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockClearSnapshot.mockReturnValue(true);

    await handleSnapshotCommand(makeContext({ args: ["clear", "api"] }));

    expect(logSpy).toHaveBeenCalledWith("Snapshot cleared for api");
  });

  it("prints a missing message when clearing an unknown snapshot", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockClearSnapshot.mockReturnValue(false);

    await handleSnapshotCommand(makeContext({ args: ["clear", "api"] }));

    expect(logSpy).toHaveBeenCalledWith("No snapshot found for api");
  });

  it("requires a project for snapshot clear", async () => {
    await expect(handleSnapshotCommand(makeContext({ args: ["clear"] }))).rejects.toThrow(
      "usage:Usage: summon snapshot clear <project>",
    );
  });

  it("rejects unknown actions", async () => {
    await expect(handleSnapshotCommand(makeContext({ args: ["wat"] }))).rejects.toThrow(
      "usage:Usage: summon snapshot <save|show|clear> [project]",
    );
  });

  it("includes subcommand examples in the usage message for unknown actions", async () => {
    let usageMessage = "";
    mockExitWithUsageHint.mockImplementation((msg?: string) => {
      usageMessage = msg ?? "";
      throw new Error(`usage:${usageMessage}`);
    });

    await expect(handleSnapshotCommand(makeContext({ args: ["wat"] }))).rejects.toThrow(/usage:/);
    expect(usageMessage).toMatch(/save \[name\]/);
    expect(usageMessage).toMatch(/show \[name\]/);
    expect(usageMessage).toMatch(/clear \[name\]/);
  });

  it("rejects path-traversal project name in snapshot show (#531 BE-M1)", async () => {
    await expect(
      handleSnapshotCommand(makeContext({ args: ["show", "../../etc/passwd"] })),
    ).rejects.toThrow(/usage:/);
    expect(mockReadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects path-traversal project name in snapshot clear (#531 BE-M1)", async () => {
    await expect(
      handleSnapshotCommand(makeContext({ args: ["clear", "../evil"] })),
    ).rejects.toThrow(/usage:/);
    expect(mockClearSnapshot).not.toHaveBeenCalled();
  });

  it("rejects path-traversal project name in snapshot save (#531 BE-M1)", async () => {
    await expect(
      handleSnapshotCommand(makeContext({ args: ["save", "../etc/passwd"] })),
    ).rejects.toThrow(/usage:/);
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
  });
});

describe("handleBriefingCommand", () => {
  it("runs the briefing generator", async () => {
    await handleBriefingCommand();

    expect(mockRunBriefing).toHaveBeenCalledOnce();
  });
});

describe("handlePortsCommand", () => {
  it("prints an empty-state message when no ports are detected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map() });

    await handlePortsCommand();

    expect(logSpy).toHaveBeenCalledWith("No port assignments detected.");
    expect(logSpy).toHaveBeenCalledWith("Run `summon add <name> <path>` to register a project.");
  });

  it("prints a colorized status table and conflict warnings", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [
        { port: 3000, project: "api", source: ".summon", state: "active" },
        { port: 3000, project: "web", source: "package.json", state: "stopped" },
      ],
      conflicts: new Map([[3000, ["api", "web"]]]),
    });

    await handlePortsCommand();

    expect(logSpy).toHaveBeenCalledWith("  PORT   PROJECT          SOURCE             STATE");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[green:●]"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[dim:stopped]"));
    expect(logSpy).toHaveBeenCalledWith("[yellow:  ⚠ Port 3000 used by: api, web]");
  });

  it("skips warnings when there are no conflicts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [
        { port: 4000, project: "api", source: ".summon", state: "active" },
      ],
      conflicts: new Map(),
    });

    await handlePortsCommand();

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Port 4000 used by"));
  });

  it("prints a positive no-conflict confirmation when there are assignments but no conflicts (#442)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [
        { port: 4000, project: "api", source: ".summon", state: "active" },
        { port: 5000, project: "web", source: "package.json", state: "stopped" },
      ],
      conflicts: new Map(),
    });

    await handlePortsCommand();

    expect(logSpy).toHaveBeenCalledWith("[green:✓] No port conflicts");
  });
});

describe("handleSnapshotCommand save --launch <id> (plan P12)", () => {
  const LAUNCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("collects before the lock, writes inside withOwnedRecord when the generation holds, and leaves the record unchanged", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const snapshot = { project: "api" };
    mockCollectSnapshot.mockReturnValue(snapshot);
    mockWithOwnedRecord.mockImplementation((_project: string, _expectation: unknown, action: (current: null) => unknown) => {
      expect(mockCollectSnapshot).toHaveBeenCalledTimes(1);
      expect(mockWriteSnapshotFile).not.toHaveBeenCalled();
      expect(action(null)).toBeNull();
      expect(mockWriteSnapshotFile).toHaveBeenCalledWith(snapshot);
      return { outcome: "unchanged", afterErrors: [] };
    });

    await handleSnapshotCommand(makeContext({
      args: ["save"],
      values: { dir: "/tmp/demo", project: "api", layout: "pair", launch: LAUNCH },
    }));

    expect(mockWithOwnedRecord).toHaveBeenCalledWith("api", { launchId: LAUNCH }, expect.any(Function));
    expect(mockCollectSnapshot).toHaveBeenCalledWith("api", "/tmp/demo", "pair");
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Snapshot saved for api");
    logSpy.mockRestore();
  });

  it("exits 0 silently and writes nothing when the generation is superseded", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockCollectSnapshot.mockReturnValue({ project: "api" });
    mockWithOwnedRecord.mockReturnValue({ outcome: "superseded", afterErrors: [] });

    await handleSnapshotCommand(makeContext({ args: ["save", "api"], values: { launch: LAUNCH } }));

    expect(mockWriteSnapshotFile).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("reports a missing git repo without writing when collectSnapshot returns null", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockCollectSnapshot.mockReturnValue(null);
    mockWithOwnedRecord.mockImplementation((_project: string, _expectation: unknown, action: (current: null) => unknown) => {
      action(null);
      return { outcome: "unchanged", afterErrors: [] };
    });

    await handleSnapshotCommand(makeContext({ args: ["save", "api"], values: { dir: "/tmp/demo", launch: LAUNCH } }));

    expect(mockWriteSnapshotFile).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("No git repo found in /tmp/demo");
    logSpy.mockRestore();
  });

  it("rejects a --launch value that is not a launch id", async () => {
    await expect(handleSnapshotCommand(makeContext({ args: ["save", "api"], values: { launch: "nope" } })))
      .rejects.toThrow("usage:Usage: summon snapshot save --launch <launch-id>");
    expect(mockWithOwnedRecord).not.toHaveBeenCalled();
  });

  it("falls back to the plain save when --launch is absent", async () => {
    mockSaveSnapshot.mockReturnValue({ project: "api" });
    await handleSnapshotCommand(makeContext({ args: ["save", "api"] }));
    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", process.cwd(), "unknown");
    expect(mockWithOwnedRecord).not.toHaveBeenCalled();
  });
});
