import { describe, it, expect, vi } from "vitest";
import {
  parseTreeDSL,
  extractPaneDefinitions,
  extractPaneCwds,
  resolveTreeCommands,
  buildTreePlan,
  collectLeaves,
  walkLeaves,
  findPaneByName,
  firstLeaf,
} from "./tree.js";
import type { LayoutNode, PaneNode, SplitNode } from "./tree.js";

// ---------- Parser ----------

describe("parseTreeDSL", () => {
  it("parses a single pane", () => {
    const node = parseTreeDSL("main");
    expect(node).toEqual({ type: "pane", name: "main", command: "" });
  });

  it("parses a right split (|)", () => {
    const node = parseTreeDSL("a | b") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("right");
    expect(node.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(node.second).toEqual({ type: "pane", name: "b", command: "" });
  });

  it("parses a down split (/)", () => {
    const node = parseTreeDSL("a / b") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("down");
    expect(node.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(node.second).toEqual({ type: "pane", name: "b", command: "" });
  });

  it("/ binds tighter than | (precedence)", () => {
    // "a | b / c" should parse as a | (b / c)
    const node = parseTreeDSL("a | b / c") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("right");
    expect(node.first).toEqual({ type: "pane", name: "a", command: "" });
    const right = node.second as SplitNode;
    expect(right.type).toBe("split");
    expect(right.direction).toBe("down");
    expect(right.first).toEqual({ type: "pane", name: "b", command: "" });
    expect(right.second).toEqual({ type: "pane", name: "c", command: "" });
  });

  it("parens override default precedence", () => {
    // "(a | b) / c" should parse as (a | b) / c
    const node = parseTreeDSL("(a | b) / c") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("down");
    const left = node.first as SplitNode;
    expect(left.type).toBe("split");
    expect(left.direction).toBe("right");
    expect(left.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(left.second).toEqual({ type: "pane", name: "b", command: "" });
    expect(node.second).toEqual({ type: "pane", name: "c", command: "" });
  });

  it("| is left-associative", () => {
    // "a | b | c" → ((a | b) | c)
    const node = parseTreeDSL("a | b | c") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("right");
    expect(node.second).toEqual({ type: "pane", name: "c", command: "" });
    const left = node.first as SplitNode;
    expect(left.type).toBe("split");
    expect(left.direction).toBe("right");
    expect(left.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(left.second).toEqual({ type: "pane", name: "b", command: "" });
  });

  it("parses nested parens: (a / b) | (c / d)", () => {
    const node = parseTreeDSL("(a / b) | (c / d)") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("right");
    const left = node.first as SplitNode;
    expect(left.direction).toBe("down");
    expect(left.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(left.second).toEqual({ type: "pane", name: "b", command: "" });
    const right = node.second as SplitNode;
    expect(right.direction).toBe("down");
    expect(right.first).toEqual({ type: "pane", name: "c", command: "" });
    expect(right.second).toEqual({ type: "pane", name: "d", command: "" });
  });

  it("parses complex expression: (a / b / c) | (d / e)", () => {
    const node = parseTreeDSL("(a / b / c) | (d / e)") as SplitNode;
    expect(node.type).toBe("split");
    expect(node.direction).toBe("right");
    // Left: (a / b / c) → ((a / b) / c) left-associative
    const left = node.first as SplitNode;
    expect(left.direction).toBe("down");
    expect(left.second).toEqual({ type: "pane", name: "c", command: "" });
    const leftInner = left.first as SplitNode;
    expect(leftInner.direction).toBe("down");
    expect(leftInner.first).toEqual({ type: "pane", name: "a", command: "" });
    expect(leftInner.second).toEqual({ type: "pane", name: "b", command: "" });
    // Right: (d / e)
    const right = node.second as SplitNode;
    expect(right.direction).toBe("down");
    expect(right.first).toEqual({ type: "pane", name: "d", command: "" });
    expect(right.second).toEqual({ type: "pane", name: "e", command: "" });
  });

  it("accepts underscores and hyphens in names", () => {
    const node = parseTreeDSL("my_pane | pane-2") as SplitNode;
    expect(node.first).toEqual({ type: "pane", name: "my_pane", command: "" });
    expect(node.second).toEqual({
      type: "pane",
      name: "pane-2",
      command: "",
    });
  });

  it("parses an inline command (quoted string)", () => {
    const node = parseTreeDSL('"claude"') as PaneNode;
    expect(node.type).toBe("pane");
    expect(node.name).toBe("claude");
    expect(node.command).toBe("claude");
  });

  it("parses an inline multi-word command", () => {
    const node = parseTreeDSL('"npm run dev"') as PaneNode;
    expect(node.type).toBe("pane");
    expect(node.name).toBe("npm");
    expect(node.command).toBe("npm run dev");
  });

  it("parses mixed bare name and inline command", () => {
    const node = parseTreeDSL('main | "lazygit"') as SplitNode;
    expect(node.first).toEqual({ type: "pane", name: "main", command: "" });
    expect(node.second).toEqual({
      type: "pane",
      name: "lazygit",
      command: "lazygit",
    });
  });

  it("deduplicates auto-names for inline commands", () => {
    const node = parseTreeDSL('"claude" | "claude"') as SplitNode;
    const first = node.first as PaneNode;
    const second = node.second as PaneNode;
    expect(first.name).toBe("claude");
    expect(second.name).toBe("claude_2");
    expect(first.command).toBe("claude");
    expect(second.command).toBe("claude");
  });

  it("throws on empty input", () => {
    expect(() => parseTreeDSL("")).toThrow(/Empty tree expression/);
    expect(() => parseTreeDSL("   ")).toThrow(/Empty tree expression/);
  });

  it("throws on unmatched paren", () => {
    expect(() => parseTreeDSL("(a | b")).toThrow(/Expected closing '\)'/);
    expect(() => parseTreeDSL("a | b)")).toThrow(/no matching '\('/);
  });

  it("throws on missing operand", () => {
    expect(() => parseTreeDSL("a |")).toThrow(/Unexpected end of input/);
    expect(() => parseTreeDSL("| a")).toThrow(/Unexpected token/);
    expect(() => parseTreeDSL("a /")).toThrow(/Unexpected end of input/);
  });

  it("throws on adjacent names without operator (leftover non-rparen token)", () => {
    // After parsing "a", the name token "b" is left over. Since it's not a ')' token,
    // the parser hits the generic leftover-token error (tree.ts line 183).
    expect(() => parseTreeDSL("a b")).toThrow(/Unexpected token 'b' at position 1/);
  });

  it("throws on invalid character", () => {
    expect(() => parseTreeDSL("a & b")).toThrow(/Unexpected character/);
  });

  it("throws on unterminated quote", () => {
    expect(() => parseTreeDSL('"claude')).toThrow(/Unterminated quoted string/);
  });

  it("throws on empty quoted string", () => {
    expect(() => parseTreeDSL('""')).toThrow(/Empty quoted string/);
  });
});

// ---------- Pane definitions ----------

describe("extractPaneDefinitions", () => {
  it("extracts pane defs from mixed config", () => {
    const config = new Map([
      ["pane.editor", "claude"],
      ["pane.sidebar", "lazygit"],
      ["editor-size", "75"],
      ["tree", "editor | sidebar"],
    ]);
    const panes = extractPaneDefinitions(config);
    expect(panes.size).toBe(2);
    expect(panes.get("editor")).toBe("claude");
    expect(panes.get("sidebar")).toBe("lazygit");
  });

  it("returns empty map when no pane defs", () => {
    const config = new Map([
      ["editor", "claude"],
      ["tree", "a | b"],
    ]);
    const panes = extractPaneDefinitions(config);
    expect(panes.size).toBe(0);
  });

  it("throws on invalid pane name", () => {
    const config = new Map([["pane.123bad", "cmd"]]);
    expect(() => extractPaneDefinitions(config)).toThrow();
  });

  it("skips sub-keys like pane.<name>.cwd", () => {
    const config = new Map([
      ["pane.editor", "vim"],
      ["pane.editor.cwd", "./frontend"],
      ["pane.backend", "npm run dev"],
      ["pane.backend.cwd", "./api"],
    ]);
    const panes = extractPaneDefinitions(config);
    expect(panes.size).toBe(2);
    expect(panes.get("editor")).toBe("vim");
    expect(panes.get("backend")).toBe("npm run dev");
  });
});

describe("extractPaneCwds", () => {
  it("extracts cwd keys from config", () => {
    const config = new Map([
      ["pane.editor", "vim"],
      ["pane.editor.cwd", "./frontend"],
      ["pane.backend", "npm run dev"],
      ["pane.backend.cwd", "./api"],
    ]);
    const cwds = extractPaneCwds(config);
    expect(cwds.size).toBe(2);
    expect(cwds.get("editor")).toBe("./frontend");
    expect(cwds.get("backend")).toBe("./api");
  });

  it("returns empty map when no cwd keys", () => {
    const config = new Map([
      ["pane.editor", "vim"],
      ["tree", "editor"],
    ]);
    const cwds = extractPaneCwds(config);
    expect(cwds.size).toBe(0);
  });

  it("ignores empty cwd values", () => {
    const config = new Map([["pane.editor.cwd", ""]]);
    const cwds = extractPaneCwds(config);
    expect(cwds.size).toBe(0);
  });
});

// ---------- Tree resolver ----------

describe("resolveTreeCommands", () => {
  it("resolves bare names from pane defs", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "right",
      first: { type: "pane", name: "editor", command: "" },
      second: { type: "pane", name: "sidebar", command: "" },
    };
    const panes = new Map([
      ["editor", "claude"],
      ["sidebar", "lazygit"],
    ]);
    const resolved = resolveTreeCommands(tree, panes) as SplitNode;
    expect((resolved.first as PaneNode).command).toBe("claude");
    expect((resolved.second as PaneNode).command).toBe("lazygit");
  });

  it("skips panes with inline commands", () => {
    const tree: LayoutNode = {
      type: "pane",
      name: "npm",
      command: "npm run dev",
    };
    const panes = new Map<string, string>();
    const resolved = resolveTreeCommands(tree, panes) as PaneNode;
    expect(resolved.command).toBe("npm run dev");
  });

  it("throws when bare name not in pane defs", () => {
    const tree: LayoutNode = {
      type: "pane",
      name: "missing",
      command: "",
    };
    const panes = new Map<string, string>();
    expect(() => resolveTreeCommands(tree, panes)).toThrow();
  });

  it("attaches cwd to resolved panes", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "right",
      first: { type: "pane", name: "editor", command: "" },
      second: { type: "pane", name: "backend", command: "" },
    };
    const panes = new Map([
      ["editor", "vim"],
      ["backend", "npm run dev"],
    ]);
    const cwds = new Map([
      ["editor", "./frontend"],
      ["backend", "./api"],
    ]);
    const resolved = resolveTreeCommands(tree, panes, cwds) as SplitNode;
    expect((resolved.first as PaneNode).cwd).toBe("./frontend");
    expect((resolved.second as PaneNode).cwd).toBe("./api");
  });

  it("attaches cwd to inline-command panes", () => {
    const tree: LayoutNode = {
      type: "pane",
      name: "npm",
      command: "npm run dev",
    };
    const cwds = new Map([["npm", "./api"]]);
    const resolved = resolveTreeCommands(tree, new Map(), cwds) as PaneNode;
    expect(resolved.command).toBe("npm run dev");
    expect(resolved.cwd).toBe("./api");
  });

  it("omits cwd when not specified", () => {
    const tree: LayoutNode = {
      type: "pane",
      name: "editor",
      command: "",
    };
    const panes = new Map([["editor", "vim"]]);
    const resolved = resolveTreeCommands(tree, panes) as PaneNode;
    expect(resolved.cwd).toBeUndefined();
  });

  it("warns on unused pane defs but succeeds", () => {
    const tree: LayoutNode = {
      type: "pane",
      name: "editor",
      command: "",
    };
    const panes = new Map([
      ["editor", "claude"],
      ["unused", "lazygit"],
    ]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const resolved = resolveTreeCommands(tree, panes) as PaneNode;
    expect(resolved.command).toBe("claude");
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(output).toContain("unused");
    stderrSpy.mockRestore();
  });
});

// ---------- Tree plan builder ----------

describe("buildTreePlan", () => {
  it("sets focusPane to first leaf in depth-first order", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "top", command: "cmd1" },
        second: { type: "pane", name: "bottom", command: "cmd2" },
      },
      second: { type: "pane", name: "right", command: "cmd3" },
    };
    const plan = buildTreePlan(tree);
    expect(plan.focusPane).toBe("top");
  });

  it("uses default options", () => {
    const tree: LayoutNode = { type: "pane", name: "main", command: "cmd" };
    const plan = buildTreePlan(tree);
    expect(plan.autoResize).toBe(true);
    expect(plan.editorSize).toBe(75);
    expect(plan.fontSize).toBeNull();
    expect(plan.theme).toBeNull();
    expect(plan.newWindow).toBe(false);
    expect(plan.fullscreen).toBe(false);
    expect(plan.maximize).toBe(false);
    expect(plan.float).toBe(false);
    expect(plan.tree).toEqual(tree);
  });

  it("accepts custom option overrides", () => {
    const tree: LayoutNode = { type: "pane", name: "main", command: "cmd" };
    const plan = buildTreePlan(tree, {
      autoResize: false,
      editorSize: 60,
      fontSize: 14,
      theme: "nord",
      newWindow: true,
      fullscreen: true,
      maximize: true,
      float: true,
    });
    expect(plan.autoResize).toBe(false);
    expect(plan.editorSize).toBe(60);
    expect(plan.fontSize).toBe(14);
    expect(plan.theme).toBe("nord");
    expect(plan.newWindow).toBe(true);
    expect(plan.fullscreen).toBe(true);
    expect(plan.maximize).toBe(true);
    expect(plan.float).toBe(true);
  });

  it("includes leaves in the plan", () => {
    const tree: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "top", command: "cmd1" },
        second: { type: "pane", name: "bottom", command: "cmd2" },
      },
      second: { type: "pane", name: "right", command: "cmd3" },
    };
    const plan = buildTreePlan(tree);
    expect(plan.leaves).toEqual(["top", "bottom", "right"]);
  });

  it("includes single leaf in the plan", () => {
    const tree: LayoutNode = { type: "pane", name: "main", command: "cmd" };
    const plan = buildTreePlan(tree);
    expect(plan.leaves).toEqual(["main"]);
  });
});

