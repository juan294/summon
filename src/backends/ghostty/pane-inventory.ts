import type { LayoutPlan } from "../../layout.js";
import type { TreeLayoutPlan } from "../../tree.js";
import { isPlainText } from "../../ui/sanitize.js";

export interface PaneDescriptor {
  name: string;
  variable: string;
}
export interface NativeMetadata {
  rootTerminalId: string;
  panes: Array<{ name: string; terminalId: string }>;
}
export const TERMINAL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Physical creation order, deliberately independent of legacy display ordering. */
export function traditionalInventory(plan: LayoutPlan): PaneDescriptor[] {
  const panes = [
    { name: "editor", variable: "paneRoot" },
    { name: "sidebar", variable: "paneSidebar" },
  ];
  for (let i = 1; i <= plan.rightColumnEditorCount; i++)
    panes.push({
      name: `right-${i}`,
      variable: i === 1 ? "paneRightCol" : `paneRight${i}`,
    });
  if (plan.hasShell)
    panes.push({
      name: "shell",
      variable:
        plan.rightColumnEditorCount === 0
          ? "paneRightCol"
          : `paneRight${plan.rightColumnEditorCount + 1}`,
    });
  for (let i = 2; i <= plan.leftColumnCount; i++)
    panes.push({ name: `editor-${i}`, variable: `paneLeft${i}` });
  return panes;
}

/** Indexed identifiers avoid punctuation and AppleScript's case-insensitive aliasing. */
export function treeInventory(plan: TreeLayoutPlan): PaneDescriptor[] {
  if (new Set(plan.leaves).size !== plan.leaves.length)
    throw new Error("Tree pane names must be unique for exact targeting.");
  const variables = plan.leaves.map(
    (name) => `pane_${name.replace(/-/g, "_")}`,
  );
  const useIndexes =
    new Set(variables.map((v) => v.toLowerCase())).size !== variables.length ||
    variables.some((v) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v));
  return plan.leaves.map((name, i) => ({
    name,
    variable: useIndexes ? `pane${i}` : variables[i]!,
  }));
}

export function parseNativeMetadata(raw: unknown): NativeMetadata | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.rootTerminalId !== "string" ||
    !TERMINAL_ID_RE.test(value.rootTerminalId) ||
    !Array.isArray(value.panes) ||
    value.panes.length === 0
  )
    return;
  const names = new Set<string>(),
    ids = new Set<string>();
  const panes: NativeMetadata["panes"] = [];
  for (const item of value.panes as unknown[]) {
    if (!item || typeof item !== "object") return;
    const p = item as Record<string, unknown>;
    if (
      !isPlainText(p.name) ||
      typeof p.terminalId !== "string" ||
      !TERMINAL_ID_RE.test(p.terminalId)
    )
      return;
    const terminalId = p.terminalId.toUpperCase();
    if (names.has(p.name) || ids.has(terminalId)) return;
    names.add(p.name);
    ids.add(terminalId);
    panes.push({ name: p.name, terminalId });
  }
  const rootTerminalId = value.rootTerminalId.toUpperCase();
  if (!ids.has(rootTerminalId)) return;
  return { rootTerminalId, panes };
}

/** Only UUIDs use framing; names and arbitrary native text never enter this channel. */
export function parseNativeCapture(
  output: string,
  inventory: PaneDescriptor[],
): NativeMetadata | undefined {
  if (Buffer.byteLength(output) > 64 * 1024) return;
  const lines = output.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.shift() !== "SUMMON_NATIVE_V1" || lines.length !== inventory.length)
    return;
  return parseNativeMetadata({
    rootTerminalId: lines[0],
    panes: inventory.map((p, i) => ({ name: p.name, terminalId: lines[i] })),
  });
}
