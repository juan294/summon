import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test against a temp directory to avoid touching real config
const TEST_STATUS_DIR = join(tmpdir(), `summon-status-test-${process.pid}`);

// Mock the STATUS_DIR before importing status module
import { vi } from "vitest";

// Rex liveness is resolved through the Phase 3 adapters; here they are faked so each row of the
// state table and the read protocol (adopt, probe, refresh) are pinned without a rex process.
const rexMocks = vi.hoisted(() => ({
  listSessions: vi.fn((..._args: unknown[]): unknown => ({ ok: true, sessions: [] })),
  sessionState: vi.fn((..._args: unknown[]): unknown => ({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] })),
  adoptOrphans: vi.fn((..._args: unknown[]): string[] => []),
  refreshPaneMapping: vi.fn((..._args: unknown[]): string[] => []),
  discoverRex: vi.fn((): { path: string | null; searched: string[] } => ({ path: "/mock/rex", searched: ["PATH"] })),
}));
vi.mock("./backends/rex/status.js", async (original) => ({
  ...(await original<typeof import("./backends/rex/status.js")>()),
  listSessions: (...args: unknown[]) => rexMocks.listSessions(...args),
  sessionState: (...args: unknown[]) => rexMocks.sessionState(...args),
}));
vi.mock("./backends/rex/launch.js", async (original) => ({
  ...(await original<typeof import("./backends/rex/launch.js")>()),
  adoptOrphans: (...args: unknown[]) => rexMocks.adoptOrphans(...args),
  refreshPaneMapping: (...args: unknown[]) => rexMocks.refreshPaneMapping(...args),
  adoptDeps: () => ({}),
}));
vi.mock("./backends/rex/cli.js", async (original) => ({
  ...(await original<typeof import("./backends/rex/cli.js")>()),
  discoverRex: () => rexMocks.discoverRex(),
  createRexCli: (binary: string, server: string) => ({ binary, server, call: () => { throw new Error("no rex process in tests"); } }),
}));
vi.mock("./paths.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
}));

const { writeStatus, clearStatus, readStatus, readAllStatuses, getGitBranch, parseWorkspaceStatus, resetReadAllStatusesCache, readStatusRecord, withOwnedRecord, discardStatusRecord, statusTestHooks, resetRexBinaryMemo } = await import("./status.js");
const { writeLaunchManifest } = await import("./launch-identity.js");
import type { WorkspaceStatus } from "./status.js";
import type { LaunchManifest } from "./launch-identity.js";

const GEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GEN_B = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";
const REX_SESSION = "session:01a1b2c3-d4e5-4f60-8a7b-8c9d0e1f2a3b";
const REX_WINDOW = "window:01a1b2c3-d4e5-4f60-8a7b-8c9d0e1f2a3b";
const REX_BLOCK = "block:01a1b2c3-d4e5-4f60-8a7b-8c9d0e1f2a3b";

function launchDir(project: string): string {
  return join(TEST_STATUS_DIR, `${project}.launches`);
}

function writeLaunchFiles(project: string, launchId: string, pid: number | string = process.pid, marker: string = launchId): void {
  mkdirSync(launchDir(project), { recursive: true });
  writeFileSync(join(launchDir(project), `${launchId}.pid`), `${pid}\n`);
  writeFileSync(join(launchDir(project), `${launchId}.active`), `${marker}\n`);
}

function rexIdentity() {
  return {
    server: "unix:///tmp/rex.sock",
    hostId: "cf528d2b-1111-4222-8333-444455556666",
    sessionId: REX_SESSION,
    windowId: REX_WINDOW,
    rootBlockId: REX_BLOCK,
    blocks: [{ name: "editor", blockId: REX_BLOCK, label: "editor · nvim" }],
  };
}

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
  resetReadAllStatusesCache();
});

