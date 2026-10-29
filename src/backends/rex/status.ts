import { rawResult } from "./cli.js";
import type { RexCli } from "./cli.js";
import { classifyRexFailure } from "./errors.js";
import type { RexFailure, RexIdentity, RexResult } from "./types.js";

/**
 * Rex workspace state (plan P10, §3 state table). Every read targets the recorded server
 * explicitly, never starts a server, and keeps `unknown` distinct from `stopped`.
 */

export interface RexSessionSummary {
  sessionId: string;
  label: string;
}

export interface SessionWindowView {
  windowId: string;
  label: string;
  /** Block ids across the window's layers, in layout order. */
  blockIds: string[];
  /** `host_id` per block, aligned with `blockIds` (empty string when the server omitted it). */
  hostIds: string[];
}

export interface SessionView {
  sessionId: string;
  label: string;
  revision: number;
  windows: SessionWindowView[];
}

export type RexWorkspaceState = "active" | "partial" | "stopped" | "unknown";

export interface RexSessionState {
  state: RexWorkspaceState;
  reason?: string;
  /** Recorded pane names whose block is present in the view. */
  liveBlocks: string[];
}

/** An answer whose shape Summon cannot read is `malformed`, classified like any other failure. */
function malformed(result: Extract<RexResult, { ok: true }>): RexFailure {
  return classifyRexFailure(result.op, rawResult({ code: 0, stdout: result.stdout, malformed: true })) as RexFailure;
}

/** `rex ls --json` (non-mutating; the bound CLI's read defaults: autostart off, 3 s). */
export function listSessions(cli: RexCli): { ok: true; sessions: RexSessionSummary[] } | RexFailure {
  const result = cli.call("ls", ["ls", "--json"]);
  if (!result.ok) return result;
  const raw = result.json && typeof result.json === "object" ? (result.json as Record<string, unknown>)["sessions"] : undefined;
  if (!Array.isArray(raw)) return malformed(result);
  const sessions: RexSessionSummary[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") return malformed(result);
    const { session_id, label } = item as Record<string, unknown>;
    if (typeof session_id !== "string") return malformed(result);
    sessions.push({ sessionId: session_id, label: typeof label === "string" ? label : "" });
  }
  return { ok: true, sessions };
}

export function parseSessionView(json: unknown): SessionView | undefined {
  if (!json || typeof json !== "object") return;
  const raw = json as Record<string, unknown>;
  if (typeof raw["session_id"] !== "string" || typeof raw["revision"] !== "number") return;
  const windowsRaw = raw["windows"];
  if (windowsRaw !== null && windowsRaw !== undefined && !Array.isArray(windowsRaw)) return;
  const windows: SessionWindowView[] = [];
  for (const item of (windowsRaw ?? []) as unknown[]) {
    if (!item || typeof item !== "object") return;
    const w = item as Record<string, unknown>;
    if (typeof w["window_id"] !== "string") return;
    const blockIds: string[] = [];
    const hostIds: string[] = [];
    const layers = w["layers"];
    if (Array.isArray(layers)) {
      for (const layer of layers as unknown[]) {
        const blocks = layer && typeof layer === "object" ? (layer as Record<string, unknown>)["blocks"] : undefined;
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks as unknown[]) {
          const id = block && typeof block === "object" ? (block as Record<string, unknown>)["block_id"] : undefined;
          if (typeof id !== "string") continue;
          const hostId = (block as Record<string, unknown>)["host_id"];
          blockIds.push(id);
          hostIds.push(typeof hostId === "string" ? hostId : "");
        }
      }
    }
    windows.push({ windowId: w["window_id"], label: typeof w["label"] === "string" ? w["label"] : "", blockIds, hostIds });
  }
  return { sessionId: raw["session_id"], label: typeof raw["label"] === "string" ? raw["label"] : "", revision: raw["revision"], windows };
}

/** `api call session.view -` for one session (non-mutating; read defaults). */
export function viewSession(cli: RexCli, sessionId: string): { ok: true; view: SessionView } | RexFailure {
  const result = cli.call("session-view", ["api", "call", "session.view", "-"], { input: JSON.stringify({ session_id: sessionId }) });
  if (!result.ok) return result;
  const view = parseSessionView(result.json);
  return view ? { ok: true, view } : malformed(result);
}

export function viewBlockIds(view: SessionView): Set<string> {
  return new Set(view.windows.flatMap((w) => w.blockIds));
}

/** The P10 state table over `ls` and `session.view`; `cli` must be bound to `identity.server`. */
export function sessionState(cli: RexCli, identity: RexIdentity, project: string): RexSessionState {
  const listed = listSessions(cli);
  if (!listed.ok) return { state: "unknown", reason: listed.reason, liveBlocks: [] };
  if (!listed.sessions.some((s) => s.sessionId === identity.sessionId)) return { state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] };
  const viewed = viewSession(cli, identity.sessionId);
  if (!viewed.ok) return { state: "unknown", reason: viewed.reason, liveBlocks: [] };
  const present = viewBlockIds(viewed.view);
  if (present.size === 0) return { state: "stopped", reason: `empty Rex session remains; run summon clean ${project}`, liveBlocks: [] };
  const liveBlocks = identity.blocks.filter((b) => present.has(b.blockId)).map((b) => b.name);
  if (present.has(identity.rootBlockId)) return { state: "active", liveBlocks };
  if (liveBlocks.length > 0) return { state: "partial", reason: "root pane closed", liveBlocks };
  return { state: "stopped", reason: "no live panes", liveBlocks: [] };
}
