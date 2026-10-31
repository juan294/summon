import { existsSync, readdirSync } from "node:fs";
import { STATUS_DIR } from "./paths.js";
import { gitOutput, getErrorMessage } from "./utils.js";
import { launchArtifactFiles, launchFileList, listLaunchManifests, readLaunchManifest } from "./launch-identity.js";
import type { LaunchFileSet } from "./launch-identity.js";
import { collectSnapshot, writeSnapshotFile } from "./snapshot.js";
import type { RexIdentity } from "./backends/rex/types.js";
import { createRexCli, discoverRex } from "./backends/rex/cli.js";
import type { RexCli } from "./backends/rex/cli.js";
import { NO_LIVE_PANES, SESSION_GONE, listSessions, programStatusOf, sessionState } from "./backends/rex/status.js";
import type { ProgramStatus, SessionListing } from "./backends/rex/status.js";
import type { NativeFailure } from "./ghostty-native.js";
import { adoptDeps, adoptOrphans, refreshPaneMapping } from "./backends/rex/launch.js";
import { RecordWriteError, ghosttyLiveness, isLiveState, readStatusRecord, removeLaunchFileSet, rexIdentityMissing, withOwnedRecord } from "./status-record.js";
import type { WorkspaceState, WorkspaceStatus } from "./status-record.js";

// The record layer (types, parser, locked writes) lives in status-record.ts; every consumer keeps importing it from here.
export * from "./status-record.js";

export const REX_CLI_MISSING = "rex CLI not found; open the Rex app once or set REX_BIN_DIR.";

/** The one wording every consumer prints for an `unknown` workspace (plan P10). */
export function unverifiedMessage(project: string, reason: string | undefined): string {
  return `[${project}] could not be verified: ${reason ?? "no liveness information"}. Open the Rex app and retry, or run summon doctor.`;
}

function noLongerExistsMessage(project: string, reason: string | undefined): string {
  return `[${project}] no longer exists in Rex (${reason ?? "session gone"}); launch it again with summon ${project}.`;
}

export interface ResolvedStatus extends Omit<WorkspaceStatus, "pid"> {
  /** Recorded launcher pid; null for an unverified launch that has no record yet. */
  pid: number | null;
  /** Derived from marker file check at read time */
  state: WorkspaceState;
  /** Milliseconds since workspace started (if active), null if stopped */
  uptime: number | null;
  /** Why the state is `unknown` (or another non-active state), when a reason is known. */
  reason?: string;
  /** Advisory lines from late adoption or pane-file refresh (Rex), for `summon status` to print. */
  notices?: string[];
  /** Rex only: recorded panes whose block is present in the session (drives focus targets). */
  liveBlocks?: string[];
  /** Rex only: the root pane's program status (OSC 7501), when its programs report one. */
  programStatus?: ProgramStatus;
}

/**
 * Per-read Rex context (plan P10 "grouped by server"): each server is listed once per read and
 * each project is adopted at most once; `readAllStatuses` shares one context across its rows.
 */
export interface RexReadContext {
  listings: Map<string, SessionListing>;
  adopted: Set<string>;
  /** Read the root pane's program status for live rows (one more `rex` call per row; the monitor and `inspect` want it). */
  programStatus?: boolean;
}

export interface ReadOptions {
  programStatus?: boolean;
}

