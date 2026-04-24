import { getPresetNames, isPresetName } from "../layout.js";
import {
  isCustomLayout,
  isValidLayoutName,
  listCustomLayouts,
} from "../config.js";
import { exitWithUsageHint } from "../utils.js";
import type { LayoutNode } from "../tree.js";

/**
 * Convert a LayoutNode tree into a string[][] grid for renderLayoutPreview.
 * "right" splits -> columns, "down" splits -> rows within a column.
 */
export function treeToGrid(node: LayoutNode, panes: Map<string, string>): string[][] {
  function collectColumns(n: LayoutNode): LayoutNode[] {
    if (n.type === "split" && n.direction === "right") {
      return [...collectColumns(n.first), ...collectColumns(n.second)];
    }
    return [n];
  }

  function collectRows(n: LayoutNode): string[] {
    if (n.type === "split" && n.direction === "down") {
      return [...collectRows(n.first), ...collectRows(n.second)];
    }
    if (n.type === "pane") {
      return [panes.get(n.name) ?? n.name];
    }

    const leaves: string[] = [];

    function gather(nd: LayoutNode): void {
      if (nd.type === "pane") {
        leaves.push(panes.get(nd.name) ?? nd.name);
      } else {
        gather(nd.first);
        gather(nd.second);
      }
    }

    gather(n);
    return [leaves.join(" | ")];
  }

  return collectColumns(node).map((col) => collectRows(col));
}

export function validateLayoutNameOrExit(name: string): void {
  if (isPresetName(name)) {
    console.error(`Error: "${name}" is a reserved preset name. Choose a different name.`);
    process.exit(1);
  }
  if (!isValidLayoutName(name)) {
    console.error(`Error: Invalid layout name "${name}".`);
    console.error("Names must start with a letter and contain only letters, digits, hyphens, and underscores.");
    process.exit(1);
  }
}

export function validateLayoutOrExit(value: string, label: string): void {
  let customMatch: boolean;
  try {
    customMatch = isCustomLayout(value);
  } catch {
    exitWithUsageHint(`Error: ${label} is not a valid layout name.`);
    return;
  }
  if (!isPresetName(value) && !customMatch) {
    console.error(`Error: ${label} must be a valid preset or custom layout name, got "${value}".`);
    console.error(`Valid presets: ${getPresetNames().join(", ")}`);
    const custom = listCustomLayouts();
    if (custom.length > 0) {
      console.error(`Custom layouts: ${custom.join(", ")}`);
    }
    exitWithUsageHint();
  }
}

export function layoutNotFoundOrExit(name: string): never {
  console.error(`Error: Layout not found: ${name}`);
  console.error("Run 'summon layout list' to see available layouts.");
  process.exit(1);
}
