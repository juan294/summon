import { rawResult } from "./cli.js";
import type { RexCli } from "./cli.js";
import { classifyRexFailure } from "./errors.js";
import { pickAppClient, selectInApp } from "./app.js";
import { asRecord } from "./types.js";
import { isDisplaySafe } from "../../pane-inventory.js";
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

/** The `stopped` reason that confirms the session is gone on the record's server. */
export const SESSION_GONE = "Rex session no longer exists";

/** The `stopped` reason when the session still has blocks, none of them a recorded pane. */
export const NO_LIVE_PANES = "no live panes";

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
    // A session id that would not print as plain text is no session Summon created: skip it.
    if (!isDisplaySafe(session_id)) continue;
    sessions.push({ sessionId: session_id, label: typeof label === "string" ? label : "" });
  }
  return { ok: true, sessions };
}

/** An optional list field: null or absent is empty, an array is itself, anything else is malformed (undefined). */
function nullableArray(value: unknown): unknown[] | undefined {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? (value as unknown[]) : undefined;
}

export function parseSessionView(json: unknown): SessionView | undefined {
  if (!json || typeof json !== "object") return;
  const raw = json as Record<string, unknown>;
  if (typeof raw["session_id"] !== "string" || typeof raw["revision"] !== "number") return;
  const windowsRaw = nullableArray(raw["windows"]);
  if (!windowsRaw) return;
  const windows: SessionWindowView[] = [];
  for (const item of windowsRaw) {
    if (!item || typeof item !== "object") return;
    const w = item as Record<string, unknown>;
    if (typeof w["window_id"] !== "string") return;
    const blockIds: string[] = [];
    const hostIds: string[] = [];
    // Null or absent `layers`/`blocks` mean "none"; any other non-array shape is malformed. A
    // malformed view must never read as an empty session: `summon clean` destroys on that reading.
    const layers = nullableArray(w["layers"]);
    if (!layers) return;
    for (const layer of layers) {
      const record = asRecord(layer);
      if (!record) return;
      const blocks = nullableArray(record["blocks"]);
      if (!blocks) return;
      for (const item of blocks) {
        const block = asRecord(item);
        if (!block || typeof block["block_id"] !== "string") return;
        const hostId = block["host_id"];
        blockIds.push(block["block_id"]);
        hostIds.push(typeof hostId === "string" ? hostId : "");
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

export type SessionListing = ReturnType<typeof listSessions>;

/** One `rex ls` answer per server, shared by the liveness probes of one launch (PE-L1). */
export interface SessionListings {
  of(cli: RexCli): SessionListing;
}

/**
 * Every probe still views the session itself, so the probes of one launch can share a listing taken moments earlier: a
 * session that ended since reads as gone on its view, and a session another launch created since is simply not seen. It never stands in for `createWorkspace`'s `before` snapshot, which is listed
 * just before `session.create` (P13): nothing reuses a listing across that mutation.
 */
export function sessionListings(): SessionListings {
  const byServer = new Map<string, SessionListing>();
  return {
    of(cli) {
      let listed = byServer.get(cli.server);
      if (!listed) { listed = listSessions(cli); byServer.set(cli.server, listed); }
      return listed;
    },
  };
}

/**
 * The P10 state table over `ls` and `session.view`; `cli` must be bound to `identity.server`.
 * A caller that resolves several records on one server passes its own `listSessions` answer.
 */
export function sessionState(cli: RexCli, identity: RexIdentity, project: string, listed: SessionListing = listSessions(cli)): RexSessionState {
  if (!listed.ok) return { state: "unknown", reason: listed.reason, liveBlocks: [] };
  if (!listed.sessions.some((s) => s.sessionId === identity.sessionId)) return { state: "stopped", reason: SESSION_GONE, liveBlocks: [] };
  const viewed = viewSession(cli, identity.sessionId);
  if (!viewed.ok) return { state: "unknown", reason: viewed.reason, liveBlocks: [] };
  const present = viewBlockIds(viewed.view);
  if (present.size === 0) return { state: "stopped", reason: `empty Rex session remains; run summon clean ${project}`, liveBlocks: [] };
  const liveBlocks = identity.blocks.filter((b) => present.has(b.blockId)).map((b) => b.name);
  if (present.has(identity.rootBlockId)) return { state: "active", liveBlocks };
  if (liveBlocks.length > 0) return { state: "partial", reason: "root pane closed", liveBlocks };
  return { state: "stopped", reason: NO_LIVE_PANES, liveBlocks: [] };
}

// --- Phase 4: workspace commands under Rex (focus, inspect, title) ---

/** Same shape as the Ghostty native failures so the commands print one way. */
export interface RexCommandFailure {
  kind: "unavailable" | "failed";
  code: "missing" | "unavailable";
  reason: string;
}

type BlockTarget = { ok: true; blockId: string; name: string } | { ok: false; failure: RexCommandFailure };

/** A named pane's block: unknown names and panes without a block (unverified after recovery) are refused. */
function blockOfPane(identity: RexIdentity, panes: readonly string[], project: string, paneName: string): BlockTarget {
  if (!panes.includes(paneName)) return { ok: false, failure: { kind: "unavailable", code: "missing", reason: `Unknown pane. Valid panes: ${panes.join(", ")}. Run summon inspect ${project}.` } };
  const block = identity.blocks.find((b) => b.name === paneName);
  if (!block) return { ok: false, failure: { kind: "unavailable", code: "missing", reason: `pane ${paneName} could not be verified after recovery; run summon inspect ${project}` } };
  return { ok: true, blockId: block.blockId, name: block.name };
}

function failed(result: RexFailure): RexCommandFailure {
  return { kind: "failed", code: "unavailable", reason: result.reason };
}

export type RexFocusResult = { kind: "focused"; terminalId: string } | RexCommandFailure;

/**
 * Focus a pane (the named block, else the root, else the first live pane of a partial session)
 * with `rex focus`, then show the session in the newest app. The caller resolved `state`.
 */
export function focusRex(cli: RexCli, identity: RexIdentity, panes: readonly string[], project: string, liveBlocks: readonly string[], paneName?: string, preferSession?: string): RexFocusResult {
  let target: { blockId: string; name: string } | undefined;
  if (paneName !== undefined) {
    const resolved = blockOfPane(identity, panes, project, paneName);
    if (!resolved.ok) return resolved.failure;
    if (!liveBlocks.includes(resolved.name)) return { kind: "unavailable", code: "missing", reason: `pane ${resolved.name} is closed in Rex; run summon inspect ${project}` };
    target = resolved;
  } else {
    const root = identity.blocks.find((b) => b.blockId === identity.rootBlockId);
    target = root && liveBlocks.includes(root.name) ? root : identity.blocks.find((b) => liveBlocks.includes(b.name));
  }
  if (!target) return { kind: "unavailable", code: "missing", reason: `no live pane to focus; run summon inspect ${project}` };
  const focused = cli.call("focus", ["focus", "-s", identity.sessionId, target.blockId]);
  if (!focused.ok) return failed(focused);
  const choice = pickAppClient(cli, preferSession);
  if (!choice) return { kind: "failed", code: "unavailable", reason: `no Rex app is connected; open Rex and pick [${project}]` };
  const selected = selectInApp(cli, choice.chosen.clientId, identity.sessionId, identity.windowId);
  if (!selected.ok) return failed(selected);
  return { kind: "focused", terminalId: target.blockId };
}

export interface RexInspectPane {
  name: string;
  blockId: string | null;
  pid: number | null;
  /** Rex does not expose the tty; always null (printed UNAVAILABLE). */
  tty: null;
  title: string | null;
  directory: string | null;
  availability: "available" | "closed" | "unverified";
}

export interface RexInspectResult {
  availability: "available" | "unavailable";
  reason?: string;
  panes: RexInspectPane[];
  /** The root pane's most severe program status, when its programs report one. */
  programStatus?: ProgramStatus;
}

/** Current labels from `block ls` for the session. */
function blockLabels(cli: RexCli, sessionId: string): { ok: true; labels: Map<string, string> } | RexFailure {
  const listed = cli.call("block-ls", ["block", "ls", "-s", sessionId, "--json"]);
  if (!listed.ok) return listed;
  const raw = asRecord(listed.json)?.["blocks"];
  if (!Array.isArray(raw)) return malformed(listed);
  const labels = new Map<string, string>();
  for (const item of raw as unknown[]) {
    const block = asRecord(item);
    if (typeof block?.["block_id"] === "string" && typeof block["label"] === "string") labels.set(block["block_id"], block["label"]);
  }
  return { ok: true, labels };
}

function blockCall(cli: RexCli, sessionId: string, blockId: string, method: string): Record<string, unknown> | undefined {
  const result = cli.call("block-call", ["block", "call", "-s", sessionId, "-b", blockId, method]);
  return result.ok ? asRecord(result.json) : undefined;
}

/**
 * Rows for every recorded pane: presence from the reader's `liveBlocks` (the `session.view`
 * the state came from), pid and cwd from `block call process`, title from `block call title`.
 */
export function inspectRex(cli: RexCli, identity: RexIdentity, panes: readonly string[], project: string, liveBlocks: readonly string[]): RexInspectResult {
  const rows: RexInspectPane[] = [];
  const closed: string[] = [];
  const unverified: string[] = [];
  for (const name of panes) {
    const block = identity.blocks.find((b) => b.name === name);
    if (!block) {
      unverified.push(name);
      rows.push({ name, blockId: null, pid: null, tty: null, title: null, directory: null, availability: "unverified" });
      continue;
    }
    if (!liveBlocks.includes(name)) {
      closed.push(name);
      rows.push({ name, blockId: block.blockId, pid: null, tty: null, title: null, directory: null, availability: "closed" });
      continue;
    }
    const process = blockCall(cli, identity.sessionId, block.blockId, "process");
    const foreground = asRecord(process?.["foreground"]);
    const child = asRecord(process?.["child"]);
    const pid = typeof foreground?.["pid"] === "number" ? foreground["pid"] : typeof child?.["pid"] === "number" ? child["pid"] : null;
    const directory = typeof foreground?.["cwd"] === "string" ? foreground["cwd"] : null;
    const titled = blockCall(cli, identity.sessionId, block.blockId, "title");
    const title = typeof titled?.["title"] === "string" ? titled["title"] : null;
    rows.push({ name, blockId: block.blockId, pid, tty: null, title, directory, availability: "available" });
  }
  // Availability follows the recorded blocks (all present = available); unverified panes are reported, not counted.
  const problems: string[] = [];
  if (closed.length > 0) problems.push(`${closed.length} recorded ${closed.length === 1 ? "pane is" : "panes are"} closed in Rex (${closed.join(", ")})`);
  if (unverified.length > 0) problems.push(`${unverified.length} ${unverified.length === 1 ? "pane" : "panes"} could not be verified after recovery (${unverified.join(", ")}); run summon ${project} --new-window to relaunch`);
  const root = rows.find((row) => row.blockId === identity.rootBlockId && row.availability === "available");
  const programStatus = root ? programStatusOf(cli, identity.sessionId, identity.rootBlockId) : undefined;
  return { availability: closed.length > 0 ? "unavailable" : "available", ...(problems.length > 0 ? { reason: problems.join("; ") } : {}), panes: rows, ...(programStatus ? { programStatus } : {}) };
}

export type RexTitleOperation = { kind: "read" } | { kind: "set"; text: string } | { kind: "reset" };
export type RexTitleResult = { kind: "title"; terminalId: string; scope: "tab" | "pane"; override: string } | RexCommandFailure;

/**
 * Pane labels through `session.set_block_label` (reset restores the recorded label); the tab is
 * the session's window through `session.set_window_label` (reset restores `[project]`).
 */
export function titleRex(cli: RexCli, identity: RexIdentity, panes: readonly string[], project: string, scope: "tab" | "pane", operation: RexTitleOperation, paneName?: string): RexTitleResult {
  if (scope === "pane") {
    const resolved = blockOfPane(identity, panes, project, paneName ?? panes[0] ?? "");
    if (!resolved.ok) return resolved.failure;
    const recorded = identity.blocks.find((b) => b.blockId === resolved.blockId)?.label ?? "";
    if (operation.kind === "read") {
      const listed = blockLabels(cli, identity.sessionId);
      if (!listed.ok) return failed(listed);
      return { kind: "title", terminalId: resolved.blockId, scope, override: listed.labels.get(resolved.blockId) ?? "" };
    }
    const label = operation.kind === "set" ? operation.text : recorded;
    const result = cli.call("block-label", ["api", "call", "session.set_block_label", "-"], { input: JSON.stringify({ session_id: identity.sessionId, block_id: resolved.blockId, label }) });
    if (!result.ok) return failed(result);
    return { kind: "title", terminalId: resolved.blockId, scope, override: label };
  }
  if (operation.kind === "read") {
    const viewed = viewSession(cli, identity.sessionId);
    if (!viewed.ok) return failed(viewed);
    const window = viewed.view.windows.find((w) => w.windowId === identity.windowId);
    return { kind: "title", terminalId: identity.windowId, scope, override: window?.label ?? "" };
  }
  const label = operation.kind === "set" ? operation.text : `[${project}]`;
  const result = cli.call("window-rename", ["api", "call", "session.set_window_label", "-"], { input: JSON.stringify({ session_id: identity.sessionId, window_id: identity.windowId, label }) });
  if (!result.ok) return failed(result);
  return { kind: "title", terminalId: identity.windowId, scope, override: label };
}

// --- Program status (Rex-only advantage, OSC 7501; plan Phase 5) ---

export type ProgramState = "blocked" | "error" | "working" | "done" | "idle";

export interface ProgramStatus {
  state: ProgramState;
  /** What a blocked program waits for (`permission`, `question`, `auth`), when reported. */
  kind?: string;
  app?: string;
  title?: string;
  msg?: string;
}

const PROGRAM_SEVERITY: Record<ProgramState, number> = { blocked: 4, error: 3, working: 2, done: 1, idle: 0 };

function programState(value: unknown): ProgramState {
  return value === "blocked" || value === "error" || value === "working" || value === "done" ? value : "idle";
}

/** The most severe record a block's programs reported (`blocked` > `error` > `working` > `done` > `idle`), or nothing. */
export function mostSevereProgramStatus(json: unknown): ProgramStatus | undefined {
  const records = asRecord(json)?.["records"];
  if (!Array.isArray(records)) return undefined;
  let best: ProgramStatus | undefined;
  for (const item of records as unknown[]) {
    const record = asRecord(item);
    if (!record) continue;
    const status: ProgramStatus = { state: programState(record["state"]) };
    for (const key of ["kind", "app", "title", "msg"] as const) {
      if (typeof record[key] === "string" && record[key] !== "") status[key] = record[key] as string;
    }
    if (!best || PROGRAM_SEVERITY[status.state] > PROGRAM_SEVERITY[best.state]) best = status;
  }
  return best;
}

/** `block call program_status` for one block (the root pane in the readers). */
export function programStatusOf(cli: RexCli, sessionId: string, blockId: string): ProgramStatus | undefined {
  return mostSevereProgramStatus(blockCall(cli, sessionId, blockId, "program_status"));
}

