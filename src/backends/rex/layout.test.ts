import { describe, it, expect } from "vitest";
import { planLayout, getPreset, traditionalPaneNames } from "../../layout.js";
import type { LayoutPlan } from "../../layout.js";
import { parseTreeDSL, resolveTreeCommands, buildTreePlan } from "../../tree.js";
import { traditionalInventory } from "../ghostty/pane-inventory.js";
import { bootstrapLine, cleanupTrapLine, paneFileLine } from "../../launch-identity.js";
import { buildSessionCreateRequest, resolveLoginShell, TERMINAL_FLAVOR } from "./layout.js";
import type { RexBlockNode, RexLayoutNode, SessionCreateInput } from "./layout.js";

const ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const DIR = "/Users/me/code/chapa";
// The Rex root pane's bootstrap line for project chapa and launch ID, byte for byte.
const ROOT_BOOTSTRAP = "mkdir -p \"$HOME/.config/summon/status/chapa.launches\" && chmod 700 \"$HOME/.config/summon/status/chapa.launches\" && printf '%s\\n' \"$$\" > \"$HOME/.config/summon/status/chapa.launches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.pid\" && printf '%s\\n' '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' > \"$HOME/.config/summon/status/chapa.launches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.active\" && printf '%s\\n%s\\n' \"$REX_SESSION\" \"$REX_BLOCK\" > \"$HOME/.config/summon/status/chapa.launches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.pane.editor.tmp\" && mv -f \"$HOME/.config/summon/status/chapa.launches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.pane.editor.tmp\" \"$HOME/.config/summon/status/chapa.launches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.pane.editor\"";
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
    expect(right.options.initial_input.endsWith("clear\nbtop\n")).toBe(true);
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
    expect(b!.options.initial_input).toContain(`cd '${DIR}/packages/api'\n`);
    expect(npm!.options.initial_input.endsWith("clear\nnpm test\n")).toBe(true);
    expect(d!.options.initial_input.endsWith("clear\n")).toBe(true);
  });

  it("rejects duplicate leaf names", () => {
    const plan = buildTreePlan({ type: "split", direction: "right", first: { type: "pane", name: "x", command: "a" }, second: { type: "pane", name: "x", command: "b" } });
    expect(() => buildSessionCreateRequest({ ...base(), layout: { kind: "tree", plan } })).toThrow("unique");
  });
});

describe("buildSessionCreateRequest: blocks", () => {
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
        SHELL,
        "-l",
      ]);
    }
  });

  it("omits STARSHIP_CONFIG and user vars when none apply", () => {
    const { request } = traditional(preset("minimal"));
    expect(blocks(request.initial_windows[0].layout)[0]!.options.command).toEqual(["/usr/bin/env", "SUMMON_WORKSPACE=1", "SUMMON_TAB_TITLE=chapa", `SUMMON_LAUNCH_ID=${ID}`, SHELL, "-l"]);
  });

  it("never types export lines", () => {
    const { request } = traditional(preset("full"), { envVars: { FOO: "bar" } });
    for (const block of blocks(request.initial_windows[0].layout)) expect(block.options.initial_input).not.toMatch(/^export /m);
  });

  it("root pane: bootstrap with the root pane-file write, trap, cd, clear, command; each line newline-terminated", () => {
    const { request } = traditional(preset("minimal"), { onStop: "echo bye" });
    const root = blocks(request.initial_windows[0].layout)[0]!;
    expect(root.options.initial_input).toBe(
      `${bootstrapLine("chapa", ID)} && ${paneFileLine("chapa", ID, "editor")}\n`
      + cleanupTrapLine("chapa", ID, { onStop: "echo bye", targetDir: DIR }) + "\n"
      + `cd '${DIR}'\n`
      + "clear\n"
      + "vim\n",
    );
    // The exact root bootstrap line (A6: the pane-file write is appended here, not by bootstrapLine).
    expect(root.options.initial_input.split("\n")[0]).toBe(ROOT_BOOTSTRAP);
    expect(root.options.initial_input).toContain(`${ID}.pane.editor`);
    expect(root.options.initial_input).toContain('"$REX_SESSION" "$REX_BLOCK"');
    expect(root.options.initial_input).toContain(`rm -f "$HOME/.config/summon/status/chapa.launches/${ID}.pid" "$HOME/.config/summon/status/chapa.launches/${ID}.active" 2>/dev/null`);
    const rm = /rm -f ([^;]*)/.exec(root.options.initial_input)![1]!;
    expect(rm).not.toContain(".pane.");
    expect(rm).not.toContain(".json");
  });

  it("every other pane starts with its own pane-file line and never writes the pid, active or another pane's file", () => {
    const { request, paneOrder } = traditional(preset("full"));
    const all = blocks(request.initial_windows[0].layout);
    for (let i = 1; i < all.length; i++) {
      const name = paneOrder[i]!;
      const input = all[i]!.options.initial_input;
      expect(input.startsWith(paneFileLine("chapa", ID, name) + "\n")).toBe(true);
      expect(input).not.toContain(".pid");
      expect(input).not.toContain(".active");
      expect(input).not.toContain("trap ");
      for (const other of paneOrder) if (other !== name) expect(input).not.toMatch(new RegExp(`\\.pane\\.${other}(\\.tmp)?"`));
      expect(input).toContain(`\ncd '${DIR}'\nclear\n`);
    }
  });

  it("quotes the pane directory with shellQuote", () => {
    const { request } = traditional(preset("minimal"), { targetDir: "/tmp/it's here" });
    expect(blocks(request.initial_windows[0].layout)[0]!.options.initial_input).toContain("cd '/tmp/it'\\''s here'\n");
  });

  it("root pane without an editor command still runs the bootstrap, trap, cd and clear", () => {
    const { request } = traditional({ ...preset("minimal"), editor: "" });
    const root = blocks(request.initial_windows[0].layout)[0]!;
    expect(root.label).toBe("editor");
    expect(root.options.initial_input.endsWith("clear\n")).toBe(true);
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
