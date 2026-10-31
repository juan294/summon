import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeRex } from "./fixtures/fake-rex.js";

/**
 * The stopped reader composed with the real snapshot writer over a real temporary git repository,
 * through a fake `rex` executable at the process boundary (validation T01 and V04). Nothing of
 * Summon is faked here but the config paths: the record layer, the lock, reconciliation, the pane
 * file refresh and the snapshot module all run as shipped.
 */
const tmpHome = mkdtempSync(join(tmpdir(), "summon-reconcile-"));
const CONFIG_DIR = join(tmpHome, "config");
const STATUS_DIR = join(CONFIG_DIR, "status");
const SNAPSHOTS_DIR = join(CONFIG_DIR, "snapshots");
vi.mock("./paths.js", async (original) => ({ ...(await original<typeof import("./paths.js")>()), CONFIG_DIR, STATUS_DIR, SNAPSHOTS_DIR }));

const { readStatus, readAllStatuses, readProjectStatus, resetRexBinaryMemo } = await import("./status.js");
const { readStatusRecord, statusTestHooks, writeStatus } = await import("./status-record.js");
const { NO_LIVE_PANES, SESSION_GONE } = await import("./backends/rex/status.js");
const { writeLaunchManifest, launchArtifactPaths } = await import("./launch-identity.js");
const { gitSafeEnv } = await import("./utils.js");

const PROJECT = "repo";
const GEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVER = "unix:///tmp/summon-reconcile-fake.sock";
const SESSION = "session:0000aaaa-0000-0000-0000-000000000001";
const WINDOW = "window:0000aaaa-0000-0000-0000-000000000002";
const EDITOR = "block:0000aaaa-0000-0000-0000-000000000010";
const SHELL = "block:0000aaaa-0000-0000-0000-000000000011";
const STARTED = "2026-10-29T09:00:00.000Z";

const binDir = join(tmpHome, "bin");
const fixture = join(tmpHome, "server.json");
const repoDir = join(tmpHome, PROJECT);
const paths = launchArtifactPaths(PROJECT, GEN);
const snapshotFile = join(SNAPSHOTS_DIR, `${PROJECT}.json`);
const savedEnv = { PATH: process.env["PATH"], REX_BIN_DIR: process.env["REX_BIN_DIR"] };

/** What the fake server answers: the listed sessions and the one view it serves. */
function server(sessions: string[], blockIds: string[]): void {
  const view = { session_id: SESSION, label: PROJECT, revision: 1, windows: [{ window_id: WINDOW, label: `[${PROJECT}]`, layers: [{ blocks: blockIds.map((block_id) => ({ block_id, host_id: "host-1" })) }] }] };
  writeFileSync(fixture, JSON.stringify({ sessions: sessions.map((session_id) => ({ session_id, label: PROJECT })), view }));
}

function seed(panes: string[], known: Array<[string, string]>, options: { shellFile?: boolean } = {}): void {
  writeStatus({ project: PROJECT, directory: repoDir, pid: process.pid, startedAt: STARTED, layout: "pair", panes, source: "summon", version: 1, launchId: GEN, backend: "rex", rex: { server: SERVER, hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: EDITOR, blocks: known.map(([name, blockId]) => ({ name, blockId, label: name })) } });
  writeLaunchManifest({ version: 1, launchId: GEN, project: PROJECT, directory: repoDir, layout: "pair", panes, paneOrder: panes, blockLabels: Object.fromEntries(panes.map((name) => [name, name])), backend: "rex", server: SERVER, startedAt: STARTED });
  writeFileSync(paths.pid, `${process.pid}\n`);
  writeFileSync(paths.active, `${GEN}\n`);
  writeFileSync(paths.pane("editor").file, `${SESSION}\n${EDITOR}\n`);
  if (panes.includes("shell") && options.shellFile !== false) writeFileSync(paths.pane("shell").file, `${SESSION}\n${SHELL}\n`);
}

const files = () => ({ pid: existsSync(paths.pid), active: existsSync(paths.active), manifest: existsSync(paths.manifest), pane: existsSync(paths.pane("editor").file) });