// ---------- Leaf walker ----------

describe("walkLeaves", () => {
  it("maps a single pane", () => {
    const node: LayoutNode = { type: "pane", name: "main", command: "cmd" };
    expect(walkLeaves(node, (p) => p.name)).toEqual(["main"]);
  });

  it("maps leaves with a custom mapper", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: { type: "pane", name: "a", command: "cmd-a" },
      second: { type: "pane", name: "b", command: "cmd-b" },
    };
    expect(walkLeaves(node, (p) => ({ name: p.name, command: p.command }))).toEqual([
      { name: "a", command: "cmd-a" },
      { name: "b", command: "cmd-b" },
    ]);
  });

  it("collects from deeply nested tree in depth-first order", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "a", command: "" },
        second: { type: "pane", name: "b", command: "" },
      },
      second: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "c", command: "" },
        second: { type: "pane", name: "d", command: "" },
      },
    };
    expect(walkLeaves(node, (p) => p.name)).toEqual(["a", "b", "c", "d"]);
  });
});

// ---------- Leaf collector ----------

describe("collectLeaves", () => {
  it("collects single pane", () => {
    const node: LayoutNode = { type: "pane", name: "main", command: "cmd" };
    expect(collectLeaves(node)).toEqual(["main"]);
  });

  it("collects from a split", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: { type: "pane", name: "a", command: "" },
      second: { type: "pane", name: "b", command: "" },
    };
    expect(collectLeaves(node)).toEqual(["a", "b"]);
  });

  it("collects from deeply nested tree in depth-first order", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "a", command: "" },
        second: { type: "pane", name: "b", command: "" },
      },
      second: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "c", command: "" },
        second: { type: "pane", name: "d", command: "" },
      },
    };
    expect(collectLeaves(node)).toEqual(["a", "b", "c", "d"]);
  });
});

