import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Test against a temp directory to avoid touching real config
const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-snapshots-test-${process.pid}`);

// Mock the SNAPSHOTS_DIR before importing snapshot module
vi.mock("./paths.js", () => ({
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
  it("warns and returns null if directory does not exist", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = saveSnapshot("gone", "/nonexistent/path/that/does/not/exist", "full");
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/nonexistent/path/that/does/not/exist")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("captures dirty file paths from git status", { timeout: 15000 }, () => {
    const repoDir = join(TEST_SNAPSHOTS_DIR, "dirty-repo");
    mkdirSync(repoDir, { recursive: true });
    // Unset git env vars that the pre-commit hook injects — they'd redirect
    // these temp-repo git commands to the parent repo and break the commit.
    const gitEnv = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined };
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore", env: gitEnv });
    execFileSync("git", ["config", "user.email", "summon@example.test"], { cwd: repoDir, env: gitEnv });
    execFileSync("git", ["config", "user.name", "Summon Test"], { cwd: repoDir, env: gitEnv });
    writeFileSync(join(repoDir, "tracked.txt"), "clean\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, env: gitEnv });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "ignore", env: gitEnv });
    writeFileSync(join(repoDir, "untracked.txt"), "dirty\n");

    const result = saveSnapshot("dirty", repoDir, "full");

    expect(result).not.toBeNull();
    expect(result!.git.dirty).toEqual(["untracked.txt"]);
  });

  it("creates snapshots directory if missing", { timeout: 15000 }, () => {
    expect(existsSync(TEST_SNAPSHOTS_DIR)).toBe(false);
    // saveSnapshot needs a real git repo - use the project's own repo
    const result = saveSnapshot("testproject", process.cwd(), "full");
    if (result) {
      expect(existsSync(TEST_SNAPSHOTS_DIR)).toBe(true);
    }
  });

  it("saves valid JSON to correct path", { timeout: 15000 }, () => {
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

  it("captures git branch", { timeout: 15000 }, () => {
    const result = saveSnapshot("myapp", process.cwd(), "full");
    if (!result) return;
    expect(result.git.branch).toBeTruthy();
    expect(typeof result.git.branch).toBe("string");
  });

  it("captures recent commits", { timeout: 15000 }, () => {
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

  it("rejects sibling directory names that share the SNAPSHOTS_DIR prefix (SE-L1)", () => {
    // e.g. SNAPSHOTS_DIR = /tmp/summon-snapshots-test-<pid>
    // evil name resolves to /tmp/summon-snapshots-test-<pid>-evil/x
    // Without trailing sep guard, startsWith check could allow this
    expect(() => saveSnapshot("../snapshots-test-evil/x", process.cwd(), "full")).toThrow("Invalid snapshot path");
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

  it("returns null when a snapshot file cannot be read", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const filePath = join(TEST_SNAPSHOTS_DIR, "unreadable.json");
    writeFileSync(filePath, "{}");
    chmodSync(filePath, 0o000);
    try {
      expect(readSnapshot("unreadable")).toBeNull();
    } finally {
      chmodSync(filePath, 0o600);
    }
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

  it("warns and returns null if directory in snapshot does not exist", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const snap = makeSnapshot({ directory: "/nonexistent/path/that/does/not/exist" });
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "moved.json"), JSON.stringify(snap) + "\n", { mode: 0o600 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = readSnapshot("moved");
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/nonexistent/path/that/does/not/exist")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  // BE-M1 (#592): malformed-but-version-1 snapshots must be rejected, not passed through

  it("returns null when git is null (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { project: "p", directory: process.cwd(), timestamp: new Date().toISOString(), layout: "full", git: null, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "git-null.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("git-null")).toBeNull();
  });

  it("returns null when git.dirty is not an array (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { project: "p", directory: process.cwd(), timestamp: new Date().toISOString(), layout: "full", git: { branch: "main", dirty: "foo", recentCommits: [] }, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "dirty-string.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("dirty-string")).toBeNull();
  });

  it("returns null when git.recentCommits is missing (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { project: "p", directory: process.cwd(), timestamp: new Date().toISOString(), layout: "full", git: { branch: "main", dirty: [] }, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "no-commits.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("no-commits")).toBeNull();
  });

  it("returns null when git.branch is not a string or null (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { project: "p", directory: process.cwd(), timestamp: new Date().toISOString(), layout: "full", git: { branch: 42, dirty: [], recentCommits: [] }, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "bad-branch.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("bad-branch")).toBeNull();
  });

  it("returns null when project is missing (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { directory: process.cwd(), timestamp: new Date().toISOString(), layout: "full", git: { branch: "main", dirty: [], recentCommits: [] }, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "no-project.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("no-project")).toBeNull();
  });

  it("returns null when layout is not a string (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const bad = { project: "p", directory: process.cwd(), timestamp: new Date().toISOString(), layout: 42, git: { branch: "main", dirty: [], recentCommits: [] }, version: 1 };
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "bad-layout.json"), JSON.stringify(bad) + "\n", { mode: 0o600 });
    expect(readSnapshot("bad-layout")).toBeNull();
  });

  it("accepts git.branch as null (detached HEAD) (BE-M1)", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const snap = makeSnapshot({ directory: process.cwd(), git: { branch: null as unknown as string, dirty: [], recentCommits: [] } });
    writeFileSync(join(TEST_SNAPSHOTS_DIR, "null-branch.json"), JSON.stringify(snap) + "\n", { mode: 0o600 });
    const result = readSnapshot("null-branch");
    expect(result).not.toBeNull();
    expect(result!.git.branch).toBeNull();
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

  it("returns false when the snapshot file cannot be removed", () => {
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    const filePath = join(TEST_SNAPSHOTS_DIR, "locked.json");
    writeFileSync(filePath, "{}");
    chmodSync(TEST_SNAPSHOTS_DIR, 0o500);
    try {
      expect(clearSnapshot("locked")).toBe(false);
    } finally {
      chmodSync(TEST_SNAPSHOTS_DIR, 0o700);
      rmSync(filePath, { force: true });
    }
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

  it("returns '0m ago' for a future timestamp (clock skew / negative diff)", () => {
    const futureTimestamp = new Date(Date.now() + 10_000).toISOString();
    expect(formatTimeSince(futureTimestamp)).toBe("0m ago");
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

  it("includes a single recent commit without an arrow", () => {
    const snap = makeSnapshot({
      git: { branch: "main", dirty: [], recentCommits: ["abc1234 first"] },
    });
    const banner = formatRestorationBanner(snap);
    expect(banner).toContain("abc1234 first");
    expect(banner).not.toContain(" -> ");
  });

  it("uses ANSI colors when stdout is a TTY and NO_COLOR is unset", () => {
    const originalIsTTY = process.stdout.isTTY;
    const originalNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.NO_COLOR;
    try {
      const banner = formatRestorationBanner(makeSnapshot({ git: { branch: "main", dirty: [], recentCommits: [] } }));
      expect(banner).toContain("\x1b[32m");
      expect(banner).toContain("\x1b[2m");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
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
