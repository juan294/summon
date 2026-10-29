import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { build } from "tsup";
import { withFileLock } from "./file-lock.js";

const dirs: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "summon-file-lock-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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
