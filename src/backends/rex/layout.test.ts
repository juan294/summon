import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { planLayout, getPreset, traditionalPaneNames } from "../../layout.js";
import type { LayoutPlan } from "../../layout.js";
import { parseTreeDSL, resolveTreeCommands, buildTreePlan } from "../../tree.js";
import { traditionalInventory } from "../ghostty/pane-inventory.js";
import { resolveCommand } from "../../utils.js";
import { shellQuote } from "../../shell-escape.js";
import { bootstrapLine, cleanupTrapLine, paneFileLine } from "../../launch-identity.js";
import { buildSessionCreateRequest, resolveLoginShell, TERMINAL_FLAVOR } from "./layout.js";
import type { RexBlockNode, RexLayoutNode, SessionCreateInput } from "./layout.js";

const ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const DIR = "/Users/me/code/chapa";
const SHELL = "/bin/zsh";

function base(partial: Partial<SessionCreateInput> = {}): Omit<SessionCreateInput, "layout"> {
  return { targetDir: DIR, project: "chapa", launchId: ID, loginShell: SHELL, ...partial };
}

function traditional(plan: LayoutPlan, partial: Partial<SessionCreateInput> = {}) {
  return buildSessionCreateRequest({ ...base(partial), layout: { kind: "traditional", plan } });
}

function tree(dsl: string, panes: Record<string, string>, opts: Parameters<typeof buildTreePlan>[1] = {}, cwds?: Record<string, string>, partial: Partial<SessionCreateInput> = {}) {
  const resolved = resolveTreeCommands(parseTreeDSL(dsl), new Map(Object.entries(panes)), cwds ? new Map(Object.entries(cwds)) : undefined, DIR);
  return buildSessionCreateRequest({ ...base(partial), layout: { kind: "tree", plan: buildTreePlan(resolved, opts) } });
}

/** Leaf labels and split shape of a Rex layout node, for compact shape assertions. */
function shape(node: RexLayoutNode): unknown {
  if ("block" in node) return node.block.label;
  const { direction, ratio, before, after } = node.split;
  return [direction === "horizontal" ? "H" : "V", ratio, shape(before), shape(after)];
}

function blocks(node: RexLayoutNode): RexBlockNode["block"][] {
  if ("block" in node) return [node.block];
  return [...blocks(node.split.before), ...blocks(node.split.after)];
}

/** Read the startup script after the initial command that unsets its transport variable. */
function script(block: RexBlockNode["block"]): string {
  const value = block.options.command.find((arg) => arg.startsWith("SUMMON_REX_STARTUP_"))!;
  return value.slice(value.indexOf("\n") + 1);
}

function preset(name: Parameters<typeof getPreset>[0], extra: Partial<LayoutPlan> = {}): LayoutPlan {
  return { ...planLayout({ editor: "vim", ...getPreset(name) }), ...extra };
}

