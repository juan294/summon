import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Ensure truncate is imported for direct testing

vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return { ...original, listProjects: vi.fn().mockReturnValue([]) };
});
vi.mock("./status.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./status.js")>();
  return {
    ...original,
    readAllStatuses: vi.fn().mockReturnValue([]),
    hasRexState: vi.fn().mockReturnValue(false),
    rexBinaryPath: vi.fn().mockReturnValue(null),
    seedRexBinaryPath: vi.fn(),
    readProjectStatus: vi.fn().mockReturnValue(null),
    getGitBranch: vi.fn().mockReturnValue(null),
  };
});
const mockLaunch = vi.fn();
const mockFocusWorkspace = vi.fn<(...args: unknown[]) => import("./ghostty-native.js").FocusResult>((..._args: unknown[])=>({kind:"focused",terminalId:"00000000-0000-4000-8000-000000000001"}));
// UX-M4: the Enter handoff launches through the trust prompt (re-exported by launcher.js); by default it runs the launch once.
const mockWithTrustPrompt = vi.fn(async (attempt: () => Promise<unknown>) => attempt());
vi.mock("./launcher.js", () => ({
  launch: (...args: unknown[]) => mockLaunch(...args),
  withTrustPrompt: (attempt: () => Promise<unknown>) => mockWithTrustPrompt(attempt),
}));
vi.mock("./workspace-focus.js", () => ({
  focusWorkspace: (...args: unknown[]) => mockFocusWorkspace(...args),
}));

const monitorModule = await import("./monitor.js");
const monitorRead = await import("./monitor-read.js");
const {
  formatUptime, stateColor, stateDot, renderRow, renderHeader, renderFooter,
  renderScreen, loadProjectRows, printStatusOnce, runMonitor, resetGitBranchCache,
  prefetchGitBranches, truncate,
} = monitorModule;
import type { ProjectRow } from "./monitor.js";
import { getDisplayWidth } from "./ui/width.js";

const { listProjects } = await import("./config.js") as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
};
const { readAllStatuses, readProjectStatus, getGitBranch, hasRexState, rexBinaryPath, seedRexBinaryPath } = await import("./status.js") as unknown as {
  hasRexState: ReturnType<typeof vi.fn>;
  rexBinaryPath: ReturnType<typeof vi.fn>;
  seedRexBinaryPath: ReturnType<typeof vi.fn>;
  readAllStatuses: ReturnType<typeof vi.fn>;
  readProjectStatus: ReturnType<typeof vi.fn>;
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

/** Visible text: drops SGR colors and the cursor/clear sequences that start a frame. */
// eslint-disable-next-line no-control-regex
const visibleText = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** stdin as a raw-capable TTY, as the monitor needs it. */
function stubTtyStdin(): void {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isRaw", { value: false, configurable: true });
  Object.defineProperty(process.stdin, "setRawMode", { value: vi.fn(() => process.stdin), configurable: true });
}

/**
 * The TTY a describe's monitor runs in: stdout captured, stdin a raw TTY, fake timers, no projects.
 * `setup` adds the describe's own defaults. `frames()` are the full repaints written so far.
 */
function useMonitorTty(setup: () => void = () => {}) {
  const tty = {
    writeSpy: undefined as unknown as ReturnType<typeof vi.spyOn>,
    resumeSpy: undefined as unknown as ReturnType<typeof vi.spyOn>,
    frames: (): string[] => tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((w: string) => w.startsWith("\x1b[H")),
  };
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    setup();
    vi.useFakeTimers();
    tty.writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    tty.resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    stubTtyStdin();
  });
  afterEach(() => {
    tty.writeSpy.mockRestore();
    tty.resumeSpy.mockRestore();
    process.stdin.removeAllListeners("data");
    process.removeAllListeners("SIGWINCH");
    vi.useRealTimers();
  });
  return tty;
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