// ---------- findPaneByName ----------

describe("findPaneByName", () => {
  it("finds a pane at the root level", () => {
    const node: LayoutNode = { type: "pane", name: "main", command: "vim" };
    const result = findPaneByName(node, "main");
    expect(result).toEqual({ type: "pane", name: "main", command: "vim" });
  });

  it("returns null when pane is not found", () => {
    const node: LayoutNode = { type: "pane", name: "main", command: "vim" };
    const result = findPaneByName(node, "missing");
    expect(result).toBeNull();
  });

  it("finds a pane in a nested split tree", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "editor", command: "vim" },
        second: { type: "pane", name: "shell", command: "bash" },
      },
      second: { type: "pane", name: "sidebar", command: "lazygit" },
    };
    const result = findPaneByName(node, "shell");
    expect(result).toEqual({ type: "pane", name: "shell", command: "bash" });
  });

  it("returns null when name is not in a nested tree", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "a", command: "" },
        second: { type: "pane", name: "b", command: "" },
      },
      second: { type: "pane", name: "c", command: "" },
    };
    const result = findPaneByName(node, "missing");
    expect(result).toBeNull();
  });

  it("finds pane in the second branch of a split", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "right",
      first: { type: "pane", name: "left", command: "vim" },
      second: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "top", command: "htop" },
        second: { type: "pane", name: "target", command: "lazygit" },
      },
    };
    const result = findPaneByName(node, "target");
    expect(result).toEqual({ type: "pane", name: "target", command: "lazygit" });
  });
});

