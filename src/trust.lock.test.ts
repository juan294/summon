import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cliBuild } from "./fixtures/cli-builds.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

describe("SE-L5: concurrent trust grants (real processes, sandbox HOME)", () => {
  it("keeps a grant another process publishes while summon trust waits for the lock", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "summon-trust-lock-")));
    homes.push(home);
    const trustFile = join(home, ".config", "summon", "trust.json");
    const project = join(home, "project");
    mkdirSync(project);
    writeFileSync(join(project, ".summon"), "editor = vim\n");
    // This test process is the live owner of the trust DB lock.
    mkdirSync(`${trustFile}.lock`, { recursive: true });
    writeFileSync(join(`${trustFile}.lock`, `${process.pid}-${randomUUID()}.owner`), "");
    const child = spawn(process.execPath, [cliBuild("unsplit"), "trust", project], {
      env: { ...process.env, HOME: home, SUMMON_NO_CACHE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    try {
      // An unlocked writer would have read the missing DB and exited by now.
      const early = await Promise.race([exited.then(() => `exited early: ${stderr}`), new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 1000))]);
      expect(early).toBe("waiting");
      // Proof the child waits on the lock: it is still running and has written nothing.
      expect(child.exitCode).toBeNull();
      expect(existsSync(trustFile)).toBe(false);
      const other = { "/other": "b".repeat(64) };
      writeFileSync(trustFile, JSON.stringify(other));
      rmSync(`${trustFile}.lock`, { recursive: true });
      expect(await exited, stderr).toBe(0);
      expect(JSON.parse(readFileSync(trustFile, "utf8"))).toEqual({ ...other, [project]: createHash("sha256").update("editor = vim\n").digest("hex") });
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await Promise.allSettled([exited]);
    }
  });
});
