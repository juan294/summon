import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LayoutPlan } from "../../layout.js";
import type { LayoutNode, TreeLayoutPlan } from "../../tree.js";
import { formatTitle } from "../../pane-inventory.js";
import { shellQuote } from "../../shell-escape.js";
import { bootstrapLine, buildEnvVarsList, cleanupTrapLine, paneFileLine } from "../../launch-identity.js";

/**
 * Pure builder of the `session.create` request for a Summon layout (plan D4, P1, P3, P4, P13).
 *
 * Node mapping: a Summon `right` split is a Rex `horizontal` split and `down` is `vertical`;
 * `ratio` is the **before** fraction (`rex api describe session.new_split`). `paneOrder` is the
 * depth-first "before then after" leaf order, which is the order `session.create` returns
 * `block_ids` in; it differs from Summon's display order (`panes`) and from Ghostty's creation
 * order (`traditionalInventory`) by design. Every pane is an interactive login shell started in
 * command mode under `/usr/bin/env` so the workspace variables exist at shell startup, and the
 * setup lines plus the pane command are typed through `initial_input`.
 */

export const TERMINAL_FLAVOR = "com.superlogical.terminal.shell";
const FALLBACK_LOGIN_SHELL = "/bin/zsh";

export interface RexBlockOptions {
  shell: "none";
  command: string[];
  cwd: string;
  initial_input: string;
}

export interface RexBlockNode {
  block: { flavor: typeof TERMINAL_FLAVOR; label: string; options: RexBlockOptions };
}

export interface RexSplitNode {
  split: { direction: "horizontal" | "vertical"; ratio: number; before: RexLayoutNode; after: RexLayoutNode };
}

export type RexLayoutNode = RexBlockNode | RexSplitNode;

export interface SessionCreateRequest {
  label: string;
  initial_windows: [{ window_label: string; layout: RexLayoutNode }];
}

export interface SessionCreateInput {
  layout: { kind: "traditional"; plan: LayoutPlan } | { kind: "tree"; plan: TreeLayoutPlan };
  targetDir: string;
  project: string;
  launchId: string;
  /** User env vars, already denylisted and validated by the launcher. */
  envVars?: Record<string, string> | undefined;
  starshipConfigPath?: string | null | undefined;
  /** Trusted on-stop fragment from validated config. */
  onStop?: string | undefined;
  /** Login shell for every pane; defaults to `resolveLoginShell()`. */
  loginShell?: string;
}

export interface SessionCreateBuild {
  request: SessionCreateRequest;
  /** Leaf names in the order `block_ids` will arrive (depth-first, before then after). */
  paneOrder: string[];
  /** Block label per pane name (the manifest's `blockLabels`, plan P13). */
  labels: Record<string, string>;
}

/** `$SHELL` when it is an absolute existing path, else `/bin/zsh`. */
export function resolveLoginShell(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  const shell = env["SHELL"];
  if (shell && shell.startsWith("/") && exists(shell)) return shell;
  return FALLBACK_LOGIN_SHELL;
}

// --- Layout model shared by both plan kinds ---

interface Leaf {
  type: "leaf";
  name: string;
  /** Pane title role (traditional) or the leaf name (tree). */
  role: string;
  command: string;
  cwd: string;
}

interface Split {
  type: "split";
  direction: "right" | "down";
  first: Node;
  second: Node;
}

type Node = Leaf | Split;

function leaf(name: string, role: string, command: string | null | undefined, cwd: string): Leaf {
  return { type: "leaf", name, role, command: command ?? "", cwd };
}

function right(first: Node, second: Node): Split {
  return { type: "split", direction: "right", first, second };
}

function down(first: Node, second: Node): Split {
  return { type: "split", direction: "down", first, second };
}

/** A downward chain `a / (b / (c ...))`, the shape repeated `split <last> direction down` builds. */
function column(leaves: Leaf[]): Node {
  const [head, ...rest] = leaves;
  if (!head) throw new Error("A column needs at least one pane");
  return rest.length === 0 ? head : down(head, column(rest));
}

/**
 * The traditional plan as the split tree Ghostty's script builds (`src/script.ts`): the
 * sidebar is split right from the root first, the right column is split right from the root
 * afterwards (so it sits between editor and sidebar), and the extra editors and the shell
 * chain downwards. The sidebar pane is created even without a command, exactly like Ghostty.
 */