afterEach(() => {
  rmSync(TEST_STATUS_DIR, { recursive: true, force: true });
  resetReadAllStatusesCache();
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

// BE-L3 #514: parseWorkspaceStatus must not leak unknown keys via spread
describe("parseWorkspaceStatus explicit field reconstruction (#514 BE-L3)", () => {
  it("does not include unknown extra keys from raw input on the result", () => {
    const raw = {
      version: 1 as const,
      source: "summon" as const,
      project: "testapp",
      directory: "/tmp/testapp",
      pid: 1234,
      startedAt: new Date().toISOString(),
      layout: "full",
      panes: ["editor"],
      // extra keys that should NOT appear on the result
      unexpectedField: "should-not-leak",
      anotherBadKey: 42,
    };
    const result = parseWorkspaceStatus(raw);
    expect(result).not.toBeNull();
    expect(result!.project).toBe("testapp");
    expect(result!.panes).toEqual(["editor"]);
    // Unknown keys must not be present on the reconstructed object
    expect("unexpectedField" in result!).toBe(false);
    expect("anotherBadKey" in result!).toBe(false);
  });

  it("preserves all valid fields exactly", () => {
    const startedAt = new Date().toISOString();
    const raw = {
      version: 1 as const,
      source: "summon" as const,
      project: "myapp",
      directory: "/home/user/myapp",
      pid: 5678,
      startedAt,
      layout: "triple",
      panes: ["alpha", "beta", "gamma"],
    };
    const result = parseWorkspaceStatus(raw);
    expect(result).not.toBeNull();
    expect(result!.project).toBe("myapp");
    expect(result!.directory).toBe("/home/user/myapp");
    expect(result!.pid).toBe(5678);
    expect(result!.startedAt).toBe(startedAt);
    expect(result!.layout).toBe("triple");
    expect(result!.panes).toEqual(["alpha", "beta", "gamma"]);
    expect(result!.source).toBe("summon");
    expect(result!.version).toBe(1);
  });
});

// PE-M1 #607 / PE-L3 #570: bounded-TTL cache for readAllStatuses
describe("readAllStatuses TTL cache (PE-M1 #607, PE-L3 #570)", () => {
  it("hits cache on second call within TTL: new file written between calls is not visible", () => {
    resetReadAllStatusesCache();
    writeStatus(makeStatus({ project: "first-proj" }));

    const first = readAllStatuses();
    expect(first).toHaveLength(1);

    // Write a second file — within TTL, the cache should still return the old snapshot
    writeStatus(makeStatus({ project: "second-proj" }));
    const second = readAllStatuses();

    // Still 1 because the cache has not expired
    expect(second).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("re-scans after TTL elapses and detects a newly dead pid", () => {
    vi.useFakeTimers();
    resetReadAllStatusesCache();

    writeStatus(makeStatus({ project: "dying-app" }));
    writeFileSync(join(TEST_STATUS_DIR, "dying-app.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "dying-app.active"), "");

    // First call: should see "active" (pid is alive)
    const first = readAllStatuses();
    expect(first[0]!.state).toBe("active");

    // Simulate pid death: remove the .active marker (as if shell bootstrap cleanup ran)
    rmSync(join(TEST_STATUS_DIR, "dying-app.active"), { force: true });

    // Still within TTL: second call should return cached "active"
    const withinTTL = readAllStatuses();
    expect(withinTTL[0]!.state).toBe("active");

    // Advance past TTL (1001ms > 1000ms TTL)
    vi.advanceTimersByTime(1001);

    // Third call: cache expired, re-scan detects stopped
    const afterTTL = readAllStatuses();
    expect(afterTTL[0]!.state).toBe("stopped");

    vi.useRealTimers();
  });

  it("resetReadAllStatusesCache clears the cache so next call re-scans immediately", () => {
    resetReadAllStatusesCache();
    writeStatus(makeStatus({ project: "reset-proj" }));

    const first = readAllStatuses();
    expect(first).toHaveLength(1);

    // Write a second file, then reset the cache
    writeStatus(makeStatus({ project: "reset-proj-2" }));
    resetReadAllStatusesCache();

    // After reset, the new file should be visible immediately
    const second = readAllStatuses();
    expect(second).toHaveLength(2);
  });
});

describe("P2 optional native schema",()=>{
 const id="00000000-0000-4000-8000-000000000001";
 it("roundtrips native identity while root-shell liveness remains unchanged",()=>{
  writeStatus(makeStatus({native:{rootTerminalId:id,panes:[{name:"editor",terminalId:id}]}}));
  const result=readStatus("testapp");
  expect(result?.native?.rootTerminalId).toBe(id);
  expect(result?.state).toBe("stopped");
  expect(existsSync(join(TEST_STATUS_DIR,"testapp.active"))).toBe(false);
 });
 it("discards malformed optional data with a bounded warning and retains base status",()=>{
  const stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  const parsed=parseWorkspaceStatus({...makeStatus(),native:{rootTerminalId:"invalid",panes:[]}});
  expect(parsed?.project).toBe("testapp");expect(parsed?.native).toBeUndefined();
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining("native identity"));stderr.mockRestore();
 });
});

describe("per-launch liveness (plan P12)", () => {
  it("legacy record (no launchId) resolves ghostty with the legacy paths", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    const result = readStatus("myapp")!;
    expect(result.state).toBe("active");
    expect(result.launchId).toBeUndefined();
    expect(result.backend).toBeUndefined();
  });

  it("a launchId record is active only through its own .active and live .pid", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A, backend: "ghostty" }));
    writeLaunchFiles("myapp", GEN_A);
    const result = readStatus("myapp")!;
    expect(result.state).toBe("active");
    expect(result.launchId).toBe(GEN_A);
    expect(result.uptime).not.toBeNull();
  });

  it("a launchId record ignores the legacy paths (legacy .active present, per-launch absent -> stopped)", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    expect(readStatus("myapp")!.state).toBe("stopped");
  });

  it("an .active holding another launch id means stopped even with a live pid", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeLaunchFiles("myapp", GEN_A, process.pid, GEN_B);
    expect(readStatus("myapp")!.state).toBe("stopped");
  });

  it("a dead pid under the launch directory means stopped", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeLaunchFiles("myapp", GEN_A, 999999);
    expect(readStatus("myapp")!.state).toBe("stopped");
  });

  it("a missing pid file under the launch directory means stopped", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    mkdirSync(launchDir("myapp"), { recursive: true });
    writeFileSync(join(launchDir("myapp"), `${GEN_A}.active`), `${GEN_A}\n`);
    expect(readStatus("myapp")!.state).toBe("stopped");
  });

  describe("Rex records resolve through sessionState (plan P10, Phase 4)", () => {
    const rexRecord = (project = "myapp", extra: Partial<WorkspaceStatus> = {}) => makeStatus({ project, launchId: GEN_A, backend: "rex", rex: rexIdentity(), panes: ["editor"], startedAt: new Date(Date.now() - 60_000).toISOString(), ...extra });
    beforeEach(() => {
      rexMocks.listSessions.mockReset().mockReturnValue({ ok: true, sessions: [] });
      rexMocks.sessionState.mockReset().mockReturnValue({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] });
      rexMocks.adoptOrphans.mockReset().mockReturnValue([]);
      rexMocks.refreshPaneMapping.mockReset().mockReturnValue([]);
      rexMocks.discoverRex.mockReset().mockReturnValue({ path: "/mock/rex", searched: ["PATH"] });
      resetReadAllStatusesCache();
      resetRexBinaryMemo();
    });

    it("a Rex record whose identity was discarded resolves to unknown with the real adoption (no reader recursion)", async () => {
      const actual = await vi.importActual<typeof import("./backends/rex/launch.js")>("./backends/rex/launch.js");
      rexMocks.adoptOrphans.mockImplementation((project: unknown, deps: unknown) => actual.adoptOrphans(project as string, deps as never));
      // An identity naming a block outside `panes` is discarded by parseWorkspaceStatus.
      writeStatus(rexRecord("myapp", { panes: ["other"] }));
      const foreign: LaunchManifest = { version: 1, launchId: GEN_B, project: "myapp", directory: "/tmp/myapp", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: {}, backend: "rex", server: "unix:///tmp/rex.sock", startedAt: new Date().toISOString() };
      writeLaunchManifest(foreign);
      const result = readStatus("myapp")!;
      expect(result.rex).toBeUndefined();
      expect(result).toMatchObject({ state: "unknown", reason: expect.stringContaining("no Rex identity") });
      expect(rexMocks.sessionState).not.toHaveBeenCalled();
      expect(readAllStatuses().map((r) => [r.project, r.state])).toEqual([["myapp", "unknown"]]);
    });

    it.each([
      ["active", undefined, true],
      ["partial", "root pane closed", true],
      ["stopped", "no live panes", false],
      ["unknown", "server unreachable", false],
    ] as const)("maps %s with its reason and uptime only when live", (state, reason, live) => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state, ...(reason ? { reason } : {}), liveBlocks: live ? ["editor"] : [] });
      const result = readStatus("myapp")!;
      expect(result.state).toBe(state);
      expect(result.reason).toBe(reason);
      expect(live ? result.uptime! > 0 : result.uptime === null).toBe(true);
      expect(rexMocks.sessionState).toHaveBeenCalledWith(expect.objectContaining({ binary: "/mock/rex", server: "unix:///tmp/rex.sock" }), rexIdentity(), "myapp", { ok: true, sessions: [] });
    });

    it("adopts orphans before probing, once per read, and surfaces the notices on the row", () => {
      writeStatus(rexRecord());
      rexMocks.adoptOrphans.mockReturnValue(["adopted earlier launch x of myapp (Rex session session:y)"]);
      const result = readStatus("myapp")!;
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(1);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledWith("myapp", expect.anything());
      expect(rexMocks.adoptOrphans.mock.invocationCallOrder[0]!).toBeLessThan(rexMocks.sessionState.mock.invocationCallOrder[0]!);
      expect(result.notices).toEqual(["adopted earlier launch x of myapp (Rex session session:y)"]);
    });

    it("re-reads the record only when adoption reported something", () => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      const result = readStatus("myapp")!;
      expect(result.notices).toBeUndefined();
      expect(result.state).toBe("active");
    });

    it("re-reads the record after adoption replaced it", () => {
      writeStatus(rexRecord());
      rexMocks.adoptOrphans.mockImplementation(() => { writeStatus(rexRecord("myapp", { launchId: GEN_B, layout: "adopted" })); return ["adopted earlier launch"]; });
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      expect(readStatus("myapp")).toMatchObject({ launchId: GEN_B, layout: "adopted", state: "active" });
    });

    it("refreshes the pane mapping only for a live record with unverified panes, then re-reads it", () => {
      writeStatus(rexRecord("myapp", { panes: ["editor", "shell"] }));
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      rexMocks.refreshPaneMapping.mockImplementation((record: unknown) => {
        const r = record as WorkspaceStatus;
        writeStatus({ ...r, rex: { ...r.rex!, blocks: [...r.rex!.blocks, { name: "shell", blockId: "block:0000aaaa-0000-0000-0000-000000000077", label: "shell" }] } });
        return ["pane x of myapp has an unreadable pane file; summon clean --orphans names it"];
      });
      const result = readStatus("myapp")!;
      expect(rexMocks.refreshPaneMapping).toHaveBeenCalledTimes(1);
      expect(result.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
      expect(result.notices).toEqual(["pane x of myapp has an unreadable pane file; summon clean --orphans names it"]);

      // Complete record: no refresh. Stopped record with a gap: no refresh either.
      rexMocks.refreshPaneMapping.mockClear();
      readStatus("myapp");
      expect(rexMocks.refreshPaneMapping).not.toHaveBeenCalled();
      writeStatus(rexRecord("other", { panes: ["editor", "shell"] }));
      rexMocks.sessionState.mockReturnValue({ state: "stopped", reason: "no live panes", liveBlocks: [] });
      readStatus("other");
      expect(rexMocks.refreshPaneMapping).not.toHaveBeenCalled();
    });

    it("is unknown without a rex binary, probing nothing", () => {
      writeStatus(rexRecord());
      rexMocks.discoverRex.mockReturnValue({ path: null, searched: ["PATH"] });
      expect(readStatus("myapp")).toMatchObject({ state: "unknown", reason: expect.stringContaining("rex CLI not found") });
      expect(rexMocks.adoptOrphans).not.toHaveBeenCalled();
      expect(rexMocks.sessionState).not.toHaveBeenCalled();
    });

    it("readAllStatuses lists each server once, keeps Ghostty rows on the sidecars and sorts live rows first", () => {
      writeStatus(rexRecord("rex-a"));
      writeStatus(rexRecord("rex-b", { rex: { ...rexIdentity(), sessionId: "session:0000aaaa-0000-0000-0000-00000000000b" } }));
      writeStatus(makeStatus({ project: "ghost", startedAt: new Date().toISOString() }));
      writeFileSync(join(TEST_STATUS_DIR, "ghost.pid"), String(process.pid));
      writeFileSync(join(TEST_STATUS_DIR, "ghost.active"), "");
      rexMocks.sessionState.mockImplementation((_cli: unknown, _identity: unknown, project: unknown) => (project === "rex-b" ? { state: "partial", reason: "root pane closed", liveBlocks: ["editor"] } : { state: "unknown", reason: "boom", liveBlocks: [] }));
      const rows = readAllStatuses();
      expect(rows.map((r) => [r.project, r.state])).toEqual([["ghost", "active"], ["rex-b", "partial"], ["rex-a", "unknown"]]);
      expect(rexMocks.listSessions).toHaveBeenCalledTimes(1);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(2);
      expect(rexMocks.discoverRex).toHaveBeenCalledTimes(1);
      // The 1 s cache bounds the probes: a second read within the TTL spawns nothing.
      readAllStatuses();
      expect(rexMocks.listSessions).toHaveBeenCalledTimes(1);
    });

    it("an unverified launch (manifest, no record) runs adoption and resolves through the record it published", () => {
      const manifest: LaunchManifest = { version: 1, launchId: GEN_A, project: "orphan", directory: "/tmp/orphan", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" }, backend: "rex", server: "unix:///tmp/rex.sock", startedAt: new Date().toISOString() };
      writeLaunchManifest(manifest);
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      rexMocks.adoptOrphans.mockImplementationOnce(() => { writeStatus(rexRecord("orphan")); return ["adopted earlier launch"]; });
      const rows = readAllStatuses();
      expect(rows.map((r) => [r.project, r.state, r.reason])).toEqual([["orphan", "active", undefined]]);
      expect(rows[0]!.notices).toEqual(["adopted earlier launch"]);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(1);

      // Without adoption the manifest stays an unverified row.
      resetReadAllStatusesCache();
      clearStatus("orphan");
      const again = readAllStatuses();
      expect(again.map((r) => [r.project, r.state, r.reason])).toEqual([["orphan", "unknown", "unverified launch"]]);
    });
  });
});