describe("truncate", () => {
  it("returns the string unchanged when it fits", () => {
    expect(truncate("main", 10)).toBe("main");
  });

  it("truncates with ellipsis when string exceeds maxLen", () => {
    const result = truncate("a-very-long-branch-name", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles maxLen of 1 (returns just ellipsis)", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("handles maxLen of 0 (returns empty string)", () => {
    expect(truncate("hello", 0)).toBe("");
  });

  it("handles negative maxLen (returns empty string)", () => {
    expect(truncate("hello", -1)).toBe("");
  });

  it("returns exact-length string unchanged", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("truncates to exactly maxLen characters including ellipsis", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("abcd…");
    expect(result.length).toBe(5);
  });

  // Wide character (CJK/emoji) tests — display width aware (#537)
  it("wide chars (CJK): treats each CJK char as 2 columns", () => {
    // "日本語" = 3 CJK chars = display width 6
    // truncate("日本語", 6) should return "日本語" unchanged (fits exactly)
    const result = truncate("日本語", 6);
    expect(result).toBe("日本語");
  });

  it("wide chars (CJK): truncates when display width exceeds maxLen", () => {
    // "日本語app" = 3 CJK (width 6) + 3 ASCII (width 3) = display width 9
    // truncate to 5 cols: must fit in 5 display cols including ellipsis (4 cols + "…")
    const result = truncate("日本語app", 5);
    // Result display width must be <= 5
    // "日本…" = 2 CJK (4) + ellipsis (1) = 5 — correct
    expect(result).toBe("日本…");
  });

  it("wide chars (emoji): emoji truncated to fit display width", () => {
    // "🚀🚀🚀" each emoji is width 2, so display width = 6
    // truncate to 4 cols: "🚀…" = 2 + 1 = 3 cols, or "🚀🚀" is exactly 4 = fits (no truncation needed? width 4)
    // "🚀🚀" display width 4 fits in maxLen 4 — no truncation
    const result = truncate("🚀🚀", 4);
    expect(result).toBe("🚀🚀");
  });

  it("wide chars (emoji): truncates with ellipsis at correct display column", () => {
    // "🚀🚀🚀" display width 6, maxLen 5: must truncate
    // "🚀🚀" = 4 cols + "…" = 5 cols total
    const result = truncate("🚀🚀🚀", 5);
    expect(result).toBe("🚀🚀…");
  });

  it("wide chars: ASCII strings still work correctly after refactor", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
    expect(truncate("abcdef", 5)).toBe("abcd…");
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

  it("stopped workspace shows directory path instead of git branch (#429)", () => {
    const row = makeRow({ state: "stopped", directory: "/tmp/myapp", gitBranch: "feat/auth" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("/tmp/myapp");
    expect(result).not.toContain("feat/auth");
  });

  it("unknown workspace shows directory path instead of em dash (#429)", () => {
    const row = makeRow({ state: "unknown", directory: "/Users/dev/project", gitBranch: "—" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("/Users/dev/project");
  });

  it("active workspace shows git branch, not directory (#429)", () => {
    const row = makeRow({ state: "active", directory: "/tmp/myapp", gitBranch: "feature/login" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("feature/login");
    expect(result).not.toContain("/tmp/myapp");
  });

  it("selected row rendering is controlled by the invert helper (not raw escape)", () => {
    // The key invariant: renderRow must use an invert() helper (which checks useColor),
    // not a raw \x1b[7m constant. In TTY mode the helper produces invert; in non-TTY it's a no-op.
    // We verify: selected differs from non-selected (selected has extra decoration when color is on).
    const row = makeRow();
    const selected = renderRow(row, 80, true);
    const notSelected = renderRow(row, 80, false);
    // Selected row must be different from non-selected (extra wrapper chars or same if no color)
    // This holds in both color and no-color environments.
    // In TTY (color) env: selected should contain invert escape
    // In non-TTY (no-color) env: both are identical plain text — that is acceptable
    if (selected.includes("\x1b[")) {
      // Color mode: invert MUST appear on selected row, NOT on non-selected
      expect(selected).toContain("\x1b[7m");
      expect(notSelected).not.toContain("\x1b[7m");
    } else {
      // No-color mode: neither should have raw escapes
      expect(selected).not.toContain("\x1b[7m");
      expect(notSelected).not.toContain("\x1b[7m");
    }
  });

  it("non-selected row does not have inverted colors", () => {
    const row = makeRow();
    const result = renderRow(row, 80, false);
    expect(result).not.toContain("\x1b[7m");
  });

  it("column width clamps to MIN_COLS floor (60) even on narrow terminal", () => {
    const row = makeRow({ gitBranch: "main" });
    // Width below MIN_COLS (60) should be clamped — render should not crash
    const result = renderRow(row, 30, false);
    expect(result).toContain("myapp");
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
    expect(screen).toContain("No projects registered.");
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
    // Second row should be selected and visible (invert ANSI only present in TTY/color env)
    expect(screen).toContain("second");
  });

  it("scrolls to show selected row at end of list (scrollStart passed explicitly)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome + 6 visible rows, selected at index 25
    // scrollStart=20 means rows 20-25 are visible
    const screen = renderScreen(rows, 25, 80, 10, { scrollStart: 20 });
    expect(screen).toContain("project-25");
    expect(screen).not.toContain("project-0");
    expect(screen).toContain("project-25");
  });

  it("scrolls to show selected row in middle of list (scrollStart passed explicitly)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome + 6 visible rows; scrollStart=12 puts project-15 in view
    const screen = renderScreen(rows, 15, 80, 10, { scrollStart: 12 });
    expect(screen).toContain("project-1");
  });

  it("handles a selected index before the visible window", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );

    const screen = renderScreen(rows, -1, 80, 10);

    expect(screen).toContain("summon status");
  });

  it("names the polling fallback in the footer and the staleness in the header, only when asked", () => {
    const plain = renderScreen([makeRow()], 0, 120, 10);
    expect(plain).not.toContain("Visibility unavailable");
    expect(plain).not.toContain("updating");
    const screen = renderScreen([makeRow()], 0, 120, 10, { visibilityUnavailable: true, staleNote: "updating\u2026" });
    expect(screen).toContain("Visibility unavailable; polling");
    expect(screen).toContain("updating\u2026");
  });
});

// --- Data-loading function tests (use mocked config.js / status.js) ---

describe("loadProjectRows", () => {
  beforeEach(() => {
    resetGitBranchCache();
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
  });

  afterEach(() => {
    resetGitBranchCache();
  });

  it("returns empty array when no projects exist", () => {
    const rows = loadProjectRows();
    expect(rows).toEqual([]);
  });

  it("builds rows from registered projects with matching statuses", async () => {
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
    // With async path, gitBranch is "…" on first call (placeholder until prefetch completes)
    expect(rows[0]!.gitBranch).toBe("…");
    // A project with no record was never launched: stopped, never "unknown" (that state means the
    // liveness could not be read and is refused by open, focus and Enter; guide F5).
    expect(rows[1]!.name).toBe("api");
    expect(rows[1]!.state).toBe("stopped");
    expect(rows[1]!.reason).toBeUndefined();

    // After prefetch, branch is available
    await prefetchGitBranches(rows, () => {});
    const rows2 = loadProjectRows();
    expect(rows2[0]!.gitBranch).toBe("main");
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

  it("caches git branch results: prefetch twice, getGitBranch called only once", async () => {
    const rows = loadProjectRows();
    await prefetchGitBranches(rows, () => {});
    // Second prefetch with warm cache should NOT call getGitBranch again
    const rows2 = loadProjectRows();
    await prefetchGitBranches(rows2, () => {});

    expect(getGitBranch).toHaveBeenCalledTimes(1);
  });

  it("returns cached branch value after prefetch warms cache", async () => {
    const rows1 = loadProjectRows();
    expect(rows1[0]!.gitBranch).toBe("…"); // placeholder before fetch
    await prefetchGitBranches(rows1, () => {});

    getGitBranch.mockReturnValue("different-branch");
    const rows2 = loadProjectRows();
    expect(rows2[0]!.gitBranch).toBe("main"); // cached value, not "different-branch"
  });

  it("refreshes cache after TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const rows = loadProjectRows();
      await prefetchGitBranches(rows, () => {});
      expect(getGitBranch).toHaveBeenCalledTimes(1);

      // Advance past the 10-second TTL
      vi.advanceTimersByTime(11_000);

      const rows2 = loadProjectRows();
      await prefetchGitBranches(rows2, () => {});
      expect(getGitBranch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches per-directory independently", async () => {
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

    const rows = loadProjectRows();
    await prefetchGitBranches(rows, () => {});
    // Both directories should trigger a getGitBranch call
    expect(getGitBranch).toHaveBeenCalledTimes(2);
    expect(getGitBranch).toHaveBeenCalledWith("/tmp/myapp");
    expect(getGitBranch).toHaveBeenCalledWith("/tmp/api");

    // Second prefetch should use cache for both
    getGitBranch.mockClear();
    const rows2 = loadProjectRows();
    await prefetchGitBranches(rows2, () => {});
    expect(getGitBranch).toHaveBeenCalledTimes(0);
  });

  it("does not cache null results: retries on next prefetch", async () => {
    getGitBranch.mockReturnValue(null);
    const rows = loadProjectRows();
    await prefetchGitBranches(rows, () => {});

    getGitBranch.mockReturnValue("main");
    const rows2 = loadProjectRows();
    await prefetchGitBranches(rows2, () => {});

    // Should have been called twice since null is not cached
    expect(getGitBranch).toHaveBeenCalledTimes(2);
    const rows3 = loadProjectRows();
    expect(rows3[0]!.gitBranch).toBe("main");
  });

  it("resetGitBranchCache clears all cached entries", async () => {
    const rows = loadProjectRows();
    await prefetchGitBranches(rows, () => {});
    expect(getGitBranch).toHaveBeenCalledTimes(1);

    resetGitBranchCache();

    const rows2 = loadProjectRows();
    await prefetchGitBranches(rows2, () => {});
    expect(getGitBranch).toHaveBeenCalledTimes(2);
  });
});

// --- FE-H3: async git branch reads ---

describe("async git branch loading (FE-H3)", () => {
  beforeEach(() => {
    resetGitBranchCache();
    listProjects.mockReset();
    readAllStatuses.mockReset();
    getGitBranch.mockReset();
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 1000 }),
    ]);
  });

  afterEach(() => {
    resetGitBranchCache();
  });

  it("loadProjectRows does not call getGitBranch synchronously (returns placeholder)", () => {
    getGitBranch.mockReturnValue("main");
    const rows = loadProjectRows();
    // With cold cache: should return placeholder, NOT block on getGitBranch
    expect(rows[0]!.gitBranch).toBe("…");
    expect(getGitBranch).not.toHaveBeenCalled();
  });

  it("loadProjectRows returns cached branch on warm cache", async () => {
    getGitBranch.mockReturnValue("main");
    const rows = loadProjectRows();
    // Warm the cache via prefetchGitBranches
    await prefetchGitBranches(rows, () => {});
    // Next loadProjectRows should return cached value
    const rows2 = loadProjectRows();
    expect(rows2[0]!.gitBranch).toBe("main");
  });

  it("prefetchGitBranches calls onUpdate after fetching branches", async () => {
    getGitBranch.mockReturnValue("develop");
    const rows = loadProjectRows();
    expect(rows[0]!.gitBranch).toBe("…");

    const onUpdate = vi.fn();
    await prefetchGitBranches(rows, onUpdate);

    expect(onUpdate).toHaveBeenCalled();
  });

  it("prefetchGitBranches does not call onUpdate when cache is already warm", async () => {
    getGitBranch.mockReturnValue("develop");
    const rows = loadProjectRows();
    await prefetchGitBranches(rows, () => {});

    // Second prefetch — everything already cached
    getGitBranch.mockClear();
    const rows2 = loadProjectRows();
    const onUpdate2 = vi.fn();
    await prefetchGitBranches(rows2, onUpdate2);

    expect(getGitBranch).not.toHaveBeenCalled();
    expect(onUpdate2).not.toHaveBeenCalled();
  });

  it("prefetchGitBranches does not call getGitBranch for stopped projects", async () => {
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");
    const rows = loadProjectRows();
    const onUpdate = vi.fn();
    await prefetchGitBranches(rows, onUpdate);
    expect(getGitBranch).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("printStatusOnce", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints empty message when no projects", async () => {
    await printStatusOnce();
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("No projects registered.");
    expect(output).toContain("summon add <name> <path>");
    expect(output).toContain("summon setup");
  });

  it("--once waits for the git branch of live rows instead of printing the placeholder (D3)", async () => {
    resetGitBranchCache();
    listProjects.mockReturnValue([["ghost", "/tmp/ghost"], ["rexy", "/tmp/rexy"], ["off", "/tmp/off"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "ghost", state: "active", uptime: 60_000 }),
      makeResolvedStatus({ project: "rexy", state: "active", uptime: 60_000, backend: "rex" }),
      makeResolvedStatus({ project: "off", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockImplementation(async (dir: string) => (dir === "/tmp/off" ? "never-asked" : dir === "/tmp/rexy" ? null : "main"));
    await printStatusOnce();
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines.find((l) => l.includes("ghost"))).toContain("main");
    expect(lines.find((l) => l.includes("rexy"))).toContain("\u2014");
    expect(lines.join("\n")).not.toContain("\u2026");
    expect(getGitBranch).not.toHaveBeenCalledWith("/tmp/off");
  });

  it("prints status rows when projects exist", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    await printStatusOnce();
    // First call: header line with active count
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("1 active / 1 total"),
    );
  });

  it("prints a reason the column cuts off in full below the row, so its command stays visible (F16)", async () => {
    const columns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    listProjects.mockReturnValue([["rc-pair", "/tmp/rc-pair"], ["short", "/tmp/short"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "rc-pair", directory: "/tmp/rc-pair", state: "stopped", uptime: null, reason: "empty Rex session remains; run summon clean rc-pair" }),
      makeResolvedStatus({ project: "short", directory: "/tmp/short", state: "stopped", uptime: null, reason: "Rex session no longer exists" }),
    ]);
    try {
      await printStatusOnce();
    } finally {
      Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
    }
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("reason: empty Rex session remains; run summon clean rc-pair"))).toBe(true);
    expect(lines.some((l) => l.includes("reason: Rex session no longer exists"))).toBe(false);
  });

  it("prints each row for multiple projects", async () => {
    listProjects.mockReturnValue([
      ["alpha", "/tmp/alpha"],
      ["beta", "/tmp/beta"],
    ]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", state: "active", uptime: 1000 }),
      makeResolvedStatus({ project: "beta", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");

    await printStatusOnce();
    const calls = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(calls).toContain("alpha");
    expect(calls).toContain("beta");
  });
});

// TUI tests require Node >= 22.12 (project minimum). Since the project enforces
// Node >= 22.12 in package.json engines, this suite always runs on supported toolchains.
describe("runMonitor", () => {
  const tty = useMonitorTty(() => {
    readAllStatuses.mockReturnValue([]);
    mockLaunch.mockResolvedValue(undefined);
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

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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
    expect(tty.writeSpy).toHaveBeenCalled();
  });

  it("quits on Ctrl+C", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\x03"));
    await monitorPromise;
    expect(tty.writeSpy).toHaveBeenCalled();
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
    const callCount = tty.writeSpy.mock.calls.length;
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

    expect(tty.writeSpy).toHaveBeenCalled();
  });

  it("re-renders on terminal resize", async () => {
    const monitorPromise = runMonitor();
    const before = tty.writeSpy.mock.calls.length;
    process.emit("SIGWINCH");
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    expect(tty.writeSpy.mock.calls.length).toBeGreaterThan(before);
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
    // Change the content so the next refresh produces a different frame and actually
    // writes (idle ticks with identical frames are skipped by the frame-level diff).
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 5_000_000 }),
    ]);
    // Trigger a second render via timer
    vi.advanceTimersByTime(3100);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const allWrites: string[] = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
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
    tty.writeSpy.mockClear();
    // Trigger a resize
    process.emit("SIGWINCH");
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const allWrites: string[] = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
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
    const allWrites = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const lastScreenWrite = [...allWrites].reverse().find(
      (w) => w.startsWith("\x1b[H"),
    );
    expect(lastScreenWrite).toBeDefined();
    // "e" should be visible (selected row scrolled into view as project name)
    expect(lastScreenWrite).toContain("● e");
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

  it("P2 active Enter focuses exact identity without duplicate launch", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 })]);
    const monitorPromise = runMonitor(); process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise; await vi.dynamicImportSettled();
    expect(mockFocusWorkspace).toHaveBeenCalledWith("myapp");
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("P2 unavailable active focus shows recovery overlay and never launches", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({project:"myapp",state:"active",uptime:60_000})]);
    mockFocusWorkspace.mockReturnValueOnce({kind:"unavailable",code:"missing",reason:"Exact identity unavailable; relaunch explicitly"});
    const monitorPromise=runMonitor();process.stdin.emit("data",Buffer.from("\r"));await vi.dynamicImportSettled();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(tty.writeSpy.mock.calls.map((c: unknown[])=>String(c[0])).join("")).toContain("relaunch explicitly");
    process.stdin.emit("data",Buffer.from(" "));process.stdin.emit("data",Buffer.from("q"));await monitorPromise;
  });

  it("opens the selected project on Enter", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    const allWrites = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(allWrites).toContain("Opening myapp...");
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/myapp");
  });

  it("FE-L2: prints the launch feedback line AFTER leaving the alternate screen on Enter", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");

    // Track all writes in order to verify feedback appears before EXIT_ALT_SCREEN
    const allWrites: string[] = [];
    tty.writeSpy.mockImplementation((s: unknown) => {
      allWrites.push(String(s));
      return true;
    });

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    // Find indices: SHOW_CURSOR+EXIT_ALT_SCREEN sequence (\x1b[?25h\x1b[?1049l) and feedback line
    // The feedback must be written AFTER the alt-screen is exited
    const exitIdx = allWrites.findIndex((w) => w.includes("\x1b[?1049l"));
    // The feedback line ("Opening myapp..." or "Launching myapp...") appears on its own write
    // and must contain the project name but NOT be a full screen render (no CURSOR_HOME prefix)
    const feedbackIdx = allWrites.findIndex((w) =>
      (w.includes("Opening") || w.includes("Launching")) && w.includes("myapp") && !w.startsWith("\x1b[H"),
    );

    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(feedbackIdx).toBeGreaterThanOrEqual(0);
    // Written on the normal screen, so it stays visible during the handoff.
    expect(feedbackIdx).toBeGreaterThan(exitIdx);
  });

  it("UX-M5: does NOT exit on launch failure — shows in-TUI error and continues (replaces old exit test)", async () => {
    // Old behavior: exit(1) on failure. New behavior: show error in TUI, allow user to continue.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("launch failed"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));  // trigger launch (fails)
    await vi.dynamicImportSettled();
    // After dynamic import settles, dismiss error overlay and quit
    process.stdin.emit("data", Buffer.from(" "));   // dismiss error screen
    // After dismissing, onKeypress is re-registered; quit via 'q'
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    // Must NOT have called exit(1) — error is handled in-TUI
    expect(exitSpy).not.toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("UX-M5: shows error in stdout (not stderr) when launch fails", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("osascript error"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));  // trigger launch (fails)
    await vi.dynamicImportSettled();
    process.stdin.emit("data", Buffer.from(" "));   // dismiss error screen
    process.stdin.emit("data", Buffer.from("q"));   // quit TUI
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("Launch failed");
    expect(output).toContain("osascript error");
  });

  it("shows ? help overlay and dismisses on any key", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    // any key to dismiss
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("Key bindings");
  });

  it("#481 FE-L1: help overlay contains color legend with yellow and active", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("yellow");
    expect(output).toContain("active");
  });

  it("#529 #538 UX-H2/FE-M2: help overlay legend accurately reflects stateColor() — green=active, yellow=active>4h, dim=stopped", async () => {
    // stateColor() maps: active->green, active-long->yellow, stopped/unknown->dim
    // The legend MUST match these mappings, not say "yellow = active"
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    // Must mention green for active state
    expect(output).toContain("green");
    // Must associate yellow with the >4h qualifier (active-long), not plain active
    expect(output).toMatch(/yellow.*4h|yellow.*long/);
    // Must mention dim for stopped
    expect(output).toContain("dim");
  });

  it("#413 FE-M7: help overlay uses bold/dim/cyan helpers (no raw ANSI in help text strings)", async () => {
    // The help overlay must use bold()/dim()/cyan() helpers, not raw \x1b[ escape sequences
    // embedded literally in string literals. We verify the structural content is present:
    // key names (cyan), descriptions (dim), header (bold).
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    // All key binding labels must be present in the overlay output
    expect(output).toContain("move up");
    expect(output).toContain("move down");
    expect(output).toContain("open selected project");
    expect(output).toContain("refresh");
    expect(output).toContain("quit");
    expect(output).toContain("Press any key to dismiss");
  });

  it("UX-M5 #508: launch error shows in-TUI error message instead of crashing", async () => {
    // When a launch fails, the TUI should show an error message in-place and let user continue
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("osascript: execution failed"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));  // trigger launch (will fail)
    await vi.dynamicImportSettled();
    // Dismiss the error overlay
    process.stdin.emit("data", Buffer.from(" "));   // dismiss error screen
    // onKeypress is re-registered after dismissal — quit normally
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    // Error message must appear in TUI stdout (not just stderr)
    expect(output).toContain("Launch failed");
    expect(output).toContain("osascript: execution failed");
    // Dashboard should still be accessible — summon status header should be in output
    expect(output).toContain("summon status");
  });
});