beforeAll(() => {
  // A real executable at the Rex process boundary, found before any installed rex.
  mkdirSync(binDir, { recursive: true });
  writeFakeRex(join(binDir, "rex"), [
    "const fs = require('node:fs');",
    `const d = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));`,
    "const a = process.argv.slice(2);",
    "if (a.includes('ls')) console.log(JSON.stringify({ sessions: d.sessions }));",
    "else if (a.includes('session.view')) console.log(JSON.stringify(d.view));",
    "else { console.error('unexpected fake rex operation', a); process.exit(2); }",
  ].join("\n") + "\n");
  process.env["PATH"] = `${binDir}:${savedEnv.PATH ?? ""}`;
  process.env["REX_BIN_DIR"] = binDir;

  // A real repository with one commit.
  const env = gitSafeEnv();
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir, env });
  execFileSync("git", ["config", "user.email", "summon@example.test"], { cwd: repoDir, env });
  execFileSync("git", ["config", "user.name", "Summon Test"], { cwd: repoDir, env });
  writeFileSync(join(repoDir, "tracked.txt"), "clean\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, env });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repoDir, env });
});

afterAll(() => {
  if (savedEnv.PATH === undefined) delete process.env["PATH"]; else process.env["PATH"] = savedEnv.PATH;
  if (savedEnv.REX_BIN_DIR === undefined) delete process.env["REX_BIN_DIR"]; else process.env["REX_BIN_DIR"] = savedEnv.REX_BIN_DIR;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(STATUS_DIR, { recursive: true, force: true });
  rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  mkdirSync(paths.dir, { recursive: true });
  resetRexBinaryMemo();
});

describe("stopped reader with the real snapshot writer and a real repository", () => {
  it("reconciles a workspace that ended outside Summon: snapshot of the repository, endedAt, files removed", { timeout: 15_000 }, () => {
    seed(["editor"], [["editor", EDITOR]]);
    server([], []);
    const row = readStatus(PROJECT, { reconcile: true })!;
    expect(row).toMatchObject({ state: "stopped", reason: SESSION_GONE, launchId: GEN });
    expect(row.notices).toHaveLength(1);
    expect(row.notices![0]).toMatch(/^workspace ended outside Summon; snapshot saved \d{4}-\d{2}-\d{2}T/);
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf-8")) as { project: string; layout: string; directory: string; git: { branch: string; dirty: string[]; recentCommits: string[] } };
    expect(snapshot).toMatchObject({ project: PROJECT, layout: "pair", directory: repoDir });
    expect(snapshot.git.branch.length).toBeGreaterThan(0);
    expect(snapshot.git.dirty).toEqual([]);
    expect(snapshot.git.recentCommits[0]).toMatch(/initial$/);
    expect(readStatusRecord(PROJECT)!.endedAt).toBeDefined();
    expect(files()).toEqual({ pid: false, active: false, manifest: false, pane: false });
  });

  it("a snapshot write failure changes nothing and says so; the next read completes every step", { timeout: 15_000 }, () => {
    seed(["editor"], [["editor", EDITOR]]);
    server([], []);
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    chmodSync(SNAPSHOTS_DIR, 0o500);
    let first;
    try {
      first = readStatus(PROJECT, { reconcile: true })!;
    } finally {
      chmodSync(SNAPSHOTS_DIR, 0o700);
    }
    expect(first.state).toBe("stopped");
    expect(first.notices).toHaveLength(1);
    expect(first.notices![0]).toMatch(/^workspace ended outside Summon; snapshot failed: .*; will retry on the next read$/);
    expect(existsSync(snapshotFile)).toBe(false);
    expect(readStatusRecord(PROJECT)!.endedAt).toBeUndefined();
    expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });

    const second = readStatus(PROJECT, { reconcile: true })!;
    expect(second.notices![0]).toMatch(/^workspace ended outside Summon; snapshot saved /);
    expect(existsSync(snapshotFile)).toBe(true);
    expect(readStatusRecord(PROJECT)!.endedAt).toBeDefined();
    expect(files()).toEqual({ pid: false, active: false, manifest: false, pane: false });
  });

  it("recovers a delayed pane file on the next read whatever the state", { timeout: 15_000 }, () => {
    // Root closed, shell alive: partial with the recovered pane; then root back: active.
    seed(["editor", "shell"], [["editor", EDITOR]]);
    server([SESSION], [SHELL]);
    const partial = readStatus(PROJECT, { reconcile: true })!;
    expect(partial).toMatchObject({ state: "partial", reason: "root pane closed", liveBlocks: ["shell"] });
    expect(partial.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
    expect(partial.notices).toBeUndefined();
    expect(readStatusRecord(PROJECT)!.endedAt).toBeUndefined();
    expect(existsSync(paths.pane("shell").file)).toBe(true);

    server([SESSION], [EDITOR, SHELL]);
    const active = readStatus(PROJECT, { reconcile: true })!;
    expect(active).toMatchObject({ state: "active", liveBlocks: ["editor", "shell"] });
    expect(active.reason).toBeUndefined();
  });

  it("a read before the pane file arrives does not end the launch; the file arriving later still recovers it", { timeout: 15_000 }, () => {
    seed(["editor", "shell"], [["editor", EDITOR]], { shellFile: false });
    server([SESSION], [SHELL]); // the root closed; a block remains that no recorded pane names yet
    const before = readStatus(PROJECT, { reconcile: true })!;
    expect(before).toMatchObject({ state: "stopped", reason: `${NO_LIVE_PANES}; 1 pane unverified`, liveBlocks: [] });
    expect(readStatusRecord(PROJECT)!.endedAt).toBeUndefined();
    expect(existsSync(snapshotFile)).toBe(false);
    expect(files()).toEqual({ pid: true, active: true, manifest: true, pane: true });

    writeFileSync(paths.pane("shell").file, `${SESSION}\n${SHELL}\n`);
    const after = readStatus(PROJECT, { reconcile: true })!;
    expect(after).toMatchObject({ state: "partial", reason: "root pane closed", liveBlocks: ["shell"] });
    expect(after.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
    expect(readStatusRecord(PROJECT)!.endedAt).toBeUndefined();
  });
});

