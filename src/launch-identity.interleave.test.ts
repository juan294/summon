import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cliBuild } from "./fixtures/cli-builds.js";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Plan §5 "Ownership tests run real interleavings": the generated bootstrap and trap text is
 * executed by the system /bin/sh against a temp HOME. `summon` on PATH is a shim that logs
 * every call and forwards `snapshot save` to the built CLI (src/commands/runtime.ts path:
 * withOwnedRecord with { launchId }), so the generation check runs for real.
 */

const TEMP_HOME = mkdtempSync(join(tmpdir(), "summon-interleave-"));
const CLI = cliBuild("unsplit");
const STATUS_DIR = join(TEMP_HOME, ".config", "summon", "status");
const SNAPSHOTS_DIR = join(TEMP_HOME, ".config", "summon", "snapshots");
const SHIM_DIR = join(TEMP_HOME, "bin");
const SHIM_LOG = join(TEMP_HOME, "shim.log");
const REPO = join(TEMP_HOME, "proj");
const PROJECT = "proj";

vi.mock("./paths.js", () => ({
  STATUS_DIR: join(TEMP_HOME, ".config", "summon", "status"),
  SNAPSHOTS_DIR: join(TEMP_HOME, ".config", "summon", "snapshots"),
  CONFIG_DIR: join(TEMP_HOME, ".config", "summon"),
}));

const { bootstrapLine, cleanupTrapLine, launchArtifactPaths, registerSelfInvocation, clearSelfInvocation } = await import("./launch-identity.js");
const { writeStatus, readStatusRecord } = await import("./status-record.js");
const { gitSafeEnv } = await import("./utils.js");
import type { WorkspaceStatus } from "./status-record.js";

const GEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GEN_B = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";

// gitSafeEnv strips GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE: under the pre-commit hook git exports
// them, and a plain `...process.env` would make the fixture repo's commits land on the real branch.
const gitEnv = { ...gitSafeEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };

function childEnv(): NodeJS.ProcessEnv {
  return { ...gitSafeEnv(), HOME: TEMP_HOME, PATH: `${SHIM_DIR}:${process.env["PATH"] ?? ""}`, SHIM_LOG, SUMMON_CLI: CLI };
}

function record(launchId?: string): WorkspaceStatus {
  return {
    project: PROJECT,
    directory: REPO,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    layout: "default",
    panes: ["editor", "shell"],
    source: "summon",
    version: 1,
    ...(launchId ? { launchId, backend: "ghostty" } : {}),
  };
}

/** Spawn /bin/sh running the given script; the shell reads one line from stdin before exiting. */
function spawnShell(script: string): ChildProcess {
  return spawn("/bin/sh", ["-c", `${script}; read __go; exit 0`], { env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
}

function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      if (predicate()) return resolvePromise();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolvePromise) => child.on("exit", (code) => resolvePromise(code)));
}

function shimLog(): string[] {
  return existsSync(SHIM_LOG) ? readFileSync(SHIM_LOG, "utf-8").split("\n").filter(Boolean) : [];
}

/** Pre-revision trap text, copied from develop f5f7901 src/script.ts:148-167 (shell form, after AppleScript unescaping). */
function legacyTrapLine(project: string, targetDir: string): string {
  const body = [
    `mkdir -p "$HOME/.config/summon" "$HOME/.config/summon/logs"`,
    `chmod 700 "$HOME/.config/summon" "$HOME/.config/summon/logs"`,
    `summon snapshot save --dir "${targetDir}" --project "${project}" --layout "unknown" 2>/dev/null`,
    `rm -f "$HOME/.config/summon/status/${project}.active" "$HOME/.config/summon/status/${project}.pid" 2>/dev/null`,
  ].join("; ");
  return `__summon_cleanup() { ${body}; }; trap '__summon_cleanup' EXIT HUP`;
}

beforeAll(() => {
  mkdirSync(SHIM_DIR, { recursive: true });
  const shim = join(SHIM_DIR, "summon");
  writeFileSync(shim, [
    "#!/bin/sh",
    'node "$SUMMON_CLI" "$@" > "$SHIM_LOG.out" 2>&1',
    "code=$?",
    'out=$(tr \'\\n\' \'|\' < "$SHIM_LOG.out")',
    'printf \'args=%s exit=%s out=%s\\n\' "$*" "$code" "$out" >> "$SHIM_LOG"',
    "exit $code",
    "",
  ].join("\n"));
  chmodSync(shim, 0o755);
  mkdirSync(REPO, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: REPO, env: gitEnv });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: REPO, env: gitEnv });
}, 60_000);

