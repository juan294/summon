import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cliBuild, type CliFlavor } from "../fixtures/cli-builds.js";

// `summon keybindings rex` through both bundled CLI flavors: it prints the canonical Lua file byte for byte, from any
// directory, without reading an untrusted project config. The Ghostty forms keep their output (baseline from develop
// 0bd8224, default layout, captured 2026-11-19).
const LUA = readFileSync(resolve("integrations/rex/summon-workspace.lua"), "utf-8");

const GHOSTTY_HEADER = [
  "# Summon workspace navigation — default layout",
  "# Pane mapping:",
  "#   [0] editor",
  "#   [1] sidebar",
  "#   [2] right-1",
  "#   [3] shell",
  "#",
  "# Activate with: keybind = alt+s = key_table:summon-nav",
  "",
];
const GHOSTTY_TAIL = [
  "keybind = summon-nav:1 = focus_split:0",
  "keybind = summon-nav:2 = focus_split:1",
  "keybind = summon-nav:3 = focus_split:2",
  "keybind = summon-nav:4 = focus_split:3",
  "keybind = summon-nav:z = toggle_split_zoom",
  "keybind = summon-nav:escape = pop_key_table",
  "",
  "",
];
const arrows = ["left", "down", "up", "right"].map((d) => `keybind = summon-nav:${d} = focus_split:${d}`);
const vim = [["h", "left"], ["j", "down"], ["k", "up"], ["l", "right"]].map(([k, d]) => `keybind = summon-nav:${k} = focus_split:${d}`);
const BASELINE = [...GHOSTTY_HEADER, ...arrows, ...GHOSTTY_TAIL].join("\n");
const BASELINE_VIM = [...GHOSTTY_HEADER, ...vim, ...GHOSTTY_TAIL].join("\n");

let tempRoot = "";
let home = "";
let plainDir = "";
let projectDir = "";

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "summon-keybindings-rex-"));
  home = join(tempRoot, "home");
  mkdirSync(join(home, ".config", "summon"), { recursive: true });
  plainDir = join(tempRoot, "elsewhere");
  mkdirSync(plainDir);
  // A project with an untrusted .summon: the Rex form must not read or prompt for it.
  projectDir = join(tempRoot, "project");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, ".summon"), "layout=full\neditor=vim\n");
});
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

function run(flavor: CliFlavor, args: string[], cwd = plainDir) {
  return spawnSync(process.execPath, [cliBuild(flavor), "keybindings", ...args], {
    encoding: "utf-8",
    cwd,
    input: "",
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
    timeout: 30_000,
  });
}

describe.each<CliFlavor>(["unsplit", "production"])("summon keybindings rex (%s build)", (flavor) => {
  it("prints the canonical Lua file byte for byte", () => {
    const result = run(flavor, ["rex"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(LUA);
  });

  it("prints the same bytes in a project with an untrusted .summon, without a trust prompt", () => {
    const result = run(flavor, ["rex"], projectDir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(LUA);
  });

  it.each([[["rex", "extra"]], [["rex", "--vim"]], [["rex", "--detach-tab"]]])("refuses %j with usage", (args) => {
    const result = run(flavor, args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: summon keybindings rex");
  });

  it("keeps the Ghostty key table output", () => {
    expect(run(flavor, []).stdout).toBe(BASELINE);
    expect(run(flavor, ["--vim"]).stdout).toBe(BASELINE_VIM);
  });
});

describe("the canonical Lua file", () => {
  it("registers the named action and keeps the binding commented out", () => {
    expect(LUA).toContain('name = "summon_open_workspace"');
    expect(LUA).toContain('title = "Summon: Open workspace…"');
    expect(LUA).toMatch(/^-- {3}rex\.bind\("shift\+cmd\+o", "summon_open_workspace"\)$/m);
    expect(LUA).not.toMatch(/^\s*rex\.bind\(/m);
    expect(LUA.endsWith("\n")).toBe(true);
  });
});