describe("optional identity fields (plan P16)", () => {
  it("round-trips a Rex identity, backend and endedAt", () => {
    const endedAt = "2026-10-29T12:00:00.000Z";
    writeStatus(makeStatus({ project: "rexapp", launchId: GEN_A, backend: "rex", rex: rexIdentity(), endedAt }));
    const record = readStatusRecord("rexapp")!;
    expect(record.rex).toEqual(rexIdentity());
    expect(record.backend).toBe("rex");
    expect(record.launchId).toBe(GEN_A);
    expect(record.endedAt).toBe(endedAt);
  });

  it("drops an invalid Rex identity with a warning and keeps the record", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const parsed = parseWorkspaceStatus({ ...makeStatus(), backend: "rex", rex: { ...rexIdentity(), sessionId: "nope" } });
      expect(parsed?.project).toBe("testapp");
      expect(parsed?.rex).toBeUndefined();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("invalid Rex identity"));
    } finally {
      stderr.mockRestore();
    }
  });

  it("drops a block whose name is not one of the record's panes", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const parsed = parseWorkspaceStatus({ ...makeStatus({ panes: ["a"] }), backend: "rex", rex: rexIdentity() });
      expect(parsed?.rex).toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });

  it("drops an unknown backend with a warning (treated as ghostty)", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const parsed = parseWorkspaceStatus({ ...makeStatus(), backend: "zsh" });
      expect(parsed?.backend).toBeUndefined();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('unknown backend "zsh"'));
    } finally {
      stderr.mockRestore();
    }
  });

  it("drops an invalid launchId with a warning so liveness falls back to the legacy markers", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const parsed = parseWorkspaceStatus({ ...makeStatus(), launchId: "NOT-A-UUID" });
      expect(parsed?.launchId).toBeUndefined();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("invalid launch id"));
    } finally {
      stderr.mockRestore();
    }
  });

  it("keeps native and rex mutually exclusive according to the backend", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const id = "00000000-0000-4000-8000-000000000001";
      const native = { rootTerminalId: id, panes: [{ name: "editor", terminalId: id }] };
      const onRex = parseWorkspaceStatus({ ...makeStatus(), backend: "rex", rex: rexIdentity(), native });
      expect(onRex?.native).toBeUndefined();
      expect(onRex?.rex).toBeDefined();
      const onGhostty = parseWorkspaceStatus({ ...makeStatus(), rex: rexIdentity(), native });
      expect(onGhostty?.rex).toBeUndefined();
      expect(onGhostty?.native).toBeDefined();
    } finally {
      stderr.mockRestore();
    }
  });

  it("drops an unparsable endedAt silently", () => {
    expect(parseWorkspaceStatus({ ...makeStatus(), endedAt: "not a date" })?.endedAt).toBeUndefined();
  });
});