afterAll(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(STATUS_DIR, { recursive: true, force: true });
  rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  rmSync(SHIM_LOG, { force: true });
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  rmSync(SHIM_LOG, { force: true });
});

describe("real-process ownership interleavings (plan Phase 1)", () => {
  it("slow on-stop, relaunch mid-trap: the old trap removes only its own files and its snapshot save is superseded", async () => {
    // Launch A publishes its record and runs the bootstrap + trap (on-stop sleeps 2 s).
    writeStatus(record(GEN_A));
    const pathsA = launchArtifactPaths(PROJECT, GEN_A);
    mkdirSync(pathsA.dir, { recursive: true });
    writeFileSync(pathsA.pane("editor").file, "session:x\nblock:y\n");
    // A pre-existing snapshot that a superseded save must not touch.
    const result = spawnSync("node", [CLI, "snapshot", "save", "--dir", REPO, "--project", PROJECT, "--layout", "before"], { env: childEnv(), encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, result.stderr).toContain(`Snapshot saved for ${PROJECT}`);
    rmSync(SHIM_LOG, { force: true });
    const snapshotFile = join(SNAPSHOTS_DIR, `${PROJECT}.json`);
    const snapshotBefore = readFileSync(snapshotFile, "utf-8");

    // on-stop sleeps 2 s: wide enough that launch B's publication lands inside A's trap even under full-suite load.
    const shellA = spawnShell(`${bootstrapLine(PROJECT, GEN_A, "ghostty")}; ${cleanupTrapLine(PROJECT, GEN_A, { onStop: "sleep 2", targetDir: REPO, layout: "default" })}`);
    await waitFor(() => existsSync(pathsA.active), 5_000, "launch A bootstrap");
    expect(readFileSync(pathsA.active, "utf-8").trim()).toBe(GEN_A);
    expect(Number(readFileSync(pathsA.pid, "utf-8").trim())).toBe(shellA.pid);

    // A's shell exits: its trap starts with the slow on-stop.
    shellA.stdin!.write("\n");
    await new Promise((r) => setTimeout(r, 200));

    // Launch B publishes its record and bootstrap while A's trap is still inside on-stop.
    writeStatus(record(GEN_B));
    const pathsB = launchArtifactPaths(PROJECT, GEN_B);
    const shellB = spawnShell(bootstrapLine(PROJECT, GEN_B, "ghostty"));
    await waitFor(() => existsSync(pathsB.active), 5_000, "launch B bootstrap");
    // A's trap removes its liveness files first (F21), while it is still inside the slow on-stop.
    await waitFor(() => !existsSync(pathsA.active) && !existsSync(pathsA.pid), 5_000, "A's trap removes its liveness files first");
    expect(shellA.exitCode).toBeNull();

    expect(await exited(shellA)).toBe(0);

    // B is intact, A's own liveness files are gone, A's pane file stays, the record is B's.
    expect(readStatusRecord(PROJECT)?.launchId).toBe(GEN_B);
    expect(readFileSync(pathsB.active, "utf-8").trim()).toBe(GEN_B);
    expect(existsSync(pathsB.pid)).toBe(true);
    expect(existsSync(pathsA.pid)).toBe(false);
    expect(existsSync(pathsA.active)).toBe(false);
    expect(existsSync(pathsA.pane("editor").file)).toBe(true);

    // The shim saw exactly one snapshot save carrying A's launch id; it was superseded: silent, exit 0, no write.
    const log = shimLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain(`--launch ${GEN_A}`);
    expect(log[0]).toMatch(/exit=0 out=$/);
    expect(readFileSync(snapshotFile, "utf-8")).toBe(snapshotBefore);

    shellB.stdin!.write("\n");
    await exited(shellB);
  }, 30_000);

  it("legacy trap after upgrade: removes only the legacy paths and saves one unconditional snapshot", async () => {
    writeStatus(record(GEN_B));
    const pathsB = launchArtifactPaths(PROJECT, GEN_B);
    mkdirSync(pathsB.dir, { recursive: true });
    writeFileSync(pathsB.pid, "4242\n");
    writeFileSync(pathsB.active, `${GEN_B}\n`);
    writeFileSync(pathsB.pane("editor").file, "session:x\nblock:y\n");
    writeFileSync(join(STATUS_DIR, `${PROJECT}.active`), "");
    writeFileSync(join(STATUS_DIR, `${PROJECT}.pid`), "4141\n");
    const recordBefore = readFileSync(join(STATUS_DIR, `${PROJECT}.json`), "utf-8");

    const shell = spawnShell(legacyTrapLine(PROJECT, REPO));
    shell.stdin!.write("\n");
    expect(await exited(shell)).toBe(0);

    expect(readFileSync(join(STATUS_DIR, `${PROJECT}.json`), "utf-8")).toBe(recordBefore);
    expect(existsSync(pathsB.pid)).toBe(true);
    expect(existsSync(pathsB.active)).toBe(true);
    expect(existsSync(pathsB.pane("editor").file)).toBe(true);
    expect(existsSync(join(STATUS_DIR, `${PROJECT}.active`))).toBe(false);
    expect(existsSync(join(STATUS_DIR, `${PROJECT}.pid`))).toBe(false);

    const log = shimLog();
    expect(log).toHaveLength(1);
    expect(log[0]).not.toContain("--launch");
    expect(log[0]).toMatch(new RegExp(`exit=0 out=Snapshot saved for ${PROJECT}\\|?$`));
    expect(existsSync(join(SNAPSHOTS_DIR, `${PROJECT}.json`))).toBe(true);
  }, 30_000);

  it("two traps for the same launch (EXIT and HUP): the per-launch removal is idempotent and exits 0", async () => {
    writeStatus(record(GEN_A));
    const pathsA = launchArtifactPaths(PROJECT, GEN_A);
    const shell = spawnShell(`${bootstrapLine(PROJECT, GEN_A, "ghostty")}; ${cleanupTrapLine(PROJECT, GEN_A, { targetDir: REPO, layout: "default" })}; __summon_cleanup`);
    // The first run's last step is the rm of its own files; wait for that, not just the snapshot call.
    await waitFor(() => existsSync(pathsA.active) === false && shimLog().length >= 1, 10_000, "first cleanup run");
    expect(shimLog()).toHaveLength(1);
    expect(existsSync(pathsA.pid)).toBe(false);
    shell.stdin!.write("\n");
    expect(await exited(shell)).toBe(0);
    expect(shimLog()).toHaveLength(2);
    expect(existsSync(pathsA.pid)).toBe(false);
    expect(existsSync(pathsA.active)).toBe(false);
    expect(readStatusRecord(PROJECT)?.launchId).toBe(GEN_A);
  }, 30_000);
});

// SE-L1: the bootstrap and trap are typed into an interactive login zsh, where history expansion
// is on; /bin/sh -c above never expands `!`. Feed the generated lines to a real interactive zsh.
const ZSH_AVAILABLE = spawnSync("zsh", ["-f", "-c", "exit 0"]).status === 0;

describe.skipIf(!ZSH_AVAILABLE)("typed text in an interactive zsh with history expansion (SE-L1)", () => {
  afterEach(() => clearSelfInvocation());

  it("a project directory, node binary and script path containing ! still run the trap", async () => {
    const targetDir = join(TEMP_HOME, "wow!proj");
    const toolsDir = join(TEMP_HOME, "tools!bin");
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(toolsDir, { recursive: true });
    const shim = join(toolsDir, "summon!cli");
    writeFileSync(shim, 'printf \'args=%s\\n\' "$*" >> "$SHIM_LOG"\n');
    registerSelfInvocation("/bin/sh", shim);
    const paths = launchArtifactPaths(PROJECT, GEN_A);

    const zsh = spawn("zsh", ["-f", "-i"], { env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    zsh.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    // The first line proves history expansion is on in this shell: it must fail with "event not found".
    zsh.stdin!.write([
      'print -r -- "probe!probe"',
      bootstrapLine(PROJECT, GEN_A, "ghostty"),
      cleanupTrapLine(PROJECT, GEN_A, { targetDir, layout: "default" }),
      "exit",
      "",
    ].join("\n"));
    const code = await exited(zsh);

    expect(stderr.match(/event not found/g), stderr).toHaveLength(1);
    expect(code).toBe(0);
    // The bootstrap ran and the trap removed its own files on exit.
    expect(existsSync(paths.active)).toBe(false);
    expect(existsSync(paths.pid)).toBe(false);
    expect(shimLog()).toEqual([`args=snapshot save --dir ${targetDir} --project ${PROJECT} --layout default --launch ${GEN_A}`]);
  }, 30_000);
});
