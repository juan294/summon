import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Moved from status.test.ts with the reconciliation steps (AR-M3): the end of a Rex launch that
 * ended outside Summon, run by a reconciling read. The same fakes: Rex liveness through the
 * adapters, snapshots collected by a fake and written as plain files, real records and locks.
 */
const TEST_STATUS_DIR = join(tmpdir(), `summon-reconcile-unit-${process.pid}`);
const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-reconcile-unit-snapshots-${process.pid}`);

const rexMocks = vi.hoisted(() => ({
  listSessions: vi.fn((..._args: unknown[]): unknown => ({ ok: true, sessions: [] })),
  sessionState: vi.fn((..._args: unknown[]): unknown => ({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] })),
  adoptOrphans: vi.fn((..._args: unknown[]): string[] => []),
  refreshPaneMapping: vi.fn((..._args: unknown[]): unknown => ({ notices: [], changed: false })),
  discoverRex: vi.fn((): { path: string | null; searched: string[] } => ({ path: "/mock/rex", searched: ["PATH"] })),
}));
vi.mock("./status.js", async (original) => ({
  ...(await original<typeof import("./status.js")>()),
  listSessions: (...args: unknown[]) => rexMocks.listSessions(...args),
  sessionState: (...args: unknown[]) => rexMocks.sessionState(...args),
}));
vi.mock("./launch.js", async (original) => ({
  ...(await original<typeof import("./launch.js")>()),
  adoptOrphans: (...args: unknown[]) => rexMocks.adoptOrphans(...args),
  refreshPaneMapping: (...args: unknown[]) => rexMocks.refreshPaneMapping(...args),
  adoptDeps: () => ({}),
}));
vi.mock("./cli.js", async (original) => ({
  ...(await original<typeof import("./cli.js")>()),
  discoverRex: () => rexMocks.discoverRex(),
  createRexCli: (binary: string, server: string) => ({ binary, server, call: () => { throw new Error("no rex process in tests"); } }),
}));
vi.mock("../../paths.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-reconcile-unit-config-${process.pid}`),
  SNAPSHOTS_DIR: TEST_SNAPSHOTS_DIR,
}));
const snapshotMocks = vi.hoisted(() => ({
  collectSnapshot: vi.fn((..._args: unknown[]): unknown => null),
  writeSnapshotFile: vi.fn((_snapshot: unknown): void => {}),
}));
vi.mock("../../snapshot.js", async (original) => ({
  ...(await original<typeof import("../../snapshot.js")>()),
  collectSnapshot: (...args: unknown[]) => snapshotMocks.collectSnapshot(...args),
  writeSnapshotFile: (snapshot: unknown) => snapshotMocks.writeSnapshotFile(snapshot),
}));

const { readStatus, resetRexBinaryMemo } = await import("../../status.js");
const { writeStatus, readStatusRecord, statusTestHooks } = await import("../../status-record.js");
const { writeLaunchManifest } = await import("../../launch-identity.js");
import type { WorkspaceStatus } from "../../status-record.js";
import type { LaunchManifest } from "../../launch-identity.js";

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
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
});

