/**
 * The Rex half of a status read (AR-M1, moved from status.ts): a Rex record's state through `sessionState` (never a
 * sidecar), late adoption and the other reconciling steps when the read asks for them, and the shared pre-flight of
 * the Rex workspace commands. The generic reader (status.ts) reaches it through the record port.
 */
import { createRexCli, discoverRex } from "./cli.js";
import type { RexCli } from "./cli.js";
import { NO_LIVE_PANES, listSessions, programStatusOf, sessionState } from "./status.js";
import type { SessionListing } from "./status.js";
import type { RexIdentity } from "./types.js";
import { adoptOnce, reconcileStoppedLaunch, refreshUnverifiedPanes } from "./reconcile.js";
import { isLiveState, readStatusRecord, rexIdentityMissing, unverifiedMessage, unverifiedPanes } from "../../status-record.js";
import type { WorkspaceStatus } from "../../status-record.js";
import type { ResolvedStatus } from "../../status.js";
import type { NativeFailure } from "../../ghostty-native.js";
import type { StatusRead } from "../port.js";

export const REX_CLI_MISSING = "rex CLI not found; open the Rex app once or set REX_BIN_DIR.";

function noLongerExistsMessage(project: string, reason: string | undefined): string {
  return `[${project}] no longer exists in Rex (${reason ?? "session gone"}); launch it again with summon ${project}.`;
}

let rexBinaryMemo: string | null | undefined;

/** The `rex` binary, discovered once per process and shared by every row of a read (the location does not move mid-run). */
export function rexBinaryPath(): string | null {
  if (rexBinaryMemo === undefined) rexBinaryMemo = discoverRex().path;
  return rexBinaryMemo;
}

/** Use a `rex` binary already resolved by the parent process (the monitor's child read, PE-H1) instead of looking it up. */
export function seedRexBinaryPath(path: string): void {
  rexBinaryMemo = path;
}

/** The `rex` binary or a failed exit 2 with the install hint (commands only). */
export function requireRexBinary(): string {
  const binary = rexBinaryPath();
  if (binary) return binary;
  process.stderr.write(`summon: error: ${REX_CLI_MISSING}\n`);
  process.exit(2);
}

/** @internal test hook */
export function resetRexBinaryMemo(): void {
  rexBinaryMemo = undefined;
}

/**
 * Per-read Rex state (plan P10 "grouped by server"): each server is listed once per read and each project is adopted
 * at most once; `readAllStatuses` shares one read across its rows.
 */
interface RexReadState {
  listings: Map<string, SessionListing>;
  adopted: Set<string>;
}

function rexState(read: StatusRead): RexReadState {
  return read.scratch<RexReadState>("rex", () => ({ listings: new Map(), adopted: new Set() }));
}

function unknownRow(record: WorkspaceStatus, reason: string, notices: string[] = []): ResolvedStatus {
  return { ...record, state: "unknown", uptime: null, reason, ...(notices.length > 0 ? { notices } : {}) };
}

/**
 * A Rex record's state: late adoption first when the read reconciles (P13), then one generation resolved at a time.
 * A re-read that shows another launch's generation (published while this one was refreshed or reconciled) resolves
 * that generation afresh instead of pairing its record with the state probed for the old one; a second supersession
 * is `unknown`.
 */
export function resolveRexStatus(projectName: string, record: WorkspaceStatus, read: StatusRead, carried: string[] = []): ResolvedStatus {
  // An identity that parseWorkspaceStatus discarded cannot be verified; adoption would read it back through this resolver.
  if (!record.rex) return unknownRow(record, rexIdentityMissing(projectName), carried);
  const binary = rexBinaryPath();
  if (!binary) return unknownRow(record, REX_CLI_MISSING, carried);
  const state = rexState(read);
  const notices = [...carried, ...(read.options.reconcile ? adoptOnce(projectName, binary, state.adopted) : [])];
  let current = notices.length > carried.length ? readStatusRecord(projectName) ?? record : record;
  for (let attempt = 0; attempt < 2; attempt++) {
    // The newer generation belongs to whichever backend launched it.
    if (current.backend !== "rex") return read.resolveRecord(projectName, current, notices);
    const resolved = resolveRexGeneration(projectName, current, binary, read, state, notices);
    if (resolved.kind === "resolved") return resolved.status;
    current = resolved.record;
    // The newer generation's session was created before its record: its server is listed again.
    if (current.rex) state.listings.delete(current.rex.server);
  }
  return unknownRow(current, "the record changed while it was read; retry", notices);
}

