import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test against a temp directory to avoid touching real config
const TEST_STATUS_DIR = join(tmpdir(), `summon-status-test-${process.pid}`);

// Mock the STATUS_DIR before importing status module
import { vi } from "vitest";
vi.mock("./config.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
}));

const { writeStatus, clearStatus, readStatus, readAllStatuses, isWorkspaceActive, cleanStaleStatuses, getGitBranch } = await import("./status.js");
import type { WorkspaceStatus } from "./status.js";

function makeStatus(overrides?: Partial<WorkspaceStatus>): WorkspaceStatus {
  return {
    project: "testapp",
    directory: "/tmp/testapp",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    layout: "full",
    panes: ["editor", "sidebar", "shell"],
    source: "summon",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rmSync(TEST_STATUS_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_STATUS_DIR, { recursive: true, force: true });
});

describe("writeStatus", () => {
  it("creates status directory if missing", () => {
    expect(existsSync(TEST_STATUS_DIR)).toBe(false);
    writeStatus(makeStatus());
    expect(existsSync(TEST_STATUS_DIR)).toBe(true);
  });

  it("writes valid JSON to correct path", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    const filePath = join(TEST_STATUS_DIR, "myapp.json");
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.project).toBe("myapp");
    expect(data.source).toBe("summon");
    expect(data.version).toBe(1);
  });

  it("overwrites existing status file", () => {
    writeStatus(makeStatus({ project: "myapp", layout: "full" }));
    writeStatus(makeStatus({ project: "myapp", layout: "minimal" }));
    const filePath = join(TEST_STATUS_DIR, "myapp.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.layout).toBe("minimal");
  });

  it("creates .active marker file", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(true);
  });
});

describe("clearStatus", () => {
  it("removes status file and marker", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.json"))).toBe(true);
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(true);
    clearStatus("myapp");
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.json"))).toBe(false);
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(false);
  });

  it("does not throw if files missing", () => {
    expect(() => clearStatus("nonexistent")).not.toThrow();
  });
});

describe("isWorkspaceActive", () => {
  it("returns true when marker exists", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    expect(isWorkspaceActive("myapp")).toBe(true);
  });

  it("returns false when marker missing", () => {
    expect(isWorkspaceActive("nonexistent")).toBe(false);
  });
});

describe("readStatus", () => {
  it("returns null for missing project", () => {
    expect(readStatus("nonexistent")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), "not json{{{");
    expect(readStatus("bad")).toBeNull();
  });

  it("returns state='active' when marker exists", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
  });

  it("returns state='stopped' when marker missing", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // Remove the marker file manually
    unlinkSync(join(TEST_STATUS_DIR, "myapp.active"));
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
  });

  it("calculates uptime for active workspaces", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    writeStatus(makeStatus({ project: "myapp", startedAt: pastTime }));
    const result = readStatus("myapp");
    expect(result!.uptime).not.toBeNull();
    expect(result!.uptime!).toBeGreaterThanOrEqual(59_000);
  });

  it("returns uptime=null for stopped workspaces", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    unlinkSync(join(TEST_STATUS_DIR, "myapp.active"));
    const result = readStatus("myapp");
    expect(result!.uptime).toBeNull();
  });

  it("rejects files with wrong version", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), JSON.stringify({ version: 99, source: "summon" }));
    expect(readStatus("bad")).toBeNull();
  });

  it("rejects files with wrong source", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), JSON.stringify({ version: 1, source: "other" }));
    expect(readStatus("bad")).toBeNull();
  });
});

describe("readAllStatuses", () => {
  it("returns empty array when no status files", () => {
    expect(readAllStatuses()).toEqual([]);
  });

  it("returns all valid statuses sorted active-first", () => {
    // Write two statuses, one active and one stopped
    writeStatus(makeStatus({ project: "stopped-app", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeStatus(makeStatus({ project: "active-app", startedAt: new Date().toISOString() }));
    // Remove marker for "stopped-app"
    unlinkSync(join(TEST_STATUS_DIR, "stopped-app.active"));

    const results = readAllStatuses();
    expect(results).toHaveLength(2);
    expect(results[0]!.project).toBe("active-app");
    expect(results[0]!.state).toBe("active");
    expect(results[1]!.project).toBe("stopped-app");
    expect(results[1]!.state).toBe("stopped");
  });

  it("skips invalid files without throwing", () => {
    writeStatus(makeStatus({ project: "good" }));
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), "not json");
    const results = readAllStatuses();
    expect(results).toHaveLength(1);
    expect(results[0]!.project).toBe("good");
  });
});

describe("cleanStaleStatuses", () => {
  it("removes stopped status files", () => {
    writeStatus(makeStatus({ project: "stale" }));
    unlinkSync(join(TEST_STATUS_DIR, "stale.active"));
    const removed = cleanStaleStatuses();
    expect(removed).toBe(1);
    expect(existsSync(join(TEST_STATUS_DIR, "stale.json"))).toBe(false);
  });

  it("preserves active status files", () => {
    writeStatus(makeStatus({ project: "alive" }));
    const removed = cleanStaleStatuses();
    expect(removed).toBe(0);
    expect(existsSync(join(TEST_STATUS_DIR, "alive.json"))).toBe(true);
  });

  it("returns count of removed files", () => {
    writeStatus(makeStatus({ project: "stale1" }));
    writeStatus(makeStatus({ project: "stale2" }));
    writeStatus(makeStatus({ project: "alive" }));
    unlinkSync(join(TEST_STATUS_DIR, "stale1.active"));
    unlinkSync(join(TEST_STATUS_DIR, "stale2.active"));
    const removed = cleanStaleStatuses();
    expect(removed).toBe(2);
  });
});

describe("getGitBranch", () => {
  it("returns branch name for git repo", () => {
    // This test runs inside the summon repo itself
    const branch = getGitBranch(process.cwd());
    expect(branch).not.toBeNull();
    expect(typeof branch).toBe("string");
    expect(branch!.length).toBeGreaterThan(0);
  });

  it("returns null for non-git directory", () => {
    const branch = getGitBranch(tmpdir());
    expect(branch).toBeNull();
  });

  it("returns null for nonexistent directory", () => {
    const branch = getGitBranch("/nonexistent/directory/that/does/not/exist");
    expect(branch).toBeNull();
  });
});
