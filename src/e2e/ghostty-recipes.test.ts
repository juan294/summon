import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readKVFromString } from "../config.js";
import { collectLeaves, extractPaneDefinitions, findPaneByName, parseTreeDSL, resolveTreeCommands } from "../tree.js";
import { shellQuote } from "../shell-escape.js";
import { cliBuild } from "../fixtures/cli-builds.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const docs = () => readFileSync(join(ROOT, "docs/ghostty.md"), "utf8");
const BUNDLE_COMMAND = "env '/Applications/Ghostty.app/Contents/MacOS/ghostty' +ssh -- dev-host";
const SHELL_BASE = "layout=cli\neditor=vi\nsidebar=\n";
const TREE_BASE = "tree=editor | remote / shell\npane.editor=vi\n";
const recipes = [
  { name: "shell PATH", command: "ghostty +ssh -- dev-host", project: SHELL_BASE + "shell=ghostty +ssh -- dev-host\n" },
  { name: "shell bundle", command: BUNDLE_COMMAND, project: SHELL_BASE + "shell=" + BUNDLE_COMMAND + "\n", documented: "shell=" + BUNDLE_COMMAND },
  { name: "shell terminfo opt-out", command: "ghostty +ssh --terminfo=false -- dev-host", project: SHELL_BASE + "shell=ghostty +ssh --terminfo=false -- dev-host\n", documented: "shell=ghostty +ssh --terminfo=false -- dev-host" },
  { name: "shell both setup opt-outs", command: "ghostty +ssh --terminfo=false --forward-env=false -- dev-host", project: SHELL_BASE + "shell=ghostty +ssh --terminfo=false --forward-env=false -- dev-host\n", documented: "shell=ghostty +ssh --terminfo=false --forward-env=false -- dev-host" },
  { name: "named tree PATH", command: "ghostty +ssh -- dev-host", project: "layout=ssh-dev\n", custom: TREE_BASE + "pane.remote=ghostty +ssh -- dev-host\npane.shell=\n" },
  { name: "named tree bundle", command: BUNDLE_COMMAND, project: "layout=ssh-dev\n", custom: TREE_BASE + "pane.remote=" + BUNDLE_COMMAND + "\npane.shell=\n", documented: "pane.remote=" + BUNDLE_COMMAND },
];
type Recipe = typeof recipes[number];
let cliCopy = "";
const fixtures = new Set<string>();

/** A private production build: the shared dist/ may be absent or emptied by a concurrent `pnpm build`. */
beforeAll(() => { cliCopy = dirname(cliBuild("production")); });
afterEach(() => { for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true }); fixtures.clear(); });

function sandbox(recipe: Recipe) {
  const root = mkdtempSync(join(tmpdir(), "summon-ssh-recipe-"));
  fixtures.add(root);
  const home = join(root, "home"), project = join(root, "project with spaces"), bin = join(root, "bin");
  const config = join(home, ".config/summon"), status = join(config, "status"), marker = join(root, "forbidden-process.log");
  for (const directory of [project, bin, status, join(config, "layouts")]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(project, ".summon"), recipe.project);
  writeFileSync(join(config, "config"), "");
  writeFileSync(join(config, "projects"), "");
  if (recipe.custom) writeFileSync(join(config, "layouts/ssh-dev"), recipe.custom);
  writeFileSync(join(status, "existing.json"), JSON.stringify({ version: 1, source: "summon", project: "existing", directory: root, pid: process.pid, startedAt: "2026-01-01T00:00:00.000Z", layout: "minimal", panes: ["editor"] }) + "\n");
  writeFileSync(join(status, "existing.active"), "existing marker\n");
  writeFileSync(join(status, "existing.pid"), String(process.pid) + "\n");
  // These real OS-boundary guards cannot open a terminal or contact an SSH host.
  for (const name of ["ghostty", "ssh", "osascript", "env"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' '${name}' >> ${shellQuote(marker)}\nexit 99\n`, { mode: 0o700 });
  }
  symlinkSync(process.execPath, join(bin, "node"));
  const run = (...args: string[]) => spawnSync(join(cliCopy, "index.js"), args, {
    cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, SUMMON_NO_CACHE: "1", SUMMON_WORKSPACE: undefined, NODE_OPTIONS: undefined, NODE_COMPILE_CACHE: undefined, NODE_DISABLE_COMPILE_CACHE: "1", NO_COLOR: "1" },
  });
  return { root, home, project, status, marker, run };
}

/** Record bytes and old mtimes; rewriting an identical file must still fail the oracle. */
function snapshot(root: string, freeze = false): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(directory: string) {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), info = lstatSync(file), relative = file.slice(root.length + 1);
      if (info.isDirectory()) walk(file);
      else if (info.isSymbolicLink()) result[relative] = `link:${readlinkSync(file)}`;
      else {
        if (freeze) utimesSync(file, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
        result[relative] = `${createHash("sha256").update(readFileSync(file)).digest("hex")}:${lstatSync(file).mtimeMs}`;
      }
    }
  }
  walk(root);
  return result;
}

function trustReviewedRecipe(fixture: ReturnType<typeof sandbox>): void {
  const result = fixture.run("trust", ".");
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

describe("P5 SSH recipes through real parsers and CLI dry-run", () => {
  it.each(recipes)("$name preserves arguments without SSH/native/status side effects", recipe => {
    expect(docs()).toContain(recipe.documented ?? recipe.custom ?? recipe.project);
    const project = readKVFromString(recipe.project);
    if (recipe.custom) {
      expect(project.get("layout")).toBe("ssh-dev");
      const custom = readKVFromString(recipe.custom);
      const tree = resolveTreeCommands(parseTreeDSL(custom.get("tree")!), extractPaneDefinitions(custom));
      expect(collectLeaves(tree)).toEqual(["editor", "remote", "shell"]);
      expect(findPaneByName(tree, "remote")?.command).toBe(recipe.command);
      expect(findPaneByName(tree, "shell")?.command).toBe("");
    } else expect(project.get("shell")).toBe(recipe.command);
    const fixture = sandbox(recipe);
    trustReviewedRecipe(fixture);
    const before = snapshot(fixture.root, true);
    const result = fixture.run(".", "--dry-run");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`set initial input of cfg to "${recipe.command}\\n"`);
    expect(existsSync(fixture.marker)).toBe(false);
    expect(readdirSync(fixture.status).sort()).toEqual(["existing.active", "existing.json", "existing.pid"]);
    expect(snapshot(fixture.root)).toEqual(before);
  });
  it("keeps the trust boundary even for a preview", () => {
    const fixture = sandbox(recipes[0]!);
    const before = snapshot(fixture.root, true);
    const result = fixture.run(".", "--dry-run");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("summon trust");
    expect(existsSync(fixture.marker)).toBe(false);
    expect(snapshot(fixture.root)).toEqual(before);
  });
});
