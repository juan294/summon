import { isPlainText } from "../../pane-inventory.js";

/** Rex resource identifiers as the CLI prints them: `<kind>:<36-char id>`. */
const REX_ID_RE = /^(session|window|block):[0-9a-f-]{36}$/;
/** Server endpoints Summon records and passes back through `-S`. */
const REX_SERVER_RE = /^(unix|tcp|https):\/\/\S+$/;

export interface RexBlockIdentity {
  /** Summon pane name (an entry of the record's `panes`). */
  name: string;
  blockId: string;
  label: string;
}

/** Exact Rex identity of a workspace (plan P16); every id is a server-assigned value. */
export interface RexIdentity {
  server: string;
  hostId: string;
  sessionId: string;
  windowId: string;
  rootBlockId: string;
  /** Pane-name to block mapping written by the panes themselves (P13); may be a subset of `panes`. */
  blocks: RexBlockIdentity[];
}

function isKindId(value: unknown, kind: "session" | "window" | "block"): value is string {
  return typeof value === "string" && REX_ID_RE.test(value) && value.startsWith(`${kind}:`);
}

/** Validate a raw `rex` field against the record's pane names. Returns undefined on any defect. */
export function parseRexIdentity(raw: unknown, panes: readonly string[]): RexIdentity | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.server !== "string" || !REX_SERVER_RE.test(value.server) ||
    !isPlainText(value.hostId) ||
    !isKindId(value.sessionId, "session") ||
    !isKindId(value.windowId, "window") ||
    !isKindId(value.rootBlockId, "block") ||
    !Array.isArray(value.blocks)
  ) return;
  const names = new Set<string>();
  const ids = new Set<string>();
  const blocks: RexBlockIdentity[] = [];
  for (const item of value.blocks as unknown[]) {
    if (!item || typeof item !== "object") return;
    const block = item as Record<string, unknown>;
    if (!isPlainText(block.name) || !panes.includes(block.name) || !isKindId(block.blockId, "block") || !isPlainText(block.label, { allowEmpty: true })) return;
    if (names.has(block.name) || ids.has(block.blockId)) return;
    names.add(block.name);
    ids.add(block.blockId);
    blocks.push({ name: block.name, blockId: block.blockId, label: block.label });
  }
  return {
    server: value.server,
    hostId: value.hostId,
    sessionId: value.sessionId,
    windowId: value.windowId,
    rootBlockId: value.rootBlockId,
    blocks,
  };
}