describe("reconciliation of ended Rex launches (plan P12, Phase 5)", () => {
  const { writeLaunchManifest: writeManifest } = { writeLaunchManifest };
  const snapshotFile = (project: string) => join(TEST_SNAPSHOTS_DIR, `${project}.json`);
  const rexRecord = (extra: Partial<WorkspaceStatus> = {}) => makeStatus({ project: "myapp", launchId: GEN_A, backend: "rex", rex: rexIdentity(), panes: ["editor"], directory: "/tmp/myapp", layout: "minimal", ...extra });
  const manifestFor = (launchId = GEN_A): LaunchManifest => ({ version: 1, launchId, project: "myapp", directory: "/tmp/myapp", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" }, backend: "rex", server: "unix:///tmp/rex.sock", startedAt: "2026-10-29T10:00:00.000Z" });
  const files = () => {
    const dir = launchDir("myapp");
    return { pid: existsSync(join(dir, `${GEN_A}.pid`)), active: existsSync(join(dir, `${GEN_A}.active`)), manifest: existsSync(join(dir, `${GEN_A}.json`)), pane: existsSync(join(dir, `${GEN_A}.pane.editor`)) };
  };
  function seedStopped(reason = "Rex session no longer exists", extra: Partial<WorkspaceStatus> = {}) {
    writeStatus(rexRecord(extra));
    writeLaunchFiles("myapp", GEN_A);
    writeManifest(manifestFor());
    writeFileSync(join(launchDir("myapp"), `${GEN_A}.pane.editor`), `${REX_SESSION}\n${REX_BLOCK}\n`);
    rexMocks.sessionState.mockReturnValue({ state: "stopped", reason, liveBlocks: [] });
  }
  beforeEach(() => {
    rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
    mkdirSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    rexMocks.listSessions.mockReset().mockReturnValue({ ok: true, sessions: [] });
    rexMocks.sessionState.mockReset();
    rexMocks.adoptOrphans.mockReset().mockImplementation(() => []);
    rexMocks.refreshPaneMapping.mockReset().mockImplementation(() => ({ notices: [], changed: false }));
    rexMocks.discoverRex.mockReset().mockReturnValue({ path: "/mock/rex", searched: ["PATH"] });
    snapshotMocks.collectSnapshot.mockReset().mockImplementation((project: unknown, directory: unknown, layout: unknown) => ({ project, directory, layout, timestamp: "2026-10-29T12:00:00.000Z", git: { branch: "main", dirty: [], recentCommits: [] }, version: 1 }));
    snapshotMocks.writeSnapshotFile.mockReset().mockImplementation((snapshot: unknown) => { writeFileSync(snapshotFile((snapshot as { project: string }).project), JSON.stringify(snapshot)); });
    delete statusTestHooks.beforeLock;
    delete statusTestHooks.beforeWrite;
    resetRexBinaryMemo();
  });
  afterEach(() => {
    delete statusTestHooks.beforeLock;
    delete statusTestHooks.beforeWrite;
  });

  it("a stopped, owned record is reconciled in order: snapshot, endedAt, then the files, with one notice", () => {
    seedStopped();
    let filesAtWrite: ReturnType<typeof files> | undefined;
    statusTestHooks.beforeWrite = () => { filesAtWrite = files(); };
    const row = readStatus("myapp", RECONCILE)!;
    expect(snapshotMocks.collectSnapshot).toHaveBeenCalledWith("myapp", "/tmp/myapp", "minimal");
    expect(existsSync(snapshotFile("myapp"))).toBe(true);
    expect(filesAtWrite).toEqual({ pid: true, active: true, manifest: true, pane: true });
    expect(readStatusRecord("myapp")!.endedAt).toBeDefined();
    expect(files()).toEqual({ pid: false, active: false, manifest: false, pane: false });
    expect(row.state).toBe("stopped");
    expect(row.endedAt).toBeDefined();
    expect(row.notices).toEqual(["workspace ended outside Summon; snapshot saved 2026-10-29T12:00:00.000Z"]);
  });

  it("keeps the manifest and pane files when the session still exists (empty or no live panes)", () => {
    for (const reason of ["empty Rex session remains; run summon clean myapp", "no live panes"]) {
      rmSync(TEST_STATUS_DIR, { recursive: true, force: true });
      mkdirSync(TEST_STATUS_DIR, { recursive: true });
      seedStopped(reason);
      readStatus("myapp", RECONCILE);
      expect(files()).toEqual({ pid: false, active: false, manifest: true, pane: true });
      expect(readStatusRecord("myapp")!.endedAt).toBeDefined();
    }
  });

  it("a record with endedAt and leftover files only retries the removal; one with no files is left alone", () => {
    seedStopped("Rex session no longer exists", { endedAt: "2026-10-29T11:00:00.000Z" });
    const before = readFileSync(join(TEST_STATUS_DIR, "myapp.json"), "utf-8");
    const row = readStatus("myapp", RECONCILE)!;
    expect(snapshotMocks.collectSnapshot).not.toHaveBeenCalled();
    expect(readFileSync(join(TEST_STATUS_DIR, "myapp.json"), "utf-8")).toBe(before);
    expect(files()).toEqual({ pid: false, active: false, manifest: false, pane: false });
    expect(row.notices).toBeUndefined();

    statusTestHooks.beforeLock = () => { throw new Error("the lock must not be taken when nothing is left"); };
    expect(readStatus("myapp", RECONCILE)!.state).toBe("stopped");
  });

  it("is superseded by a relaunch between the read and the lock: nothing written, files kept, the new generation resolved on its own", () => {
    seedStopped();
    // The old generation's probe says stopped; the relaunch (gen B) is live.
    rexMocks.sessionState.mockReturnValueOnce({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] }).mockReturnValue({ state: "active", liveBlocks: ["editor"] });
    statusTestHooks.beforeLock = () => { delete statusTestHooks.beforeLock; writeFileSync(join(TEST_STATUS_DIR, "myapp.json"), JSON.stringify(rexRecord({ launchId: GEN_B }))); };
    const row = readStatus("myapp", RECONCILE)!;
    expect(snapshotMocks.writeSnapshotFile).not.toHaveBeenCalled();
    expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
    expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });
    expect(row).toMatchObject({ launchId: GEN_B, state: "active" });
    expect(row.notices).toBeUndefined();
  });

  it("a second reader changes nothing: snapshot and record bytes identical, no probe beyond the state", () => {
    seedStopped();
    readStatus("myapp", RECONCILE);
    const snap = readFileSync(snapshotFile("myapp"), "utf-8");
    const record = readFileSync(join(TEST_STATUS_DIR, "myapp.json"), "utf-8");
    const probes = rexMocks.sessionState.mock.calls.length;
    const again = readStatus("myapp", RECONCILE)!;
    expect(readFileSync(snapshotFile("myapp"), "utf-8")).toBe(snap);
    expect(readFileSync(join(TEST_STATUS_DIR, "myapp.json"), "utf-8")).toBe(record);
    expect(snapshotMocks.collectSnapshot).toHaveBeenCalledTimes(1);
    expect(rexMocks.sessionState.mock.calls.length).toBe(probes + 1);
    expect(again.notices).toBeUndefined();
  });

  it("never reconciles a legacy record", () => {
    writeStatus(makeStatus({ project: "legacy", backend: "rex", rex: rexIdentity(), panes: ["editor"] }));
    rexMocks.sessionState.mockReturnValue({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] });
    const row = readStatus("legacy", RECONCILE)!;
    expect(row.state).toBe("stopped");
    expect(snapshotMocks.collectSnapshot).not.toHaveBeenCalled();
    expect(readStatusRecord("legacy")!.endedAt).toBeUndefined();
  });

  describe("partial failures retry through the executable path and converge", () => {
    const finalState = () => ({ record: readStatusRecord("myapp")!, files: files(), snapshot: existsSync(snapshotFile("myapp")) });
    const converged = { files: { pid: false, active: false, manifest: false, pane: false }, snapshot: true };

    it("step A (snapshot) fails: nothing else changes, then the next read completes everything", () => {
      seedStopped();
      snapshotMocks.collectSnapshot.mockImplementationOnce(() => { throw new Error("git exploded"); });
      const first = readStatus("myapp", RECONCILE)!;
      expect(first.notices).toEqual(["workspace ended outside Summon; snapshot failed: git exploded; will retry on the next read"]);
      expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
      expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });
      expect(existsSync(snapshotFile("myapp"))).toBe(false);
      const second = readStatus("myapp", RECONCILE)!;
      expect(second.notices).toEqual(["workspace ended outside Summon; snapshot saved 2026-10-29T12:00:00.000Z"]);
      expect(finalState()).toMatchObject(converged);
      expect(finalState().record.endedAt).toBeDefined();
    });

    it("step B (record) fails: the snapshot stays, the record is unchanged, then the next read completes", () => {
      seedStopped();
      statusTestHooks.beforeWrite = () => { delete statusTestHooks.beforeWrite; throw new Error("disk full"); };
      const first = readStatus("myapp", RECONCILE)!;
      expect(first.notices).toEqual(["workspace ended outside Summon; snapshot saved 2026-10-29T12:00:00.000Z; record failed: disk full; will retry on the next read"]);
      expect(existsSync(snapshotFile("myapp"))).toBe(true);
      expect(readStatusRecord("myapp")!.endedAt).toBeUndefined();
      expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });
      const second = readStatus("myapp", RECONCILE)!;
      expect(second.notices).toEqual(["workspace ended outside Summon; snapshot saved 2026-10-29T12:00:00.000Z"]);
      expect(snapshotMocks.collectSnapshot).toHaveBeenCalledTimes(2);
      expect(finalState()).toMatchObject(converged);
    });

    it("step C (files) fails: the record has endedAt, the files remain with a will-retry notice, then the next read removes them", () => {
      seedStopped();
      const dir = launchDir("myapp");
      chmodSync(dir, 0o500);
      let first;
      try {
        first = readStatus("myapp", RECONCILE)!;
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(first.notices![0]).toMatch(/^workspace ended outside Summon; snapshot saved 2026-10-29T12:00:00.000Z; \d launch files of \[myapp\] could not be removed: .*; will retry$/);
      expect(readStatusRecord("myapp")!.endedAt).toBeDefined();
      expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });
      const second = readStatus("myapp", RECONCILE)!;
      expect(second.notices).toBeUndefined();
      expect(snapshotMocks.collectSnapshot).toHaveBeenCalledTimes(1);
      expect(finalState()).toMatchObject(converged);
    });
  });
});
