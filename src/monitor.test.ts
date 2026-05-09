import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return { ...original, listProjects: vi.fn().mockReturnValue([]) };
});
vi.mock("./status.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./status.js")>();
  return {
    ...original,
    readAllStatuses: vi.fn().mockReturnValue([]),
    getGitBranch: vi.fn().mockReturnValue(null),
  };
});
const mockLaunch = vi.fn();
vi.mock("./launcher.js", () => ({
  launch: (...args: unknown[]) => mockLaunch(...args),
}));

const {
  formatUptime, stateColor, stateDot, renderRow, renderHeader, renderFooter,
  renderScreen, loadProjectRows, printStatusOnce, runMonitor, resetGitBranchCache,
} = await import("./monitor.js");
import type { ProjectRow } from "./monitor.js";

const { listProjects } = await import("./config.js") as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
};
const { readAllStatuses, getGitBranch } = await import("./status.js") as unknown as {
  readAllStatuses: ReturnType<typeof vi.fn>;
  getGitBranch: ReturnType<typeof vi.fn>;
};

function makeRow(overrides?: Partial<ProjectRow>): ProjectRow {
  return {
    name: "myapp",
    directory: "/tmp/myapp",
    state: "active",
    uptime: "2h 15m",
    gitBranch: "feat/auth",
    ...overrides,
  };
}

function makeResolvedStatus(overrides?: Record<string, unknown>) {
  return {
    project: "myapp",
    directory: "/tmp/myapp",
    pid: 1234,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    layout: "full",
    panes: ["editor"],
    source: "summon",
    version: 1,
    state: "active",
    uptime: 3_600_000,
    ...overrides,
  };
}

describe("formatUptime", () => {
  it("30000 → '<1m'", () => {
    expect(formatUptime(30_000)).toBe("<1m");
  });

  it("300000 → '5m'", () => {
    expect(formatUptime(300_000)).toBe("5m");
  });

  it("7500000 → '2h 5m'", () => {
    expect(formatUptime(7_500_000)).toBe("2h 5m");
  });

  it("90000000 → '1d 1h'", () => {
    expect(formatUptime(90_000_000)).toBe("1d 1h");
  });

  it("3600000 → '1h'", () => {
    expect(formatUptime(3_600_000)).toBe("1h");
  });

  it("86400000 → '1d'", () => {
    expect(formatUptime(86_400_000)).toBe("1d");
  });
});

describe("stateColor", () => {
  it("active → returns green function", () => {
    const fn = stateColor("active");
    expect(fn("test")).toContain("test");
    expect(fn).toBe(stateColor("active")); // same function for same state
  });

  it("active-long → returns yellow function", () => {
    const fn = stateColor("active-long");
    expect(fn("test")).toContain("test");
  });

  it("stopped → returns dim function", () => {
    const fn = stateColor("stopped");
    expect(fn("test")).toContain("test");
    expect(fn).toBe(stateColor("unknown")); // same function for stopped/unknown
  });

  it("returns different functions for active vs stopped", () => {
    expect(stateColor("active")).not.toBe(stateColor("stopped"));
  });
});

describe("stateDot", () => {
  it("active → '●'", () => {
    expect(stateDot("active")).toBe("●");
  });

  it("active-long → '●'", () => {
    expect(stateDot("active-long")).toBe("●");
  });

  it("stopped → '○'", () => {
    expect(stateDot("stopped")).toBe("○");
  });

  it("unknown → '○'", () => {
    expect(stateDot("unknown")).toBe("○");
  });
});