describe("buildSessionCreateRequest: traditional presets (the shape Ghostty builds)", () => {
  it("minimal: editor beside the sidebar", () => {
    const { request, paneOrder } = traditional(preset("minimal"));
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, "editor · vim", "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["editor", "sidebar"]);
  });

  it("cli: the right column exists only for the shell, inserted between editor and sidebar", () => {
    const { request, paneOrder } = traditional(preset("cli"));
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, ["H", 0.5, "editor · vim", "shell"], "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["editor", "shell", "sidebar"]);
  });

  it("pair: one right editor with the shell below it", () => {
    const { request, paneOrder } = traditional(preset("pair"));
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, ["H", 0.5, "editor · vim", ["V", 0.5, "editor · vim", "shell"]], "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["editor", "right-1", "shell", "sidebar"]);
  });

  it("btop: the right editor runs the secondary editor", () => {
    const { request, paneOrder, labels } = traditional(preset("btop"));
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, ["H", 0.5, "editor · vim", ["V", 0.5, "editor · btop", "shell"]], "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["editor", "right-1", "shell", "sidebar"]);
    expect(labels).toEqual({ editor: "editor · vim", "right-1": "editor · btop", shell: "shell", sidebar: "sidebar · lazygit" });
    const right = blocks(request.initial_windows[0].layout)[1]!;
    expect(script(right).endsWith("clear\neval 'btop'\n}")).toBe(true);
  });

  it("full: paneOrder is the depth-first before/after leaf order, distinct from panes and from traditionalInventory", () => {
    const plan = preset("full");
    const { request, paneOrder } = traditional(plan);
    expect(shape(request.initial_windows[0].layout)).toEqual([
      "H", 0.75,
      ["H", 0.5, ["V", 0.5, "editor · vim", "editor · vim"], ["V", 0.5, "editor · vim", "shell"]],
      "sidebar · lazygit",
    ]);
    expect(paneOrder).toEqual(["editor", "editor-2", "right-1", "shell", "sidebar"]);
    expect(traditionalPaneNames(plan)).toEqual(["editor", "sidebar", "editor-2", "right-1", "shell"]);
    expect(traditionalInventory(plan).map((p) => p.name)).toEqual(["editor", "sidebar", "right-1", "shell", "editor-2"]);
    expect(paneOrder).not.toEqual(traditionalPaneNames(plan));
    expect(paneOrder).not.toEqual(traditionalInventory(plan).map((p) => p.name));
    expect([...paneOrder].sort()).toEqual([...traditionalPaneNames(plan)].sort());
  });

  it("five editor panes: both columns chain downwards on the after side", () => {
    const { request, paneOrder } = traditional(planLayout({ editor: "vim", editorPanes: 5, shell: "htop" }));
    expect(shape(request.initial_windows[0].layout)).toEqual([
      "H", 0.75,
      ["H", 0.5,
        ["V", 0.5, "editor · vim", ["V", 0.5, "editor · vim", "editor · vim"]],
        ["V", 0.5, "editor · vim", ["V", 0.5, "editor · vim", "shell · htop"]]],
      "sidebar · lazygit",
    ]);
    expect(paneOrder).toEqual(["editor", "editor-2", "editor-3", "right-1", "right-2", "shell", "sidebar"]);
  });

  it("the sidebar block is always created, like Ghostty's unconditional sidebar split", () => {
    const { paneOrder, labels } = traditional({ ...preset("minimal"), sidebarCommand: "" });
    expect(paneOrder).toEqual(["editor", "sidebar"]);
    expect(labels["sidebar"]).toBe("sidebar");
  });
});

describe("buildSessionCreateRequest: ratios", () => {
  it("uses editorSize/100 on the first right split when autoResize is on, 0.5 elsewhere", () => {
    const { request } = traditional(planLayout({ editor: "vim", editorSize: 75, autoResize: true }));
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, ["H", 0.5, "editor · vim", ["V", 0.5, "editor · vim", "shell"]], "sidebar · lazygit"]);
    const small = traditional(planLayout({ editor: "vim", editorSize: 30, autoResize: true }));
    expect((small.request.initial_windows[0].layout as { split: { ratio: number } }).split.ratio).toBe(0.3);
  });

  it("uses 0.5 everywhere when autoResize is off", () => {
    const { request } = traditional(planLayout({ editor: "vim", editorSize: 75, autoResize: false }));
    expect((request.initial_windows[0].layout as { split: { ratio: number } }).split.ratio).toBe(0.5);
  });

  it("tree: the first right split in pre-order takes the editor size, nested right splits stay 0.5", () => {
    const outer = tree("(a / b) | c", { a: "x", b: "y", c: "z" }, { editorSize: 60, autoResize: true });
    expect(shape(outer.request.initial_windows[0].layout)).toEqual(["H", 0.6, ["V", 0.5, "a · x", "b · y"], "c · z"]);
    const inner = tree("a / (b | (c | d))", { a: "w", b: "x", c: "y", d: "z" }, { editorSize: 60, autoResize: true });
    expect(shape(inner.request.initial_windows[0].layout)).toEqual(["V", 0.5, "a · w", ["H", 0.6, "b · x", ["H", 0.5, "c · y", "d · z"]]]);
  });
});