export function newRexReadContext(options: ReadOptions = {}): RexReadContext {
  return { listings: new Map(), adopted: new Set(), ...(options.programStatus ? { programStatus: true } : {}) };
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

/** Late adoption (P13) for a project, once per read context. */
function adoptOnce(projectName: string, binary: string, ctx: RexReadContext): string[] {
  if (ctx.adopted.has(projectName)) return [];
  ctx.adopted.add(projectName);
  return adoptOrphans(projectName, adoptDeps(binary));
}

/** A recorded pane whose block is not known yet (its pane file had not appeared when last looked). */
function unverifiedPanes(record: WorkspaceStatus): number {
  return record.panes.length - (record.rex?.blocks.length ?? 0);
}

function unknownRow(record: Omit<WorkspaceStatus, "pid"> & { pid: number | null }, reason: string, notices: string[] = []): ResolvedStatus {
  return { ...record, state: "unknown", uptime: null, reason, ...(notices.length > 0 ? { notices } : {}) };
}

/**
 * A Rex record's state through `sessionState` (never a sidecar): late adoption first (P13), then
 * one generation resolved at a time. A re-read that shows another launch's generation (published
 * while this one was refreshed or reconciled) resolves that generation afresh instead of pairing
 * its record with the state probed for the old one; a second supersession is `unknown`.
 */
function resolveRexStatus(projectName: string, record: WorkspaceStatus, ctx: RexReadContext): ResolvedStatus {
  // An identity that parseWorkspaceStatus discarded cannot be verified; adoption would read it back through this resolver.
  if (!record.rex) return unknownRow(record, rexIdentityMissing(projectName));
  const binary = rexBinaryPath();
  if (!binary) return unknownRow(record, REX_CLI_MISSING);
  const notices = [...adoptOnce(projectName, binary, ctx)];
  let current = notices.length > 0 ? readStatusRecord(projectName) ?? record : record;
  for (let attempt = 0; attempt < 2; attempt++) {
    // The newer generation belongs to whichever backend launched it.
    if (current.backend !== "rex") return resolveGhosttyStatus(projectName, current, notices);
    const resolved = resolveRexGeneration(projectName, current, binary, ctx, notices);
    if (resolved.kind === "resolved") return resolved.status;
    current = resolved.record;
    // The newer generation's session was created before its record: its server is listed again.
    if (current.rex) ctx.listings.delete(current.rex.server);
  }
  return unknownRow(current, "the record changed while it was read; retry", notices);
}

/** Ghostty: the sidecars decide (a record with a launch id reads only its own per-launch files, P12). */
function resolveGhosttyStatus(projectName: string, record: WorkspaceStatus, notices: string[] = []): ResolvedStatus {
  const active = ghosttyLiveness(projectName, record) === "active";
  const started = Date.parse(record.startedAt);
  return {
    ...record,
    state: active ? "active" : "stopped",
    uptime: active && !Number.isNaN(started) ? Date.now() - started : null,
    ...(notices.length > 0 ? { notices } : {}),
  };
}

type GenerationResult = { kind: "resolved"; status: ResolvedStatus } | { kind: "superseded"; record: WorkspaceStatus };

/**
 * One generation of a Rex record: the pane-file refresh for a record with unverified panes (P13
 * next-read recovery, whatever state the probe then finds), the state probe over the refreshed
 * identity, then reconciliation of a stopped launch. Every re-read after a generation-bound write
 * must still carry this generation; otherwise the newer record is handed back unresolved.
 */
function resolveRexGeneration(projectName: string, record: WorkspaceStatus, binary: string, ctx: RexReadContext, notices: string[]): GenerationResult {
  const gen = record.launchId;
  let current = record;
  // An ended generation never gains pane files; a live or stopped one with unverified panes is refreshed before the probe.
  if (gen && record.rex && !record.endedAt && unverifiedPanes(record) > 0) {
    const refreshed = refreshPaneMapping(record);
    notices.push(...refreshed.notices);
    if (refreshed.changed) {
      const latest = readStatusRecord(projectName) ?? record;
      if (latest.launchId !== gen) return { kind: "superseded", record: latest };
      current = latest;
    }
  }
  const identity = current.rex;
  if (!identity) return { kind: "resolved", status: unknownRow(current, rexIdentityMissing(projectName), notices) };
  const cli = createRexCli(binary, identity.server);
  let listing = ctx.listings.get(identity.server);
  if (!listing) {
    listing = listSessions(cli);
    ctx.listings.set(identity.server, listing);
  }
  const state = sessionState(cli, identity, projectName, listing);
  // Blocks remain and a recorded pane is unverified: one of them may be ours, so the launch is not ended here (P13 next-read recovery).
  const unverified = state.reason === NO_LIVE_PANES ? unverifiedPanes(current) : 0;
  const reason = unverified > 0 ? `${state.reason}; ${unverified} pane${unverified === 1 ? "" : "s"} unverified` : state.reason;
  if (state.state === "stopped" && gen && unverified === 0) {
    const confirmedGone = state.reason === SESSION_GONE;
    if (needsReconciliation(current, () => removableLaunchFiles(projectName, current, gen, confirmedGone))) {
      const notice = endRexLaunch(projectName, current, { confirmedGone });
      if (notice) notices.push(notice);
      const latest = readStatusRecord(projectName) ?? current;
      if (latest.launchId !== gen) return { kind: "superseded", record: latest };
      current = latest;
    }
  }
  const started = Date.parse(current.startedAt);
  // `active` is exactly "the root block is present" (state table); the program status is read on request only.
  const programStatus = ctx.programStatus && state.state === "active" ? programStatusOf(cli, identity.sessionId, identity.rootBlockId) : undefined;
  return {
    kind: "resolved",
    status: {
      ...current,
      state: state.state,
      uptime: isLiveState(state.state) && !Number.isNaN(started) ? Date.now() - started : null,
      ...(reason ? { reason } : {}),
      ...(notices.length > 0 ? { notices } : {}),
      liveBlocks: state.liveBlocks,
      ...(programStatus ? { programStatus } : {}),
    },
  };
}

export function readStatus(projectName: string, ctx: RexReadContext = newRexReadContext()): ResolvedStatus | null {
  const status = readStatusRecord(projectName);
  if (!status) return null;

  return status.backend === "rex" ? resolveRexStatus(projectName, status, ctx) : resolveGhosttyStatus(projectName, status);
}

const UNVERIFIED_LAUNCH = "unverified launch";

/**
 * Launches that have a manifest but no record (unknown creation outcome, plan P13 §6).
 * Phase 3 resolves them through adoption; here they are surfaced so `summon status` can
 * list them and never hide a session Summon may have created.
 */
function unverifiedLaunchRows(launchDirProjects: string[], recordedProjects: Set<string>, ctx: RexReadContext): ResolvedStatus[] {
  const rows: ResolvedStatus[] = [];
  for (const projectName of launchDirProjects) {
    if (recordedProjects.has(projectName)) continue;
    let manifests;
    try {
      manifests = listLaunchManifests(projectName);
    } catch {
      continue;
    }
    if (manifests.length === 0) continue;
    // Late adoption (P13) may publish a record for a launch whose outcome was unknown.
    const binary = manifests.some((m) => m.backend === "rex") ? rexBinaryPath() : null;
    const notices = binary ? adoptOnce(projectName, binary, ctx) : [];
    if (binary && readStatusRecord(projectName)) {
      const adopted = readStatus(projectName, ctx);
      if (adopted) {
        rows.push({ ...adopted, ...(notices.length > 0 ? { notices: [...notices, ...(adopted.notices ?? [])] } : {}) });
        continue;
      }
    }
    for (const manifest of manifests) {
      rows.push(unknownRow({
        project: manifest.project,
        directory: manifest.directory,
        pid: null,
        startedAt: manifest.startedAt,
        layout: manifest.layout,
        panes: [...manifest.panes],
        source: "summon",
        version: 1,
        launchId: manifest.launchId,
        backend: manifest.backend,
      }, UNVERIFIED_LAUNCH, notices));
    }
  }
  return rows;
}

/**
 * One project's status as `readAllStatuses` would list it: its record, or the unverified-launch row
 * of a manifest without a record (after one late-adoption attempt), or null when there is nothing.
 */
export function readProjectStatus(projectName: string, ctx: RexReadContext = newRexReadContext()): ResolvedStatus | null {
  return readStatus(projectName, ctx) ?? unverifiedLaunchRows([projectName], new Set(), ctx)[0] ?? null;
}

/** The projects with a record and the projects with a launches directory, from one listing of STATUS_DIR. */
function scanStatusDir(): { recorded: string[]; launchDirProjects: string[] } {
  if (!existsSync(STATUS_DIR)) return { recorded: [], launchDirProjects: [] };
  // BE-M4 #605: filter out .tmp and dotfiles so orphans never appear as phantom entries
  const entries = readdirSync(STATUS_DIR, { withFileTypes: true });
  return {
    recorded: entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".") && !entry.name.endsWith(".tmp"))
      .map((entry) => entry.name.slice(0, -".json".length)),
    launchDirProjects: entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".launches"))
      .map((entry) => entry.name.slice(0, -".launches".length)),
  };
}