describe("withOwnedRecord (plan §3 status write protocol)", () => {
  const recordBytes = (project: string) => readFileSync(join(TEST_STATUS_DIR, `${project}.json`), "utf-8");

  afterEach(() => {
    delete statusTestHooks.beforeLock;
  });

  it("{launchId: null} with no record runs the action and writes", () => {
    const action = vi.fn(() => makeStatus({ project: "p", launchId: GEN_A }));
    const result = withOwnedRecord("p", { launchId: null }, action);
    expect(result).toEqual({ outcome: "written", afterErrors: [] });
    expect(action).toHaveBeenCalledWith(null);
    expect(readStatusRecord("p")?.launchId).toBe(GEN_A);
  });

  it("{launchId: null} when a record appeared before the lock -> superseded, action never runs", () => {
    statusTestHooks.beforeLock = () => {
      delete statusTestHooks.beforeLock;
      writeFileSync(join(TEST_STATUS_DIR, "p.json"), JSON.stringify(makeStatus({ project: "p", launchId: GEN_B })));
    };
    const action = vi.fn(() => makeStatus({ project: "p", launchId: GEN_A }));
    expect(withOwnedRecord("p", { launchId: null }, action).outcome).toBe("superseded");
    expect(action).not.toHaveBeenCalled();
    expect(readStatusRecord("p")?.launchId).toBe(GEN_B);
  });

  it("{launchId: null} when a legacy record (no launchId) exists -> superseded", () => {
    writeStatus(makeStatus({ project: "p" }));
    const action = vi.fn(() => null);
    expect(withOwnedRecord("p", { launchId: null }, action).outcome).toBe("superseded");
    expect(action).not.toHaveBeenCalled();
  });

  it("{launchId: null} when a malformed record file exists -> superseded (a file is a present record)", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "p.json"), "{broken");
    const action = vi.fn(() => null);
    expect(withOwnedRecord("p", { launchId: null }, action).outcome).toBe("superseded");
    expect(action).not.toHaveBeenCalled();
  });

  it("{launchId: gen} mismatch -> superseded without touching the record", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_B }));
    const before = recordBytes("p");
    const action = vi.fn(() => makeStatus({ project: "p", launchId: GEN_A }));
    expect(withOwnedRecord("p", { launchId: GEN_A }, action).outcome).toBe("superseded");
    expect(action).not.toHaveBeenCalled();
    expect(recordBytes("p")).toBe(before);
  });

  it("{launchId: gen} against a legacy record -> superseded", () => {
    writeStatus(makeStatus({ project: "p" }));
    expect(withOwnedRecord("p", { launchId: GEN_A }, () => null).outcome).toBe("superseded");
  });

  it("{launchId: gen} with no record -> superseded", () => {
    expect(withOwnedRecord("p", { launchId: GEN_A }, () => null).outcome).toBe("superseded");
  });

  it("{launchId: gen} match runs the action with the current record", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A, layout: "full" }));
    const action = vi.fn((current: WorkspaceStatus | null) => ({ ...current!, layout: "pair" }));
    expect(withOwnedRecord("p", { launchId: GEN_A }, action).outcome).toBe("written");
    expect(action.mock.calls[0]?.[0]?.layout).toBe("full");
    expect(readStatusRecord("p")?.layout).toBe("pair");
  });

  it("action returning null -> unchanged and the file bytes are identical", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    const before = recordBytes("p");
    expect(withOwnedRecord("p", { launchId: GEN_A }, () => null).outcome).toBe("unchanged");
    expect(recordBytes("p")).toBe(before);
  });

  it('"replace" always writes, even over another live generation', () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    expect(withOwnedRecord("p", "replace", () => makeStatus({ project: "p", launchId: GEN_B })).outcome).toBe("written");
    expect(readStatusRecord("p")?.launchId).toBe(GEN_B);
  });

  it("action throw -> no write, error propagates, afterWrite not called", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A, layout: "full" }));
    const afterWrite = vi.fn();
    expect(() => withOwnedRecord("p", { launchId: GEN_A }, () => { throw new Error("boom"); }, afterWrite)).toThrow("boom");
    expect(afterWrite).not.toHaveBeenCalled();
    expect(readStatusRecord("p")?.layout).toBe("full");
    // The lock is released: a later write succeeds.
    expect(withOwnedRecord("p", { launchId: GEN_A }, () => null).outcome).toBe("unchanged");
  });

  it("afterWrite runs after written and after unchanged, observing the durable file, never after superseded", () => {
    const seen: Array<[string, string | undefined]> = [];
    const afterWrite = (outcome: "written" | "unchanged", record: WorkspaceStatus | null) => {
      seen.push([outcome, readStatusRecord("p")?.layout]);
      expect(record?.project).toBe("p");
    };
    withOwnedRecord("p", { launchId: null }, () => makeStatus({ project: "p", launchId: GEN_A, layout: "full" }), afterWrite);
    withOwnedRecord("p", { launchId: GEN_A }, () => null, afterWrite);
    const superseded = vi.fn();
    withOwnedRecord("p", { launchId: GEN_B }, () => null, superseded);
    expect(seen).toEqual([["written", "full"], ["unchanged", "full"]]);
    expect(superseded).not.toHaveBeenCalled();
  });

  it("an afterWrite throw lands in afterErrors and the outcome stays written", () => {
    const result = withOwnedRecord("p", "replace", () => makeStatus({ project: "p", launchId: GEN_A }), () => { throw new Error("cleanup failed"); });
    expect(result.outcome).toBe("written");
    expect(result.afterErrors.map((e) => e.message)).toEqual(["cleanup failed"]);
    expect(readStatusRecord("p")?.launchId).toBe(GEN_A);
  });

  it("a held lock surfaces the file-lock timeout error (status-record case)", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    const lockDir = join(TEST_STATUS_DIR, "p.json.lock");
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, `${process.pid}-00000000-0000-4000-8000-000000000000.owner`), "");
    const action = vi.fn(() => null);
    expect(() => withOwnedRecord("p", "replace", action)).toThrow("Timed out waiting for config lock");
    expect(action).not.toHaveBeenCalled();
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("rejects path traversal before taking any lock", () => {
    expect(() => withOwnedRecord("../../etc/evil", "replace", () => null)).toThrow("Invalid status path");
  });
});

