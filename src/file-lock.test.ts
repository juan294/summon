import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { build } from "tsup";

// In-process fault injection for the contention, error and recovery branches (QA-L1): each wrapper
// delegates to the real function unless a test installs a hook. The subprocess suites below bundle
// the real module and are unaffected.
type FsHook = (real: (...args: never[]) => unknown, ...args: never[]) => unknown;
const hooks = vi.hoisted(() => ({} as Partial<Record<"readdirSync" | "renameSync" | "unlinkSync" | "rmdirSync" | "lstatSync", FsHook>>));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const wrap = <K extends keyof typeof hooks>(name: K) => (...args: never[]) => {
    const real = fs[name] as unknown as (...args: never[]) => unknown;
    const hook = hooks[name];
    return hook ? hook(real, ...args) : real(...args);
  };
  return { ...fs, readdirSync: wrap("readdirSync"), renameSync: wrap("renameSync"), unlinkSync: wrap("unlinkSync"), rmdirSync: wrap("rmdirSync"), lstatSync: wrap("lstatSync") };
});

import { describeLock, inspectLock, recoverStaleLock, STALE_LOCK_MS, withFileLock, withFileLockAsync } from "./file-lock.js";

const dirs: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "summon-file-lock-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const key of Object.keys(hooks)) delete hooks[key as keyof typeof hooks];
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function owner(file: string, pid: number): string {
  mkdirSync(`${file}.lock`);
  const token = `${pid}-${randomUUID()}.owner`;
  writeFileSync(join(`${file}.lock`, token), "");
  return token;
}

