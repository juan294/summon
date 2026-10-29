import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
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