describe("UX-M4 (#558): printStatusOnce uses standard empty-state message", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows the standard empty-state message including 'summon add' and 'summon setup'", async () => {
    await printStatusOnce();
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("No projects registered.");
    expect(output).toContain("summon add <name> <path>");
    expect(output).toContain("summon setup");
  });
});

describe("UX-M4 (#558): renderScreen uses standard empty-state message", () => {
  it("renderScreen empty-state contains 'No projects registered.'", () => {
    const screen = renderScreen([], 0, 80, 24);
    expect(screen).toContain("No projects registered.");
    expect(screen).toContain("summon add <name> <path>");
    expect(screen).toContain("summon setup");
  });
});

// --- New regression tests for PASS 1 findings ---

describe("UX-H2 (#599): active-long has a non-color distinguishing marker", () => {
  it("stateDot: active-long renders a filled dot (●) same as active", () => {
    expect(stateDot("active-long")).toBe("●");
  });

  it("renderRow: active-long row contains 'active*' label (non-color marker)", () => {
    const row = makeRow({ state: "active-long" });
    const result = renderRow(row, 80, false);
    expect(result).toContain("active*");
  });

  it("renderRow: active-long label differs from plain active label without relying on color", () => {
    const activeLongRow = makeRow({ state: "active-long" });
    const activeRow = makeRow({ state: "active" });
    // Compare the plain text, without ANSI codes
    const longText = visibleText(renderRow(activeLongRow, 80, false));
    const activeText = visibleText(renderRow(activeRow, 80, false));
    expect(longText).not.toBe(activeText);
  });
});