describe("buildSessionCreateRequest: tree layouts", () => {
  it("main | sidebar", () => {
    const { request, paneOrder, labels } = tree("main | sidebar", { main: "claude", sidebar: "lazygit" });
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, "main · claude", "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["main", "sidebar"]);
    expect(labels).toEqual({ main: "main · claude", sidebar: "sidebar · lazygit" });
  });

  it("(editor / shell) | sidebar", () => {
    const { request, paneOrder } = tree("(editor / shell) | sidebar", { editor: "claude", shell: "npm run dev", sidebar: "lazygit" });
    expect(shape(request.initial_windows[0].layout)).toEqual(["H", 0.75, ["V", 0.5, "editor · claude", "shell · npm run dev"], "sidebar · lazygit"]);
    expect(paneOrder).toEqual(["editor", "shell", "sidebar"]);
  });

  it("a | (b / (c | d)) with a per-pane cwd and an inline quoted command", () => {
    const { request, paneOrder, labels } = tree('a | (b / ("npm test" | d))', { a: "vim", b: "htop", d: "" }, {}, { b: "packages/api" });
    expect(paneOrder).toEqual(["a", "b", "npm", "d"]);
    expect(labels).toEqual({ a: "a · vim", b: "b · htop", npm: "npm · npm test", d: "d" });
    const [a, b, npm, d] = blocks(request.initial_windows[0].layout);
    expect(a!.options.cwd).toBe(DIR);
    expect(b!.options.cwd).toBe(`${DIR}/packages/api`);
    expect(script(b!)).toContain(`cd '${DIR}/packages/api' && {\n`);
    expect(script(npm!).endsWith("clear\neval 'npm test'\n}")).toBe(true);
    expect(script(d!).endsWith("clear\n}")).toBe(true);
  });

  it("rejects duplicate leaf names", () => {
    const plan = buildTreePlan({ type: "split", direction: "right", first: { type: "pane", name: "x", command: "a" }, second: { type: "pane", name: "x", command: "b" } });
    expect(() => buildSessionCreateRequest({ ...base(), layout: { kind: "tree", plan } })).toThrow("unique");
  });
});

