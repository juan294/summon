import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCliInto } from "./fixtures/build-cli.js";
import { MONITOR_READ_ARG } from "./monitor.js";

// PE-H1: the bundled CLI answers the hidden flag the monitor starts its child with, under a sandboxed HOME.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let tempRoot = "";
let cli = "";

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "summon-monitor-cli-"));
  cli = await buildCliInto(PROJECT_ROOT, join(tempRoot, "cli"));
}, 60_000);
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe("summon --internal-monitor-read (bundled CLI)", () => {
  it("prints the statuses as JSON: a live Ghostty record is active, with nothing else on stdout", () => {
    const home = join(tempRoot, "home");
    const statusDir = join(home, ".config", "summon", "status");
    mkdirSync(statusDir, { recursive: true });
    writeFileSync(join(statusDir, "ghost.json"), JSON.stringify({
      version: 1, source: "summon", project: "ghost", directory: home, pid: process.pid,
      startedAt: new Date(Date.now() - 60_000).toISOString(), layout: "minimal", panes: ["editor"],
    }));
    writeFileSync(join(statusDir, "ghost.active"), "");
    writeFileSync(join(statusDir, "ghost.pid"), String(process.pid));
    const stdout = execFileSync(process.execPath, [cli, MONITOR_READ_ARG], {
      encoding: "utf-8",
      env: { ...process.env, HOME: home, SUMMON_NO_CACHE: "1" },
      timeout: 30_000,
    });
    const statuses = JSON.parse(stdout) as Array<{ project: string; state: string; uptime: number | null }>;
    expect(statuses.map((s) => [s.project, s.state])).toEqual([["ghost", "active"]]);
    expect(statuses[0]!.uptime).toBeGreaterThan(0);
  });
});