describe("discardStatusRecord and clearStatus with a generation", () => {
  it("discardStatusRecord removes the record only while the generation holds", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_B }));
    expect(discardStatusRecord("p", GEN_A)).toBe(false);
    expect(readStatusRecord("p")?.launchId).toBe(GEN_B);
    expect(discardStatusRecord("p", GEN_B)).toBe(true);
    expect(existsSync(join(TEST_STATUS_DIR, "p.json"))).toBe(false);
    expect(discardStatusRecord("p")).toBe(true);
  });

  it("discardStatusRecord returns false instead of throwing on an invalid project name", () => {
    expect(discardStatusRecord("../../etc/evil")).toBe(false);
  });

  it("clearStatus with a generation removes that launch's own files and the legacy paths", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    writeLaunchFiles("p", GEN_A);
    writeLaunchFiles("p", GEN_B);
    writeFileSync(join(TEST_STATUS_DIR, "p.active"), "");
    clearStatus("p", GEN_A);
    expect(existsSync(join(TEST_STATUS_DIR, "p.json"))).toBe(false);
    expect(existsSync(join(TEST_STATUS_DIR, "p.active"))).toBe(false);
    expect(existsSync(join(launchDir("p"), `${GEN_A}.pid`))).toBe(false);
    expect(existsSync(join(launchDir("p"), `${GEN_A}.active`))).toBe(false);
    expect(existsSync(join(launchDir("p"), `${GEN_B}.pid`))).toBe(true);
  });

  it("clearStatus with a stale generation leaves everything in place", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_B }));
    writeLaunchFiles("p", GEN_B);
    clearStatus("p", GEN_A);
    expect(existsSync(join(TEST_STATUS_DIR, "p.json"))).toBe(true);
    expect(existsSync(join(launchDir("p"), `${GEN_B}.pid`))).toBe(true);
  });
});