describe("buildSessionCreateRequest: blocks", () => {
  const shells = ["/bin/bash", "/bin/zsh", resolveCommand("fish")].filter((path): path is string => !!path && existsSync(path));
  it.each(shells)("preserves long startup, aliases, exit status and cleanup under %s", (shell) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "summon-pane-startup-")));
    const target = join(home, "project's paired\\\\and trailing\\");
    const project = "s".repeat(64);
    const key = "SUMMON_REX_STARTUP_" + ID.replaceAll("-", "_");
    const payload = "long command ".repeat(250);
    const fish = shell.endsWith("/fish");
    try {
      mkdirSync(target);
      const { request } = traditional(preset("minimal", { editor: `capture_env; pwd; printf '%s' '${payload}' > "$HOME/ran"; false` }), {
        project, targetDir: target, loginShell: shell, onStop: "echo stopped",
        envVars: { HOME: home, REX_SESSION: "session:test", REX_BLOCK: "block:test", [key]: "caller" },
      });
      const { command, initial_input } = blocks(request.initial_windows[0].layout)[0]!.options;
      expect(Buffer.byteLength(initial_input)).toBeLessThan(1024);
      const setupAlias = fish ? `alias capture_env 'env > "$HOME/child-env"'\n` : `alias capture_env='env > "$HOME/child-env"'\n`;
      const bash = shell.endsWith("/bash");
      const args = fish ? ["--no-config"] : bash ? ["--noprofile", "--norc"] : ["-f"];
      const after = fish ? "echo status=$status\nkill -HUP $fish_pid\n" : "echo status=$?\n";
      const result = spawnSync(command[0]!, [...command.slice(1, -1), ...args], {
        input: (bash ? "shopt -s expand_aliases\n" : "") + setupAlias + initial_input + after,
        encoding: "utf8", cwd: home, env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(target);
      expect(result.stdout).toContain("status=1");
      expect(readFileSync(join(home, "ran"), "utf8")).toBe(payload);
      expect(readFileSync(join(home, "child-env"), "utf8").split("\n").filter((entry) => entry.startsWith("SUMMON_REX_STARTUP_"))).toEqual([`${key}=caller`]);
      const generation = join(home, `.config/summon/status/${project}.launches/${ID}`);
      expect(readFileSync(generation + ".pane.editor", "utf8")).toBe("session:test\nblock:test\n");
      expect(existsSync(generation + ".pid")).toBe(false);
      expect(existsSync(generation + ".active")).toBe(false);
      expect(readFileSync(join(home, `.config/summon/logs/cleanup-${project}.log`), "utf8")).toBe("stopped\n");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("every block is a command-mode login shell wrapped in /usr/bin/env with the workspace variables, in order", () => {
    const { request } = traditional(preset("minimal"), { envVars: { FOO: "bar", BAZ: "a b" }, starshipConfigPath: "/cfg/starship.toml" });
    for (const block of blocks(request.initial_windows[0].layout)) {
      expect(block.flavor).toBe(TERMINAL_FLAVOR);
      expect(block.options.shell).toBe("none");
      expect(block.options.cwd).toBe(DIR);
      expect(block.options.command).toEqual([
        "/usr/bin/env",
        "SUMMON_WORKSPACE=1",
        "SUMMON_TAB_TITLE=chapa",
        "STARSHIP_CONFIG=/cfg/starship.toml",
        "FOO=bar",
        "BAZ=a b",
        `SUMMON_LAUNCH_ID=${ID}`,
        expect.stringMatching(/^SUMMON_REX_STARTUP_/),
        SHELL,
        "-l",
      ]);
    }
  });

  it("omits STARSHIP_CONFIG and user vars when none apply", () => {
    const { request } = traditional(preset("minimal"));
    expect(blocks(request.initial_windows[0].layout)[0]!.options.command).toEqual(["/usr/bin/env", "SUMMON_WORKSPACE=1", "SUMMON_TAB_TITLE=chapa", `SUMMON_LAUNCH_ID=${ID}`, expect.stringMatching(/^SUMMON_REX_STARTUP_/), SHELL, "-l"]);
  });

  it("never types export lines", () => {
    const { request } = traditional(preset("full"), { envVars: { FOO: "bar" } });
    for (const block of blocks(request.initial_windows[0].layout)) expect(block.options.initial_input).not.toMatch(/^export /m);
  });

  it("root pane: bootstrap with the root pane-file write, trap, cd, clear, command; each line newline-terminated", () => {
    const { request } = traditional(preset("minimal"), { onStop: "echo bye" });
    const root = blocks(request.initial_windows[0].layout)[0]!;
    const setup = script(root);
    expect(setup).toContain(
      `${bootstrapLine("chapa", ID)} && ${paneFileLine("chapa", ID, "editor")}\n`
      + "eval " + shellQuote(cleanupTrapLine("chapa", ID, { onStop: "echo bye", targetDir: DIR })),
    );
    expect(setup).toContain(`rm -f "$HOME/.config/summon/status/chapa.launches/${ID}.pid" "$HOME/.config/summon/status/chapa.launches/${ID}.active" 2>/dev/null`);
    const rm = /rm -f ([^;]*)/.exec(setup)![1]!;
    expect(rm).not.toContain(".pane.");
    expect(rm).not.toContain(".json");
  });

  it("every other pane starts with its own pane-file line and never writes the pid, active or another pane's file", () => {
    const { request, paneOrder } = traditional(preset("full"));
    const all = blocks(request.initial_windows[0].layout);
    for (let i = 1; i < all.length; i++) {
      const name = paneOrder[i]!;
      const input = script(all[i]!);
      expect(input.startsWith(paneFileLine("chapa", ID, name) + "\n")).toBe(true);
      expect(input).not.toContain(".pid");
      expect(input).not.toContain(".active");
      expect(input).not.toContain("trap ");
      for (const other of paneOrder) if (other !== name) expect(input).not.toMatch(new RegExp(`\\.pane\\.${other}(\\.tmp)?"`));
      expect(script(all[i]!)).toContain(`cd '${DIR}' && {\nclear\n`);
    }
  });

  it("runs a compound command in the requested directory and leaves the shell usable when cd fails", () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "summon-pane-cwd-")));
    const project = join(home, "project's files");
    try {
      mkdirSync(project);
      // Exercise the full secondary pane input, including its pane identity write.
      mkdirSync(join(home, ".config/summon/status/chapa.launches"), { recursive: true });
      const command = "pwd; printf 'first\\n' # inline comment\nprintf 'second\\n'";
      const { request } = traditional({ ...preset("minimal"), sidebarCommand: command }, { targetDir: project });
      const { command: argv, initial_input: input } = blocks(request.initial_windows[0].layout)[1]!.options;
      const run = () => spawnSync(argv[0]!, [...argv.slice(1, -2), process.platform === "darwin" ? SHELL : "/bin/sh", "-f"], {
        input: "clear() { echo cleared; return 1; }\n" + input + 'echo status=$?\nenv > "$HOME/after-env"\necho ready\n',
        encoding: "utf8", cwd: home, env: { ...process.env, HOME: home },
      });
      const valid = run();
      expect(valid.status).toBe(0);
      expect(valid.stdout.split("\n")).toEqual(["cleared", project, "first", "second", "status=0", "ready", ""]);
      rmSync(project, { recursive: true });
      const missing = run();
      expect(missing.status).toBe(0);
      expect(missing.stderr).toContain(project);
      expect(missing.stdout).toMatch(/^status=[1-9]\d*\nready\n$/);
      expect(readFileSync(join(home, "after-env"), "utf8")).not.toMatch(/^SUMMON_REX_STARTUP_/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each(["exec /usr/bin/env", ")"])("keeps the transport out of the pane environment for %s", (paneCommand) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "summon-pane-env-")));
    try {
      const { request } = traditional(preset("minimal", { editor: paneCommand }), { targetDir: home, envVars: { HOME: home } });
      const { command, initial_input } = blocks(request.initial_windows[0].layout)[0]!.options;
      const result = spawnSync(command[0]!, [...command.slice(1, -2), "/bin/sh"], {
        input: initial_input + "env\n", encoding: "utf8", env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
      });
      expect(result.stdout).toContain(`HOME=${home}`);
      expect(result.stdout).not.toMatch(/^SUMMON_REX_STARTUP_/m);
      expect(existsSync(join(home, `.config/summon/status/chapa.launches/${ID}.pane.editor`))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses a fish command group when fish is the login shell", () => {
    const { request } = traditional(preset("minimal"), { loginShell: "/opt/homebrew/bin/fish" });
    const sidebar = blocks(request.initial_windows[0].layout)[1]!;
    expect(script(sidebar).endsWith(`cd '${DIR}' && begin\nclear\neval 'lazygit'\nend`)).toBe(true);
  });

  it("quotes the pane directory with shellQuote", () => {
    const { request } = traditional(preset("minimal"), { targetDir: "/tmp/it's here" });
    expect(script(blocks(request.initial_windows[0].layout)[0]!)).toContain("cd '/tmp/it'\\''s here' && {\n");
  });

  it("root pane without an editor command still runs the bootstrap, trap, cd and clear", () => {
    const { request } = traditional({ ...preset("minimal"), editor: "" });
    const root = blocks(request.initial_windows[0].layout)[0]!;
    expect(root.label).toBe("editor");
    expect(script(root).endsWith("clear\n}")).toBe(true);
  });
});