describe.skipIf(parseInt(process.versions.node.split(".")[0]!, 10) < 20)(
  "FE-B1 (#580): help overlay dismiss repaints dashboard",
  () => {
    const tty = useMonitorTty(() => { readAllStatuses.mockReturnValue([]); });

    it("FE-B1: after ? overlay dismiss, a new dashboard write occurs (prevFrame invalidated)", async () => {
      const monitorPromise = runMonitor();
      const writesBefore = tty.writeSpy.mock.calls.length;
      process.stdin.emit("data", Buffer.from("?"));
      // count writes after ? opened overlay
      const writesAfterOpen = tty.writeSpy.mock.calls.length;
      expect(writesAfterOpen).toBeGreaterThan(writesBefore); // overlay was written

      // dismiss help — should trigger a repaint
      process.stdin.emit("data", Buffer.from(" "));
      const writesAfterDismiss = tty.writeSpy.mock.calls.length;
      expect(writesAfterDismiss).toBeGreaterThan(writesAfterOpen); // repaint occurred

      process.stdin.emit("data", Buffer.from("q"));
      await monitorPromise;
    });

    it("FE-B2: pressing q to dismiss ? help does NOT quit the monitor", async () => {
      let resolved = false;
      const monitorPromise = runMonitor().then(() => { resolved = true; });
      process.stdin.emit("data", Buffer.from("?"));
      // q to dismiss the help overlay — should not quit
      process.stdin.emit("data", Buffer.from("q"));
      // give a tick for any async processing
      await Promise.resolve();
      // monitor must still be running (not resolved yet)
      expect(resolved).toBe(false);
      // Now properly quit
      process.stdin.emit("data", Buffer.from("q"));
      await monitorPromise;
      expect(resolved).toBe(true);
    });
  },
);
// --- FE-M3 (#611): renderScreen appends \x1b[0K to each row to erase trailing glyphs ---

describe("FE-M3 (#611): renderScreen clears to end-of-line on each row", () => {
  it("each content row ends with EL (erase-to-end-of-line) sequence", () => {
    const rows = [makeRow({ name: "myapp", state: "active" })];
    const screen = renderScreen(rows, 0, 80, 10);
    const lines = screen.split("\n");
    // Lines: header, separator, row0..rowN, separator, footer
    // The content rows (between the two separators) must end with \x1b[0K
    const separatorChar = "─";
    const EL = "\x1b[0K";
    let inContent = false;
    let firstSepSeen = false;
    for (const line of lines) {
      const isSep = line.includes(separatorChar) && !line.includes("myapp");
      if (isSep && !firstSepSeen) { firstSepSeen = true; inContent = true; continue; }
      if (isSep && firstSepSeen) { inContent = false; continue; }
      if (inContent) {
        expect(line.endsWith(EL)).toBe(true);
      }
    }
  });

  it("no-ghost: a row that shrinks after a repaint does not leave trailing characters", () => {
    // Simulate a long row rendered first, then a shorter row rendered at the same screen position.
    // After the fix, the shorter row must end with \x1b[0K which erases trailing chars.
    const longRow = makeRow({ name: "myapp", gitBranch: "feature/very-long-branch-name-that-is-long" });
    const shortRow = makeRow({ name: "myapp", gitBranch: "main" });

    const screenLong = renderScreen([longRow], 0, 80, 10);
    const screenShort = renderScreen([shortRow], 0, 80, 10);

    // Both screens' content rows must end with \x1b[0K so a CURSOR_HOME repaint is clean
    const EL = "\x1b[0K";
    const contentRowLong = screenLong.split("\n").find(l => l.includes("myapp"));
    const contentRowShort = screenShort.split("\n").find(l => l.includes("myapp"));
    expect(contentRowLong?.endsWith(EL)).toBe(true);
    expect(contentRowShort?.endsWith(EL)).toBe(true);
  });
});

// --- UX-L1 (#616): legend improvements and narrow terminal guard ---

describe("UX-L1 (#616): help overlay legend shows glyph/label mapping", () => {
  // Node >= 22.12 is the project minimum — no skipIf guard needed (QA-L2 policy)
  const tty = useMonitorTty(() => {
    readAllStatuses.mockReturnValue([]);
    mockLaunch.mockResolvedValue(undefined);
  });

  it("help overlay shows ● glyph mapped to 'active' label", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("●");
    expect(output).toMatch(/●.*active/s);
  });

  it("help overlay shows ○ glyph mapped to 'stopped' label", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("○");
    expect(output).toMatch(/○.*stopped/s);
  });

  it("help overlay shows active* label for long-running (>4h)", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = tty.writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    // Must mention active* or active-long for the >4h case
    expect(output).toMatch(/active\*|active-long|active >4h/);
  });
});

describe("UX-L1 (#616): narrow terminal renders single-line guard message", () => {
  it("renderScreen returns narrow guard message when width < MIN_COLS (60)", () => {
    const rows = [makeRow()];
    const screen = renderScreen(rows, 0, 40, 24);
    expect(screen).toContain("Terminal too narrow");
    expect(screen).toContain("60");
  });

  it("renderScreen renders normally at exactly MIN_COLS (60)", () => {
    const rows = [makeRow()];
    const screen = renderScreen(rows, 0, 60, 24);
    expect(screen).toContain("summon status");
    expect(screen).not.toContain("Terminal too narrow");
  });

  it("renderScreen renders normally at width above MIN_COLS", () => {
    const rows = [makeRow()];
    const screen = renderScreen(rows, 0, 80, 24);
    expect(screen).toContain("summon status");
    expect(screen).not.toContain("Terminal too narrow");
  });
});

