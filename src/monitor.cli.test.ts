import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliBuild } from "./fixtures/cli-builds.js";
import { MONITOR_READ_ARG } from "./monitor.js";

// PE-H1: the bundled CLI answers the hidden flag the monitor starts its child with, under a sandboxed HOME.
let tempRoot = "";
let cli = "";

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "summon-monitor-cli-"));
  cli = cliBuild("unsplit");
});
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
      env: { ...process.env, HOME: home },
      timeout: 30_000,
    });
    const statuses = JSON.parse(stdout) as Array<{ project: string; state: string; uptime: number | null }>;
    expect(statuses.map((s) => [s.project, s.state])).toEqual([["ghost", "active"]]);
    expect(statuses[0]!.uptime).toBeGreaterThan(0);
  });
});

describe("summon status (bundled CLI in a terminal)", () => {
  it("renders the first child read for a Rex record and quits on q", () => {
    const home = join(tempRoot, "monitor-home");
    const statusDir = join(home, ".config", "summon", "status");
    mkdirSync(statusDir, { recursive: true });
    // A record without native identity is reported as unknown without contacting a Rex server.
    writeFileSync(join(statusDir, "rex-project.json"), JSON.stringify({
      version: 1, source: "summon", project: "rex-project", directory: home, pid: 0,
      startedAt: new Date().toISOString(), layout: "minimal", panes: [], backend: "rex",
    }));

    // Spawn the bundled CLI as the foreground process in a real PTY. The reader sends q
    // only after the project appears, so a silent early exit cannot pass this test.
    const driveTerminal = `
import os, pty, sys
screen = bytearray()
def read_frame(fd):
    chunk = os.read(fd, 65536)
    if b"rex-project" not in screen:
        screen.extend(chunk)
        if b"rex-project" in screen:
            os.write(fd, b"q")
    return chunk
sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:], master_read=read_frame)))
`;
    const output = execFileSync("python3", ["-c", driveTerminal, process.execPath, cli, "status"], {
      encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: home, SUMMON_NO_VISIBILITY: "1" },
    });
    expect(output).toContain("rex-project");
    expect(output).toContain("unknown");
    expect(output).toContain("\x1b[?1049l"); // q restored the normal screen
  });
});