describe("buildSessionCreateRequest: request envelope", () => {
  it("labels the session with the project and the window with [project]", () => {
    const { request } = traditional(preset("minimal"));
    expect(request.label).toBe("chapa");
    expect(request.initial_windows).toHaveLength(1);
    expect(request.initial_windows[0].window_label).toBe("[chapa]");
  });

  it("is plain JSON (round-trips through JSON.stringify)", () => {
    const { request } = traditional(preset("full"), { envVars: { FOO: "bar" } });
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  });

  it("rejects an invalid launch id", () => {
    expect(() => traditional(preset("minimal"), { launchId: "nope" })).toThrow("Invalid launch id");
  });
});

describe("buildSessionCreateRequest: background panes (plan D1, D4, D11)", () => {
  const PANES = { editor: "vim", sidebar: "lazygit", shell: "zsh", server: "make serve" };
  const DSL = "(editor | (sidebar / shell)) | server";
  const bg = (entries: Array<[string, boolean]>) => ({ background: new Map(entries) });

  it("without a key the build has nothing to minimize and the request is the one it always was", () => {
    const plain = tree(DSL, PANES, { editorSize: 73, autoResize: true });
    expect(plain.minimize).toEqual([]);
    expect(plain.ignoredBackground).toEqual([]);
    const withEmptyMap = tree(DSL, PANES, { editorSize: 73, autoResize: true }, undefined, bg([]));
    expect(withEmptyMap.request).toEqual(plain.request);
    expect(traditional(preset("full")).minimize).toEqual([]);
  });

  it("a background pane stays in the create request (one atomic create) and is listed in paneOrder order", () => {
    const built = tree(DSL, PANES, { editorSize: 73, autoResize: true }, undefined, bg([["server", true]]));
    expect(built.minimize).toEqual(["server"]);
    expect(built.paneOrder).toEqual(["editor", "sidebar", "shell", "server"]);
    expect(blocks(built.request.initial_windows[0].layout)).toHaveLength(4);
    expect(built.ignoredBackground).toEqual([]);
  });

  it("lists several background panes in paneOrder order, whatever the order of the map", () => {
    const built = tree(DSL, PANES, {}, undefined, bg([["server", true], ["sidebar", true]]));
    expect(built.minimize).toEqual(["sidebar", "server"]);
  });

  it("the editor size goes to the first right split that keeps a visible pane on both sides", () => {
    const built = tree(DSL, PANES, { editorSize: 73, autoResize: true }, undefined, bg([["server", true]]));
    const outer = built.request.initial_windows[0].layout as Extract<RexLayoutNode, { split: unknown }>;
    expect(outer.split.ratio).toBe(0.5);
    expect((outer.split.before as Extract<RexLayoutNode, { split: unknown }>).split.ratio).toBe(0.73);
    // Nothing minimized: the outer split takes the size, as before.
    const plain = tree(DSL, PANES, { editorSize: 73, autoResize: true });
    expect((plain.request.initial_windows[0].layout as Extract<RexLayoutNode, { split: unknown }>).split.ratio).toBe(0.73);
  });

  it("a right split with one side entirely minimized keeps 0.5, and no other split takes the size in its place", () => {
    const built = tree("editor | (api / worker)", { editor: "vim", api: "make serve", worker: "npm run watch" }, { editorSize: 70, autoResize: true }, undefined, bg([["api", true], ["worker", true]]));
    // The right side is entirely minimized, so no split keeps a visible pane on both sides: every ratio stays 0.5.
    expect(shape(built.request.initial_windows[0].layout)).toEqual(["H", 0.5, expect.any(String), ["V", 0.5, expect.any(String), expect.any(String)]]);
  });

  it("the first pane and a pane without a command are refused and reported, not minimized (S9)", () => {
    const built = tree("editor | (shell / server)", { editor: "vim", shell: "", server: "make serve" }, {}, undefined, bg([["editor", true], ["shell", true], ["server", true]]));
    expect(built.minimize).toEqual(["server"]);
    expect(built.ignoredBackground).toEqual(["editor", "shell"]);
  });

  it("false keeps a pane in the layout", () => {
    const built = tree(DSL, PANES, {}, undefined, bg([["server", false]]));
    expect(built.minimize).toEqual([]);
    expect(built.ignoredBackground).toEqual([]);
  });

  it("ignores a flag for a pane that is not in the layout", () => {
    const built = tree(DSL, PANES, {}, undefined, bg([["nope", true]]));
    expect(built.minimize).toEqual([]);
    expect(built.ignoredBackground).toEqual([]);
  });

  it("works on a traditional plan: the shell pane with a command", () => {
    const built = traditional(preset("cli", { shellCommand: "make serve" }), bg([["shell", true]]));
    expect(built.minimize).toEqual(["shell"]);
    expect(built.paneOrder).toEqual(["editor", "shell", "sidebar"]);
  });
});

