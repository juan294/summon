import { existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { STATUS_DIR } from "./paths.js";
import { debugLog, atomicWrite, gitOutput, confinedPath } from "./utils.js";
import { withFileLock } from "./file-lock.js";
import { isLaunchId, launchArtifactPaths, listLaunchManifests } from "./launch-identity.js";
import { isBackendId } from "./backend.js";
import type { BackendId } from "./backend.js";
import { parseRexIdentity } from "./backends/rex/types.js";
import type { RexIdentity } from "./backends/rex/types.js";
import { createRexCli, discoverRex } from "./backends/rex/cli.js";
import type { RexCli } from "./backends/rex/cli.js";
import { listSessions, sessionState } from "./backends/rex/status.js";
import type { SessionListing } from "./backends/rex/status.js";
import type { NativeFailure } from "./ghostty-native.js";
import { adoptDeps, adoptOrphans, refreshPaneMapping } from "./backends/rex/launch.js";

import { parseNativeMetadata } from "./pane-inventory.js";
import type { NativeMetadata } from "./pane-inventory.js";

// --- Types ---

export interface WorkspaceStatus {
  /** Registered project name or directory basename */
  project: string;
  /** Absolute path to project directory */
  directory: string;
  /** PID recorded at launch (informational; root-shell PID sidecar drives liveness) */
  pid: number;
  /** ISO 8601 timestamp of workspace launch */
  startedAt: string;
  /** Layout used (preset name or "custom") */
  layout: string;
  /** Pane names in the workspace */
  panes: string[];
  /** Source of this status entry */
  source: "summon";
  /** Schema version for future compatibility */
  version: 1;
  /** Exact surface-lifetime native identity (Ghostty); optional for legacy launches. */
  native?: NativeMetadata;
  /** Launch generation (UUID v4, plan P12); absent on records written before per-launch ownership. */
  launchId?: string;
  /** Owning terminal backend; absent means Ghostty (plan P6). */
  backend?: BackendId;
  /** Exact Rex identity (plan P16); mutually exclusive with `native`. */
  rex?: RexIdentity;
  /** Set by lifecycle reconciliation once the workspace ended; absent while live. */
  endedAt?: string;
}

/** `partial`: a Rex session whose root pane closed while other recorded panes live (plan P10). */
export type WorkspaceState = "active" | "partial" | "stopped" | "unknown";

/** States with a live workspace to focus or count (plan P10 reader rules). */
export function isLiveState(state: WorkspaceState): boolean {
  return state === "active" || state === "partial";
}

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
}

/** Who may write the shared record (plan §3 "Status write protocol"). */
export type RecordExpectation =
  | { launchId: string | null }
  | "replace";

export type OwnedRecordOutcome = "written" | "unchanged" | "superseded";

export interface OwnedRecordResult {
  outcome: OwnedRecordOutcome;
  /** Errors thrown by `afterWrite`; collected, never rethrown. */
  afterErrors: Error[];
}

/** @internal test hook: runs just before the status lock is taken. */
export const statusTestHooks: { beforeLock?: () => void } = {};

// --- Paths ---

function statusArtifactPath(projectName: string, extension: "json" | "active" | "pid"): string {
  return confinedPath(STATUS_DIR, `${projectName}.${extension}`, "status");
}

function statusFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "json");
}

function markerFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "active");
}

function pidFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "pid");
}

// --- Write ---

/** Read the record as JSON only: no liveness, no probes, no side effects. */
export function readStatusRecord(projectName: string): WorkspaceStatus | null {
  const filePath = statusFilePath(projectName);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseWorkspaceStatus(data);
}

/**
 * Locked, expectation-checked record write (plan P12, §3 "Status write protocol").
 *
 * Inside `withFileLock(<project>.json)`: read the current record, compare it with the
 * caller's expectation, run `action` (which may write side files and returns the record to
 * publish, or null to leave it unchanged), write atomically, then run `afterWrite` for
 * idempotent cleanup. An expectation mismatch returns "superseded" and runs nothing.
 *
 * - `{ launchId: null }` requires that NO record file exists (a legacy record is present).
 * - `{ launchId: g }` requires a record whose `launchId` is g (a legacy record never matches).
 * - `"replace"` is for user-initiated launches only: it always publishes.
 */