/**
 * A Rex record or a Rex launch manifest exists: only then can a status read spawn `rex`. Reads the
 * records and manifests as JSON (no liveness, no probes); the monitor reads off its thread only then (PE-H1).
 */
export function hasRexState(): boolean {
  const { recorded, launchDirProjects } = scanStatusDir();
  if (recorded.some((project) => readStatusRecord(project)?.backend === "rex")) return true;
  return launchDirProjects.some((project) => {
    try {
      return listLaunchManifests(project).some((manifest) => manifest.backend === "rex");
    } catch {
      return false;
    }
  });
}

export function readAllStatuses(options: ReadOptions = {}): ResolvedStatus[] {
  const { recorded, launchDirProjects } = scanStatusDir();
  const statuses: ResolvedStatus[] = [];
  const ctx = newRexReadContext(options);

  const recordedProjects = new Set(recorded);
  for (const projectName of recorded) {
    const status = readStatus(projectName, ctx);
    if (status) statuses.push(status);
  }
  statuses.push(...unverifiedLaunchRows(launchDirProjects, recordedProjects, ctx));

  // Sort: live first (active, then partial; newest first), then the rest (newest first)
  const rank = (state: WorkspaceState): number => (state === "active" ? 0 : state === "partial" ? 1 : 2);
  return statuses.sort((a, b) => {
    const byState = rank(a.state) - rank(b.state);
    if (byState !== 0) return byState;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });
}