describe("buildSessionCreateRequest: autodetected background panes (plan D3, D4)", () => {
  const bg = (entries: Array<[string, boolean]>) => ({ background: new Map(entries) });

  it("a pane whose command is a known background program is minimized without any key", () => {
    const built = tree("editor | server", { editor: "vim", server: "npm run dev" });
    expect(built.minimize).toEqual(["server"]);
    expect(built.autodetected).toEqual(["server"]);
    expect(built.ignoredBackground).toEqual([]);
    expect(built.paneOrder).toEqual(["editor", "server"]);
  });

  it("an inline quoted command is detected too, whatever the pane is called", () => {
    const built = tree('editor | "tail -f log/development.log"', { editor: "vim" });
    expect(built.minimize).toEqual(["tail"]);
  });

  it("background=false keeps it in the layout; background=true on a pane the table does not know minimizes it and is not 'autodetected'", () => {
    expect(tree("editor | server", { editor: "vim", server: "npm run dev" }, {}, undefined, bg([["server", false]])).minimize).toEqual([]);
    const forced = tree("editor | build", { editor: "vim", build: "make watch" }, {}, undefined, bg([["build", true]]));
    expect(forced.minimize).toEqual(["build"]);
    expect(forced.autodetected).toEqual([]);
  });

  it("the first pane is never minimized, and is not reported when nothing asked for it", () => {
    const built = tree("server | editor", { server: "npm run dev", editor: "vim" });
    expect(built.minimize).toEqual([]);
    expect(built.autodetected).toEqual([]);
    expect(built.ignoredBackground).toEqual([]);
    // Asking for it is reported (S9), as before.
    expect(tree("server | editor", { server: "npm run dev", editor: "vim" }, {}, undefined, bg([["server", true]])).ignoredBackground).toEqual(["server"]);
  });

  it("the traditional shell pane with a dev command is minimized; the presets and a plain shell are not", () => {
    const built = traditional(preset("cli", { shellCommand: "npm run dev" }));
    expect(built.minimize).toEqual(["shell"]);
    expect(built.autodetected).toEqual(["shell"]);
    for (const name of ["minimal", "full", "pair", "cli", "btop"] as const) {
      const plain = traditional(preset(name));
      expect(plain.minimize, name).toEqual([]);
      expect(plain.autodetected, name).toEqual([]);
    }
  });

  it("the editor size follows the visible layout when an autodetected pane collapses a split (D11)", () => {
    const built = tree("(editor | (sidebar / shell)) | server", { editor: "vim", sidebar: "lazygit", shell: "zsh", server: "npm run dev" }, { editorSize: 73, autoResize: true });
    expect(built.minimize).toEqual(["server"]);
    const outer = built.request.initial_windows[0].layout as Extract<RexLayoutNode, { split: unknown }>;
    expect((outer.split.before as Extract<RexLayoutNode, { split: unknown }>).split.ratio).toBe(0.73);
  });
});

describe("resolveLoginShell", () => {
  it("uses $SHELL when it is an absolute existing path", () => {
    expect(resolveLoginShell({ SHELL: "/opt/homebrew/bin/fish" }, (p) => p === "/opt/homebrew/bin/fish")).toBe("/opt/homebrew/bin/fish");
  });

  it("falls back to /bin/zsh for a relative, missing or unset SHELL", () => {
    expect(resolveLoginShell({ SHELL: "fish" }, () => true)).toBe("/bin/zsh");
    expect(resolveLoginShell({ SHELL: "/nope/sh" }, () => false)).toBe("/bin/zsh");
    expect(resolveLoginShell({}, () => true)).toBe("/bin/zsh");
  });

  it("is the builder's default", () => {
    const { request } = buildSessionCreateRequest({ targetDir: DIR, project: "chapa", launchId: ID, layout: { kind: "traditional", plan: preset("minimal") } });
    const command = blocks(request.initial_windows[0].layout)[0]!.options.command;
    expect(command[command.length - 2]).toBe(resolveLoginShell());
    expect(command[command.length - 1]).toBe("-l");
  });
});