describe("renderRow", () => {
  it("renders active project with filled dot", () => {
    const row = makeRow({ state: "active" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("●");
    expect(result).toContain("myapp");
    expect(result).toContain("active");
  });

  it("renders stopped project with empty dot", () => {
    const row = makeRow({ state: "stopped" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("○");
    expect(result).toContain("stopped");
  });

  it("selected row has inverted colors", () => {
    const row = makeRow();
    const result = renderRow(row, 80, true);
    expect(result).toContain("\x1b[7m"); // invert
  });

  it("non-selected row does not have inverted colors", () => {
    const row = makeRow();
    const result = renderRow(row, 80, false);
    expect(result).not.toContain("\x1b[7m");
  });

  it("truncates long branch names to fit width", () => {
    const row = makeRow({ gitBranch: "feature/very-long-branch-name-that-exceeds-width" });
    const result = renderRow(row, 60, false);
    expect(result).toContain("\u2026"); // ellipsis
  });

  it("truncates long project names to 16 chars", () => {
    const row = makeRow({ name: "super-long-project-name-here" });
    const result = renderRow(row, 80, false);
    // Name should be truncated with ellipsis
    expect(result).toContain("\u2026");
    expect(result).not.toContain("super-long-project-name-here");
  });

  it("renders active-long state as 'active' text", () => {
    const row = makeRow({ state: "active-long" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("active");
    expect(result).toContain("●");
  });
});

describe("renderHeader", () => {
  it("shows active/total count", () => {
    const result = renderHeader(3, 7, 80);
    expect(result).toContain("3 / 7");
  });

  it("contains 'summon status'", () => {
    const result = renderHeader(0, 0, 80);
    expect(result).toContain("summon status");
  });

  it("pads to terminal width", () => {
    const result = renderHeader(1, 5, 80);
    // Should contain spaces between left and right sections
    expect(result).toContain("  ");
  });
});

describe("renderFooter", () => {
  it("shows keyboard shortcuts", () => {
    const result = renderFooter(80);
    expect(result).toContain("navigate");
    expect(result).toContain("open");
    expect(result).toContain("refresh");
    expect(result).toContain("quit");
  });

  it("shows j/k as navigation aliases", () => {
    const result = renderFooter(80);
    expect(result).toContain("j");
    expect(result).toContain("k");
  });

  it("shows ? for help", () => {
    const result = renderFooter(80);
    expect(result).toContain("?");
  });
});

describe("renderScreen", () => {
  it("composes header + rows + footer", () => {
    const rows = [makeRow(), makeRow({ name: "api", state: "stopped" })];
    const screen = renderScreen(rows, 0, 80, 24);
    expect(screen).toContain("summon status");
    expect(screen).toContain("myapp");
    expect(screen).toContain("api");
    expect(screen).toContain("navigate");
    // Contains separator lines
    expect(screen).toContain("\u2500"); // ─
  });

  it("handles empty project list", () => {
    const screen = renderScreen([], 0, 80, 24);
    expect(screen).toContain("summon status");
    expect(screen).toContain("0 / 0");
    expect(screen).toContain("navigate");
  });

  it("shows empty state message when there are no projects", () => {
    const screen = renderScreen([], 0, 80, 24);
    expect(screen).toContain("No projects registered");
    expect(screen).toContain("summon add");
  });

  it("handles more rows than screen height (scrolling)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome lines + 6 visible rows
    const screen = renderScreen(rows, 0, 80, 10);
    const lines = screen.split("\n");
    // header + separator + 6 rows + separator + footer = 10
    expect(lines).toHaveLength(10);
  });

  it("selected row within visible window", () => {
    const rows = [
      makeRow({ name: "first" }),
      makeRow({ name: "second" }),
      makeRow({ name: "third" }),
    ];
    const screen = renderScreen(rows, 1, 80, 24);
    // Second row should be inverted (selected)
    expect(screen).toContain("\x1b[7m");
    expect(screen).toContain("second");
  });

  it("scrolls to show selected row at end of list (scrollStart passed explicitly)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome + 6 visible rows, selected at index 25
    // scrollStart=20 means rows 20-25 are visible
    const screen = renderScreen(rows, 25, 80, 10, 20);
    expect(screen).toContain("project-25");
    expect(screen).not.toContain("project-0");
    expect(screen).toContain("\x1b[7m"); // selected row inverted
  });

  it("scrolls to show selected row in middle of list (scrollStart passed explicitly)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome + 6 visible rows; scrollStart=12 puts project-15 in view
    const screen = renderScreen(rows, 15, 80, 10, 12);
    expect(screen).toContain("project-15");
    expect(screen).toContain("\x1b[7m");
  });

  it("handles a selected index before the visible window", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );

    const screen = renderScreen(rows, -1, 80, 10);

    expect(screen).toContain("summon status");
  });
});

// --- Data-loading function tests (use mocked config.js / status.js) ---

describe("loadProjectRows", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
  });

  it("returns empty array when no projects exist", () => {
    const rows = loadProjectRows();
    expect(rows).toEqual([]);
  });

  it("builds rows from registered projects with matching statuses", () => {
    listProjects.mockReturnValue([
      ["myapp", "/tmp/myapp"],
      ["api", "/tmp/api"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", directory: "/tmp/myapp" }),
    ]);
    getGitBranch.mockReturnValue("main");

    const rows = loadProjectRows();
    expect(rows).toHaveLength(2);
    // Active project first (sorted by state)
    expect(rows[0]!.name).toBe("myapp");
    expect(rows[0]!.state).toBe("active");
    expect(rows[0]!.gitBranch).toBe("main");
    // Unknown project second (no status found)
    expect(rows[1]!.name).toBe("api");
    expect(rows[1]!.state).toBe("unknown");
  });

  it("classifies long-running active workspace as 'active-long'", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({
        project: "myapp",
        state: "active",
        uptime: 5 * 60 * 60 * 1000, // 5 hours > 4h threshold
      }),
    ]);
    getGitBranch.mockReturnValue("develop");

    const rows = loadProjectRows();
    expect(rows[0]!.state).toBe("active-long");
    expect(rows[0]!.uptime).toContain("h");
  });

  it("classifies stopped workspace", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);

    const rows = loadProjectRows();
    expect(rows[0]!.state).toBe("stopped");
    expect(rows[0]!.uptime).toBe("\u2014"); // em dash
    expect(rows[0]!.gitBranch).toBe("\u2014");
  });

  it("includes unregistered statuses (orphan workspaces)", () => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "orphan", directory: "/tmp/orphan" }),
    ]);
    getGitBranch.mockReturnValue("feat/test");

    const rows = loadProjectRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("orphan");
    expect(rows[0]!.state).toBe("active");
  });

  it("sorts by state: active first, then active-long, stopped, unknown", () => {
    listProjects.mockReturnValue([
      ["alpha", "/tmp/alpha"],
      ["beta", "/tmp/beta"],
      ["gamma", "/tmp/gamma"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", state: "stopped", uptime: null }),
      makeResolvedStatus({ project: "gamma", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const rows = loadProjectRows();
    expect(rows[0]!.name).toBe("gamma"); // active
    expect(rows[1]!.name).toBe("alpha"); // stopped
    expect(rows[2]!.name).toBe("beta"); // unknown
  });

  it("uses formatUptime for active workspace uptime", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 7_500_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const rows = loadProjectRows();
    expect(rows[0]!.uptime).toBe("2h 5m");
  });

  it("shows dash for null uptime", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: null }),
    ]);
    getGitBranch.mockReturnValue(null);

    const rows = loadProjectRows();
    expect(rows[0]!.uptime).toBe("\u2014");
  });
});

