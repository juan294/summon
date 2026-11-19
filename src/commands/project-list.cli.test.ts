import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliBuild } from "../fixtures/cli-builds.js";
import { writeFakeRex } from "../fixtures/fake-rex.js";

// `summon list` through the bundled CLI under a synthetic HOME: the human list keeps its exact output, and
// `--json` prints the registry as one JSON array for the Rex workspace picker.
let tempRoot = "";
let cli = "";
let caseIndex = 0;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "summon-list-cli-"));
  cli = cliBuild("unsplit");
});
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

type Run = { status: number | null; stdout: string; stderr: string; rexCalled: boolean };

/**
 * Run `command ...args` (the bundled CLI by default) with the registry `projects` (raw file text, or none) and a
 * sentinel `rex` that records any invocation.
 */
function runList(
  projects: string | null,
  args: string[] = [],
  setup?: (home: string) => void,
  command: string[] = [process.execPath, cli, "list"],
): Run {
  const root = join(tempRoot, `case-${caseIndex++}`);
  const home = join(root, "home");
  const binDir = join(root, "bin");
  const marker = join(root, "rex-called");
  mkdirSync(join(home, ".config", "summon"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  if (projects !== null) writeFileSync(join(home, ".config", "summon", "projects"), projects);
  setup?.(home);
  writeFakeRex(join(binDir, "rex"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); process.exit(1);\n`);
  const [file, ...prefix] = command;
  const result = spawnSync(file!, [...prefix, ...args], {
    encoding: "utf-8",
    cwd: root,
    // A Rex terminal context: listing must still never run the `rex` CLI.
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      REX_BIN_DIR: binDir,
      TERM_PROGRAM: "rex",
      REX_SERVER: `unix://${join(root, "no-server.sock")}`,
      NO_COLOR: "1",
    },
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, rexCalled: existsSync(marker) };
}

describe("sentinel rex (positive control)", () => {
  it("is the rex found first on PATH, and records a call", () => {
    expect(runList(null, [], undefined, ["rex"]).rexCalled).toBe(true);
  });
});

describe("summon list (bundled CLI), human output", () => {
  it("prints the registered projects exactly as before", () => {
    const run = runList("api=/tmp/api\nweb=/tmp/web\n");
    expect(run).toEqual({
      status: 0,
      stdout: "Registered projects:\n  api → /tmp/api\n  web → /tmp/web\n",
      stderr: "",
      rexCalled: false,
    });
  });

  it("prints the empty-state hint exactly as before", () => {
    const run = runList(null);
    expect(run).toEqual({
      status: 0,
      stdout: "No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.\n",
      stderr: "",
      rexCalled: false,
    });
  });
});

describe("summon list --json (bundled CLI)", () => {
  it("prints [] and a final newline for an empty registry", () => {
    const run = runList(null, ["--json"]);
    expect(run).toEqual({ status: 0, stdout: "[]\n", stderr: "", rexCalled: false });
  });

  it("prints [] for a registry file holding only comments and blank lines", () => {
    const run = runList("# projects\n\n", ["--json"]);
    expect(run).toEqual({ status: 0, stdout: "[]\n", stderr: "", rexCalled: false });
  });

  it("prints every registration in registry order, with exact names and directories", () => {
    const run = runList(
      [
        "demo=/tmp/demo = one",
        "zeta=/Users/someone/Proyectos/café ☕",
        "alpha=/tmp/with space/and=equals",
        "never.launched-1=/tmp/never",
        "",
      ].join("\n"),
      ["--json"],
    );
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.rexCalled).toBe(false);
    expect(run.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(run.stdout)).toEqual([
      { name: "demo", directory: "/tmp/demo = one" },
      { name: "zeta", directory: "/Users/someone/Proyectos/café ☕" },
      { name: "alpha", directory: "/tmp/with space/and=equals" },
      { name: "never.launched-1", directory: "/tmp/never" },
    ]);
  });

  it("keeps the parser warning on stderr while the valid rows still parse", () => {
    const run = runList("api=/tmp/api\nthis line is broken\nweb=/tmp/web\n", ["--json"]);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("summon: warning: ignored malformed config line: this line is broken\n");
    expect(JSON.parse(run.stdout)).toEqual([
      { name: "api", directory: "/tmp/api" },
      { name: "web", directory: "/tmp/web" },
    ]);
  });

  it("reports a hand-edited name as read, for the action to validate", () => {
    const run = runList("bad name!=/tmp/bad\nok=/tmp/ok\n", ["--json"]);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([
      { name: "bad name!", directory: "/tmp/bad" },
      { name: "ok", directory: "/tmp/ok" },
    ]);
  });

  it("lists launched and never-launched registrations alike, and leaves out a status-only workspace", () => {
    const run = runList("api=/tmp/api\nfresh=/tmp/fresh\n", ["--json"], (home) => {
      const statusDir = join(home, ".config", "summon", "status");
      mkdirSync(statusDir, { recursive: true });
      for (const project of ["api", "ghost"]) {
        writeFileSync(join(statusDir, `${project}.json`), JSON.stringify({
          version: 1, source: "summon", project, directory: home, pid: process.pid,
          startedAt: new Date().toISOString(), layout: "minimal", panes: ["editor"],
        }));
      }
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([
      { name: "api", directory: "/tmp/api" },
      { name: "fresh", directory: "/tmp/fresh" },
    ]);
    expect(run.rexCalled).toBe(false);
  });
});