describe("per-file transaction lock", () => {
  it("returns results and releases the lock when the callback throws", () => {
    const dir = fixture(), file = join(dir, "config");
    expect(withFileLock(file, () => 42)).toBe(42);
    const original = new Error("write failed");
    expect(() => withFileLock(file, () => { throw original; })).toThrow(original);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("times out on a live owner without deleting its token or leaving staging files", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    expect(() => withFileLock(file, () => { throw new Error("must not enter"); }, 20)).toThrow("Timed out waiting for config lock");
    expect(readdirSync(dir)).toEqual(["config.lock"]);
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
  });

  it("fails closed for unknown ownership and recovers an interrupted empty release", () => {
    const dir = fixture(), file = join(dir, "config");
    mkdirSync(`${file}.lock`);
    writeFileSync(join(`${file}.lock`, "unknown"), "");
    expect(() => withFileLock(file, () => 1, 10)).toThrow("Timed out");
    expect(readdirSync(`${file}.lock`)).toEqual(["unknown"]);
    rmSync(`${file}.lock`, { recursive: true });
    mkdirSync(`${file}.lock`);
    expect(withFileLock(file, () => 2)).toBe(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does not hide an acquisition error and cleans its staging directory", () => {
    const dir = fixture(), file = join(dir, "config");
    writeFileSync(`${file}.lock`, "not a directory");
    expect(() => withFileLock(file, () => 1)).toThrow();
    expect(readdirSync(dir)).toEqual(["config.lock"]);
  });

  it.each([
    ["SIGINT", "preexisting"], ["SIGTERM", "preexisting"],
    ["SIGINT", "publication-conflict"], ["SIGTERM", "publication-conflict"],
  ] as const)("leaves no waiter staging after %s during %s contention", async (signal, contention) => {
    const dir = fixture(), file = join(dir, "config");
    writeFileSync(file, "keep=original\n");
    const token = contention === "preexisting" ? owner(file, process.pid) : `${process.pid}-${randomUUID()}.owner`;
    await build({ config: false, entry: { lock: new URL("./file-lock.ts", import.meta.url).pathname }, outDir: dir, outExtension: () => ({ js: ".mjs" }), platform: "node", format: ["esm"], silent: true });
    writeFileSync(join(dir, "interrupt.mjs"), `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const [file, token, contention] = process.argv.slice(2);
      const rename = fs.renameSync;
      if (contention === 'publication-conflict') {
        fs.renameSync = function(from, to) {
          // Inject only an OS publication race: another live owner wins just
          // before the real rename. The product helper remains unmodified.
          if (String(to) === file + '.lock' && !fs.existsSync(to)) {
            fs.mkdirSync(to);
            fs.writeFileSync(to + '/' + token, '');
          }
          return rename.call(this, from, to);
        };
      }
      const readdir = fs.readdirSync;
      let reported = false;
      fs.readdirSync = function(path, ...args) {
        const result = readdir.call(this, path, ...args);
        if (String(path) === file + '.lock' && !reported) {
          reported = true;
          process.stdout.write('waiting\\n');
        }
        return result;
      };
      syncBuiltinESMExports();
      const { withFileLock } = await import('./lock.mjs');
      withFileLock(file, () => fs.writeFileSync(file, 'must-not-write'));
    `);
    const child = spawn(process.execPath, [join(dir, "interrupt.mjs"), file, token, contention], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    void done.catch(() => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once("data", () => resolve());
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`waiter exited before contention (${code}): ${stderr}`)));
      });
      expect(child.kill(signal)).toBe(true);
      expect(await done).toEqual({ code: null, signal });
      expect(readFileSync(file, "utf8")).toBe("keep=original\n");
      expect(readdirSync(`${file}.lock`)).toEqual([token]);
      expect(readdirSync(dir).filter((name) => name.startsWith("config.lock-"))).toEqual([]);
      // Release only the exact fixture owner, then retry against the same bytes.
      rmSync(`${file}.lock`, { recursive: true });
      expect(withFileLock(file, () => readFileSync(file, "utf8"))).toBe("keep=original\n");
      expect(readdirSync(dir).filter((name) => name.startsWith("config.lock"))).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await Promise.allSettled([done]);
    }
  });

  it("serializes competing stale reclaimers without deleting a newly published owner", async () => {
    const dir = fixture(), file = join(dir, "config");
    const dead = spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
    expect(dead.status).toBe(0);
    owner(file, dead.pid);
    await build({ config: false, entry: { lock: new URL("./file-lock.ts", import.meta.url).pathname }, outDir: dir, outExtension: () => ({ js: ".mjs" }), platform: "node", format: ["esm"], silent: true });
    writeFileSync(join(dir, "worker.mjs"), `
      import fs from 'node:fs';
      import { withFileLock } from './lock.mjs';
      const [file, gate] = process.argv.slice(2);
      process.stdout.write('ready\\n');
      while (!fs.existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      withFileLock(file, () => {
        fs.writeFileSync(file + '.critical', '', {flag:'wx'});
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
        fs.unlinkSync(file + '.critical');
      });
    `);
    const gate = join(dir, "go");
    const workers = Array.from({ length: 3 }, () => {
      const child = spawn(process.execPath, [join(dir, "worker.mjs"), file, gate], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.once("data", () => resolve());
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`worker exited before ready (${code}): ${stderr}`)));
      });
      const done = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr))); });
      void done.catch(() => undefined);
      return { child, ready, done };
    });
    try {
      await Promise.all(workers.map(({ ready }) => ready));
      writeFileSync(gate, "");
      await Promise.all(workers.map(({ done }) => done));
      expect(readdirSync(dir).filter((name) => name.startsWith("config"))).toEqual([]);
    } finally {
      for (const { child } of workers) if (child.exitCode === null) child.kill();
      await Promise.allSettled(workers.map(({ done }) => done));
    }
  });
});

/** Set a path's mtime `ms` in the past. */
function age(path: string, ms: number): void {
  const seconds = (Date.now() - ms) / 1000;
  utimesSync(path, seconds, seconds);
}
const errno = (code: string): Error => Object.assign(new Error(code), { code });
function deadPid(): number {
  const dead = spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
  expect(dead.status).toBe(0);
  return dead.pid!;
}