/** Every file under the config directory with its bytes (directories as entries), to compare before and after a read. */
function configTree(dir = CONFIG_DIR, prefix = ""): Map<string, string> {
  const tree = new Map<string, string>();
  if (!existsSync(dir)) return tree;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      tree.set(`${path}/`, "");
      for (const [child, bytes] of configTree(join(dir, entry.name), `${path}/`)) tree.set(child, bytes);
    } else {
      tree.set(path, readFileSync(join(dir, entry.name), "utf-8"));
    }
  }
  return tree;
}

describe("a non-reconciling read writes nothing (AR-M3)", () => {
  it("leaves an ended workspace, a delayed pane file and an unverified launch untouched, takes no lock; the next reconciling read still recovers", { timeout: 15_000 }, () => {
    // Every writing step has work here: the shell's pane file arrived late (refresh), the session is
    // gone (end of launch: snapshot, endedAt, file removal) and another project has a manifest without a record (adoption).
    seed(["editor", "shell"], [["editor", EDITOR]]);
    server([], []);
    writeLaunchManifest({ version: 1, launchId: GEN, project: "orphan", directory: repoDir, layout: "pair", panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" }, backend: "rex", server: SERVER, startedAt: STARTED });
    const before = configTree();
    statusTestHooks.beforeLock = () => { throw new Error("a non-reconciling read must not take the status lock"); };
    try {
      const row = readStatus(PROJECT)!;
      expect(row).toMatchObject({ state: "stopped", reason: SESSION_GONE, launchId: GEN });
      expect(row.endedAt).toBeUndefined();
      expect(row.notices).toBeUndefined();
      expect(row.rex!.blocks.map((b) => b.name)).toEqual(["editor"]);
      expect(readProjectStatus(PROJECT)).toMatchObject({ state: "stopped", reason: SESSION_GONE });
      expect(readProjectStatus("orphan")).toMatchObject({ state: "unknown", reason: "unverified launch" });
      const rows = readAllStatuses({ programStatus: true });
      expect(rows.map((r) => [r.project, r.state, r.notices])).toEqual([[PROJECT, "stopped", undefined], ["orphan", "unknown", undefined]]);
    } finally {
      delete statusTestHooks.beforeLock;
    }
    expect(configTree()).toEqual(before);
    expect(existsSync(snapshotFile)).toBe(false);

    // Next-read recovery: the first reconciling read refreshes the pane, saves the snapshot, marks the record and removes the files.
    const reconciled = readStatus(PROJECT, { reconcile: true })!;
    expect(reconciled.notices![0]).toMatch(/^workspace ended outside Summon; snapshot saved /);
    expect(reconciled.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
    expect(readStatusRecord(PROJECT)!.endedAt).toBeDefined();
    expect(existsSync(snapshotFile)).toBe(true);
    expect(files()).toEqual({ pid: false, active: false, manifest: false, pane: false });
  });
});