describe("firstLeaf", () => {
  it("returns the node itself for a single pane", () => {
    const pane: PaneNode = { type: "pane", name: "editor", command: "vim" };
    const result = firstLeaf(pane);
    expect(result).toBe(pane);
    expect(result.name).toBe("editor");
    expect(result.command).toBe("vim");
  });

  it("returns the leftmost leaf of a right split", () => {
    const left: PaneNode = { type: "pane", name: "a", command: "cmd-a" };
    const right: PaneNode = { type: "pane", name: "b", command: "cmd-b" };
    const split: SplitNode = { type: "split", direction: "right", first: left, second: right };
    expect(firstLeaf(split)).toBe(left);
  });

  it("returns the leftmost leaf of a down split", () => {
    const top: PaneNode = { type: "pane", name: "top", command: "top-cmd" };
    const bottom: PaneNode = { type: "pane", name: "bottom", command: "bottom-cmd" };
    const split: SplitNode = { type: "split", direction: "down", first: top, second: bottom };
    expect(firstLeaf(split)).toBe(top);
  });

  it("returns the deepest leftmost leaf of a nested tree", () => {
    const a: PaneNode = { type: "pane", name: "a", command: "cmd-a" };
    const b: PaneNode = { type: "pane", name: "b", command: "cmd-b" };
    const c: PaneNode = { type: "pane", name: "c", command: "cmd-c" };
    const d: PaneNode = { type: "pane", name: "d", command: "cmd-d" };
    const left: SplitNode = { type: "split", direction: "down", first: a, second: b };
    const right: SplitNode = { type: "split", direction: "down", first: c, second: d };
    const root: SplitNode = { type: "split", direction: "right", first: left, second: right };
    expect(firstLeaf(root)).toBe(a);
  });

  it("traverses only the first branch at each level", () => {
    const a: PaneNode = { type: "pane", name: "a", command: "" };
    const b: PaneNode = { type: "pane", name: "b", command: "" };
    const c: PaneNode = { type: "pane", name: "c", command: "" };
    const d: PaneNode = { type: "pane", name: "d", command: "" };
    const ab: SplitNode = { type: "split", direction: "down", first: a, second: b };
    const abc: SplitNode = { type: "split", direction: "down", first: ab, second: c };
    const root: SplitNode = { type: "split", direction: "right", first: abc, second: d };
    expect(firstLeaf(root)).toBe(a);
  });
});
