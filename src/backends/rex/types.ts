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

export function isKindId(value: unknown, kind: "session" | "window" | "block"): value is string {
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

// --- CLI adapter contract (plan §3 "Rex error classes", D5, P14) ---

interface RexOpTraits {
  /** Changes server state: a timeout or unexplained failure leaves the outcome unknown. */
  mutating: boolean;
  /** Prints JSON without a `--json` flag (`api call` prints the method result). */
  json?: true;
  /** The server rolls the request back when it answers with an error object. */
  rollsBackOnReject?: true;
}

/**
 * Every Rex CLI operation Summon may run, with its traits. `runRex` takes the op so the
 * classifier never guesses what a failure meant; `rex wait` is deliberately absent (not an
 * allowed op). Adding an op means adding one row here.
 */
export const REX_OPS = {
  "whoami": { mutating: false },
  "version": { mutating: false },
  "ls": { mutating: false },
  "client-ls": { mutating: false, json: true },
  "session-create": { mutating: true, json: true, rollsBackOnReject: true },
  "session-view": { mutating: false, json: true },
  "session-inspect": { mutating: false },
  "block-ls": { mutating: false },
  "block-call": { mutating: false },
  "focus": { mutating: true },
  "do-select": { mutating: true },
  "kill": { mutating: true },
  "window-rename": { mutating: true },
  "block-label": { mutating: true },
} as const satisfies Record<string, RexOpTraits>;

export type RexOp = keyof typeof REX_OPS;

export function rexOpTraits(op: RexOp): RexOpTraits {
  return REX_OPS[op];
}

export function isMutatingOp(op: RexOp): boolean {
  return rexOpTraits(op).mutating;
}

/** What `runRex` observed from the process, independent of any interpretation. */
export interface RexRawResult {
  /** Exit status, or null when the process was killed or never started. */
  code: number | null;
  signal: string | null;
  /** Node's process timeout fired (the child was killed). */
  timedOut: boolean;
  /** The binary does not exist. */
  enoent: boolean;
  stdout: string;
  stderr: string;
  /** Expected JSON output could not be parsed, or the output exceeded the buffer. */
  malformed?: boolean;
}

export type RexFailureKind =
  | "missing-binary"
  | "unreachable"
  | "invalid"
  | "not-found"
  | "ambiguous"
  | "rejected"
  | "failed"
  | "timeout"
  | "signal"
  | "malformed"
  | "unknown";

/** Effect of a failed call on the server: nothing happened, the server rolled it back, or nobody knows. */
export type RexOutcome = "none" | "rolled-back" | "unknown";

export interface RexFailure {
  ok: false;
  op: RexOp;
  kind: RexFailureKind;
  outcome: RexOutcome;
  /** First stderr line (control characters escaped) or a generic description. */
  reason: string;
  /** Recovery advice for the user when the kind has one. */
  hint?: string;
  raw: RexRawResult;
}

export interface RexSuccess {
  ok: true;
  op: RexOp;
  stdout: string;
  /** Parsed stdout when the op or `--json` promised JSON. */
  json?: unknown;
}

export type RexResult = RexSuccess | RexFailure;