describe("four-state rows (plan P10, Phase 4)", () => {
  const { classifyState, renderRow, isLiveState } = monitorModule;

  it("classifyState keeps unknown and partial distinct and splits active by uptime", () => {
    expect(classifyState(makeResolvedStatus({ state: "unknown", uptime: null, reason: "server unreachable" }) as never)).toBe("unknown");
    expect(classifyState(makeResolvedStatus({ state: "partial", uptime: 1000, reason: "root pane closed" }) as never)).toBe("partial");
    expect(classifyState(makeResolvedStatus({ state: "stopped", uptime: null }) as never)).toBe("stopped");
    expect(classifyState(makeResolvedStatus({ state: "active", uptime: 1000 }) as never)).toBe("active");
    expect(classifyState(makeResolvedStatus({ state: "active", uptime: 5 * 60 * 60 * 1000 }) as never)).toBe("active-long");
    expect(["active", "active-long", "partial"].every((s) => isLiveState(s as never))).toBe(true);
    expect(["stopped", "unknown"].some((s) => isLiveState(s as never))).toBe(false);
  });

  it("renders the reason in the detail column for unknown and partial rows", () => {
    const unknown = renderRow(makeRow({ state: "unknown", uptime: "\u2014", reason: "server unreachable" }), 80, false);
    expect(unknown).toContain("unknown");
    expect(unknown).toContain("server unreachable");
    expect(unknown).not.toContain("/tmp/myapp");
    const partial = renderRow(makeRow({ state: "partial", reason: "root pane closed" }), 80, false);
    expect(partial).toContain("partial");
    expect(partial).toContain("root pane closed");
    const stopped = renderRow(makeRow({ state: "stopped" }), 80, false);
    expect(stopped).toContain("/tmp/myapp");
    const stoppedWithReason = renderRow(makeRow({ state: "stopped", reason: "empty Rex session remains; run summon clean myapp" }), 80, false);
    expect(stoppedWithReason).toContain("empty Rex session remains");
    expect(stoppedWithReason).not.toContain("/tmp/myapp");
  });

  it("loadProjectRows carries reason and notices, counts partial as active and sorts live rows first", async () => {
    listProjects.mockReturnValue([["a", "/tmp/a"], ["b", "/tmp/b"], ["c", "/tmp/c"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "a", state: "unknown", uptime: null, reason: "server unreachable", notices: ["earlier launch x could not be verified"] }),
      makeResolvedStatus({ project: "b", state: "partial", uptime: 60_000, reason: "root pane closed" }),
      makeResolvedStatus({ project: "c", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");
    const rows = monitorModule.loadProjectRows();
    expect(rows.map((r) => [r.name, r.state, r.reason])).toEqual([["c", "active", undefined], ["b", "partial", "root pane closed"], ["a", "unknown", "server unreachable"]]);
    expect(rows.find((r) => r.name === "a")!.notices).toEqual(["earlier launch x could not be verified"]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await monitorModule.printStatusOnce();
    const output = logSpy.mock.calls.flat().join("\n");
    logSpy.mockRestore();
    expect(output).toContain("2 active / 3 total");
    expect(output).toContain("note: earlier launch x could not be verified");
    expect(output).toContain("server unreachable");
  });
});

describe("handoff on the four states (plan P10, Phase 4)", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockLaunch.mockReset();
    mockFocusWorkspace.mockReset().mockReturnValue({ kind: "focused", terminalId: "00000000-0000-4000-8000-000000000001" });
  });
  afterEach(() => { writeSpy.mockRestore(); });

  it("Enter on a partial row focuses it", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "partial", uptime: 60_000, reason: "root pane closed" })]);
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();
    expect(mockFocusWorkspace).toHaveBeenCalledWith("myapp");
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("UX-M4: Enter on a stopped row launches inside the trust prompt, on the normal screen; a focus skips it", async () => {
    mockWithTrustPrompt.mockClear();
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null })]);
    let screenLeftBeforePrompt = false;
    mockWithTrustPrompt.mockImplementationOnce(async (attempt) => {
      screenLeftBeforePrompt = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("").includes("\x1b[?1049l");
      return attempt();
    });
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();
    expect(mockWithTrustPrompt).toHaveBeenCalledTimes(1);
    expect(screenLeftBeforePrompt).toBe(true);
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/myapp");

    mockWithTrustPrompt.mockClear();
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 })]);
    const second = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await second;
    await vi.dynamicImportSettled();
    expect(mockFocusWorkspace).toHaveBeenCalledWith("myapp");
    expect(mockWithTrustPrompt).not.toHaveBeenCalled();
  });

  /** Enter on a stopped row whose trust prompt ends with `cancel`; returns the text written after the handoff. */
  async function cancelAtTrustPrompt(cancel: Error): Promise<string> {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "stopped", uptime: null })]);
    mockWithTrustPrompt.mockRejectedValueOnce(cancel);
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    const written = () => writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    await vi.waitFor(() => expect(written()).toContain("Launch cancelled."));
    const shown = written();
    // Any key returns to the dashboard, where q quits as usual.
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
    expect(mockLaunch).not.toHaveBeenCalled();
    return shown;
  }

  it("UX-M4: n or Enter at the trust prompt is a neutral cancel that names the decline, then the dashboard", async () => {
    const { PromptCancelled } = await import("./utils.js");
    const shown = await cancelAtTrustPrompt(new PromptCancelled("Trust declined."));
    expect(shown).toContain("Trust declined.");
    expect(shown).not.toContain("Launch failed");
  });

  it("UX-M4: Ctrl+C or Esc at the trust prompt is a neutral cancel, never a launch failure", async () => {
    const { PromptCancelled } = await import("./utils.js");
    const shown = await cancelAtTrustPrompt(new PromptCancelled());
    expect(shown).toContain("Nothing was trusted.");
    expect(shown).not.toContain("Launch failed");
    expect(shown).not.toContain("Cancelled");
  });

  it("Enter on an unknown row shows the reason and neither launches nor focuses", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "myapp", state: "unknown", uptime: null, reason: "server unreachable" })]);
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await new Promise((r) => setTimeout(r, 20));
    const writes = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(writes).toContain("Cannot open (state unknown):");
    expect(writes).toContain("server unreachable");
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockFocusWorkspace).not.toHaveBeenCalled();
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
  });
});

describe("program status glyph (Rex, Phase 5)", () => {
  const { programGlyph, renderRow } = monitorModule;
  it("maps each program state to one glyph and renders it beside the dot", () => {
    expect(programGlyph("blocked")).toContain("\u26A0");
    expect(programGlyph("error")).toContain("\u2717");
    expect(programGlyph("working")).toContain("\u22EF");
    expect(programGlyph("done")).toContain("\u2713");
    expect(programGlyph("idle")).toBe(" ");
    expect(programGlyph(undefined)).toBe(" ");
    const row = renderRow(makeRow({ programStatus: "blocked" }), 80, false);
    expect(row).toContain("\u26A0");
    expect(renderRow(makeRow(), 80, false)).not.toContain("\u26A0");
  });

  it("loadProjectRows carries the program state from the status", () => {
    listProjects.mockReturnValue([["a", "/tmp/a"]]);
    readAllStatuses.mockReturnValue([makeResolvedStatus({ project: "a", state: "active", uptime: 60_000, programStatus: { state: "error", msg: "boom" } })]);
    getGitBranch.mockReturnValue("main");
    expect(monitorModule.loadProjectRows()[0]!.programStatus).toBe("error");
  });
});


describe("loadProjectRow (summon open <project>)", () => {
  it("builds one row from one status read, and a stopped row for a registered project without a record", async () => {
    const { loadProjectRow } = await import("./monitor.js");
    readAllStatuses.mockClear();
    listProjects.mockReturnValue(new Map([["api", "/tmp/api"], ["web", "/tmp/web"]]));
    readProjectStatus.mockReturnValue(makeResolvedStatus({ project: "api", directory: "/tmp/api", state: "partial", reason: "root pane closed" }));
    expect(loadProjectRow("api")).toMatchObject({ name: "api", directory: "/tmp/api", state: "partial", reason: "root pane closed" });
    expect(readProjectStatus).toHaveBeenCalledWith("api");
    readProjectStatus.mockReturnValue(makeResolvedStatus({ project: "api", directory: "/tmp/api", state: "unknown", uptime: null, reason: "unverified launch" }));
    expect(loadProjectRow("api")).toMatchObject({ name: "api", state: "unknown", reason: "unverified launch" });
    readProjectStatus.mockReturnValue(null);
    expect(loadProjectRow("web")).toMatchObject({ name: "web", directory: "/tmp/web", state: "stopped" });
    expect(loadProjectRow("nope")).toBeUndefined();
    expect(readAllStatuses).not.toHaveBeenCalled();
  });
});