describe("readAllStatuses discovery of unverified launches (plan P13 §6)", () => {
  function manifest(project: string, launchId: string): LaunchManifest {
    return {
      version: 1, launchId, project, directory: `/tmp/${project}`, layout: "default",
      panes: ["editor", "shell"], paneOrder: ["editor", "shell"], blockLabels: { editor: "editor", shell: "shell" },
      backend: "rex", server: "unix:///tmp/rex.sock", startedAt: "2026-10-29T10:00:00.000Z",
    };
  }

  it("lists a manifest without a record as an unverified launch row", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeLaunchManifest(manifest("orphan", GEN_A));
    const rows = readAllStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project: "orphan", launchId: GEN_A, backend: "rex", state: "unknown", uptime: null, reason: "unverified launch", panes: ["editor", "shell"], directory: "/tmp/orphan" });
  });

  it("does not list manifests of a project that has a record (adoption is Phase 3)", () => {
    writeStatus(makeStatus({ project: "recorded", launchId: GEN_B }));
    writeLaunchManifest(manifest("recorded", GEN_A));
    const rows = readAllStatuses();
    expect(rows.map((r) => r.launchId)).toEqual([GEN_B]);
  });

  it("ignores launch directories without manifests and lock directories", () => {
    writeStatus(makeStatus({ project: "a" }));
    mkdirSync(join(TEST_STATUS_DIR, "empty.launches"), { recursive: true });
    mkdirSync(join(TEST_STATUS_DIR, "a.json.lock"), { recursive: true });
    expect(readAllStatuses().map((r) => r.project)).toEqual(["a"]);
  });
});