describe("git branch cache", () => {
  beforeEach(() => {
    resetGitBranchCache();
    listProjects.mockReset();
    readAllStatuses.mockReset();
    getGitBranch.mockReset();
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");
  });

  afterEach(() => {
    resetGitBranchCache();
  });

  it("caches git branch results across consecutive loadProjectRows calls", () => {
    loadProjectRows();
    loadProjectRows();

    // getGitBranch should only be called once (second call uses cache)
    expect(getGitBranch).toHaveBeenCalledTimes(1);
  });

  it("returns cached branch value on second call", () => {
    const rows1 = loadProjectRows();
    getGitBranch.mockReturnValue("different-branch");
    const rows2 = loadProjectRows();

    expect(rows1[0]!.gitBranch).toBe("main");
    expect(rows2[0]!.gitBranch).toBe("main"); // cached value, not "different-branch"
  });

  it("refreshes cache after TTL expires", () => {
    vi.useFakeTimers();
    try {
      loadProjectRows();
      expect(getGitBranch).toHaveBeenCalledTimes(1);

      // Advance past the 10-second TTL
      vi.advanceTimersByTime(11_000);

      loadProjectRows();
      expect(getGitBranch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches per-directory independently", () => {
    listProjects.mockReturnValue([
      ["myapp", "/tmp/myapp"],
      ["api", "/tmp/api"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", directory: "/tmp/myapp", state: "active", uptime: 1000 }),
      makeResolvedStatus({ project: "api", directory: "/tmp/api", state: "active", uptime: 2000 }),
    ]);
    getGitBranch
      .mockReturnValueOnce("main")
      .mockReturnValueOnce("develop");

    loadProjectRows();
    // Both directories should trigger a getGitBranch call
    expect(getGitBranch).toHaveBeenCalledTimes(2);
    expect(getGitBranch).toHaveBeenCalledWith("/tmp/myapp");
    expect(getGitBranch).toHaveBeenCalledWith("/tmp/api");

    // Second call should use cache for both
    getGitBranch.mockClear();
    loadProjectRows();
    expect(getGitBranch).toHaveBeenCalledTimes(0);
  });

  it("does not cache null results", () => {
    getGitBranch.mockReturnValue(null);
    loadProjectRows();

    getGitBranch.mockReturnValue("main");
    const rows = loadProjectRows();

    // Should have been called twice since null is not cached
    expect(getGitBranch).toHaveBeenCalledTimes(2);
    expect(rows[0]!.gitBranch).toBe("main");
  });

  it("resetGitBranchCache clears all cached entries", () => {
    loadProjectRows();
    expect(getGitBranch).toHaveBeenCalledTimes(1);

    resetGitBranchCache();

    loadProjectRows();
    expect(getGitBranch).toHaveBeenCalledTimes(2);
  });
});

describe("printStatusOnce", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints empty message when no projects", () => {
    printStatusOnce();
    expect(console.log).toHaveBeenCalledWith("No workspace sessions recorded yet.");
    expect(console.log).toHaveBeenCalledWith(
      "Launch a workspace with 'summon <project>' to start tracking.",
    );
  });

  it("prints status rows when projects exist", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    printStatusOnce();
    // First call: header line with active count
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("1 active / 1 total"),
    );
  });

  it("prints each row for multiple projects", () => {
    listProjects.mockReturnValue([
      ["alpha", "/tmp/alpha"],
      ["beta", "/tmp/beta"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", state: "active", uptime: 1000 }),
      makeResolvedStatus({ project: "beta", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");

    printStatusOnce();
    const calls = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(calls).toContain("alpha");
    expect(calls).toContain("beta");
  });
});

// TUI tests hang on Node 18 CI due to stdin event loop interaction.
// The TUI is inherently environment-dependent (manual-test territory per CLAUDE.md).
const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);

describe.skipIf(nodeMajor < 20)("runMonitor", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let resumeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    mockLaunch.mockResolvedValue(undefined);
    vi.useFakeTimers();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isRaw", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "setRawMode", {
      value: vi.fn(() => process.stdin),
      configurable: true,
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    resumeSpy.mockRestore();
    process.stdin.removeAllListeners("data");
    process.removeAllListeners("SIGWINCH");
    vi.useRealTimers();
  });

  it("starts, renders, and quits on 'q' key", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("summon status");
  });

  it("handles arrow key navigation", async () => {
    listProjects.mockReturnValue([
      ["alpha", "/tmp/alpha"],
      ["beta", "/tmp/beta"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", state: "active", uptime: 1000 }),
      makeResolvedStatus({ project: "beta", state: "active", uptime: 2000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();

    process.stdin.emit("data", Buffer.from("\x1b[B")); // arrow down
    process.stdin.emit("data", Buffer.from("\x1b[A")); // arrow up
    process.stdin.emit("data", Buffer.from("j"));       // vim down
    process.stdin.emit("data", Buffer.from("k"));       // vim up
    process.stdin.emit("data", Buffer.from("r"));       // refresh
    process.stdin.emit("data", Buffer.from("q"));       // quit

    await monitorPromise;
    expect(writeSpy).toHaveBeenCalled();
  });

  it("quits on Ctrl+C", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\x03"));
    await monitorPromise;
    expect(writeSpy).toHaveBeenCalled();
  });

  it("auto-refreshes on timer", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();

    vi.advanceTimersByTime(3100);

    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    // Multiple renders: initial + timer refresh
    const callCount = writeSpy.mock.calls.length;
    expect(callCount).toBeGreaterThan(2);
  });

  it("clamps selection when a refresh returns fewer rows", async () => {
    listProjects
      .mockReturnValueOnce([
        ["alpha", "/tmp/alpha"],
        ["beta", "/tmp/beta"],
      ])
      .mockReturnValue([["alpha", "/tmp/alpha"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\x1b[B"));
    process.stdin.emit("data", Buffer.from("r"));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    expect(writeSpy).toHaveBeenCalled();
  });

  it("re-renders on terminal resize", async () => {
    const monitorPromise = runMonitor();
    const before = writeSpy.mock.calls.length;
    process.emit("SIGWINCH");
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    expect(writeSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("uses cursor-home (not full clear) on second and subsequent renders", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const CLEAR_SCREEN = "\x1b[H\x1b[2J";
    const CURSOR_HOME = "\x1b[H";

    const monitorPromise = runMonitor();
    // Trigger a second render via timer
    vi.advanceTimersByTime(3100);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const allWrites: string[] = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Find writes that start with cursor-home or clear-screen (screen renders)
    const screenWrites: string[] = allWrites.filter(
      (w: string) => w.startsWith(CLEAR_SCREEN) || w.startsWith(CURSOR_HOME),
    );
    // There should be at least 2 screen renders
    expect(screenWrites.length).toBeGreaterThanOrEqual(2);
    // The first render may use clear-screen (initial clear), but the second must NOT
    const secondAndLater = screenWrites.slice(1);
    for (const write of secondAndLater) {
      expect(write).not.toContain(CLEAR_SCREEN);
      expect(write.startsWith(CURSOR_HOME)).toBe(true);
    }
  });

  it("uses full clear on resize events", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 1000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const CLEAR_SCREEN = "\x1b[H\x1b[2J";

    const monitorPromise = runMonitor();
    // Reset the spy so we only see writes after the initial render
    writeSpy.mockClear();
    // Trigger a resize
    process.emit("SIGWINCH");
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const allWrites: string[] = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const hasFullClearOnResize = allWrites.some((w: string) => w.startsWith(CLEAR_SCREEN));
    expect(hasFullClearOnResize).toBe(true);
  });

  it("scrollStart persists and scrolls down when selectedIndex moves beyond viewport", async () => {
    // 8 rows, height 8 = 4 chrome + 4 visible
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    listProjects.mockReturnValue(names.map((n) => [n, `/tmp/${n}`]));
    readAllStatuses.mockReturnValue(
      names.map((n) => makeResolvedStatus({ project: n, directory: `/tmp/${n}`, state: "active", uptime: 1000 })),
    );
    getGitBranch.mockReturnValue("main");

    Object.defineProperty(process.stdout, "rows", { value: 8, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });

    const monitorPromise = runMonitor();

    // Navigate down past the visible viewport (4 visible rows, indices 0-3)
    // pressing down 4 times moves selectedIndex to 4, which is beyond viewport
    process.stdin.emit("data", Buffer.from("\x1b[B")); // index 1
    process.stdin.emit("data", Buffer.from("\x1b[B")); // index 2
    process.stdin.emit("data", Buffer.from("\x1b[B")); // index 3
    process.stdin.emit("data", Buffer.from("\x1b[B")); // index 4 -- beyond viewport
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    // The last screen write should contain "e" (project at index 4) as selected (inverted)
    const allWrites = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const lastScreenWrite = [...allWrites].reverse().find(
      (w) => w.startsWith("\x1b[H"),
    );
    expect(lastScreenWrite).toBeDefined();
    // "e" should be visible and selected (inverted)
    expect(lastScreenWrite).toContain("\x1b[7m");
    // "a" should no longer be visible (scrolled past)
    // We check that the selected row marker appears near "e" not "a"
    // by checking the screen contains the selected project name
    const invertStart = lastScreenWrite!.indexOf("\x1b[7m");
    const afterInvert = lastScreenWrite!.slice(invertStart, invertStart + 60);
    expect(afterInvert).toContain("e");
  });

  it("ignores Enter when there are no rows", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("enables and disables raw mode in interactive TTY mode", async () => {
    const setRawModeSpy = process.stdin.setRawMode as ReturnType<typeof vi.fn>;

    const monitorPromise = runMonitor();
    Object.defineProperty(process.stdin, "isRaw", { value: true, configurable: true });
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    expect(setRawModeSpy).toHaveBeenCalledWith(true);
    expect(setRawModeSpy).toHaveBeenCalledWith(false);
  });

  it("opens the selected project on Enter", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    expect(logSpy).toHaveBeenCalledWith("Opening myapp...");
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/myapp");
  });

  it("exits when launching the selected project fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("launch failed"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("prints error message when launch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("osascript error"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    expect(errorSpy).toHaveBeenCalledWith("Launch failed:", "osascript error");
    errorSpy.mockRestore();
  });

  it("shows ? help overlay and dismisses on any key", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    // any key to dismiss
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("Key bindings");
  });
});