function traditionalTree(plan: LayoutPlan, targetDir: string): Node {
  const secondaryCmd = plan.secondaryEditor ?? plan.editor;
  const left = [leaf("editor", "editor", plan.editor, targetDir)];
  for (let i = 2; i <= plan.leftColumnCount; i++) left.push(leaf(`editor-${i}`, "editor", plan.editor, targetDir));
  const rightColumn: Leaf[] = [];
  for (let i = 1; i <= plan.rightColumnEditorCount; i++) rightColumn.push(leaf(`right-${i}`, "editor", secondaryCmd, targetDir));
  if (plan.hasShell) rightColumn.push(leaf("shell", "shell", plan.shellCommand, targetDir));
  const sidebar = leaf("sidebar", "sidebar", plan.sidebarCommand, targetDir);
  const editorArea = rightColumn.length === 0 ? column(left) : right(column(left), column(rightColumn));
  return right(editorArea, sidebar);
}

function treeTree(node: LayoutNode, targetDir: string): Node {
  if (node.type === "pane") return leaf(node.name, node.name, node.command, node.cwd ? resolve(targetDir, node.cwd) : targetDir);
  return { type: "split", direction: node.direction, first: treeTree(node.first, targetDir), second: treeTree(node.second, targetDir) };
}

// --- Block construction ---

/** The Ghostty workspace environment plus this launch's id, as `/usr/bin/env` arguments. */
function envWrapper(input: SessionCreateInput, loginShell: string): string[] {
  return ["/usr/bin/env", ...buildEnvVarsList(input.starshipConfigPath, input.envVars, input.project), `SUMMON_LAUNCH_ID=${input.launchId}`, loginShell, "-l"];
}

/**
 * Text typed into a pane once its shell starts. The root pane publishes this launch's pid,
 * active marker and its own pane file and installs the cleanup trap; every other pane publishes
 * its own pane file. Then `cd`, `clear` and the pane command. Values are quoted with
 * shellQuote; the command is a trusted shell fragment (confirmDangerousCommands) typed as is.
 */
function buildInitialInput(input: SessionCreateInput, pane: Leaf, isRoot: boolean): string {
  const lines = isRoot
    ? [
      bootstrapLine(input.project, input.launchId, "rex", pane.name),
      cleanupTrapLine(input.project, input.launchId, { onStop: input.onStop, targetDir: input.targetDir }),
    ]
    : [paneFileLine(input.project, input.launchId, pane.name)];
  lines.push(`cd ${shellQuote(pane.cwd)}`, "clear");
  if (pane.command) lines.push(pane.command);
  return lines.map((line) => `${line}\n`).join("");
}

export function buildSessionCreateRequest(input: SessionCreateInput): SessionCreateBuild {
  const loginShell = input.loginShell ?? resolveLoginShell();
  const command = envWrapper(input, loginShell);
  const root = input.layout.kind === "traditional"
    ? traditionalTree(input.layout.plan, input.targetDir)
    : treeTree(input.layout.plan.tree, input.targetDir);
  const { autoResize, editorSize } = input.layout.plan;

  const paneOrder: string[] = [];
  const labels: Record<string, string> = {};
  let firstRightSplitDone = false;

  function build(node: Node): RexLayoutNode {
    if (node.type === "leaf") {
      if (node.name in labels) throw new Error(`Rex layout: pane names must be unique (duplicate "${node.name}")`);
      const isRoot = paneOrder.length === 0;
      const label = formatTitle(node.role, node.command || null);
      paneOrder.push(node.name);
      labels[node.name] = label;
      return {
        block: {
          flavor: TERMINAL_FLAVOR,
          label,
          options: { shell: "none", command, cwd: node.cwd, initial_input: buildInitialInput(input, node, isRoot) },
        },
      };
    }
    let ratio = 0.5;
    if (node.direction === "right" && !firstRightSplitDone) {
      firstRightSplitDone = true;
      if (autoResize) ratio = editorSize / 100;
    }
    // Before is built before after so paneOrder matches the server's block_ids order.
    const before = build(node.first);
    const after = build(node.second);
    return { split: { direction: node.direction === "right" ? "horizontal" : "vertical", ratio, before, after } };
  }

  const layout = build(root);
  return {
    request: { label: input.project, initial_windows: [{ window_label: `[${input.project}]`, layout }] },
    paneOrder,
    labels,
  };
}