// --- Git ---

export async function getGitBranch(directory: string): Promise<string | null> {
  // AR-M1 #603: use shared gitOutput helper from utils.ts
  try {
    return (await gitOutput(directory, ["rev-parse", "--abbrev-ref", "HEAD"])) || null;
  } catch {
    return null;
  }
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

// --- Reconciliation of ended Rex launches (plan P12, phase-5.md) ---

export { NO_LIVE_PANES, SESSION_GONE } from "./backends/rex/status.js";

/** Step A (the snapshot) failed; the record write failure is `RecordWriteError`, anything else comes from the lock. */
class SnapshotStepFailure extends Error {}

/** The files the end-of-launch steps remove for this record: always the sidecars; the session files only once the session is confirmed gone. */
function removableLaunchFiles(project: string, record: WorkspaceStatus, launchId: string, confirmedGone: boolean): LaunchFileSet {
  const panes = readLaunchManifest(project, launchId)?.paneOrder ?? record.panes;
  const files = launchArtifactFiles(project, launchId, panes);
  return confirmedGone ? files : { liveness: files.liveness, panes: [] };
}

/** Rule 1 of the reconciliation: no `endedAt` yet, or `endedAt` with removable per-launch files left behind (the set is built only then). */
function needsReconciliation(record: WorkspaceStatus, files: () => LaunchFileSet): boolean {
  if (!record.launchId) return false;
  if (!record.endedAt) return true;
  return launchFileList(files()).some((file) => existsSync(file));
}

export interface EndLaunchOptions {
  /** The session is confirmed gone on the record's server: the manifest and pane files may go too. */
  confirmedGone: boolean;
  /** How the notice names the event (default: a workspace that ended outside Summon). */
  label?: string;
}

/**
 * Ordered, idempotent end-of-launch steps for the record's own generation: A snapshot (collected
 * before the lock, written inside it), B `endedAt` on the record, C removal of this launch's
 * files (`afterWrite`, still under the lock). The lock excludes other writers; the steps are not
 * all-or-nothing, so a later read completes whatever is left (`endedAt` present skips A and B;
 * `afterWrite` retries C). Returns the notice to show, if any. Shared by the readers (a
 * workspace that ended outside Summon) and `summon clean`.
 */
export function endRexLaunch(project: string, record: WorkspaceStatus, options: EndLaunchOptions): string | undefined {
  const gen = record.launchId;
  if (!gen) return undefined;
  const label = options.label ?? "workspace ended outside Summon";
  const files = removableLaunchFiles(project, record, gen, options.confirmedGone);
  const completed: string[] = [];
  const fileFailures: string[] = [];
  let snapshot: ReturnType<typeof collectSnapshot>;
  try {
    snapshot = record.endedAt ? null : collectSnapshot(project, record.directory, record.layout);
  } catch (error) {
    return `${label}; snapshot failed: ${getErrorMessage(error)}; will retry on the next read`;
  }
  try {
    const { outcome } = withOwnedRecord(
      project,
      { launchId: gen },
      (current) => {
        if (!current || current.endedAt) return null;
        try {
          if (snapshot) writeSnapshotFile(snapshot);
        } catch (error) {
          throw new SnapshotStepFailure(getErrorMessage(error));
        }
        completed.push(snapshot ? `snapshot saved ${snapshot.timestamp}` : "snapshot skipped (no git repository)");
        return { ...current, endedAt: new Date().toISOString() };
      },
      (_outcome, final) => {
        if (final?.endedAt) fileFailures.push(...removeLaunchFileSet(files).failures);
      },
    );
    if (outcome === "superseded") return undefined;
    const fileNote = fileFailures.length > 0 ? `${fileFailures.length} launch ${fileFailures.length === 1 ? "file" : "files"} of [${project}] ${outcome === "unchanged" ? "still " : ""}could not be removed: ${fileFailures[0]}; will retry` : undefined;
    if (outcome === "unchanged") return fileNote;
    return [label, ...completed, ...(fileNote ? [fileNote] : [])].join("; ");
  } catch (error) {
    const step = error instanceof SnapshotStepFailure ? "snapshot" : error instanceof RecordWriteError ? "record" : "lock";
    return [label, ...completed, `${step} failed: ${getErrorMessage(error)}`, "will retry on the next read"].join("; ");
  }
}