type GenerationResult = { kind: "resolved"; status: ResolvedStatus } | { kind: "superseded"; record: WorkspaceStatus };

/**
 * One generation of a Rex record: when the read reconciles, the pane-file refresh for a record with
 * unverified panes (P13 next-read recovery, whatever state the probe then finds); the state probe
 * over that identity; then, when the read reconciles, the end of a stopped launch. Every re-read
 * after a generation-bound write must still carry this generation; otherwise the newer record is
 * handed back unresolved.
 */
function resolveRexGeneration(projectName: string, record: WorkspaceStatus, binary: string, read: StatusRead, state: RexReadState, notices: string[]): GenerationResult {
  let current = record;
  if (read.options.reconcile) {
    const refreshed = refreshUnverifiedPanes(projectName, current, notices);
    if (refreshed.kind === "superseded") return refreshed;
    current = refreshed.record;
  }
  const identity = current.rex;
  if (!identity) return { kind: "resolved", status: unknownRow(current, rexIdentityMissing(projectName), notices) };
  const cli = createRexCli(binary, identity.server);
  let listing = state.listings.get(identity.server);
  if (!listing) {
    listing = listSessions(cli);
    state.listings.set(identity.server, listing);
  }
  const probed = sessionState(cli, identity, projectName, listing);
  // Blocks remain and a recorded pane is unverified: one of them may be ours, so the launch is not ended here (P13 next-read recovery).
  const unverified = probed.reason === NO_LIVE_PANES ? unverifiedPanes(current) : 0;
  const reason = unverified > 0 ? `${probed.reason}; ${unverified} pane${unverified === 1 ? "" : "s"} unverified` : probed.reason;
  if (read.options.reconcile) {
    const ended = reconcileStoppedLaunch(projectName, current, probed, unverified, notices);
    if (ended.kind === "superseded") return ended;
    current = ended.record;
  }
  const started = Date.parse(current.startedAt);
  // `active` is exactly "the root block is present" (state table); the program status is read on request only.
  const programStatus = read.options.programStatus && probed.state === "active" ? programStatusOf(cli, identity.sessionId, identity.rootBlockId) : undefined;
  return {
    kind: "resolved",
    status: {
      ...current,
      state: probed.state,
      uptime: isLiveState(probed.state) && !Number.isNaN(started) ? Date.now() - started : null,
      ...(reason ? { reason } : {}),
      ...(notices.length > 0 ? { notices } : {}),
      liveBlocks: probed.liveBlocks,
      ...(programStatus ? { programStatus } : {}),
    },
  };
}

/**
 * Launches with a manifest but no record (P13): one late-adoption attempt per project and read when the read
 * reconciles. `attempted` is false without a `rex` binary, so the reader does not look for an adopted record.
 */
export function adoptUnrecordedRex(projectName: string, read: StatusRead): { attempted: boolean; notices: string[] } {
  const binary = rexBinaryPath();
  if (!binary) return { attempted: false, notices: [] };
  return { attempted: true, notices: read.options.reconcile ? adoptOnce(projectName, binary, rexState(read).adopted) : [] };
}

// --- Rex workspace commands: the shared pre-flight (plan P10 reader rules) ---

export type RexCommandGate =
  | { ok: true; cli: RexCli; identity: RexIdentity; liveBlocks: string[] }
  | { ok: false; failure: NativeFailure };

/**
 * Before `focus`, `inspect` or `title` touch a Rex workspace: `unknown` is never acted on,
 * `stopped` says "launch again", and the CLI must be installed. Returns the bound CLI.
 */
export function rexCommandGate(project: string, status: ResolvedStatus): RexCommandGate {
  const identity = status.rex;
  if (!identity) return { ok: false, failure: { kind: "unavailable", code: "unavailable", reason: unverifiedMessage(project, "the record has no Rex identity") } };
  if (status.state === "unknown") return { ok: false, failure: { kind: "unavailable", code: "unavailable", reason: unverifiedMessage(project, status.reason) } };
  if (status.state === "stopped") return { ok: false, failure: { kind: "unavailable", code: "missing", reason: noLongerExistsMessage(project, status.reason) } };
  const binary = rexBinaryPath();
  if (!binary) return { ok: false, failure: { kind: "unavailable", code: "unavailable", reason: REX_CLI_MISSING } };
  return { ok: true, cli: createRexCli(binary, identity.server), identity, liveBlocks: status.liveBlocks ?? [] };
}
