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
  prefetchGitBranches, truncate,
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
    const screen = renderScreen(rows, 25, 80, 10, 20);
    expect(screen).toContain("project-25");
    expect(screen).not.toContain("project-0");
    expect(screen).toContain("project-25");
  });

  it("scrolls to show selected row in middle of list (scrollStart passed explicitly)", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ name: `project-${i}` }),
    );
    // Height 10 = 4 chrome + 6 visible rows; scrollStart=12 puts project-15 in view
    const screen = renderScreen(rows, 15, 80, 10, 12);
    expect(screen).toContain("project-1");
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
    // Unknown project second (no status found)
    expect(rows[1]!.name).toBe("api");
    expect(rows[1]!.state).toBe("unknown");

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

  it("prints empty message when no projects", () => {
    printStatusOnce();
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("No projects registered.");
    expect(output).toContain("summon add <name> <path>");
    expect(output).toContain("summon setup");
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

  it("opens the selected project on Enter", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));
    await monitorPromise;
    await vi.dynamicImportSettled();

    const allWrites = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(allWrites).toContain("Opening myapp...");
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/myapp");
  });

  it("FE-H4: prints launch feedback line BEFORE exiting alt-screen on Enter", async () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");

    // Track all writes in order to verify feedback appears before EXIT_ALT_SCREEN
    const allWrites: string[] = [];
    writeSpy.mockImplementation((s: unknown) => {
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
    // After the fix, feedback appears BEFORE alt-screen exit
    expect(feedbackIdx).toBeLessThan(exitIdx);
  });

  it("UX-M5: does NOT exit on launch failure — shows in-TUI error and continues (replaces old exit test)", async () => {
    // Old behavior: exit(1) on failure. New behavior: show error in TUI, allow user to continue.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
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
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
    ]);
    getGitBranch.mockReturnValue("main");
    mockLaunch.mockRejectedValueOnce(new Error("osascript error"));

    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("\r"));  // trigger launch (fails)
    await vi.dynamicImportSettled();
    process.stdin.emit("data", Buffer.from(" "));   // dismiss error screen
    process.stdin.emit("data", Buffer.from("q"));   // quit TUI
    await monitorPromise;

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(output).toContain("Key bindings");
  });

  it("#481 FE-L1: help overlay contains color legend with yellow and active", async () => {
    const monitorPromise = runMonitor();
    process.stdin.emit("data", Buffer.from("?"));
    process.stdin.emit("data", Buffer.from(" "));
    process.stdin.emit("data", Buffer.from("q"));
    await monitorPromise;

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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
      makeResolvedStatus({ project: "myapp", state: "active", uptime: 60_000 }),
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

    const output = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
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

  it("shows the standard empty-state message including 'summon add' and 'summon setup'", () => {
    printStatusOnce();
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
