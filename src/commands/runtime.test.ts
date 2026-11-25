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

vi.mock("../status-record.js", () => ({
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

// Pure formatting helpers stay real; the report gets the live fields a static-only read returns.
vi.mock("../ports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ports.js")>()),
  detectAllPorts: async (...args: unknown[]) => ({ live: [], held: [], notes: [], liveWorkspaces: 0, readWorkspaces: 0, ...(await mockDetectAllPorts(...args)) }),
}));

vi.mock("../ui/ansi.js", () => ({
  green: (value: string) => mockGreen(value),
  dim: (value: string) => mockDim(value),
  yellow: (value: string) => mockYellow(value),
  // Marks what was passed through truncation, so a test can tell a cut line from a whole one.
  truncateLine: (value: string, _width: number) => (truncateMarks.on ? `[cut:${value}]` : value),
}));
const truncateMarks = vi.hoisted(() => ({ on: false }));

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
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 0 });

    await handlePortsCommand();

    expect(logSpy).toHaveBeenCalledWith("No port assignments detected.");
    expect(logSpy).toHaveBeenCalledWith("Run `summon add <name> <path>` to register a project.");
  });

  it("explains where ports come from when projects are registered but none declares a port (F15)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 2 });

    await handlePortsCommand();

    expect(logSpy).toHaveBeenCalledWith("No port assignments detected in 2 registered projects.");
    expect(logSpy).toHaveBeenCalledWith("Ports are read from PORT-style variables in a trusted .summon, --port/-p flags of dev-server scripts in package.json, and framework config files.");
    expect(logSpy).not.toHaveBeenCalledWith("Run `summon add <name> <path>` to register a project.");
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

describe("handlePortsCommand with live ports (plan 2026-11-19-rex-live-ports)", () => {
  const live = (port: number, project: string, pane: string, process: string | null = "node") => ({ port, address: "127.0.0.1", project, pane, recorded: true, process, pid: 7, state: "active", ephemeral: port >= 49152 });

  function lines(spy: ReturnType<typeof vi.spyOn>): string[] {
    return spy.mock.calls.map((call: unknown[]) => String(call[0]));
  }

  it("adds a DETAIL column: listening for a claim its own workspace holds, held by for one another workspace holds", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [
        { port: 3000, project: "web", source: "package.json", state: "stopped" },
        { port: 4000, project: "api", source: "config", state: "active" },
      ],
      conflicts: new Map(),
      projectCount: 2,
      live: [live(3000, "api", "server"), live(4000, "api", "worker")],
      held: [{ port: 3000, holder: "api", pane: "server", process: "node", claimants: [{ project: "web", source: "package.json" }] }],
      liveWorkspaces: 1, readWorkspaces: 1,
    });
    await handlePortsCommand();
    const out = lines(logSpy);
    expect(out).toContain("  PORT   PROJECT          SOURCE             STATE      DETAIL");
    expect(out.find((l) => l.includes("web") && l.includes("3000"))).toContain("held by api/server (node)");
    expect(out.find((l) => l.includes("web") && l.includes("3000"))).toContain("conflict");
    expect(out.find((l) => l.includes("api") && l.includes("live") && l.includes("3000"))).toContain("server (node)");
    expect(out.find((l) => l.includes("4000"))).toContain("listening: worker (node)");
    expect(out.filter((l) => l.includes("4000"))).toHaveLength(1);
    expect(out).toContain("[yellow:  ⚠ Port 3000 is held by api/server (node); web (package.json) claims it]");
    expect(out).not.toContain("[green:✓] No port conflicts");
  });

  it("never cuts a held-conflict line to the terminal width (the claimant is the part to act on)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    truncateMarks.on = true;
    try {
      mockDetectAllPorts.mockReturnValue({
        assignments: [{ port: 3000, project: "web", source: "package.json", state: "stopped" }], conflicts: new Map(), projectCount: 1,
        live: [live(3000, "api", "server")],
        held: [{ port: 3000, holder: "api", pane: "server", process: "node", claimants: [{ project: "web", source: "package.json" }] }],
        liveWorkspaces: 1, readWorkspaces: 1,
      });
      await handlePortsCommand();
    } finally {
      truncateMarks.on = false;
    }
    expect(lines(logSpy)).toContain("[yellow:  ⚠ Port 3000 is held by api/server (node); web (package.json) claims it]");
  });

  it("hides an unclaimed ephemeral live port and says how many it hid; a claimed one is shown", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [{ port: 50000, project: "api", source: "config", state: "active" }],
      conflicts: new Map(),
      projectCount: 1,
      live: [live(50000, "api", "server"), live(52206, "api", "agent", "claude"), live(52300, "api", "agent2", "codex")],
      liveWorkspaces: 1, readWorkspaces: 1,
    });
    await handlePortsCommand();
    const out = lines(logSpy);
    expect(out.join("\n")).not.toContain("52206");
    expect(out.find((l) => l.includes("50000"))).toContain("listening: server (node)");
    expect(out).toContain("[dim:2 ephemeral live ports hidden; summon inspect api lists them.]");
    expect(out).toContain("[green:✓] No port conflicts");
  });

  it("names the projects of hidden ports when there are several and points at --json", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 2, live: [live(52206, "api", "agent"), live(52207, "web", "agent")], liveWorkspaces: 2, readWorkspaces: 2 });
    await handlePortsCommand();
    const out = lines(logSpy);
    expect(out).toContain("No port assignments detected in 2 registered projects.");
    expect(out).toContain("[dim:2 ephemeral live ports hidden (api, web); summon ports --json lists them.]");
  });

  it("a hidden port in a pane split by hand points at --json (inspect lists recorded panes only); two addresses count once", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const split = { ...live(52206, "api", "zsh"), recorded: false };
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 1, live: [split, { ...split, address: "::1" }], liveWorkspaces: 1, readWorkspaces: 1 });
    await handlePortsCommand();
    expect(lines(logSpy)).toContain("[dim:1 ephemeral live port hidden (api); summon ports --json lists them.]");
  });

  it("counts the workspaces instead of naming them past three", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const projects = ["a", "b", "c", "d"];
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 4, live: projects.map((p, i) => live(52000 + i, p, "agent")), liveWorkspaces: 4, readWorkspaces: 4 });
    await handlePortsCommand();
    expect(lines(logSpy)).toContain("[dim:4 ephemeral live ports hidden in 4 workspaces; summon ports --json lists them.]");
  });

  it("prints a table of live rows alone when nothing is claimed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 1, live: [live(5173, "web", "vite")], liveWorkspaces: 1, readWorkspaces: 1 });
    await handlePortsCommand();
    const out = lines(logSpy);
    expect(out.find((l) => l.includes("5173"))).toContain("vite (node)");
    expect(out).toContain("[green:✓] No port conflicts");
  });

  it("escapes control characters from a process label and prints the live notes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [], conflicts: new Map(), projectCount: 1,
      live: [live(3000, "api", "server", "evil\u001b[2J")],
      notes: [{ project: "web", status: "unavailable", reason: "timed out" }],
      liveWorkspaces: 2, readWorkspaces: 1,
    });
    await handlePortsCommand();
    const out = lines(logSpy).join("\n");
    expect(out).toContain("evil\\u001b[2J");
    expect(out).not.toContain("\u001b");
    expect(out).toContain("[dim:note: live ports incomplete for web (timed out)]");
    expect(out).not.toContain("[green:✓] No port conflicts");
    expect(out).toContain("No port conflicts in the claims and live ports that were read");
  });

  it("--json prints claims, every live port with its ephemeral flag, both conflict kinds and the notes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({
      assignments: [{ port: 3000, project: "web", source: "package.json", state: "stopped" }, { port: 3000, project: "docs", source: "framework-default", state: "stopped" }],
      conflicts: new Map([[3000, ["web", "docs"]]]),
      projectCount: 2,
      live: [live(3000, "api", "server"), live(52206, "api", "agent", "claude")],
      held: [{ port: 3000, holder: "api", pane: "server", process: "node", claimants: [{ project: "web", source: "package.json" }, { project: "docs", source: "framework-default" }] }],
      notes: [{ project: "jobs", status: "partial", reason: "x" }],
      liveWorkspaces: 2, readWorkspaces: 2,
    });
    await handlePortsCommand({ values: { json: true } });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0]![0]))).toEqual({
      claims: [{ port: 3000, project: "web", source: "package.json", state: "stopped" }, { port: 3000, project: "docs", source: "framework-default", state: "stopped" }],
      live: [
        { port: 3000, address: "127.0.0.1", project: "api", pane: "server", recorded: true, process: "node", pid: 7, state: "active", ephemeral: false },
        { port: 52206, address: "127.0.0.1", project: "api", pane: "agent", recorded: true, process: "claude", pid: 7, state: "active", ephemeral: true },
      ],
      conflicts: [
        { port: 3000, kind: "claimed", projects: ["web", "docs"] },
        { port: 3000, kind: "held", holder: "api", pane: "server", process: "node", claimants: [{ project: "web", source: "package.json" }, { project: "docs", source: "framework-default" }] },
      ],
      notes: [{ project: "jobs", status: "partial", reason: "x" }],
    });
  });

  it("--json with nothing to report prints empty arrays", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDetectAllPorts.mockReturnValue({ assignments: [], conflicts: new Map(), projectCount: 0 });
    await handlePortsCommand({ values: { json: true } });
    expect(JSON.parse(String(logSpy.mock.calls[0]![0]))).toEqual({ claims: [], live: [], conflicts: [], notes: [] });
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