describe("FE-H1: a row is never wider than the terminal", () => {
  const long = "empty Rex session remains; run summon clean myapp ".repeat(4);
  const rows: ProjectRow[] = [
    makeRow({ state: "stopped", reason: long }),
    makeRow({ state: "partial", reason: long, programStatus: "blocked" }),
    makeRow({ state: "unknown", directory: `/tmp/${"d".repeat(200)}` }),
    makeRow({ state: "active-long", gitBranch: `feature/${"b".repeat(200)}`, programStatus: "working" }),
  ];
  for (const width of [60, 80, 120]) {
    it(`truncated rows fill exactly ${width} columns`, () => {
      for (const row of rows) {
        for (const selected of [false, true]) {
          const text = visibleText(renderRow(row, width, selected));
          expect(getDisplayWidth(text)).toBe(width);
        }
      }
    });
  }
  it("FE-L1: rows with emoji, ZWJ and NFD text still fill exactly the width", () => {
    const tricky = [
      makeRow({ name: "caf\u0065\u0301-\u2728", gitBranch: `feat/\u2728\u{1F468}\u200D\u{1F469}\u200D\u{1F467}-${"x".repeat(80)}` }),
      makeRow({ state: "stopped", directory: `/Users/me/Cafe\u0301/\u{20BB7}${"d".repeat(80)}`, programStatus: "done" }),
    ];
    for (const width of [60, 80, 120]) {
      for (const row of tricky) expect(getDisplayWidth(visibleText(renderRow(row, width, false)))).toBe(width);
    }
  });
  it("FE-L2: the picker form drops only the leading pad, so the glyph column stays aligned", () => {
    for (const width of [60, 80, 120]) {
      const plain = visibleText(renderRow(makeRow({ gitBranch: "b".repeat(200) }), width, false, { leadingPad: false }));
      const glyph = visibleText(renderRow(makeRow({ gitBranch: "b".repeat(200), programStatus: "blocked" }), width, false, { leadingPad: false }));
      expect(getDisplayWidth(plain)).toBe(width);
      expect(getDisplayWidth(glyph)).toBe(width);
      expect(plain.indexOf("\u25CF")).toBe(1);
      expect(glyph.indexOf("\u25CF")).toBe(1);
      expect(plain.indexOf("myapp")).toBe(glyph.indexOf("myapp"));
      expect(plain.slice(1)).toBe(visibleText(renderRow(makeRow({ gitBranch: "b".repeat(200) }), width + 1, false)).slice(2));
    }
  });
  it("keeps the detail column at column 42", () => {
    const text = visibleText(renderRow(makeRow({ gitBranch: `feature/${"b".repeat(200)}` }), 80, false));
    expect(text.indexOf("feature/")).toBe(42);
  });
  it("--once prints the full reason exactly when the detail column cuts it off", async () => {
    const columns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    const fits = "f".repeat(38);
    const cut = "c".repeat(39);
    listProjects.mockReturnValue([["fits", "/tmp/fits"], ["cut", "/tmp/cut"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "fits", directory: "/tmp/fits", state: "stopped", uptime: null, reason: fits }),
      makeResolvedStatus({ project: "cut", directory: "/tmp/cut", state: "stopped", uptime: null, reason: cut }),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await printStatusOnce();
    } finally {
      Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
    }
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();
    expect(lines.some((l) => l.includes(`reason: ${cut}`))).toBe(true);
    expect(lines.some((l) => l.includes(`reason: ${fits}`))).toBe(false);
  });
});

describe("monitor interaction (FE-M1, FE-M2, UX-L1)", () => {
  const tty = useMonitorTty(() => {
    readAllStatuses.mockReturnValue([]);
    mockLaunch.mockReset();
    mockLaunch.mockResolvedValue(undefined);
    mockFocusWorkspace.mockClear();
  });
  const { frames } = tty;

  it("FE-M1: Enter acts on the highlighted project after a refresh reorders the rows", async () => {
    listProjects.mockReturnValue([["alpha", "/tmp/alpha"], ["beta", "/tmp/beta"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", directory: "/tmp/alpha", state: "active", uptime: 1000 }),
      makeResolvedStatus({ project: "beta", directory: "/tmp/beta", state: "stopped", uptime: null }),
    ]);
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("j")); // beta
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "alpha", directory: "/tmp/alpha", state: "stopped", uptime: null }),
      makeResolvedStatus({ project: "beta", directory: "/tmp/beta", state: "active", uptime: 1000 }),
    ]);
    vi.advanceTimersByTime(3100); // rows are now [beta, alpha]
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();
    expect(mockFocusWorkspace).toHaveBeenCalledWith("beta");
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("FE-M2: Esc dismisses the help overlay, does nothing on the dashboard, and keeps the next key", async () => {
    listProjects.mockReturnValue([["alpha", "/tmp/alpha"]]);
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    expect(frames().at(-1)).toContain("Key bindings");
    process.stdin.emit("data", Buffer.from("\x1b"));
    vi.advanceTimersByTime(150);
    expect(frames().at(-1)).toContain("summon status");
    process.stdin.emit("data", Buffer.from("\x1b"));
    vi.advanceTimersByTime(150);
    expect(frames().at(-1)).toContain("summon status");
    expect(mockLaunch).not.toHaveBeenCalled();
    process.stdin.emit("data", Buffer.from("q"));
    const quit = process.stdin.listenerCount("data") === 0; // q reached the dashboard and quit
    if (!quit) process.stdin.emit("data", Buffer.from("\x03"));
    await monitorPromise;
    expect(quit).toBe(true);
  });

  it("UX-L1: help explains partial, unknown and the program-status glyphs", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    const help = frames().at(-1) ?? "";
    process.stdin.emit("data", Buffer.from("\x03"));
    await monitorPromise;
    expect(help).toMatch(/●.*partial/);
    expect(help).toMatch(/○.*unknown/);
    for (const [glyph, word] of [["⚠", "blocked"], ["✗", "error"], ["⋯", "working"], ["✓", "done"]]) {
      expect(help).toMatch(new RegExp(`${glyph}.*${word}`));
    }
    expect(help).toContain("idle");
    // The help screen fits the narrowest supported terminal.
    for (const line of visibleText(help).split("\n")) {
      expect(getDisplayWidth(line)).toBeLessThanOrEqual(60);
    }
  });
});