describe("asynchronous transaction lock (BE-L1)", () => {
  const options = { timeoutMs: 2000, timeoutMessage: "timed out waiting for the launch lock", pollMs: 5 };

  it("serializes two transactions of one file: the second starts after the first finished, and is told once that it waits", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const onWait = vi.fn();
    const first = withFileLockAsync(file, async () => { events.push("first:start"); await firstHeld; events.push("first:end"); return 1; }, options);
    const second = withFileLockAsync(file, async () => { events.push("second:start"); return 2; }, { ...options, onWait });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(events).toEqual(["first:start"]);
    expect(onWait).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("releases the lock when the transaction rejects, and rethrows its error", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    const original = new Error("create failed");
    await expect(withFileLockAsync(file, async () => { throw original; }, options)).rejects.toBe(original);
    expect(readdirSync(dir)).toEqual([]);
    await expect(withFileLockAsync(file, async () => "again", options)).resolves.toBe("again");
  });

  it("times out on a live owner with the caller's message, leaving the owner's token", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    const token = owner(file, process.pid);
    await expect(withFileLockAsync(file, async () => { throw new Error("must not enter"); }, { ...options, timeoutMs: 30 })).rejects.toThrow("timed out waiting for the launch lock");
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
  });

  it("a live owner past STALE_LOCK_MS keeps a lock that has its own longer stale bound; past that bound it is recovered", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    const staleMs = 5 * STALE_LOCK_MS;
    const token = owner(file, process.pid);
    // A slow launch: its token is older than the record locks' bound, and its process is alive.
    age(join(`${file}.lock`, token), STALE_LOCK_MS + 5000);
    expect(inspectLock(`${file}.lock`, staleMs)).toMatchObject({ kind: "live", pid: process.pid });
    await expect(withFileLockAsync(file, async () => { throw new Error("must not enter"); }, { ...options, timeoutMs: 60, staleMs })).rejects.toThrow("timed out waiting for the launch lock");
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
    // A hung or suspended owner (Ctrl-Z) is still recovered once past the lock's own bound.
    age(join(`${file}.lock`, token), staleMs + 5000);
    expect(inspectLock(`${file}.lock`, staleMs)).toMatchObject({ kind: "expired" });
    await expect(withFileLockAsync(file, async () => "taken over", { ...options, staleMs })).resolves.toBe("taken over");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("recovers a dead owner at once whatever the lock's stale bound", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    owner(file, deadPid());
    await expect(withFileLockAsync(file, async () => 4, { ...options, staleMs: 5 * STALE_LOCK_MS })).resolves.toBe(4);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("recovers a lock whose owner is proven gone", async () => {
    const dir = fixture(), file = join(dir, "project.launch");
    owner(file, deadPid());
    await expect(withFileLockAsync(file, async () => 3, options)).resolves.toBe(3);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("stale-lock recovery (BE-L2)", () => {
  it("recovers a lock whose owner PID answers but whose token is past the bound (a reused PID)", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    age(join(`${file}.lock`, token), STALE_LOCK_MS + 5000);
    expect(inspectLock(`${file}.lock`)).toMatchObject({ kind: "expired", pid: process.pid, token });
    expect(withFileLock(file, () => 7, 200)).toBe(7);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("treats a token dated more than the bound in the future (clock jumped back) as expired, not live forever", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    age(join(`${file}.lock`, token), -(STALE_LOCK_MS + 5000));
    expect(inspectLock(`${file}.lock`)).toMatchObject({ kind: "expired", pid: process.pid, token });
    expect(withFileLock(file, () => 8, 200)).toBe(8);
    expect(readdirSync(dir)).toEqual([]);
    const near = owner(file, process.pid);
    age(join(`${file}.lock`, near), -(STALE_LOCK_MS - 5000));
    expect(inspectLock(`${file}.lock`)).toMatchObject({ kind: "live" });
  });

  it("describes each state for diagnostics", () => {
    const base = { pid: 7, token: "t", ageMs: 65_400 };
    expect(describeLock({ kind: "absent" })).toBe("no lock");
    expect(describeLock({ kind: "released" })).toBe("interrupted release");
    expect(describeLock({ kind: "unrecognized", entries: ["a", "b"] })).toBe("a, b");
    expect(describeLock({ kind: "live", ...base })).toBe("held by process 7");
    expect(describeLock({ kind: "dead", ...base })).toBe("owner process 7 is gone");
    expect(describeLock({ kind: "expired", ...base })).toBe("owner token is 65 s old");
    expect(describeLock({ kind: "expired", ...base, ageMs: -65_400 })).toBe("owner token is dated 65 s in the future");
  });

  it("recovery says whether the directory is gone", () => {
    const dir = fixture(), file = join(dir, "config");
    mkdirSync(`${file}.lock`);
    hooks.rmdirSync = () => { throw errno("ENOTEMPTY"); };
    expect(recoverStaleLock(`${file}.lock`)).toEqual({ state: { kind: "released" }, removed: false });
    delete hooks.rmdirSync;
    expect(recoverStaleLock(`${file}.lock`)).toEqual({ state: { kind: "released" }, removed: true });
    expect(recoverStaleLock(`${file}.lock`)).toEqual({ state: { kind: "absent" }, removed: false });
  });

  it("never steals a live owner's lock within the bound", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    age(join(`${file}.lock`, token), STALE_LOCK_MS - 5000);
    expect(inspectLock(`${file}.lock`)).toMatchObject({ kind: "live", pid: process.pid, token });
    expect(() => withFileLock(file, () => { throw new Error("must not enter"); }, 20)).toThrow("Timed out waiting for config lock");
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
  });

  it("treats an EPERM probe as live while fresh and recovers it once past the bound", () => {
    const dir = fixture(), file = join(dir, "config");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw errno("EPERM"); });
    const token = owner(file, 4242);
    expect(() => withFileLock(file, () => 1, 20)).toThrow("Timed out");
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
    age(join(`${file}.lock`, token), STALE_LOCK_MS + 1000);
    expect(withFileLock(file, () => 2, 200)).toBe(2);
    expect(kill).toHaveBeenCalledWith(4242, 0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("recovers a fresh lock whose owner is proven gone (ESRCH)", () => {
    const dir = fixture(), file = join(dir, "config");
    const pid = deadPid();
    const token = owner(file, pid);
    expect(inspectLock(`${file}.lock`)).toMatchObject({ kind: "dead", pid, token });
    expect(withFileLock(file, () => 3, 200)).toBe(3);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails closed for several tokens or an unparsable PID, however old", () => {
    const dir = fixture(), file = join(dir, "config");
    const first = owner(file, deadPid());
    const second = `${deadPid()}-${randomUUID()}.owner`;
    writeFileSync(join(`${file}.lock`, second), "");
    age(join(`${file}.lock`, first), STALE_LOCK_MS * 10);
    expect(inspectLock(`${file}.lock`)).toEqual({ kind: "unrecognized", entries: [first, second].sort() });
    expect(() => withFileLock(file, () => 1, 20)).toThrow("Timed out");
    expect(readdirSync(`${file}.lock`).sort()).toEqual([first, second].sort());
    rmSync(`${file}.lock`, { recursive: true });
    mkdirSync(`${file}.lock`);
    const huge = `99999999999999999999-${randomUUID()}.owner`;
    writeFileSync(join(`${file}.lock`, huge), "");
    age(join(`${file}.lock`, huge), STALE_LOCK_MS * 10);
    expect(recoverStaleLock(`${file}.lock`)).toEqual({ state: { kind: "unrecognized", entries: [huge] }, removed: false });
    expect(readdirSync(`${file}.lock`)).toEqual([huge]);
  });

  it("classifies a missing and an empty lock, and recovery removes only the empty one", () => {
    const dir = fixture(), file = join(dir, "config");
    expect(inspectLock(`${file}.lock`)).toEqual({ kind: "absent" });
    mkdirSync(`${file}.lock`);
    expect(inspectLock(`${file}.lock`)).toEqual({ kind: "released" });
    expect(recoverStaleLock(`${file}.lock`)).toEqual({ state: { kind: "released" }, removed: true });
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it("reports absent when the owner releases between listing and stat", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    hooks.lstatSync = (real, ...args) => {
      rmSync(`${file}.lock`, { recursive: true });
      return real(...args);
    };
    expect(inspectLock(`${file}.lock`)).toEqual({ kind: "absent" });
    expect(token).toMatch(/\.owner$/);
  });

  it("rethrows an unexpected stat error of the owner token", () => {
    const dir = fixture(), file = join(dir, "config");
    owner(file, process.pid);
    hooks.lstatSync = () => { throw errno("EACCES"); };
    expect(() => inspectLock(`${file}.lock`)).toThrow("EACCES");
  });
});

describe("contention and error branches in process (QA-L1)", () => {
  it("retries when the lock vanishes between the existence check and the listing", () => {
    const dir = fixture(), file = join(dir, "config");
    owner(file, process.pid);
    let vanished = false;
    hooks.readdirSync = (real, ...args) => {
      if (!vanished && String(args[0]) === `${file}.lock`) {
        vanished = true;
        rmSync(`${file}.lock`, { recursive: true });
      }
      return real(...args);
    };
    expect(withFileLock(file, () => 4, 200)).toBe(4);
    expect(vanished).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rethrows an unexpected listing error and leaves the lock in place", () => {
    const dir = fixture(), file = join(dir, "config");
    const token = owner(file, process.pid);
    hooks.readdirSync = (real, ...args) => {
      if (String(args[0]) === `${file}.lock`) throw errno("EACCES");
      return real(...args);
    };
    expect(() => withFileLock(file, () => 1, 200)).toThrow("EACCES");
    delete hooks.readdirSync;
    expect(readdirSync(`${file}.lock`)).toEqual([token]);
  });

  it("loses a publication race: disposes its own staging and never enters while the winner lives", () => {
    const dir = fixture(), file = join(dir, "config");
    const winner = `${process.pid}-${randomUUID()}.owner`;
    hooks.renameSync = (real, ...args) => {
      const to = String(args[1]);
      if (to === `${file}.lock` && !existsSync(to)) {
        mkdirSync(to);
        writeFileSync(join(to, winner), "");
      }
      return real(...args);
    };
    expect(() => withFileLock(file, () => { throw new Error("must not enter"); }, 20)).toThrow("Timed out");
    expect(readdirSync(dir)).toEqual(["config.lock"]);
    expect(readdirSync(`${file}.lock`)).toEqual([winner]);
  });

  it("rethrows a publication error that is not a race and removes its staging", () => {
    const dir = fixture(), file = join(dir, "config");
    hooks.renameSync = (real, ...args) => {
      if (String(args[1]) === `${file}.lock`) throw errno("EACCES");
      return real(...args);
    };
    expect(() => withFileLock(file, () => 1)).toThrow("EACCES");
    expect(readdirSync(dir)).toEqual([]);
    hooks.renameSync = () => { throw new Error("no errno"); };
    expect(() => withFileLock(file, () => 1)).toThrow("no errno");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("surfaces an unexpected release error from the token or the directory", () => {
    const dir = fixture(), file = join(dir, "config");
    hooks.unlinkSync = (real, ...args) => {
      if (String(args[0]).startsWith(`${file}.lock/`)) throw errno("EACCES");
      return real(...args);
    };
    expect(() => withFileLock(file, () => 1)).toThrow("EACCES");
    delete hooks.unlinkSync;
    rmSync(`${file}.lock`, { recursive: true });
    hooks.rmdirSync = (real, ...args) => {
      if (String(args[0]) === `${file}.lock`) throw errno("EBUSY");
      return real(...args);
    };
    expect(() => withFileLock(file, () => 1)).toThrow("EBUSY");
    rmSync(`${file}.lock`, { recursive: true });
    hooks.rmdirSync = () => { throw new Error("no errno"); };
    expect(() => withFileLock(file, () => 1)).toThrow("no errno");
  });
});

describe("staging sweep (BE-L2)", () => {
  function staging(dir: string, base: string, ageMs: number, withToken = true): string {
    const token = `${deadPid()}-${randomUUID()}.owner`;
    const path = join(dir, `${base}.lock-${token}.tmp`);
    mkdirSync(path);
    if (withToken) writeFileSync(join(path, token), "");
    age(path, ageMs);
    return `${base}.lock-${token}.tmp`;
  }

  it("removes this file's staging directories past the bound and keeps fresh, foreign and unrecognized ones", () => {
    const dir = fixture(), file = join(dir, "config");
    staging(dir, "config", STALE_LOCK_MS + 5000);
    staging(dir, "config", STALE_LOCK_MS + 5000, false);
    const fresh = staging(dir, "config", 1000);
    const foreign = staging(dir, "projects", STALE_LOCK_MS + 5000);
    mkdirSync(join(dir, "config.lock-junk.tmp"));
    age(join(dir, "config.lock-junk.tmp"), STALE_LOCK_MS + 5000);
    expect(withFileLock(file, () => 5)).toBe(5);
    expect(readdirSync(dir).sort()).toEqual([fresh, "config.lock-junk.tmp", foreign].sort());
  });

  it("sweeps after the release, so the sweep is not lock hold time", () => {
    const dir = fixture(), file = join(dir, "config");
    let lockHeldDuringSweep: boolean | undefined;
    hooks.readdirSync = (real, ...args) => {
      if (String(args[0]) === dir) lockHeldDuringSweep = existsSync(`${file}.lock`);
      return real(...args);
    };
    expect(withFileLock(file, () => 9)).toBe(9);
    expect(lockHeldDuringSweep).toBe(false);
  });

  it("never fails the transaction when the sweep cannot list or stat", () => {
    const dir = fixture(), file = join(dir, "config");
    const kept = staging(dir, "config", STALE_LOCK_MS + 5000);
    hooks.lstatSync = (real, ...args) => {
      if (String(args[0]).endsWith(".tmp")) throw errno("EACCES");
      return real(...args);
    };
    expect(withFileLock(file, () => 6)).toBe(6);
    delete hooks.lstatSync;
    hooks.readdirSync = (real, ...args) => {
      if (String(args[0]) === dir) throw errno("EACCES");
      return real(...args);
    };
    expect(withFileLock(file, () => 7)).toBe(7);
    delete hooks.readdirSync;
    expect(readdirSync(dir)).toEqual([kept]);
  });
});
