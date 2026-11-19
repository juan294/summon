#!/usr/bin/env node
// pnpm test:lua: run the Rex palette action's Lua tests with a Lua 5.1-compatible interpreter.
// Not part of `pnpm test`: it needs a system Lua. Exits nonzero when none is found.
//   node scripts/test-lua.mjs [action.lua]   (default: integrations/rex/summon-workspace.lua)
// The candidate JSON comes from the built CLI (dist/index.js, so run `pnpm build` first) under a
// throwaway HOME. SUMMON_TEST_LUA overrides the interpreter.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = resolve(process.argv[2] ?? join(root, "integrations", "rex", "summon-workspace.lua"));
const harness = join(root, "integrations", "rex", "test", "summon-workspace.test.lua");
const cli = join(root, "dist", "index.js");

function luaVersion(bin) {
  const probe = spawnSync(bin, ["-e", "io.write(_VERSION)"], { encoding: "utf-8" });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

const candidates = process.env.SUMMON_TEST_LUA ? [process.env.SUMMON_TEST_LUA] : ["lua5.1", "lua-5.1", "luajit", "lua"];
const lua = candidates.find((bin) => luaVersion(bin) === "Lua 5.1");
if (!lua) {
  console.error(`test:lua: no Lua 5.1-compatible interpreter found (tried ${candidates.join(", ")}). Install one, for example: brew install luajit`);
  process.exit(1);
}
if (!existsSync(cli)) {
  console.error("test:lua: dist/index.js is missing. Run `pnpm build` first.");
  process.exit(1);
}

const temp = mkdtempSync(join(tmpdir(), "summon-test-lua-"));
let status = 1;
try {
  const home = join(temp, "home");
  mkdirSync(join(home, ".config", "summon"), { recursive: true });
  writeFileSync(join(home, ".config", "summon", "projects"), "demo=/tmp/demo = one\napi=/Users/someone/café ☕\nbad name!=/tmp/bad\n");
  const list = spawnSync(process.execPath, [cli, "list", "--json"], { encoding: "utf-8", env: { ...process.env, HOME: home } });
  if (list.status !== 0) {
    console.error(`test:lua: summon list --json failed (${list.status}): ${list.stderr}`);
  } else {
    const candidate = join(temp, "candidate.json");
    writeFileSync(candidate, list.stdout);
    console.log(`test:lua: ${lua} on ${action}`);
    const result = spawnSync(lua, [harness, action, candidate], { stdio: "inherit" });
    status = result.status ?? 1;
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
process.exit(status);