describe("PE-H1: a slow status read never blocks the monitor", () => {
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const row = (name: string, state: ProjectRow["state"]) => makeRow({ name, directory: `/tmp/${name}`, state, gitBranch: "—" });
  function deferred() {
    let resolve!: (rows: ProjectRow[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ProjectRow[]>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const tty = useMonitorTty(() => { readAllStatuses.mockReset().mockReturnValue([]); });
  const { frames } = tty;

  it("handles keys and resize while a read is in flight, and never starts a second read", async () => {
    const reads: Array<ReturnType<typeof deferred>> = [];
    const loadRows = vi.fn(() => { const read = deferred(); reads.push(read); return read.promise; });
    const monitorPromise = runMonitor({ loadRows });
    reads[0]!.resolve([row("alpha", "active"), row("beta", "stopped")]);
    await settle();
    expect(frames().at(-1)).toContain("alpha");

    await vi.advanceTimersByTimeAsync(3100); // the tick starts a read that does not answer yet
    expect(loadRows).toHaveBeenCalledTimes(2);
    process.stdin.emit("data", Buffer.from("?"));
    expect(frames().at(-1)).toContain("Key bindings"); // the key was handled and drawn during the read
    process.stdin.emit("data", Buffer.from(" "));
    expect(frames().at(-1)).toContain("alpha");
    tty.writeSpy.mockClear();
    process.emit("SIGWINCH");
    const repaint = String(tty.writeSpy.mock.calls.at(-1)?.[0]);
    expect(repaint.startsWith("\x1b[H\x1b[2J") && repaint.includes("alpha")).toBe(true); // resize repaints at once

    await vi.advanceTimersByTimeAsync(9000); // three more ticks while the read is in flight
    process.stdin.emit("data", Buffer.from("r"));
    expect(loadRows).toHaveBeenCalledTimes(2);

    reads[1]!.resolve([row("beta", "active"), row("alpha", "stopped"), row("gamma", "stopped")]);
    await settle();
    expect(frames().at(-1)).toContain("gamma");
    await vi.advanceTimersByTimeAsync(3000);
    expect(loadRows).toHaveBeenCalledTimes(3);
    reads[2]!.resolve([]);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
  });

  it("a failed read keeps the rows on screen and the next tick reads again", async () => {
    const reads: Array<ReturnType<typeof deferred>> = [];
    const loadRows = vi.fn(() => { const read = deferred(); reads.push(read); return read.promise; });
    const monitorPromise = runMonitor({ loadRows });
    reads[0]!.resolve([row("alpha", "active")]);
    await settle();
    await vi.advanceTimersByTimeAsync(3100);
    reads[1]!.reject(new Error("status read timed out"));
    await settle();
    expect(frames().at(-1)).toContain("alpha");
    await vi.advanceTimersByTimeAsync(3000);
    expect(loadRows).toHaveBeenCalledTimes(3);
    reads[2]!.resolve([]);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
  });

  it("marks the rows stale: updating while a read runs past a tick, the age after a failed read", async () => {
    const reads: Array<ReturnType<typeof deferred>> = [];
    const loadRows = vi.fn(() => { const read = deferred(); reads.push(read); return read.promise; });
    const monitorPromise = runMonitor({ loadRows });
    reads[0]!.resolve([row("alpha", "active")]);
    await settle();
    await vi.advanceTimersByTimeAsync(3000); // a read starts
    expect(frames().at(-1)).not.toContain("updating");
    await vi.advanceTimersByTimeAsync(3000); // it has run for a whole tick
    expect(frames().at(-1)).toContain("updating\u2026");
    reads[1]!.reject(new Error("rex failed"));
    await settle();
    expect(frames().at(-1)).toContain("last updated 6s ago");
    await vi.advanceTimersByTimeAsync(3000); // the next read runs; the age keeps counting
    expect(frames().at(-1)).toContain("last updated 9s ago");
    reads[2]!.resolve([row("alpha", "active")]);
    await settle();
    expect(frames().at(-1)).not.toMatch(/updating|last updated/);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
  });

  it("stops the read in flight on quit", async () => {
    const signals: AbortSignal[] = [];
    const reads: Array<ReturnType<typeof deferred>> = [];
    const loadRows = vi.fn((signal: AbortSignal) => { signals.push(signal); const read = deferred(); reads.push(read); return read.promise; });
    const monitorPromise = runMonitor({ loadRows });
    reads[0]!.resolve([row("alpha", "active")]);
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(signals[1]!.aborted).toBe(false);
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;
    expect(signals[1]!.aborted).toBe(true);
  });

  it("stops the read in flight before the Enter handoff launches", async () => {
    const signals: AbortSignal[] = [];
    const reads: Array<ReturnType<typeof deferred>> = [];
    const loadRows = vi.fn((signal: AbortSignal) => { signals.push(signal); const read = deferred(); reads.push(read); return read.promise; });
    let abortedAtLaunch: boolean | undefined;
    mockLaunch.mockReset().mockImplementation(async () => { abortedAtLaunch = signals[1]!.aborted; });
    const monitorPromise = runMonitor({ loadRows });
    reads[0]!.resolve([row("alpha", "stopped")]);
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/alpha");
    expect(abortedAtLaunch).toBe(true);
  });

  it("the child's JSON gives the same rows as the in-process read, for Ghostty and Rex rows", async () => {
    listProjects.mockReturnValue([["ghost", "/tmp/ghost"], ["rexa", "/tmp/rexa"], ["rexb", "/tmp/rexb"], ["idle", "/tmp/idle"]]);
    const rex = { server: "unix:///tmp/rex.sock", sessionId: "session:1", rootBlockId: "block:1", blocks: [{ name: "editor", blockId: "block:1" }] };
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "ghost", directory: "/tmp/ghost", state: "active", uptime: 60_000 }),
      makeResolvedStatus({ project: "rexa", directory: "/tmp/rexa", backend: "rex", rex, state: "active", uptime: 5 * 3_600_000, liveBlocks: ["editor"], programStatus: { state: "blocked", kind: "permission" }, notices: ["adopted earlier launch"] }),
      makeResolvedStatus({ project: "rexb", directory: "/tmp/rexb", backend: "rex", rex, state: "unknown", uptime: null, reason: "server unreachable" }),
      makeResolvedStatus({ project: "orphan", directory: "/tmp/orphan", backend: "rex", state: "partial", uptime: 1000, reason: "root pane closed" }),
    ]);
    let wire = "";
    tty.writeSpy.mockImplementation((data: unknown) => { wire += String(data); return true; });
    await monitorRead.writeMonitorRead({});
    expect(readAllStatuses).toHaveBeenLastCalledWith({ programStatus: true });
    expect(seedRexBinaryPath).not.toHaveBeenCalled();
    expect(monitorModule.rowsFromStatuses(JSON.parse(wire))).toEqual(loadProjectRows());
  });

  it("the child uses the rex binary its parent resolved, when the parent passed one", async () => {
    seedRexBinaryPath.mockClear();
    tty.writeSpy.mockImplementation(() => true);
    await monitorRead.writeMonitorRead({ [monitorRead.MONITOR_REX_BINARY_ENV]: "/opt/rex/bin/rex" });
    expect(seedRexBinaryPath).toHaveBeenCalledWith("/opt/rex/bin/rex");
    seedRexBinaryPath.mockClear();
    await monitorRead.writeMonitorRead({ [monitorRead.MONITOR_REX_BINARY_ENV]: "" });
    expect(seedRexBinaryPath).not.toHaveBeenCalled();
  });

  it("the CLI entry answers the hidden flag the monitor starts its child with, from the one constant", async () => {
    const { readFileSync } = await import("node:fs");
    const entry = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
    expect(monitorModule.MONITOR_READ_ARG).toBe(monitorRead.MONITOR_READ_ARG);
    expect(entry).toMatch(/\{ MONITOR_READ_ARG, writeMonitorRead \} = await import\("\.\/monitor-read\.js"\)/);
    expect(entry).toContain("=== MONITOR_READ_ARG");
    expect(entry).not.toContain(JSON.stringify(monitorRead.MONITOR_READ_ARG));
    expect(entry).toContain("writeMonitorRead()");
  });
});

