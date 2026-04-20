import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Test against a temp directory to avoid touching real config
const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-snapshots-test-${process.pid}`);

// Mock the SNAPSHOTS_DIR before importing snapshot module
vi.mock("./config.js", () => ({
  SNAPSHOTS_DIR: TEST_SNAPSHOTS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
}));

const {
  saveSnapshot,
  readSnapshot,
  clearSnapshot,
  formatTimeSince,
  formatRestorationBanner,
} = await import("./snapshot.js");
import type { ContextSnapshot } from "./snapshot.js";

function makeSnapshot(overrides?: Partial<ContextSnapshot>): ContextSnapshot {
  return {
    project: "testapp",
    directory: "/tmp/testapp",
    timestamp: new Date().toISOString(),
    layout: "full",
    git: {
      branch: "main",
      dirty: ["src/index.ts", "README.md"],
      recentCommits: ["abc1234 first commit", "def5678 second commit"],
    },
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
});

describe("saveSnapshot", () => {
  it("creates snapshots directory if missing", () => {
    expect(existsSync(TEST_SNAPSHOTS_DIR)).toBe(false);
    // saveSnapshot needs a real git repo - use the project's own repo
    const result = saveSnapshot("testproject", process.cwd(), "full");
    if (result) {
      expect(existsSync(TEST_SNAPSHOTS_DIR)).toBe(true);
    }
  });

  it("saves valid JSON to correct path", () => {
    const result = saveSnapshot("myapp", process.cwd(), "minimal");
    // Skip if not in a git repo
    if (!result) return;
    const filePath = join(TEST_SNAPSHOTS_DIR, "myapp.json");
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.project).toBe("myapp");
    expect(data.layout).toBe("minimal");
    expect(data.version).toBe(1);
    expect(data.git.branch).toBeTruthy();
  });

  it("captures git branch", () => {
    const result = saveSnapshot("myapp", process.cwd(), "full");
    if (!result) return;
    expect(result.git.branch).toBeTruthy();
    expect(typeof result.git.branch).toBe("string");
  });

  it("captures recent commits", () => {
    const result = saveSnapshot("myapp", process.cwd(), "full");
    if (!result) return;
    expect(result.git.recentCommits.length).toBeGreaterThan(0);
    expect(result.git.recentCommits.length).toBeLessThanOrEqual(3);
  });

  it("returns null for non-git directory", () => {
    const result = saveSnapshot("myapp", tmpdir(), "full");
    expect(result).toBeNull();
  });

  it("rejects path traversal in project name", () => {
    expect(() => saveSnapshot("../../etc/evil", process.cwd(), "full")).toThrow("Invalid snapshot path");
  });

  it("rejects path traversal with leading dot-dot", () => {
    expect(() => saveSnapshot("../outside", process.cwd(), "full")).toThrow("Invalid snapshot path");
  });

  it("includes ISO timestamp", () => {
    const result = saveSnapshot("myapp", process.cwd(), "full");
    if (!result) return;
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(Date.parse(result.timestamp)).not.toBeNaN();
  });
});

describe("readSnapshot", () => {
  it("returns null for missing project", () => {
    expect(readSnapshot("nonexistent")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "bad.json"), "not json{{{");
    expect(readSnapshot("bad")).toBeNull();
  });

  it("rejects files with wrong version", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "bad.json"), JSON.stringify({ version: 99 }));
    expect(readSnapshot("bad")).toBeNull();
  });

  it("rejects path traversal in project name", () => {
    expect(() => readSnapshot("../../etc/evil")).toThrow("Invalid snapshot path");
  });

  it("reads a previously saved snapshot", () => {
    const saved = saveSnapshot("roundtrip", process.cwd(), "pair");
    if (!saved) return;
    const read = readSnapshot("roundtrip");
    expect(read).not.toBeNull();
    expect(read!.project).toBe("roundtrip");
    expect(read!.layout).toBe("pair");
    expect(read!.version).toBe(1);
    expect(read!.git.branch).toBe(saved.git.branch);
  });

});

describe("clearSnapshot", () => {
  it("removes snapshot file and returns true", () => {
    const saved = saveSnapshot("clearme", process.cwd(), "full");
    if (!saved) return;
    expect(existsSync(join(TEST_SNAPSHOTS_DIR, "clearme.json"))).toBe(true);
    const result = clearSnapshot("clearme");
    expect(result).toBe(true);
    expect(existsSync(join(TEST_SNAPSHOTS_DIR, "clearme.json"))).toBe(false);
  });

  it("returns false when snapshot does not exist", () => {
    expect(clearSnapshot("nonexistent")).toBe(false);
  });

  it("rejects path traversal in project name", () => {
    expect(() => clearSnapshot("../../etc/evil")).toThrow("Invalid snapshot path");
  });

});

describe("formatTimeSince", () => {
  it("formats minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeSince(fiveMinAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatTimeSince(threeHoursAgo)).toBe("3h ago");
  });

  it("formats yesterday", () => {
    const yesterdayMs = Date.now() - 30 * 3_600_000; // 30 hours ago
    const yesterday = new Date(yesterdayMs).toISOString();
    expect(formatTimeSince(yesterday)).toBe("yesterday");
  });

  it("formats days ago", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(formatTimeSince(fiveDaysAgo)).toBe("5 days ago");
  });

  it("formats 0m ago for just now", () => {
    const now = new Date().toISOString();
    expect(formatTimeSince(now)).toBe("0m ago");
  });

  it("returns 'unknown' for invalid timestamp", () => {
    expect(formatTimeSince("not-a-date")).toBe("unknown");
  });
});

describe("formatRestorationBanner", () => {
  it("includes project name", () => {
    const snap = makeSnapshot({ project: "myproject" });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("myproject");
  });

  it("includes branch name", () => {
    const snap = makeSnapshot({ git: { branch: "feature/test", dirty: [], recentCommits: [] } });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("feature/test");
  });

  it("includes modified files", () => {
    const snap = makeSnapshot({
      git: { branch: "main", dirty: ["file1.ts", "file2.ts"], recentCommits: [] },
    });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("file1.ts");
    expect(banner).toContain("file2.ts");
  });

  it("truncates modified files beyond 3", () => {
    const snap = makeSnapshot({
      git: {
        branch: "main",
        dirty: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        recentCommits: [],
      },
    });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("a.ts");
    expect(banner).toContain("b.ts");
    expect(banner).toContain("c.ts");
    expect(banner).toContain("+ 2 more");
    expect(banner).not.toContain("d.ts");
  });

  it("omits modified line when no dirty files", () => {
    const snap = makeSnapshot({
      git: { branch: "main", dirty: [], recentCommits: ["abc first"] },
    });
    const banner = formatRestorationBanner(snap);
    expect(banner).not.toContain("Modified:");
  });

  it("includes recent commits", () => {
    const snap = makeSnapshot({
      git: { branch: "main", dirty: [], recentCommits: ["abc1234 first", "def5678 second"] },
    });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("abc1234 first");
    expect(banner).toContain("def5678 second");
  });

  it("shows 'Welcome back to' label", () => {
    const snap = makeSnapshot();
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("Welcome back to");
  });

  it("shows 'Last session' label", () => {
    const snap = makeSnapshot();
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("Last session:");
  });
});