export function withOwnedRecord(
  projectName: string,
  expectation: RecordExpectation,
  action: (current: WorkspaceStatus | null) => WorkspaceStatus | null,
  afterWrite?: (outcome: "written" | "unchanged", record: WorkspaceStatus | null) => void,
): OwnedRecordResult {
  const file = statusFilePath(projectName);
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  statusTestHooks.beforeLock?.();
  return withFileLock(file, () => {
    const exists = existsSync(file);
    const current = exists ? readStatusRecord(projectName) : null;
    if (expectation !== "replace") {
      const superseded = expectation.launchId === null
        ? exists
        : current === null || current.launchId !== expectation.launchId;
      if (superseded) return { outcome: "superseded", afterErrors: [] };
    }
    const next = action(current);
    let outcome: "written" | "unchanged";
    if (next === null) {
      outcome = "unchanged";
    } else {
      atomicWrite(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
      outcome = "written";
    }
    const afterErrors: Error[] = [];
    if (afterWrite) {
      try {
        afterWrite(outcome, next ?? current);
      } catch (error) {
        afterErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return { outcome, afterErrors };
  });
}

/**
 * Publish a launch's record (expectation "replace": a user-initiated launch always wins).
 * Liveness artifacts (.active marker, .pid sidecar) are created by the root shell bootstrap
 * after the pid is durable (see bootstrapLine in src/launch-identity.ts). Node never writes
 * the marker; this eliminates a launch-window race where a concurrent reader would observe
 * marker-without-pid and GC both artifacts. (2026-04-19 audit #2.)
 */
export function writeStatus(status: WorkspaceStatus): void {
  withOwnedRecord(status.project, "replace", () => status);
}

export function unlinkIgnoringMissing(path: string): boolean {
  try { unlinkSync(path); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}

/**
 * Discard metadata only after a failed replacement; root-shell liveness sidecars stay
 * authoritative. With a `launchId` the record is removed only while it still belongs to
 * that generation. Returns true when the record is gone (or was already absent).
 */
export function discardStatusRecord(projectName: string, launchId?: string): boolean {
  let removed = false;
  try {
    const { outcome } = withOwnedRecord(
      projectName,
      launchId ? { launchId } : "replace",
      () => null,
      () => { removed = unlinkIgnoringMissing(statusFilePath(projectName)); },
    );
    return outcome !== "superseded" && removed;
  } catch {
    return false;
  }
}

/** Remove the record and its liveness files (explicit user command; "replace" unless a generation is given). */
export function clearStatus(projectName: string, launchId?: string): void {
  const legacyPaths = [markerFilePath(projectName), pidFilePath(projectName)];
  withOwnedRecord(
    projectName,
    launchId ? { launchId } : "replace",
    () => null,
    () => {
      unlinkIgnoringMissing(statusFilePath(projectName));
      for (const path of legacyPaths) unlinkIgnoringMissing(path);
      if (launchId) {
        const paths = launchArtifactPaths(projectName, launchId);
        unlinkIgnoringMissing(paths.pid);
        unlinkIgnoringMissing(paths.active);
      }
    },
  );
}

// --- Read ---

function readPidFile(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Liveness of a record that carries a launch id: its own `.active` names it and its own `.pid` is alive. */
function isLaunchLive(projectName: string, launchId: string): boolean {
  const paths = launchArtifactPaths(projectName, launchId);
  let marker: string;
  try {
    marker = readFileSync(paths.active, "utf-8").trim();
  } catch {
    return false;
  }
  if (marker !== launchId) return false;
  const pid = readPidFile(paths.pid);
  return pid !== null && isPidAlive(pid);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}


/**
 * Validates the raw JSON parsed from a status file. Returns a typed WorkspaceStatus
 * if all required fields have the correct types, or null if the shape is invalid.
 */
export function parseWorkspaceStatus(raw: unknown): WorkspaceStatus | null {
  if (typeof raw !== "object" || raw === null) return null;

  const d = raw as Record<string, unknown>;

  // BE-M2 #491: gracefully handle future schema versions — warn and return null
  // BE-M5 #606: emit an unconditional stderr warning so users know to upgrade
  if (typeof d["version"] === "number" && d["version"] > 1) {
    const file = typeof d["project"] === "string" ? `${d["project"]}.json` : "status file";
    process.stderr.write(`summon: warning: ${file} was written by a newer summon; upgrade to read it\n`);
    debugLog(`parseWorkspaceStatus: unrecognised future schema version ${d["version"]}; returning null`);
    return null;
  }
  if (d["version"] !== 1) return null;
  if (d["source"] !== "summon") return null;
  if (typeof d["project"] !== "string") return null;
  if (typeof d["directory"] !== "string") return null;
  if (typeof d["pid"] !== "number") return null;
  if (typeof d["startedAt"] !== "string") return null;
  if (typeof d["layout"] !== "string") return null;
  if (!Array.isArray(d["panes"])) return null;

  // Validate that every pane element is a string (BE-M5 #379).
  // If any element is not a string, return empty panes rather than rejecting the record.
  const rawPanes = d["panes"] as unknown[];
  const validPanes = rawPanes.every((p) => typeof p === "string")
    ? rawPanes as string[]
    : [];

  const warn = (message: string) => process.stderr.write(`summon: warning: ${message}\n`);

  let launchId: string | undefined;
  if (d["launchId"] !== undefined) {
    if (isLaunchId(d["launchId"])) launchId = d["launchId"];
    else warn("invalid launch id discarded; liveness falls back to the legacy markers.");
  }

  let backend: BackendId | undefined;
  if (d["backend"] !== undefined) {
    if (isBackendId(d["backend"])) backend = d["backend"];
    else warn(`unknown backend ${JSON.stringify(d["backend"])} discarded; treating the workspace as Ghostty.`);
  }
  let native = parseNativeMetadata(d["native"]);
  if (d["native"] !== undefined && !native) warn("invalid native identity discarded; inspect or explicitly relaunch to capture exact targets.");

  let rex: RexIdentity | undefined;
  if (d["rex"] !== undefined) {
    rex = parseRexIdentity(d["rex"], validPanes);
    if (!rex) warn("invalid Rex identity discarded; relaunch to capture exact targets.");
  }

  // `native` (Ghostty) and `rex` are mutually exclusive: the backend (absent = Ghostty) decides which one is kept.
  if (backend === "rex" && native) {
    warn("native Ghostty identity discarded on a Rex record.");
    native = undefined;
  }
  if (backend !== "rex" && rex) {
    warn("Rex identity discarded on a Ghostty record.");
    rex = undefined;
  }

  let endedAt: string | undefined;
  if (d["endedAt"] !== undefined) {
    if (typeof d["endedAt"] === "string" && !Number.isNaN(Date.parse(d["endedAt"]))) endedAt = d["endedAt"];
    else debugLog("parseWorkspaceStatus: invalid endedAt discarded");
  }

  // BE-L3 #514: reconstruct explicitly from validated fields — no unknown keys leak through
  return {
    project: d["project"] as string,
    directory: d["directory"] as string,
    pid: d["pid"] as number,
    startedAt: d["startedAt"] as string,
    layout: d["layout"] as string,
    panes: validPanes,
    source: "summon",
    version: 1,
    ...(native ? { native } : {}),
    ...(launchId ? { launchId } : {}),
    ...(backend ? { backend } : {}),
    ...(rex ? { rex } : {}),
    ...(endedAt ? { endedAt } : {}),
  };
}

/**
 * Per-read Rex context (plan P10 "grouped by server"): each server is listed once per read and
 * each project is adopted at most once; `readAllStatuses` shares one context across its rows.
 */
export interface RexReadContext {
  listings: Map<string, SessionListing>;
  adopted: Set<string>;
}

export function newRexReadContext(): RexReadContext {
  return { listings: new Map(), adopted: new Set() };
}

let rexBinaryMemo: string | null | undefined;

/** The `rex` binary, discovered once per process (the TUI reads every 3 s; the location does not move mid-run). */
export function rexBinaryPath(): string | null {
  if (rexBinaryMemo === undefined) rexBinaryMemo = discoverRex().path;
  return rexBinaryMemo;
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

/**
 * A Rex record's state through `sessionState` (never a sidecar): late adoption first (P13),
 * then the state probe, then a pane-file refresh for records with unverified panes.
 */
function resolveRexStatus(projectName: string, record: WorkspaceStatus, ctx: RexReadContext): ResolvedStatus {
  // An identity that parseWorkspaceStatus discarded cannot be verified; adoption would read it back through this resolver.
  if (!record.rex) return { ...record, state: "unknown", uptime: null, reason: "the record has no Rex identity; relaunch to capture it" };
  const binary = rexBinaryPath();
  if (!binary) return { ...record, state: "unknown", uptime: null, reason: REX_CLI_MISSING };
  const notices = adoptOnce(projectName, binary, ctx);
  let current = notices.length > 0 ? readStatusRecord(projectName) ?? record : record;
  const identity = current.rex;
  if (!identity) return { ...current, state: "unknown", uptime: null, reason: "the record has no Rex identity; relaunch to capture it", notices };
  const cli = createRexCli(binary, identity.server);
  let listing = ctx.listings.get(identity.server);
  if (!listing) {
    listing = listSessions(cli);
    ctx.listings.set(identity.server, listing);
  }
  const state = sessionState(cli, identity, projectName, listing);
  if (isLiveState(state.state) && identity.blocks.length < current.panes.length) {
    notices.push(...refreshPaneMapping(current));
    current = readStatusRecord(projectName) ?? current;
  }
  const started = Date.parse(current.startedAt);
  return {
    ...current,
    state: state.state,
    uptime: isLiveState(state.state) && !Number.isNaN(started) ? Date.now() - started : null,
    ...(state.reason ? { reason: state.reason } : {}),
    ...(notices.length > 0 ? { notices } : {}),
    liveBlocks: state.liveBlocks,
  };
}

export function readStatus(projectName: string, ctx: RexReadContext = newRexReadContext()): ResolvedStatus | null {
  const status = readStatusRecord(projectName);
  if (!status) return null;

  if (status.backend === "rex") return resolveRexStatus(projectName, status, ctx);

  // A record with a launch id never reads the legacy `<project>.active`/`.pid` paths (P12).
  let active: boolean;
  if (status.launchId) {
    active = isLaunchLive(projectName, status.launchId);
  } else {
    const markerExists = existsSync(markerFilePath(projectName));
    const shellPid = readPidFile(pidFilePath(projectName));
    active = markerExists && shellPid !== null && isPidAlive(shellPid);
  }

  const now = Date.now();
  const started = Date.parse(status.startedAt);

  return {
    ...status,
    state: active ? "active" : "stopped",
    uptime: active && !isNaN(started) ? now - started : null,
  };
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
      rows.push({
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
        state: "unknown",
        uptime: null,
        reason: UNVERIFIED_LAUNCH,
        ...(notices.length > 0 ? { notices } : {}),
      });
    }
  }
  return rows;
}

// PE-M1 #607 / PE-L3 #570: bounded-TTL in-process cache for readAllStatuses.
// TTL is intentionally short (1000ms) so the monitor's 3-second refresh loop
// still re-checks isPidAlive for any process that died between ticks WITHOUT a
// file-system change. The previous dir-mtime cache was reverted because directory
// mtime does not advance on process death — a process dying silently would remain
// "active" indefinitely. A wall-clock TTL avoids that flaw while still coalescing
// bursts of calls within the same render cycle. After TTL, a full re-scan runs.
const READ_ALL_STATUSES_TTL_MS = 1000;

interface StatusCache {
  result: ResolvedStatus[];
  cachedAt: number;
}

let _statusCache: StatusCache | null = null;

/** Clear the readAllStatuses cache. Exposed for tests; also useful for CLI commands
 *  that need a fresh read immediately after a write. */
export function resetReadAllStatusesCache(): void {
  _statusCache = null;
}

export function readAllStatuses(): ResolvedStatus[] {
  const now = Date.now();

  // Return cached result if within TTL
  if (_statusCache !== null && now - _statusCache.cachedAt < READ_ALL_STATUSES_TTL_MS) {
    return _statusCache.result;
  }

  if (!existsSync(STATUS_DIR)) {
    _statusCache = { result: [], cachedAt: now };
    return _statusCache.result;
  }

  // BE-M4 #605: filter out .tmp and dotfiles so orphans never appear as phantom entries
  const entries = readdirSync(STATUS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".") && !entry.name.endsWith(".tmp"))
    .map((entry) => entry.name);
  const launchDirProjects = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".launches"))
    .map((entry) => entry.name.slice(0, -".launches".length));
  const statuses: ResolvedStatus[] = [];
  const ctx = newRexReadContext();

  const recordedProjects = new Set<string>();
  for (const file of files) {
    const projectName = file.replace(/\.json$/, "");
    recordedProjects.add(projectName);
    const status = readStatus(projectName, ctx);
    if (status) statuses.push(status);
  }
  statuses.push(...unverifiedLaunchRows(launchDirProjects, recordedProjects, ctx));

  // Sort: live first (active, then partial; newest first), then the rest (newest first)
  const rank = (state: WorkspaceState): number => (state === "active" ? 0 : state === "partial" ? 1 : 2);
  const result = statuses.sort((a, b) => {
    const byState = rank(a.state) - rank(b.state);
    if (byState !== 0) return byState;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });

  _statusCache = { result, cachedAt: now };
  return result;
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