describe("PE-H1: readStatusesInChild", () => {
  let dir = "";
  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    dir = mkdtempSync(join(tmpdir(), "summon-monitor-read-"));
  });
  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  });
  async function script(body: string): Promise<string> {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const file = join(dir, `child-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(file, body);
    return file;
  }

  it("resolves the child's statuses while the event loop keeps running", async () => {
    const file = await script(`setTimeout(() => process.stdout.write(JSON.stringify([{ project: "a", args: process.argv.slice(2) }])), 300);`);
    const order: string[] = [];
    setTimeout(() => order.push("timer"), 20);
    const statuses = await monitorModule.readStatusesInChild(process.execPath, [file, "--flag"]);
    order.push("read");
    expect(order).toEqual(["timer", "read"]);
    expect(statuses).toEqual([{ project: "a", args: ["--flag"] }]);
  });

  it("rejects a child that fails or prints something other than JSON", async () => {
    await expect(monitorModule.readStatusesInChild(process.execPath, [await script("process.exit(4);")])).rejects.toThrow(/4/);
    await expect(monitorModule.readStatusesInChild(process.execPath, [await script("process.stdout.write('nope');")])).rejects.toThrow();
  });

  it("in the CLI the monitor reads through a child of this Summon started with the hidden flag", async () => {
    const { registerSelfInvocation, clearSelfInvocation } = await import("./self.js");
    const status = makeResolvedStatus({ project: "alpha", directory: "/tmp/alpha", state: "stopped", uptime: null, reason: "read in the child" });
    const file = await script(`if (process.argv.slice(2).join(" ") !== ${JSON.stringify(monitorModule.MONITOR_READ_ARG)}) process.exit(3); process.stdout.write(${JSON.stringify(JSON.stringify([status]))});`);
    listProjects.mockReturnValue([["alpha", "/tmp/alpha"]]);
    readAllStatuses.mockClear();
    hasRexState.mockReturnValue(true);
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => { writes.push(String(data)); return true; });
    const resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    stubTtyStdin();
    registerSelfInvocation(process.execPath, file);
    try {
      const monitorPromise = runMonitor();
      await vi.waitFor(() => expect(process.stdin.listenerCount("data")).toBeGreaterThan(0), { timeout: 5000 });
      expect(writes.join("")).toContain("read in the child");
      expect(readAllStatuses).not.toHaveBeenCalled();
      process.stdin.emit("data", Buffer.from("q"));
      await monitorPromise;
    } finally {
      clearSelfInvocation();
      hasRexState.mockReturnValue(false);
      writeSpy.mockRestore();
      resumeSpy.mockRestore();
      process.stdin.removeAllListeners("data");
      process.removeAllListeners("SIGWINCH");
    }
  });

  async function monitorThroughChild(body: string, rex: boolean): Promise<{ result: Promise<void>; writes: string[]; restore: () => void }> {
    const { registerSelfInvocation, clearSelfInvocation } = await import("./self.js");
    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => { writes.push(String(data)); return true; });
    const resumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    stubTtyStdin();
    hasRexState.mockReturnValue(rex);
    registerSelfInvocation(process.execPath, await script(body));
    const result = runMonitor();
    return {
      result, writes,
      restore: () => {
        clearSelfInvocation();
        hasRexState.mockReturnValue(false);
        writeSpy.mockRestore();
        resumeSpy.mockRestore();
        process.stdin.removeAllListeners("data");
        process.removeAllListeners("SIGWINCH");
      },
    };
  }

  it("without Rex state the CLI reads in-process, exactly as before (no child per tick)", async () => {
    listProjects.mockReturnValue([["ghost", "/tmp/ghost"]]);
    readAllStatuses.mockReset().mockReturnValue([makeResolvedStatus({ project: "ghost", directory: "/tmp/ghost", state: "active", uptime: 60_000 })]);
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const ran = join(dir, "ran");
    const monitor = await monitorThroughChild(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(ran)}, "");`, false);
    try {
      expect(process.stdin.listenerCount("data")).toBeGreaterThan(0); // entered at once, synchronously
      expect(readAllStatuses).toHaveBeenCalledWith({ programStatus: true });
      expect(monitor.writes.join("")).toContain("ghost");
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
      expect(existsSync(ran)).toBe(false);
    } finally { monitor.restore(); readAllStatuses.mockReset().mockReturnValue([]); }
  });

  /** A child body that records each run in `file` and prints `statuses`. */
  function countingChild(file: string, statuses: unknown[]): string {
    return `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(file)}, "read\\n");
process.stdout.write(${JSON.stringify(JSON.stringify(statuses))});`;
  }
  async function runsOf(file: string): Promise<number> {
    const { readFileSync, existsSync } = await import("node:fs");
    return existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean).length : 0;
  }

  it("a Ghostty-only start reads in-process until Rex state appears on disk; the very next read runs in the child, never in-process", async () => {
    const { join } = await import("node:path");
    listProjects.mockReturnValue([["ghost", "/tmp/ghost"], ["rexa", "/tmp/rexa"]]);
    readAllStatuses.mockReset().mockReturnValue([makeResolvedStatus({ project: "ghost", directory: "/tmp/ghost", state: "active", uptime: 60_000 })]);
    hasRexState.mockClear();
    const runs = join(dir, "runs");
    const child = makeResolvedStatus({ project: "rexa", directory: "/tmp/rexa", backend: "rex", state: "stopped", uptime: null, reason: "read in the child" });
    const monitor = await monitorThroughChild(countingChild(runs, [child]), false);
    try {
      process.stdin.emit("data", Buffer.from("r"));
      expect(readAllStatuses).toHaveBeenCalledTimes(2);
      expect(hasRexState).toHaveBeenCalledTimes(2); // the file-only check before each in-process read
      // A Rex launch writes its manifest and record: the next read goes to the child, the in-process read never sees it.
      hasRexState.mockReturnValue(true);
      process.stdin.emit("data", Buffer.from("r"));
      await vi.waitFor(async () => expect(await runsOf(runs)).toBe(1), { timeout: 5000 });
      await vi.waitFor(() => expect(monitor.writes.join("")).toContain("read in the child"), { timeout: 5000 });
      expect(readAllStatuses).toHaveBeenCalledTimes(2);
      // In child mode the scan is skipped: a read that lists a Rex status keeps the next read in the child.
      process.stdin.emit("data", Buffer.from("r"));
      await vi.waitFor(async () => expect(await runsOf(runs)).toBe(2), { timeout: 5000 });
      expect(hasRexState).toHaveBeenCalledTimes(3);
      expect(readAllStatuses).toHaveBeenCalledTimes(2);
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
    } finally { monitor.restore(); readAllStatuses.mockReset().mockReturnValue([]); }
  });

  it("a child read without Rex statuses moves the next read back to the file check, then in-process", async () => {
    const { join } = await import("node:path");
    listProjects.mockReturnValue([["ghost", "/tmp/ghost"]]);
    readAllStatuses.mockReset().mockReturnValue([makeResolvedStatus({ project: "ghost", directory: "/tmp/ghost", state: "stopped", uptime: null, reason: "read in-process" })]);
    const runs = join(dir, "runs");
    const child = makeResolvedStatus({ project: "ghost", directory: "/tmp/ghost", state: "stopped", uptime: null, reason: "read in the child" });
    const monitor = await monitorThroughChild(countingChild(runs, [child]), true);
    try {
      await vi.waitFor(() => expect(monitor.writes.join("")).toContain("read in the child"), { timeout: 5000 });
      expect(readAllStatuses).not.toHaveBeenCalled();
      hasRexState.mockReturnValue(false); // the Rex state is gone from disk
      process.stdin.emit("data", Buffer.from("r"));
      expect(readAllStatuses).toHaveBeenCalledTimes(1);
      expect(monitor.writes.join("")).toContain("read in-process");
      expect(await runsOf(runs)).toBe(1);
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
    } finally { monitor.restore(); readAllStatuses.mockReset().mockReturnValue([]); }
  });

  it("without a rex binary in the parent, an inherited SUMMON_MONITOR_REX_BINARY never reaches the child", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    listProjects.mockReturnValue([["rexa", "/tmp/rexa"]]);
    rexBinaryPath.mockClear().mockReturnValue(null);
    vi.stubEnv(monitorRead.MONITOR_REX_BINARY_ENV, "/tmp/not-rex");
    const seen = join(dir, "seen");
    const status = makeResolvedStatus({ project: "rexa", directory: "/tmp/rexa", backend: "rex", state: "stopped", uptime: null });
    const body = `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(seen)}, String(process.env[${JSON.stringify(monitorRead.MONITOR_REX_BINARY_ENV)}]) + "\\n");
process.stdout.write(${JSON.stringify(JSON.stringify([status]))});`;
    const monitor = await monitorThroughChild(body, true);
    try {
      await vi.waitFor(() => expect(existsSync(seen)).toBe(true), { timeout: 5000 });
      expect(readFileSync(seen, "utf-8")).toBe("undefined\n");
      await vi.waitFor(() => expect(process.stdin.listenerCount("data")).toBeGreaterThan(0), { timeout: 5000 });
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
    } finally { monitor.restore(); vi.unstubAllEnvs(); }
  });

  it("the parent resolves the rex binary once and hands it to every child read", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    listProjects.mockReturnValue([["rexa", "/tmp/rexa"]]);
    rexBinaryPath.mockClear().mockReturnValue("/opt/rex/bin/rex");
    const seen = join(dir, "seen");
    const status = makeResolvedStatus({ project: "rexa", directory: "/tmp/rexa", backend: "rex", state: "stopped", uptime: null });
    const body = `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(seen)}, process.env[${JSON.stringify(monitorRead.MONITOR_REX_BINARY_ENV)}] + "\\n");
process.stdout.write(${JSON.stringify(JSON.stringify([status]))});`;
    const lines = () => (existsSync(seen) ? readFileSync(seen, "utf-8").split("\n").filter(Boolean) : []);
    const monitor = await monitorThroughChild(body, true);
    try {
      await vi.waitFor(() => expect(lines()).toHaveLength(1), { timeout: 5000 });
      await vi.waitFor(() => expect(process.stdin.listenerCount("data")).toBeGreaterThan(0), { timeout: 5000 });
      process.stdin.emit("data", Buffer.from("r"));
      await vi.waitFor(() => expect(lines()).toHaveLength(2), { timeout: 5000 });
      expect(lines()).toEqual(["/opt/rex/bin/rex", "/opt/rex/bin/rex"]);
      expect(rexBinaryPath).toHaveBeenCalledTimes(1);
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
    } finally { monitor.restore(); rexBinaryPath.mockReturnValue(null); }
  });

  it("on start, a child that exits with a failure falls back to one in-process read", async () => {
    listProjects.mockReturnValue([["alpha", "/tmp/alpha"]]);
    readAllStatuses.mockReset().mockReturnValue([makeResolvedStatus({ project: "alpha", directory: "/tmp/alpha", state: "stopped", uptime: null, reason: "read in-process" })]);
    const monitor = await monitorThroughChild("process.exit(3);", true);
    try {
      await vi.waitFor(() => expect(process.stdin.listenerCount("data")).toBeGreaterThan(0), { timeout: 5000 });
      expect(monitor.writes.join("")).toContain("read in-process");
      process.stdin.emit("data", Buffer.from("q"));
      await monitor.result;
    } finally { monitor.restore(); readAllStatuses.mockReset().mockReturnValue([]); }
  });

  it("on start, a child ended by a signal is never read again in-process", async () => {
    readAllStatuses.mockClear();
    const monitor = await monitorThroughChild(`process.kill(process.pid, "SIGKILL");`, true);
    try {
      await expect(monitor.result).rejects.toThrow(/SIGKILL/);
      expect(readAllStatuses).not.toHaveBeenCalled();
    } finally { monitor.restore(); }
  });

  it("an abort kills the child's whole process group, so a running grandchild dies too", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const pids = join(dir, "pids");
    const file = await script(`import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pids)}, process.pid + " " + grandchild.pid); setTimeout(() => {}, 60000);`);
    const controller = new AbortController();
    const read = monitorModule.readStatusesInChild(process.execPath, [file], controller.signal);
    await vi.waitFor(() => expect(existsSync(pids)).toBe(true), { timeout: 5000 });
    const [child, grandchild] = readFileSync(pids, "utf-8").split(" ").map(Number);
    controller.abort();
    await expect(read).rejects.toThrow(/SIGTERM/);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    expect(alive(child!)).toBe(false);
    await vi.waitFor(() => expect(alive(grandchild!)).toBe(false), { timeout: 5000 });
  });
});
