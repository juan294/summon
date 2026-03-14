// tree.ts — Tree data model, DSL parser, pane extractor, resolver, plan builder, leaf collector

import { EDITOR_SIZE_DEFAULT } from "./layout.js";

// ---------- Types ----------

export interface PaneNode {
  type: "pane";
  name: string;
  command: string;
}

export interface SplitNode {
  type: "split";
  direction: "right" | "down";
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = PaneNode | SplitNode;

export interface TreeLayoutPlan {
  tree: LayoutNode;
  focusPane: string;
  autoResize: boolean;
  editorSize: number;
  fontSize: number | null;
  newWindow: boolean;
  fullscreen: boolean;
  maximize: boolean;
  float: boolean;
}

// ---------- Parser internals ----------

const PANE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const NAME_START_RE = /[a-zA-Z_]/;
const NAME_CHAR_RE = /[a-zA-Z0-9_-]/;

interface Token {
  type: "name" | "quoted" | "pipe" | "slash" | "lparen" | "rparen";
  value: string;
}

const SINGLE_CHAR_TOKENS: Record<string, Token["type"]> = {
  "|": "pipe",
  "/": "slash",
  "(": "lparen",
  ")": "rparen",
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    const singleType = SINGLE_CHAR_TOKENS[ch];
    if (singleType) {
      tokens.push({ type: singleType, value: ch });
      i++;
      continue;
    }
    if (ch === '"') {
      const start = i + 1;
      i++;
      while (i < input.length && input[i] !== '"') {
        i++;
      }
      if (i >= input.length) {
        throw new Error("Unterminated quoted string");
      }
      const content = input.slice(start, i);
      if (content.length === 0) {
        throw new Error("Empty quoted string");
      }
      tokens.push({ type: "quoted", value: content });
      i++; // skip closing quote
      continue;
    }
    if (NAME_START_RE.test(ch)) {
      const start = i;
      while (i < input.length && NAME_CHAR_RE.test(input[i]!)) {
        i++;
      }
      tokens.push({ type: "name", value: input.slice(start, i) });
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/**
 * Recursive descent parser.
 *
 * Grammar (lowest to highest precedence):
 *   expr     → downExpr ( "|" downExpr )*
 *   downExpr → atom ( "/" atom )*
 *   atom     → NAME | QUOTED_STRING | "(" expr ")"
 *
 * Both | and / are left-associative. / binds tighter than |.
 *
 * The parser builds the tree with temporary auto-names for quoted strings,
 * then a post-pass deduplicates names across the whole tree.
 */
function parse(tokens: Token[]): LayoutNode {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token {
    const tok = tokens[pos];
    if (!tok) {
      throw new Error("Unexpected end of input");
    }
    pos++;
    return tok;
  }

  function parseBinaryOp(
    operatorType: Token["type"],
    direction: "right" | "down",
    nextLevel: () => LayoutNode,
  ): LayoutNode {
    let left = nextLevel();
    while (peek()?.type === operatorType) {
      advance();
      const right = nextLevel();
      left = { type: "split", direction, first: left, second: right };
    }
    return left;
  }

  function parseExpr(): LayoutNode {
    return parseBinaryOp("pipe", "right", parseDownExpr);
  }

  function parseDownExpr(): LayoutNode {
    return parseBinaryOp("slash", "down", parseAtom);
  }

  function parseAtom(): LayoutNode {
    const tok = peek();
    if (!tok) {
      throw new Error("Unexpected end of input: expected a pane name, quoted command, or '('");
    }
    if (tok.type === "name") {
      advance();
      return { type: "pane", name: tok.value, command: "" };
    }
    if (tok.type === "quoted") {
      advance();
      const cmd = tok.value;
      const firstWord = cmd.split(/\s+/)[0] ?? cmd;
      return { type: "pane", name: firstWord, command: cmd };
    }
    if (tok.type === "lparen") {
      advance(); // consume (
      const node = parseExpr();
      const closing = peek();
      if (!closing || closing.type !== "rparen") {
        throw new Error("Expected closing ')'");
      }
      advance(); // consume )
      return node;
    }
    throw new Error(`Unexpected token '${tok.value}' at position ${pos}`);
  }

  const result = parseExpr();

  if (pos < tokens.length) {
    const leftover = tokens[pos];
    if (leftover?.type === "rparen") {
      throw new Error("Unexpected ')': no matching '('");
    }
    throw new Error(`Unexpected token '${leftover?.value}' at position ${pos}`);
  }

  return result;
}

/** Deduplicate auto-generated pane names across the tree (mutates in-place during build). */
function deduplicateNames(node: LayoutNode): LayoutNode {
  const counts = new Map<string, number>();

  // First pass: count all names that came from quoted strings (have non-empty command)
  function countNames(n: LayoutNode): void {
    if (n.type === "pane" && n.command !== "") {
      counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    } else if (n.type === "split") {
      countNames(n.first);
      countNames(n.second);
    }
  }
  countNames(node);

  // Second pass: assign deduplicated names
  const seen = new Map<string, number>();

  function rename(n: LayoutNode): LayoutNode {
    if (n.type === "pane") {
      if (n.command !== "" && (counts.get(n.name) ?? 0) > 1) {
        const count = (seen.get(n.name) ?? 0) + 1;
        seen.set(n.name, count);
        const newName = count === 1 ? n.name : `${n.name}_${count}`;
        return { ...n, name: newName };
      }
      return n;
    }
    return {
      type: "split",
      direction: n.direction,
      first: rename(n.first),
      second: rename(n.second),
    };
  }

  return rename(node);
}

// ---------- Public API ----------

/** Parse a tree DSL string into a LayoutNode tree. */
export function parseTreeDSL(input: string): LayoutNode {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty tree expression");
  }
  const tokens = tokenize(trimmed);
  const tree = parse(tokens);
  return deduplicateNames(tree);
}

/** Extract pane definitions (keys matching `pane.<name>`) from a config map. */
export function extractPaneDefinitions(config: Map<string, string>): Map<string, string> {
  const panes = new Map<string, string>();
  for (const [key, value] of config) {
    if (key.startsWith("pane.")) {
      const name = key.slice(5);
      if (!PANE_NAME_RE.test(name)) {
        throw new Error(`Invalid pane name: '${name}' (must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/)`);
      }
      panes.set(name, value);
    }
  }
  return panes;
}

/**
 * Walk the tree and fill in commands for bare-name panes from the pane definitions map.
 * Panes with non-empty commands (inline quoted) are left as-is.
 * Throws if a bare name is not found in the pane definitions.
 * Warns to stderr if a pane definition is not referenced in the tree.
 * Returns a new tree (does not mutate input).
 */
export function resolveTreeCommands(
  tree: LayoutNode,
  panes: Map<string, string>,
): LayoutNode {
  const usedNames = new Set<string>();

  function resolve(node: LayoutNode): LayoutNode {
    if (node.type === "pane") {
      if (node.command !== "") {
        // Inline command — leave as-is
        return node;
      }
      const cmd = panes.get(node.name);
      if (cmd === undefined) {
        throw new Error(
          `Pane '${node.name}' is used in the tree but has no definition (missing pane.${node.name} in config)`,
        );
      }
      usedNames.add(node.name);
      return { ...node, command: cmd };
    }
    return {
      type: "split",
      direction: node.direction,
      first: resolve(node.first),
      second: resolve(node.second),
    };
  }

  const resolved = resolve(tree);

  // Warn about unused pane definitions
  for (const name of panes.keys()) {
    if (!usedNames.has(name)) {
      process.stderr.write(`Warning: pane definition '${name}' is not used in the tree\n`);
    }
  }

  return resolved;
}

export interface TreePlanOptions {
  autoResize?: boolean;
  editorSize?: number;
  fontSize?: number | null;
  newWindow?: boolean;
  fullscreen?: boolean;
  maximize?: boolean;
  float?: boolean;
}

/** Build a TreeLayoutPlan from a resolved tree and optional settings. */
export function buildTreePlan(
  tree: LayoutNode,
  opts?: TreePlanOptions,
): TreeLayoutPlan {
  const leaves = collectLeaves(tree);
  const focusPane = leaves[0] ?? "";
  return {
    tree,
    focusPane,
    autoResize: opts?.autoResize ?? true,
    editorSize: opts?.editorSize ?? EDITOR_SIZE_DEFAULT,
    fontSize: opts?.fontSize ?? null,
    newWindow: opts?.newWindow ?? false,
    fullscreen: opts?.fullscreen ?? false,
    maximize: opts?.maximize ?? false,
    float: opts?.float ?? false,
  };
}

/** Collect all pane names in depth-first order. */
export function collectLeaves(node: LayoutNode): string[] {
  if (node.type === "pane") {
    return [node.name];
  }
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

/** Returns the first leaf pane node in depth-first order. */
export function firstLeaf(node: LayoutNode): PaneNode {
  if (node.type === "pane") {
    return node;
  }
  return firstLeaf(node.first);
}

/** Find a PaneNode by name in the tree. Returns null if not found. */
export function findPaneByName(node: LayoutNode, name: string): PaneNode | null {
  if (node.type === "pane") {
    return node.name === name ? node : null;
  }
  return findPaneByName(node.first, name) ?? findPaneByName(node.second, name);
}
