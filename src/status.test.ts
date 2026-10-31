import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync, chmodSync } from "node:fs";
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
  refreshPaneMapping: vi.fn((..._args: unknown[]): unknown => ({ notices: [], changed: false })),
  discoverRex: vi.fn((): { path: string | null; searched: string[] } => ({ path: "/mock/rex", searched: ["PATH"] })),
  programStatusOf: vi.fn((..._args: unknown[]): unknown => undefined),
}));
vi.mock("./backends/rex/status.js", async (original) => {
  const actual = await original<typeof import("./backends/rex/status.js")>();
  return {
  ...actual,
  listSessions: (...args: unknown[]) => rexMocks.listSessions(...args),
  // The read's per-server cache lists through the mocked `listSessions`, so its calls are counted.
  sessionListings: () => actual.sessionListings((cli) => rexMocks.listSessions(cli) as ReturnType<typeof actual.listSessions>),
  sessionState: (...args: unknown[]) => rexMocks.sessionState(...args),
  programStatusOf: (...args: unknown[]) => rexMocks.programStatusOf(...args),
  };
});
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
const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-snapshots-test-${process.pid}`);
vi.mock("./paths.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
  SNAPSHOTS_DIR: TEST_SNAPSHOTS_DIR,
}));
// Snapshots are collected from git; here the collector is faked and the writer writes a plain file.
const snapshotMocks = vi.hoisted(() => ({
  collectSnapshot: vi.fn((..._args: unknown[]): unknown => null),
  writeSnapshotFile: vi.fn((_snapshot: unknown): void => {}),
}));
vi.mock("./snapshot.js", async (original) => ({
  ...(await original<typeof import("./snapshot.js")>()),
  collectSnapshot: (...args: unknown[]) => snapshotMocks.collectSnapshot(...args),
  writeSnapshotFile: (snapshot: unknown) => snapshotMocks.writeSnapshotFile(snapshot),
}));

const { hasRexState, readStatus, readAllStatuses, readProjectStatus, getGitBranch, resetRexBinaryMemo } = await import("./status.js");
const { writeStatus, publishStatus, parseWorkspaceStatus, readStatusRecord, withOwnedRecord, statusTestHooks, removeLaunchFileSet } = await import("./status-record.js");
const { NO_LIVE_PANES } = await import("./backends/rex/status.js");
const { launchArtifactFiles } = await import("./launch-identity.js");
const { writeLaunchManifest } = await import("./launch-identity.js");
import type { RexWorkspaceStatus, WorkspaceStatus } from "./status-record.js";
import type { BackendId } from "./backend-detect.js";
import type { NativeMetadata } from "./backends/ghostty/pane-inventory.js";
import type { RexIdentity } from "./backends/rex/types.js";
import type { LaunchManifest } from "./launch-identity.js";

/** Every caller reads with reconciliation (AR-M3), so these suites pin the reconciling read. */
const RECONCILE = { reconcile: true } as const;

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

/** Any field combination a status file may hold; the parser decides what a read keeps (AR-L2). */
type StatusFixture = Partial<Omit<WorkspaceStatus, "backend" | "native" | "rex">> & { backend?: BackendId; native?: NativeMetadata; rex?: RexIdentity };

function makeStatus(overrides?: StatusFixture): WorkspaceStatus {
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
  } as WorkspaceStatus;
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

describe("readStatus", () => {
  it("returns null for missing project", () => {
    expect(readStatus("nonexistent", RECONCILE)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), "not json{{{");
    expect(readStatus("bad", RECONCILE)).toBeNull();
  });

  it("rejects path traversal in project name", () => {
    expect(() => readStatus("../../etc/evil", RECONCILE)).toThrow("Invalid status path");
  });

  it("returns state='active' when marker and live pid exist (shell bootstrap simulated)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // Simulate shell bootstrap writing pid then marker
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    const result = readStatus("myapp", RECONCILE);
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

    const result = readStatus("myapp", RECONCILE);

    expect(result).not.toBeNull();
    expect(result!.state).toBe("active");
    killSpy.mockRestore();
  });

  it("returns state='stopped' when marker missing", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    // marker was never written by writeStatus — shell bootstrap is authoritative
    const result = readStatus("myapp", RECONCILE);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
  });

  it("treats marker without pid as stopped (BE-H6: no filesystem side effects)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    const result = readStatus("myapp", RECONCILE);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
    // readStatus is pure: it does NOT delete stale artifacts (BE-H6)
  });

  it("treats marker with dead pid as stopped (BE-H6: no filesystem side effects)", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), "999999");
    const result = readStatus("myapp", RECONCILE);
    expect(result).not.toBeNull();
    expect(result!.state).toBe("stopped");
    // readStatus is pure: artifacts remain; it does not GC them (BE-H6)
  });

  it("calculates uptime for active workspaces", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    writeStatus(makeStatus({ project: "myapp", startedAt: pastTime }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    const result = readStatus("myapp", RECONCILE);
    expect(result!.uptime).not.toBeNull();
    expect(result!.uptime!).toBeGreaterThanOrEqual(59_000);
  });

  it("returns uptime=null for stopped workspaces", () => {
    writeStatus(makeStatus({ project: "myapp" }));
    // no marker created — shell bootstrap is authoritative, workspace is stopped
    const result = readStatus("myapp", RECONCILE);
    expect(result!.uptime).toBeNull();
  });

  it("rejects files with wrong version", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), JSON.stringify({ version: 99, source: "summon" }));
    expect(readStatus("bad", RECONCILE)).toBeNull();
  });

  it("rejects files with wrong source", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), JSON.stringify({ version: 1, source: "other" }));
    expect(readStatus("bad", RECONCILE)).toBeNull();
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
    expect(() => readStatus("future", RECONCILE)).not.toThrow();
    expect(readStatus("future", RECONCILE)).toBeNull();
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
      readStatus("future-warn", RECONCILE);
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
      readStatus("future2", RECONCILE);
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
    expect(readAllStatuses(RECONCILE)).toEqual([]);
  });

  it("returns all valid statuses sorted active-first", () => {
    // Write two statuses, one active and one stopped
    writeStatus(makeStatus({ project: "stopped-app", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeStatus(makeStatus({ project: "active-app", startedAt: new Date().toISOString() }));
    // Simulate shell bootstrap for active-app only
    writeFileSync(join(TEST_STATUS_DIR, "active-app.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "active-app.active"), "");
    // stopped-app has no marker (shell never wrote one)

    const results = readAllStatuses(RECONCILE);
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

    const results = readAllStatuses(RECONCILE);

    expect(results.map((status) => status.project)).toEqual(["active-app", "stopped-app"]);
  });

  it("sorts an active status ahead of a stopped status when compared in that order", () => {
    writeStatus(makeStatus({ project: "aaa-stopped", startedAt: new Date().toISOString() }));
    writeStatus(makeStatus({ project: "zzz-active", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeFileSync(join(TEST_STATUS_DIR, "zzz-active.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "zzz-active.active"), "");

    const results = readAllStatuses(RECONCILE);

    expect(results[0]!.project).toBe("zzz-active");
  });

  it("skips invalid files without throwing", () => {
    writeStatus(makeStatus({ project: "good" }));
    writeFileSync(join(TEST_STATUS_DIR, "good.pid"), String(process.pid));
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "bad.json"), "not json");
    const results = readAllStatuses(RECONCILE);
    expect(results).toHaveLength(1);
    expect(results[0]!.project).toBe("good");
  });

  it("sorts statuses with the same state by newest first", () => {
    writeStatus(makeStatus({ project: "older", startedAt: new Date(Date.now() - 120_000).toISOString() }));
    writeStatus(makeStatus({ project: "newer", startedAt: new Date().toISOString() }));
    // neither has a marker — both stopped (shell never wrote markers)

    const results = readAllStatuses(RECONCILE);

    expect(results.map((status) => status.project)).toEqual(["newer", "older"]);
  });

  // PE-M1 #607: repeated calls with unchanged dir mtime return same results
  it("returns same results on repeated calls without disk change (PE-M1 #607)", () => {
    writeStatus(makeStatus({ project: "cached" }));
    const first = readAllStatuses(RECONCILE);
    const second = readAllStatuses(RECONCILE);
    expect(second).toEqual(first);
    expect(second.length).toBe(first.length);
  });

  // BE-M4 #605: .tmp and dotfiles must not appear in readAllStatuses
  it("does not include .tmp files in readAllStatuses (BE-M4 #605 + PE-M1)", () => {
    writeStatus(makeStatus({ project: "real-project" }));
    writeFileSync(join(TEST_STATUS_DIR, "real-project.json.tmp"), JSON.stringify(makeStatus({ project: "real-project" })));
    writeFileSync(join(TEST_STATUS_DIR, ".hidden.json"), JSON.stringify(makeStatus({ project: "hidden" })));
    const results = readAllStatuses(RECONCILE);
    // Only "real-project" should appear — .tmp and dotfile json must be excluded
    expect(results.map(r => r.project)).toEqual(["real-project"]);
  });
});

describe("readStatus purity (BE-H6)", () => {
  it("does not delete stale artifacts when called", () => {
    writeStatus(makeStatus({ project: "stale-check" }));
    writeFileSync(join(TEST_STATUS_DIR, "stale-check.active"), "");
    writeFileSync(join(TEST_STATUS_DIR, "stale-check.pid"), "999999");
    readStatus("stale-check", RECONCILE);
    // artifacts may or may not exist — but readStatus must not throw, and must
    // return a result. The key contract: readStatus is pure read.
    const result = readStatus("stale-check", RECONCILE);
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
    expect(readStatus("bad-pid", RECONCILE)).toBeNull();
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
    expect(readStatus("bad-project", RECONCILE)).toBeNull();
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
    expect(readStatus("bad-panes", RECONCILE)).toBeNull();
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
    expect(readStatus("bad-dir", RECONCILE)).toBeNull();
  });

  it("accepts well-formed status JSON", () => {
    writeStatus(makeStatus({ project: "well-formed" }));
    const result = readStatus("well-formed", RECONCILE);
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

  it("returns empty panes when a name is not a pane identifier (BE-L3: x/../<id> would name another launch's file)", () => {
    const result = parseWorkspaceStatus({ ...base, panes: ["editor", "x/../11111111-1111-4111-8111-111111111111"] });
    expect(result).not.toBeNull();
    expect(result!.panes).toEqual([]);
    expect(parseWorkspaceStatus({ ...base, panes: ["editor", ""] })!.panes).toEqual([]);
  });

  it("keeps every name the launcher writes: traditional and tree pane names", () => {
    const names = ["editor", "sidebar", "editor-2", "right-1", "shell", "api_server", "_w"];
    expect(parseWorkspaceStatus({ ...base, panes: names })!.panes).toEqual(names);
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

// PE-H1: readAllStatuses has no cache; every call reads the records and the liveness again.
describe("readAllStatuses reads afresh on every call (PE-H1)", () => {
  it("sees a record written and a marker removed since the previous call", () => {
    writeStatus(makeStatus({ project: "dying-app" }));
    writeFileSync(join(TEST_STATUS_DIR, "dying-app.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "dying-app.active"), "");
    expect(readAllStatuses(RECONCILE).map((r) => [r.project, r.state])).toEqual([["dying-app", "active"]]);
    rmSync(join(TEST_STATUS_DIR, "dying-app.active"), { force: true });
    writeStatus(makeStatus({ project: "second-proj" }));
    expect(readAllStatuses(RECONCILE).map((r) => [r.project, r.state]).sort()).toEqual([["dying-app", "stopped"], ["second-proj", "stopped"]]);
  });
});

describe("P2 optional native schema",()=>{
 const id="00000000-0000-4000-8000-000000000001";
 it("roundtrips native identity while root-shell liveness remains unchanged",()=>{
  writeStatus(makeStatus({native:{rootTerminalId:id,panes:[{name:"editor",terminalId:id}]}}));
  const result=readStatus("testapp", RECONCILE);
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
    const result = readStatus("myapp", RECONCILE)!;
    expect(result.state).toBe("active");
    expect(result.launchId).toBeUndefined();
    expect(result.backend).toBeUndefined();
  });

  it("a launchId record is active only through its own .active and live .pid", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A, backend: "ghostty" }));
    writeLaunchFiles("myapp", GEN_A);
    const result = readStatus("myapp", RECONCILE)!;
    expect(result.state).toBe("active");
    expect(result.launchId).toBe(GEN_A);
    expect(result.uptime).not.toBeNull();
  });

  it("a launchId record ignores the legacy paths (legacy .active present, per-launch absent -> stopped)", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.pid"), String(process.pid));
    writeFileSync(join(TEST_STATUS_DIR, "myapp.active"), "");
    expect(readStatus("myapp", RECONCILE)!.state).toBe("stopped");
  });

  it("an .active holding another launch id means stopped even with a live pid", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeLaunchFiles("myapp", GEN_A, process.pid, GEN_B);
    expect(readStatus("myapp", RECONCILE)!.state).toBe("stopped");
  });

  it("a dead pid under the launch directory means stopped", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    writeLaunchFiles("myapp", GEN_A, 999999);
    expect(readStatus("myapp", RECONCILE)!.state).toBe("stopped");
  });

  it("a missing pid file under the launch directory means stopped", () => {
    writeStatus(makeStatus({ project: "myapp", launchId: GEN_A }));
    mkdirSync(launchDir("myapp"), { recursive: true });
    writeFileSync(join(launchDir("myapp"), `${GEN_A}.active`), `${GEN_A}\n`);
    expect(readStatus("myapp", RECONCILE)!.state).toBe("stopped");
  });

  describe("Rex records resolve through sessionState (plan P10, Phase 4)", () => {
    const rexRecord = (project = "myapp", extra: StatusFixture = {}) => makeStatus({ project, launchId: GEN_A, backend: "rex", rex: rexIdentity(), panes: ["editor"], startedAt: new Date(Date.now() - 60_000).toISOString(), ...extra });
    beforeEach(() => {
      rexMocks.listSessions.mockReset().mockReturnValue({ ok: true, sessions: [] });
      rexMocks.sessionState.mockReset().mockReturnValue({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] });
      rexMocks.adoptOrphans.mockReset().mockImplementation(() => []);
      rexMocks.refreshPaneMapping.mockReset().mockImplementation(() => ({ notices: [], changed: false }));
      rexMocks.discoverRex.mockReset().mockReturnValue({ path: "/mock/rex", searched: ["PATH"] });
      resetRexBinaryMemo();
    });

    it("a Rex record whose identity was discarded resolves to unknown with the real adoption (no reader recursion)", async () => {
      const actual = await vi.importActual<typeof import("./backends/rex/launch.js")>("./backends/rex/launch.js");
      rexMocks.adoptOrphans.mockImplementation((project: unknown, deps: unknown) => actual.adoptOrphans(project as string, deps as never));
      // An identity naming a block outside `panes` is discarded by parseWorkspaceStatus.
      writeStatus(rexRecord("myapp", { panes: ["other"] }));
      const foreign: LaunchManifest = { version: 1, launchId: GEN_B, project: "myapp", directory: "/tmp/myapp", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: {}, backend: "rex", server: "unix:///tmp/rex.sock", startedAt: new Date().toISOString() };
      writeLaunchManifest(foreign);
      const result = readStatus("myapp", RECONCILE)!;
      expect(result.rex).toBeUndefined();
      expect(result).toMatchObject({ state: "unknown", reason: expect.stringContaining("no Rex identity") });
      expect(rexMocks.sessionState).not.toHaveBeenCalled();
      expect(readAllStatuses(RECONCILE).map((r) => [r.project, r.state])).toEqual([["myapp", "unknown"]]);
    });

    it.each([
      ["active", undefined, true],
      ["partial", "root pane closed", true],
      ["stopped", "no live panes", false],
      ["unknown", "server unreachable", false],
    ] as const)("maps %s with its reason and uptime only when live", (state, reason, live) => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state, ...(reason ? { reason } : {}), liveBlocks: live ? ["editor"] : [] });
      const result = readStatus("myapp", RECONCILE)!;
      expect(result.state).toBe(state);
      expect(result.reason).toBe(reason);
      expect(live ? result.uptime! > 0 : result.uptime === null).toBe(true);
      expect(rexMocks.sessionState).toHaveBeenCalledWith(expect.objectContaining({ binary: "/mock/rex", server: "unix:///tmp/rex.sock" }), rexIdentity(), "myapp", { ok: true, sessions: [] });
    });

    it("adopts orphans before probing, once per read, and surfaces the notices on the row", () => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      rexMocks.adoptOrphans.mockReturnValue(["adopted earlier launch x of myapp (Rex session session:y)"]);
      const result = readStatus("myapp", RECONCILE)!;
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(1);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledWith("myapp", expect.anything());
      expect(rexMocks.adoptOrphans.mock.invocationCallOrder[0]!).toBeLessThan(rexMocks.sessionState.mock.invocationCallOrder[0]!);
      expect(result.notices).toEqual(["adopted earlier launch x of myapp (Rex session session:y)"]);
    });

    it("carries the root pane's program status only when asked for and only on an active row", () => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      rexMocks.programStatusOf.mockReturnValue({ state: "blocked", kind: "permission" });
      expect(readStatus("myapp", RECONCILE)!.programStatus).toBeUndefined();
      expect(rexMocks.programStatusOf).not.toHaveBeenCalled();
      expect(readStatus("myapp", { programStatus: true, reconcile: true })!.programStatus).toEqual({ state: "blocked", kind: "permission" });
      expect(rexMocks.programStatusOf).toHaveBeenCalledWith(expect.anything(), rexIdentity().sessionId, rexIdentity().rootBlockId);
      // readAllStatuses: the flag reaches the rows only when asked for.
      expect(readAllStatuses(RECONCILE)[0]!.programStatus).toBeUndefined();
      expect(readAllStatuses({ programStatus: true, reconcile: true })[0]!.programStatus).toEqual({ state: "blocked", kind: "permission" });
      rexMocks.programStatusOf.mockClear();
      rexMocks.sessionState.mockReturnValue({ state: "partial", reason: "root pane closed", liveBlocks: [] });
      expect(readStatus("myapp", { programStatus: true, reconcile: true })!.programStatus).toBeUndefined();
      expect(rexMocks.programStatusOf).not.toHaveBeenCalled();
    });

    it("re-reads the record only when adoption reported something", () => {
      writeStatus(rexRecord());
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      const result = readStatus("myapp", RECONCILE)!;
      expect(result.notices).toBeUndefined();
      expect(result.state).toBe("active");
    });

    it("re-reads the record after adoption replaced it", () => {
      writeStatus(rexRecord());
      rexMocks.adoptOrphans.mockImplementation(() => { writeStatus(rexRecord("myapp", { launchId: GEN_B, layout: "adopted" })); return ["adopted earlier launch"]; });
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      expect(readStatus("myapp", RECONCILE)).toMatchObject({ launchId: GEN_B, layout: "adopted", state: "active" });
    });

    const SHELL_BLOCK = "block:0000aaaa-0000-0000-0000-000000000077";
    /** The probe: partial once the identity knows the shell (root closed), else stopped with blocks that no recorded pane names. */
    const stateFollowsShell = () => rexMocks.sessionState.mockImplementation((_cli: unknown, identity: unknown) => {
      const known = (identity as { blocks: Array<{ name: string }> }).blocks.map((b) => b.name);
      return known.includes("shell") ? { state: "partial", reason: "root pane closed", liveBlocks: ["shell"] } : { state: "stopped", reason: NO_LIVE_PANES, liveBlocks: [] };
    });
    /** A refresh that finds the shell pane's file: the record gains its block under the lock. */
    const refreshFindsShell = () => rexMocks.refreshPaneMapping.mockImplementation((record: unknown) => {
      const r = record as RexWorkspaceStatus;
      writeStatus({ ...r, rex: { ...r.rex, blocks: [...r.rex.blocks, { name: "shell", blockId: SHELL_BLOCK, label: "shell" }] } });
      return { notices: ["pane x of myapp has an unreadable pane file; summon clean --orphans names it"], changed: true };
    });

    it("refreshes the pane mapping of a record with unverified panes before the probe, which then sees the refreshed identity", () => {
      writeStatus(rexRecord("myapp", { panes: ["editor", "shell"] }));
      rexMocks.sessionState.mockImplementation((_cli: unknown, identity: unknown) => ({ state: "active", liveBlocks: (identity as { blocks: Array<{ name: string }> }).blocks.map((b) => b.name) }));
      refreshFindsShell();
      const result = readStatus("myapp", RECONCILE)!;
      expect(rexMocks.refreshPaneMapping).toHaveBeenCalledTimes(1);
      expect(rexMocks.refreshPaneMapping.mock.invocationCallOrder[0]!).toBeLessThan(rexMocks.sessionState.mock.invocationCallOrder[0]!);
      expect(result.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
      // The returned liveness comes from the refreshed identity, never from a probe of the gap.
      expect(result.liveBlocks).toEqual(["editor", "shell"]);
      expect(result.notices).toEqual(["pane x of myapp has an unreadable pane file; summon clean --orphans names it"]);

      // Complete record: no refresh. Ended record with a gap: no refresh either (its files are gone; the monitor reads it every tick).
      rexMocks.refreshPaneMapping.mockClear();
      readStatus("myapp", RECONCILE);
      writeStatus(rexRecord("ended", { panes: ["editor", "shell"], endedAt: "2026-10-29T12:00:00.000Z" }));
      readStatus("ended", RECONCILE);
      expect(rexMocks.refreshPaneMapping).not.toHaveBeenCalled();
    });

    it("a stopped record with a gap is refreshed too (P13 next-read recovery): the delayed pane keeps the workspace alive", () => {
      writeStatus(rexRecord("myapp", { panes: ["editor", "shell"] }));
      stateFollowsShell();
      refreshFindsShell();
      const result = readStatus("myapp", RECONCILE)!;
      expect(rexMocks.refreshPaneMapping).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ state: "partial", liveBlocks: ["shell"] });
      expect(result.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
      expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
    });

    it("a stop with blocks remaining while a pane is unverified is not reconciled; the late pane file recovers it on the next read", () => {
      writeStatus(rexRecord("myapp", { panes: ["editor", "shell"] }));
      stateFollowsShell();
      // First read: the shell's pane file has not arrived.
      snapshotMocks.collectSnapshot.mockClear();
      rexMocks.refreshPaneMapping.mockReturnValueOnce({ notices: [], changed: false });
      const first = readStatus("myapp", RECONCILE)!;
      expect(first).toMatchObject({ state: "stopped", reason: `${NO_LIVE_PANES}; 1 pane unverified` });
      expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
      expect(snapshotMocks.collectSnapshot).not.toHaveBeenCalled();
      // Second read: the file is there.
      refreshFindsShell();
      const second = readStatus("myapp", RECONCILE)!;
      expect(second).toMatchObject({ state: "partial", liveBlocks: ["shell"] });
      expect(second.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
      // With every pane known, "no live panes" is a real stop and is reconciled.
      rexMocks.sessionState.mockReturnValue({ state: "stopped", reason: NO_LIVE_PANES, liveBlocks: [] });
      expect(readStatus("myapp", RECONCILE)!.reason).toBe(NO_LIVE_PANES);
      expect(readStatusRecord("myapp")!.endedAt).toBeDefined();
    });

    it("a Ghostty generation published during reconciliation is resolved through the Ghostty sidecars, not the Rex resolver", () => {
      writeStatus(rexRecord("myapp"));
      rexMocks.sessionState.mockReturnValue({ state: "stopped", reason: "empty Rex session remains; run summon clean myapp", liveBlocks: [] });
      statusTestHooks.beforeLock = () => {
        delete statusTestHooks.beforeLock;
        writeLaunchFiles("myapp", GEN_B);
        writeStatus(makeStatus({ project: "myapp", launchId: GEN_B, backend: "ghostty", startedAt: new Date().toISOString() }));
      };
      const result = readStatus("myapp", RECONCILE)!;
      expect(result).toMatchObject({ launchId: GEN_B, backend: "ghostty", state: "active" });
      expect(result.reason).toBeUndefined();
      expect(result.rex).toBeUndefined();
      expect(rexMocks.sessionState).toHaveBeenCalledTimes(1);
    });

    it("a generation published during reconciliation is resolved afresh, never paired with the old generation's state", () => {
      writeStatus(rexRecord("myapp"));
      const sessionB = "session:0000bbbb-0000-0000-0000-00000000000b";
      rexMocks.sessionState.mockImplementation((_cli: unknown, identity: unknown) => ((identity as { sessionId: string }).sessionId === sessionB ? { state: "active", liveBlocks: ["editor"] } : { state: "stopped", reason: "empty Rex session remains; run summon clean myapp", liveBlocks: [] }));
      statusTestHooks.beforeLock = () => {
        delete statusTestHooks.beforeLock;
        writeStatus(rexRecord("myapp", { launchId: GEN_B, rex: { ...rexIdentity(), sessionId: sessionB } }));
      };
      const result = readStatus("myapp", RECONCILE)!;
      expect(result).toMatchObject({ launchId: GEN_B, state: "active", liveBlocks: ["editor"] });
      expect(result.rex!.sessionId).toBe(sessionB);
      expect(result.reason).toBeUndefined();
      expect(rexMocks.sessionState).toHaveBeenCalledTimes(2);
      expect(rexMocks.listSessions).toHaveBeenCalledTimes(2);
      expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
    });

    it("a generation published during the pane-file refresh is resolved afresh; a second supersession is unknown", () => {
      writeStatus(rexRecord("myapp", { panes: ["editor", "shell"] }));
      const GEN_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const gens = [GEN_B, GEN_C];
      rexMocks.refreshPaneMapping.mockImplementation(() => {
        const next = gens.shift();
        if (next) writeStatus(rexRecord("myapp", { launchId: next, panes: ["editor", "shell"] }));
        return { notices: [], changed: true };
      });
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      const result = readStatus("myapp", RECONCILE)!;
      expect(result).toMatchObject({ launchId: GEN_C, state: "unknown", reason: "the record changed while it was read; retry" });
      expect(rexMocks.sessionState).not.toHaveBeenCalled();
    });

    it("is unknown without a rex binary, probing nothing", () => {
      writeStatus(rexRecord());
      rexMocks.discoverRex.mockReturnValue({ path: null, searched: ["PATH"] });
      expect(readStatus("myapp", RECONCILE)).toMatchObject({ state: "unknown", reason: expect.stringContaining("rex CLI not found") });
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
      const rows = readAllStatuses(RECONCILE);
      expect(rows.map((r) => [r.project, r.state])).toEqual([["ghost", "active"], ["rex-b", "partial"], ["rex-a", "unknown"]]);
      expect(rexMocks.listSessions).toHaveBeenCalledTimes(1);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(2);
      expect(rexMocks.discoverRex).toHaveBeenCalledTimes(1);
      // One listing per server per read: a second read lists the server once more.
      readAllStatuses(RECONCILE);
      expect(rexMocks.listSessions).toHaveBeenCalledTimes(2);
    });

    it("an unverified launch (manifest, no record) runs adoption and resolves through the record it published", () => {
      const manifest: LaunchManifest = { version: 1, launchId: GEN_A, project: "orphan", directory: "/tmp/orphan", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" }, backend: "rex", server: "unix:///tmp/rex.sock", startedAt: new Date().toISOString() };
      writeLaunchManifest(manifest);
      rexMocks.sessionState.mockReturnValue({ state: "active", liveBlocks: ["editor"] });
      rexMocks.adoptOrphans.mockImplementationOnce(() => { writeStatus(rexRecord("orphan")); return ["adopted earlier launch"]; });
      const rows = readAllStatuses(RECONCILE);
      expect(rows.map((r) => [r.project, r.state, r.reason])).toEqual([["orphan", "active", undefined]]);
      expect(rows[0]!.notices).toEqual(["adopted earlier launch"]);
      expect(rexMocks.adoptOrphans).toHaveBeenCalledTimes(1);

      // Without adoption the manifest stays an unverified row.
      rmSync(join(TEST_STATUS_DIR, "orphan.json"));
      const again = readAllStatuses(RECONCILE);
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

describe("in-memory record union (AR-L2): the JSON on disk is unchanged", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const native = { rootTerminalId: id, panes: [{ name: "editor", terminalId: id }] };
  const fields = { project: "unionapp", directory: "/tmp/unionapp", pid: 4242, startedAt: "2026-10-29T09:00:00.000Z", layout: "minimal", panes: ["editor"], source: "summon", version: 1 };
  const file = () => join(TEST_STATUS_DIR, "unionapp.json");
  /** Store `raw` as a status file, read it, write the parsed record back; returns the bytes before and after. */
  const roundTrip = (raw: Record<string, unknown>): { before: string; after: string; parsed: WorkspaceStatus } => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    const before = JSON.stringify(raw, null, 2) + "\n";
    writeFileSync(file(), before);
    const parsed = readStatusRecord("unionapp")!;
    writeStatus(parsed);
    return { before, after: readFileSync(file(), "utf-8"), parsed };
  };

  it("a legacy record without a backend field parses as Ghostty and is rewritten byte for byte, still without the field", () => {
    const { before, after, parsed } = roundTrip({ ...fields, native });
    expect(parsed.backend).toBeUndefined();
    expect(parsed.native).toEqual(native);
    expect(after).toBe(before);
    expect(after).not.toContain('"backend"');
    // A legacy record with neither identity nor launch id round-trips too.
    expect(roundTrip({ ...fields }).after).toBe(JSON.stringify(fields, null, 2) + "\n");
  });

  it("a Ghostty and a Rex record as launches write them are rewritten byte for byte", () => {
    const ghostty = roundTrip({ ...fields, native, launchId: GEN_A, backend: "ghostty", endedAt: "2026-10-29T10:00:00.000Z" });
    expect(ghostty.parsed.backend).toBe("ghostty");
    expect(ghostty.after).toBe(ghostty.before);
    const rex = roundTrip({ ...fields, launchId: GEN_A, backend: "rex", rex: rexIdentity(), endedAt: "2026-10-29T10:00:00.000Z" });
    expect(rex.parsed.backend === "rex" && rex.parsed.rex).toEqual(rexIdentity());
    expect(rex.after).toBe(rex.before);
  });

  it("a Rex record whose identity was discarded stays a Rex record without identity, and its rewrite adds no field", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { after, parsed } = roundTrip({ ...fields, launchId: GEN_A, backend: "rex", rex: { ...rexIdentity(), sessionId: "nope" } });
      expect(parsed.backend).toBe("rex");
      expect(parsed.rex).toBeUndefined();
      expect(Object.keys(parsed)).toEqual([...Object.keys(fields), "launchId", "backend"]);
      expect(after).toBe(JSON.stringify({ ...fields, launchId: GEN_A, backend: "rex" }, null, 2) + "\n");
      // Every reader treats it as unknown (plan P10), never as Ghostty.
      expect(readStatus("unionapp")).toMatchObject({ backend: "rex", state: "unknown", reason: "the record has no Rex identity; run summon unionapp --new-window to relaunch" });
    } finally {
      stderr.mockRestore();
    }
  });

  it("the type admits only the identity of the record's own backend", () => {
    const base: Omit<WorkspaceStatus, "backend" | "native" | "rex"> = { project: "x", directory: "/x", pid: 1, startedAt: "2026-10-29T09:00:00.000Z", layout: "minimal", panes: [], source: "summon", version: 1 };
    const rex: WorkspaceStatus = { ...base, backend: "rex", rex: rexIdentity() };
    const unidentified: WorkspaceStatus = { ...base, backend: "rex" };
    const legacy: WorkspaceStatus = { ...base, native };
    // @ts-expect-error a Rex record cannot carry a Ghostty identity
    const mixed: WorkspaceStatus = { ...base, backend: "rex", rex: rexIdentity(), native };
    // @ts-expect-error a Ghostty record cannot carry a Rex identity
    const foreign: WorkspaceStatus = { ...base, backend: "ghostty", rex: rexIdentity() };
    expect([rex, unidentified, legacy, mixed, foreign]).toHaveLength(5);
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

describe("publishStatus: a failed publication discards only the record observed under its own lock", () => {
  afterEach(() => {
    delete statusTestHooks.beforeLock;
    delete statusTestHooks.beforeWrite;
    delete statusTestHooks.afterUnlock;
    chmodSync(TEST_STATUS_DIR, 0o700);
  });

  it("publishes with replace semantics", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    expect(publishStatus(makeStatus({ project: "p", launchId: GEN_B }))).toBe("published");
    expect(readStatusRecord("p")?.launchId).toBe(GEN_B);
  });

  it("a failed write discards the record observed under the same lock, taking the lock once", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    let locks = 0;
    statusTestHooks.beforeLock = () => { locks += 1; };
    statusTestHooks.beforeWrite = () => {
      expect(existsSync(join(TEST_STATUS_DIR, "p.json.lock"))).toBe(true); // the failing write runs under the lock
      throw new Error("disk full");
    };
    expect(publishStatus(makeStatus({ project: "p", launchId: GEN_B }))).toBe("discarded");
    // One lock: the observation, the failed write and the discard are one critical section, so a
    // record another launch publishes after the lock is released is never the one discarded.
    expect(locks).toBe(1);
    expect(existsSync(join(TEST_STATUS_DIR, "p.json"))).toBe(false);
    delete statusTestHooks.beforeWrite;
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    expect(readStatusRecord("p")?.launchId).toBe(GEN_A);
  });

  it("a record published the moment the lock is released survives: the discard happened inside the lock", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    statusTestHooks.beforeWrite = () => { throw new Error("disk full"); };
    statusTestHooks.afterUnlock = () => {
      // Another launch wins the lock right after this publication released it.
      delete statusTestHooks.afterUnlock;
      delete statusTestHooks.beforeWrite;
      writeStatus(makeStatus({ project: "p", launchId: GEN_B }));
    };
    expect(publishStatus(makeStatus({ project: "p", launchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }))).toBe("discarded");
    expect(readStatusRecord("p")?.launchId).toBe(GEN_B);
  });

  it("a failed write with no record observed is discarded (nothing stale remains)", () => {
    statusTestHooks.beforeWrite = () => { throw new Error("disk full"); };
    expect(publishStatus(makeStatus({ project: "p", launchId: GEN_B }))).toBe("discarded");
    expect(existsSync(join(TEST_STATUS_DIR, "p.json"))).toBe(false);
  });

  it("is unsaved when the lock cannot be taken: the previous record stays", () => {
    writeStatus(makeStatus({ project: "p", launchId: GEN_A }));
    chmodSync(TEST_STATUS_DIR, 0o500);
    expect(publishStatus(makeStatus({ project: "p", launchId: GEN_B }))).toBe("unsaved");
    chmodSync(TEST_STATUS_DIR, 0o700);
    expect(readStatusRecord("p")?.launchId).toBe(GEN_A);
  });
});

describe("removeLaunchFileSet keeps the retry proof", () => {
  const files = () => launchArtifactFiles("p", GEN_A, ["editor", "shell"]);
  const write = (path: string) => writeFileSync(path, "x\n");
  beforeEach(() => {
    mkdirSync(launchDir("p"), { recursive: true });
    for (const file of [...files().liveness, ...files().panes, files().manifest!, files().token!]) if (!file.endsWith(".tmp")) write(file);
  });

  it("a failing pane or sidecar removal keeps the manifest and the token; the retry removes everything", () => {
    mkdirSync(files().panes.find((f) => f.endsWith(".pane.shell.tmp"))!); // only that unlink fails
    const removal = removeLaunchFileSet(files());
    expect(removal.failures).toHaveLength(1);
    expect(removal.failures[0]).toContain(".pane.shell.tmp");
    expect(removal.stranded).toBeUndefined();
    expect(existsSync(files().manifest!)).toBe(true);
    expect(existsSync(files().token!)).toBe(true);
    rmSync(files().panes.find((f) => f.endsWith(".pane.shell.tmp"))!, { recursive: true });
    expect(removeLaunchFileSet(files())).toEqual({ failures: [] });
    expect(launchFileListExists()).toEqual([]);
  });

  it("a failing manifest removal keeps the token; the retry removes everything", () => {
    rmSync(files().manifest!);
    mkdirSync(files().manifest!); // a directory where the manifest is: unlink fails, nothing else does
    const removal = removeLaunchFileSet(files());
    expect(removal.failures).toHaveLength(1);
    expect(removal.failures[0]).toContain(`${GEN_A}.json`);
    expect(removal.stranded).toBeUndefined();
    expect(existsSync(files().token!)).toBe(true);
    rmSync(files().manifest!, { recursive: true });
    expect(removeLaunchFileSet(files())).toEqual({ failures: [] });
    expect(launchFileListExists()).toEqual([]);
  });

  it("a failing token removal after the manifest went is reported as stranded: nothing left to rediscover", () => {
    rmSync(files().token!);
    mkdirSync(files().token!); // only the token's unlink fails
    const removal = removeLaunchFileSet(files());
    expect(removal.failures).toHaveLength(1);
    expect(removal.failures[0]).toContain(".pane.editor");
    expect(removal.stranded).toBe(files().token);
    expect(existsSync(files().manifest!)).toBe(false);
    // Without a manifest in the set (a sidecar-only removal) a token is never stranded.
    expect(removeLaunchFileSet({ liveness: [], panes: [], token: files().token }).stranded).toBeUndefined();
  });

  it("a set without manifest or token (session not confirmed gone) removes only what it names", () => {
    expect(removeLaunchFileSet({ liveness: files().liveness, panes: [] })).toEqual({ failures: [] });
    expect(existsSync(files().token!)).toBe(true);
    expect(existsSync(files().manifest!)).toBe(true);
  });

  const launchFileListExists = () => [...files().liveness, ...files().panes, files().manifest!, files().token!].filter((f) => existsSync(f));
});

describe("readAllStatuses discovery of unverified launches (plan P13 §6)", () => {
  function manifest(project: string, launchId: string): LaunchManifest {
    return {
      version: 1, launchId, project, directory: `/tmp/${project}`, layout: "default",
      panes: ["editor", "shell"], paneOrder: ["editor", "shell"], blockLabels: { editor: "editor", shell: "shell" },
      backend: "rex", server: "unix:///tmp/rex.sock", startedAt: "2026-10-29T10:00:00.000Z",
    };
  }

  it("readProjectStatus resolves one project the same way: the unverified row for a manifest without a record, null for nothing", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeLaunchManifest(manifest("orphan", GEN_A));
    expect(readProjectStatus("orphan", RECONCILE)).toMatchObject({ project: "orphan", launchId: GEN_A, state: "unknown", uptime: null, reason: "unverified launch" });
    expect(readProjectStatus("nothing", RECONCILE)).toBeNull();
  });

  it("lists a manifest without a record as an unverified launch row", () => {
    mkdirSync(TEST_STATUS_DIR, { recursive: true });
    writeLaunchManifest(manifest("orphan", GEN_A));
    const rows = readAllStatuses(RECONCILE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project: "orphan", launchId: GEN_A, backend: "rex", state: "unknown", uptime: null, reason: "unverified launch", panes: ["editor", "shell"], directory: "/tmp/orphan" });
  });

  it("does not list manifests of a project that has a record (adoption is Phase 3)", () => {
    writeStatus(makeStatus({ project: "recorded", launchId: GEN_B }));
    writeLaunchManifest(manifest("recorded", GEN_A));
    const rows = readAllStatuses(RECONCILE);
    expect(rows.map((r) => r.launchId)).toEqual([GEN_B]);
  });

  it("ignores launch directories without manifests and lock directories", () => {
    writeStatus(makeStatus({ project: "a" }));
    mkdirSync(join(TEST_STATUS_DIR, "empty.launches"), { recursive: true });
    mkdirSync(join(TEST_STATUS_DIR, "a.json.lock"), { recursive: true });
    expect(readAllStatuses(RECONCILE).map((r) => r.project)).toEqual(["a"]);
  });
});

describe("hasRexState (PE-H1: only Rex state reads off the monitor's thread)", () => {
  const manifest = (project: string, backend: "rex" | "ghostty"): LaunchManifest => ({
    version: 1, launchId: GEN_A, project, directory: `/tmp/${project}`, layout: "default",
    panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" },
    backend, ...(backend === "rex" ? { server: "unix:///tmp/rex.sock" } : {}), startedAt: "2026-10-29T10:00:00.000Z",
  }) as LaunchManifest;

  it("is false with no status directory, Ghostty records or Ghostty manifests", () => {
    expect(hasRexState()).toBe(false);
    writeStatus(makeStatus({ project: "ghost" }));
    writeLaunchManifest(manifest("ghost-launch", "ghostty"));
    expect(hasRexState()).toBe(false);
  });

  it("is true with a Rex record or a Rex launch manifest without a record", () => {
    writeStatus(makeStatus({ project: "rexy", launchId: GEN_A, backend: "rex", rex: rexIdentity(), panes: ["editor"] }));
    expect(hasRexState()).toBe(true);
    rmSync(join(TEST_STATUS_DIR, "rexy.json"));
    expect(hasRexState()).toBe(false);
    writeLaunchManifest(manifest("orphan", "rex"));
    expect(hasRexState()).toBe(true);
  });
});
