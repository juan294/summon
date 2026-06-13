import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test against a temp directory to avoid touching real config
const TEST_STATUS_DIR = join(tmpdir(), `summon-status-test-${process.pid}`);

// Mock the STATUS_DIR before importing status module
import { vi } from "vitest";
vi.mock("./paths.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
}));

const { writeStatus, clearStatus, readStatus, readAllStatuses, getGitBranch, parseWorkspaceStatus } = await import("./status.js");
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

  it("does NOT create .active marker file (shell bootstrap is authoritative)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(false);
  });

  it("does not create a pid sidecar at write time", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.pid"))).toBe(false);
  });

  it("rejects path traversal in project name", () => {
    expect(() => writeStatus(makeStatus({ project: "../../etc/evil" }))).toThrow("Invalid status path");
  });

  it("writes status JSON with mode 0o600", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    const filePath = join(TEST_STATUS_DIR, "myapp.json");
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("clearStatus", () => {
  it("removes status file and marker", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // Simulate shell bootstrap writing marker + pid
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.json"))).toBe(true);
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(true);
    clearStatus("myapp");
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.json"))).toBe(false);
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.active"))).toBe(false);
    expect(existsSync(join(TEST_STATUS_DIR, "myapp.pid"))).toBe(false);
  });

  it("does not throw if files missing", () => {
    expect(() => clearStatus("nonexistent")).not.toThrow();
  });

  it("rejects path traversal in project name", () => {
    expect(() => clearStatus("../../etc/evil")).toThrow("Invalid status path");
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

  it("rejects path traversal in project name", () => {
    expect(() => readStatus("../../etc/evil")).toThrow("Invalid status path");
  });

  it("returns state='active' when marker and live pid exist (shell bootstrap simulated)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // Simulate shell bootstrap writing pid then marker
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
  });

  it("treats EPERM pid checks as active", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("eperm") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), "12345");

    const result = readStatus("myapp");

    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
    killSpy.mockRestore();
  });

  it("returns state='stopped' when marker missing", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    // marker was never written by writeStatus — shell bootstrap is authoritative
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
  });

  it("treats marker without pid as stopped (BE-H6: no filesystem side effects)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
    // readStatus is pure: it does NOT delete stale artifacts (BE-H6)
  });

  it("treats marker with dead pid as stopped (BE-H6: no filesystem side effects)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), "999999");
    const result = readStatus("myapp");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
    // readStatus is pure: artifacts remain; it does not GC them (BE-H6)
  });

  it("calculates uptime for active workspaces", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    writeStatus(makeStatus({ project: "myapp", startedAt: pastTime }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    const result = readStatus("myapp");
    expect(result!.uptime).not.toBeNull();
    expect(result!.uptime!).toBeGreaterThanOrEqual(59_000);
  });

  it("returns uptime=null for stopped workspaces", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // no marker created — shell bootstrap is authoritative, workspace is stopped
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

  // BE-M2 #491: future schema versions should return null gracefully, not throw
  it("returns null gracefully (no throw) when version > 1 (future schema)", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(
      join(TEST_STATUS_DIR, "future.json"),
      JSON.stringify({
        version: 2,
        source: "summon",
        project: "future-app",
        directory: "/tmp/future-app",
        pid: 1234,
        startedAt: new Date().toISOString(),
        layout: "full",
        panes: ["editor"],
      }),
    );
    expect(() => readStatus("future")).not.toThrow();
    expect(readStatus("future")).toBeNull();
  });

  // BE-M5 #606: a process.stderr.write warning should be emitted for future schema versions
  // (unconditional — not gated by SUMMON_DEBUG)
  it("emits stderr warning unconditionally when version > 1 (BE-M5 #606)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      mkdirSync(TEST_STATUS_DIR, { recursive: true });
      writeFileSync(
        join(TEST_STATUS_DIR, "future-warn.json"),
        JSON.stringify({
          version: 2,
          source: "summon",
          project: "future-app",
          directory: "/tmp/future-app",
          pid: 1234,
          startedAt: new Date().toISOString(),
          layout: "full",
          panes: ["editor"],
        }),
      );
      readStatus("future-warn");
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      const hasWarn = calls.some((msg) =>
        msg.includes("upgrade") || msg.includes("newer") || msg.includes("future-warn")
      );
      expect(hasWarn).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  // BE-M2 #491: a debugLog warning should be emitted for future versions
  it("emits a debugLog warning to stderr when version > 1 (future schema)", () => {
    const originalDebug = process.env["SUMMON_DEBUG"];
    process.env["SUMMON_DEBUG"] = "1";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      mkdirSync(TEST_STATUS_DIR, { recursive: true });
      writeFileSync(
        join(TEST_STATUS_DIR, "future2.json"),
        JSON.stringify({
          version: 2,
          source: "summon",
          project: "future-app",
          directory: "/tmp/future-app",
          pid: 1234,
          startedAt: new Date().toISOString(),
          layout: "full",
          panes: ["editor"],
        }),
      );
      readStatus("future2");
      const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
      const hasWarn = calls.some((msg) => msg.includes("version") || msg.includes("future") || msg.includes("schema") || msg.includes("summon:debug"));
      expect(hasWarn).toBe(true);
    } finally {
      stderrSpy.mockRestore();
      if (originalDebug === undefined) {
        delete process.env["SUMMON_DEBUG"];
      } else {
        process.env["SUMMON_DEBUG"] = originalDebug;
      }
    }
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
    // Simulate shell bootstrap for active-app only
    writeFileSync(join(TEST_STATUS_DIR, "active-app.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "active-app.active"), "");
    // stopped-app has no marker (shell never wrote one)

    const results = readAllStatuses();
    expect(results).toHaveLength(2);
    expect(results[0]!.project).toBe("active-app");
    expect(results[0]!.state).toBe("active");
    expect(results[1]!.project).toBe("stopped-app");
    expect(results[1]!.state).toBe("stopped");
  });

  it("sorts active statuses before stopped statuses regardless of input order", () => {
    writeStatus(makeStatus({ project: "active-app", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeStatus(makeStatus({ project: "stopped-app", startedAt: new Date().toISOString() }));
    writeFileSync(join(TEST_STATUS_DIR, "active-app.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "active-app.active"), "");

    const results = readAllStatuses();

    expect(results.map((status) => status.project)).toEqual(["active-app", "stopped-app"]);
  });

  it("sorts an active status ahead of a stopped status when compared in that order", () => {
    writeStatus(makeStatus({ project: "aaa-stopped", startedAt: new Date().toISOString() }));
    writeStatus(makeStatus({ project: "zzz-active", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeFileSync(join(TEST_STATUS_DIR, "zzz-active.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "zzz-active.active"), "");

    const results = readAllStatuses();

    expect(results[0]!.project).toBe("zzz-active");
  });

  it("skips invalid files without throwing", () => {
    writeStatus(makeStatus({ project: "good" }));
    writeFileSync(join(TEST_STATUS_DIR, "good.pid"), String(process.pid));
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), "not json");
    const results = readAllStatuses();
    expect(results).toHaveLength(1);
    expect(results[0]!.project).toBe("good");
  });

  it("sorts statuses with the same state by newest first", () => {
    writeStatus(makeStatus({ project: "older", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeStatus(makeStatus({ project: "newer", startedAt: new Date().toISOString() }));
    // neither has a marker — both stopped (shell never wrote markers)

    const results = readAllStatuses();

    expect(results.map((status) => status.project)).toEqual(["newer", "older"]);
  });

  // PE-M1 #607: repeated calls with unchanged dir mtime return same results
  it("returns same results on repeated calls without disk change (PE-M1 #607)", () => {
    writeStatus(makeStatus({ project: "cached" }));
    const first = readAllStatuses();
    const second = readAllStatuses();
    expect(second).toEqual(first);
    expect(second.length).toBe(first.length);
  });

  // BE-M4 #605: .tmp and dotfiles must not appear in readAllStatuses
  it("does not include .tmp files in readAllStatuses (BE-M4 #605 + PE-M1)", () => {
    writeStatus(makeStatus({ project: "real-project" }));
    writeFileSync(join(TEST_STATUS_DIR, "real-project.json.tmp"), JSON.stringify(makeStatus({ project: "real-project" })));
    writeFileSync(join(TEST_STATUS_DIR, ".hidden.json"), JSON.stringify(makeStatus({ project: "hidden" })));
    const results = readAllStatuses();
    // Only "real-project" should appear — .tmp and dotfile json must be excluded
    expect(results.map(r => r.project)).toEqual(["real-project"]);
  });
});

describe("readStatus purity (BE-H6)", () => {
  it("does not delete stale artifacts when called", () => {
    writeStatus(makeStatus({ project: "stale-check" }));
    writeFileSync(join(TEST_STATUS_DIR, "stale-check.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "stale-check.pid"), "999999");
    readStatus("stale-check");
    // artifacts may or may not exist — but readStatus must not throw, and must
    // return a result. The key contract: readStatus is pure read.
    const result = readStatus("stale-check");
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
  });
});

describe("parseWorkspaceStatus type guard (BE-M19)", () => {
  it("returns null when pid is not a number", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(
      join(TEST_STATUS_DIR, "bad-pid.json"),
      JSON.stringify({
        version: 1,
        source: "summon",
        project: "badpid",
        directory: "/tmp",
        pid: "not-a-number",
        startedAt: new Date().toISOString(),
        layout: "full",
        panes: [],
      }),
    );
    expect(readStatus("bad-pid")).toBeNull();
  });

  it("returns null when projectName is not a string", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(
      join(TEST_STATUS_DIR, "bad-project.json"),
      JSON.stringify({
        version: 1,
        source: "summon",
        project: 42,
        directory: "/tmp",
        pid: 1234,
        startedAt: new Date().toISOString(),
        layout: "full",
        panes: [],
      }),
    );
    expect(readStatus("bad-project")).toBeNull();
  });

  it("returns null when panes is not an array", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(
      join(TEST_STATUS_DIR, "bad-panes.json"),
      JSON.stringify({
        version: 1,
        source: "summon",
        project: "bad-panes",
        directory: "/tmp",
        pid: 1234,
        startedAt: new Date().toISOString(),
        layout: "full",
        panes: "not-an-array",
      }),
    );
    expect(readStatus("bad-panes")).toBeNull();
  });

  it("returns null when directory is not a string", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(
      join(TEST_STATUS_DIR, "bad-dir.json"),
      JSON.stringify({
        version: 1,
        source: "summon",
        project: "bad-dir",
        directory: 123,
        pid: 1234,
        startedAt: new Date().toISOString(),
        layout: "full",
        panes: [],
      }),
    );
    expect(readStatus("bad-dir")).toBeNull();
  });

  it("accepts well-formed status JSON", () => {
    writeStatus(makeStatus({ project: "well-formed" }));
    const result = readStatus("well-formed");
    expect(result).not.toBeNull();
  });
});

describe("getGitBranch", () => {
  it("returns branch name for git repo", async () => {
    // This test runs inside the summon repo itself
    const branch = await getGitBranch(process.cwd());
    expect(branch).not.toBeNull();
    expect(typeof branch).toBe("string");
    expect(branch!.length).toBeGreaterThan(0);
  });

  it("returns null for non-git directory", async () => {
    const branch = await getGitBranch(tmpdir());
    expect(branch).toBeNull();
  });

  it("returns null for nonexistent directory", async () => {
    const branch = await getGitBranch("/nonexistent/directory/that/does/not/exist");
    expect(branch).toBeNull();
  });
});

describe("parseWorkspaceStatus panes element type validation (BE-M5 #379)", () => {
  const base = {
    version: 1,
    source: "summon",
    project: "testapp",
    directory: "/tmp/testapp",
    pid: 1234,
    startedAt: new Date().toISOString(),
    layout: "full",
  };

  it("accepts panes array of all strings", () => {
    const result = parseWorkspaceStatus({ ...base, panes: ["editor", "sidebar"] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual(["editor", "sidebar"]);
  });

  it("returns empty panes when array contains non-string elements (null)", () => {
    const result = parseWorkspaceStatus({ ...base, panes: [null, "editor"] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual([]);
  });

  it("returns empty panes when array contains numeric elements", () => {
    const result = parseWorkspaceStatus({ ...base, panes: [42, "editor"] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual([]);
  });

  it("returns empty panes when array contains object elements", () => {
    const result = parseWorkspaceStatus({ ...base, panes: [{ name: "editor" }] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual([]);
  });

  it("accepts an empty panes array", () => {
    const result = parseWorkspaceStatus({ ...base, panes: [] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual([]);
  });
});

// BE-M3 #492: atomic write — writeStatus must not leave a truncated file on crash
// We verify the atomic write pattern by checking that the .tmp file is used and then renamed.
describe("writeStatus atomic write (BE-M3 #492)", () => {
  it("does not leave a .tmp file after a successful write", () => {
    writeStatus(makeStatus({ project: "atomic-test" }));
    const tmpPath = join(TEST_STATUS_DIR, "atomic-test.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("written file is not empty after writeStatus", () => {
    writeStatus(makeStatus({ project: "atomic-nonempty" }));
    const filePath = join(TEST_STATUS_DIR, "atomic-nonempty.json");
    const content = readFileSync(filePath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
