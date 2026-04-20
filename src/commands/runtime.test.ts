import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
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

vi.mock("../monitor.js", () => ({
  runMonitor: (...args: unknown[]) => mockRunMonitor(...args),
  printStatusOnce: (...args: unknown[]) => mockPrintStatusOnce(...args),
}));

vi.mock("../snapshot.js", () => ({
  saveSnapshot: (...args: unknown[]) => mockSaveSnapshot(...args),
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
      args: ["save", "--dir", "/tmp/demo", "--project", "api", "--layout", "pair"],
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", "/tmp/demo", "pair");
    expect(logSpy).toHaveBeenCalledWith("Snapshot saved for api");
  });

  it("derives the project name from the directory basename", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveSnapshot.mockReturnValue(null);

    await handleSnapshotCommand(makeContext({
      args: ["save", "--dir", "/tmp/apps/web"],
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("web", "/tmp/apps/web", "unknown");
    expect(logSpy).toHaveBeenCalledWith("No git repo found in /tmp/apps/web");
  });

  it("uses the first positional argument as the project name when present", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveSnapshot.mockReturnValue({ project: "api" });

    await handleSnapshotCommand(makeContext({
      args: ["save", "api", "--layout", "pair"],
    }));

    expect(mockSaveSnapshot).toHaveBeenCalledWith("api", process.cwd(), "pair");
    expect(logSpy).toHaveBeenCalledWith("Snapshot saved for api");
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

    expect(logSpy).toHaveBeenCalledWith("No port assignments detected across registered projects.");
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
});
