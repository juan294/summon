import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { STATUS_DIR } from "./paths.js";
import { debugLog, atomicWrite, confinedPath } from "./utils.js";
import { withFileLock } from "./file-lock.js";
import { isLaunchId, isPaneNameList, launchArtifactPaths } from "./launch-identity.js";
import type { LaunchFileSet } from "./launch-identity.js";
import { isBackendId } from "./backend-detect.js";
import type { BackendId } from "./backend-detect.js";
import { parseRexIdentity } from "./backends/rex/types.js";
import type { RexIdentity } from "./backends/rex/types.js";
import { parseNativeMetadata } from "./backends/ghostty/pane-inventory.js";
import type { NativeMetadata } from "./backends/ghostty/pane-inventory.js";
import type { ResolvedStatus, StatusRow } from "./status.js";

/**
 * The status record layer: the shared record `status/<project>.json`, its parser, the locked
 * write protocol (plan P12) and the Ghostty sidecar liveness. No probes, no Rex calls, no
 * imports from the Rex backend beyond the identity type, so the Rex modules can depend on it
 * without a cycle; `status.ts` is the reader built on top.
 */
// --- Types ---

/** Fields every status record carries, whatever its backend. */
interface WorkspaceStatusFields {
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
  /** Launch generation (UUID v4, plan P12); absent on records written before per-launch ownership. */
  launchId?: string;
  /** Set by lifecycle reconciliation once the workspace ended; absent while live. */
  endedAt?: string;
}

/** A Ghostty record; `backend` is absent on records written before the Rex backend (plan P6). */
export interface GhosttyWorkspaceStatus extends WorkspaceStatusFields {
  backend?: "ghostty";
  /** Exact surface-lifetime native identity; optional for legacy launches. */
  native?: NativeMetadata;
  rex?: undefined;
}

/** A Rex record with its exact identity (plan P16). */
export interface RexWorkspaceStatus extends WorkspaceStatusFields {
  backend: "rex";
  rex: RexIdentity;
  native?: undefined;
}

/**
 * A Rex record without an identity: the parser discarded an invalid one, or none was stored. Every reader treats it
 * as `unknown` (`rexIdentityMissing`, plan P10). It is the record as stored (`backend: "rex"`, no `rex` field), so a
 * rewrite of it is byte-identical; no marker field is added.
 */
export interface UnidentifiedRexWorkspaceStatus extends WorkspaceStatusFields {
  backend: "rex";
  rex?: undefined;
  native?: undefined;
}

/**
 * The status record in memory (AR-L2): the backend decides which identity a record may carry, so `native` (Ghostty)
 * and `rex` never appear together. The JSON on disk is unchanged (schema version 1).
 */
export type WorkspaceStatus = GhosttyWorkspaceStatus | RexWorkspaceStatus | UnidentifiedRexWorkspaceStatus;

/** `partial`: a Rex session whose root pane closed while other recorded panes live (plan P10). */
export type WorkspaceState = "active" | "partial" | "stopped" | "unknown";

/** The one reason every reader gives for a Rex record whose identity the parser discarded (plan P10). */
export function rexIdentityMissing(project: string): string {
  return `the record has no Rex identity; run summon ${project} --new-window to relaunch`;
}

/** The one wording every consumer prints for an `unknown` workspace (plan P10). */
export function unverifiedMessage(project: string, reason: string | undefined): string {
  return `[${project}] could not be verified: ${reason ?? "no liveness information"}. Open the Rex app and retry, or run summon doctor.`;
}

/** Rex: recorded panes whose block is not known yet (the pane file had not appeared when last looked). */
export function unverifiedPanes(record: WorkspaceStatus): number {
  return record.panes.length - (record.rex?.blocks.length ?? 0);
}

/** States with a live workspace to focus or count (plan P10 reader rules). */
export function isLiveState(state: WorkspaceState): boolean {
  return state === "active" || state === "partial";
}

/** Milliseconds since `startedAt` for a live state; null for any other state or an unreadable timestamp. */
export function liveUptime(state: WorkspaceState, startedAt: string): number | null {
  const started = Date.parse(startedAt);
  return isLiveState(state) && !Number.isNaN(started) ? Date.now() - started : null;
}

/** A row whose liveness could not be read: `unknown`, with the reason and any notices carried so far. */
export function unknownRow(record: StatusRow, reason: string, notices: string[] = []): ResolvedStatus {
  return { ...record, state: "unknown", uptime: null, reason, ...(notices.length > 0 ? { notices } : {}) };
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

/** The record write itself failed (step B of the end-of-launch steps); other errors come from the lock or the action. */
export class RecordWriteError extends Error {}

/** @internal test hook: runs just before the status lock is taken. */
export const statusTestHooks: { beforeLock?: () => void; beforeWrite?: () => void; afterUnlock?: () => void } = {};

// --- Paths ---

function statusArtifactPath(projectName: string, extension: "json" | "active" | "pid" | "launch"): string {
  return confinedPath(STATUS_DIR, `${projectName}.${extension}`, "status");
}

function statusFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "json");
}

/**
 * BE-L1: the stale bound of a launch lock. Its owner runs `rex` subprocesses synchronously (execFileSync), so its
 * token is not refreshed while it works. The worst case under the lock, summed from the call timeouts (each read 8 s
 * plus a 2 s grace, `session.create` 10 s, the token and app waits 8 s each), is about 2 minutes; 5 minutes keeps a
 * slow live launch its lock, and a hung or suspended (Ctrl-Z) owner is still taken over after that. A dead owner is
 * recovered at once.
 */
export const LAUNCH_LOCK_STALE_MS = 5 * 60_000;

/** The stale bound of a lock directory under the config directory: a launch lock's own, else the shared STALE_LOCK_MS. */
export function lockStaleBound(directory: string): number | undefined {
  return directory.endsWith(".launch.lock") ? LAUNCH_LOCK_STALE_MS : undefined;
}

/**
 * BE-L1: the file a backend's per-project launch lock is named after (`<project>.launch.lock/` once held), distinct
 * from the record lock (`<project>.json.lock/`). The status directory exists afterwards.
 */
export function launchLockFile(projectName: string): string {
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  return statusArtifactPath(projectName, "launch");
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
 *
 * `onWriteFailure` runs under the same lock when the record write itself fails, before
 * `RecordWriteError` is thrown: the file it sees is the record observed under this lock, so cleanup
 * done there can never touch a record another process publishes after the lock is released.
 */
export function withOwnedRecord(
  projectName: string,
  expectation: RecordExpectation,
  action: (current: WorkspaceStatus | null) => WorkspaceStatus | null,
  afterWrite?: (outcome: "written" | "unchanged", record: WorkspaceStatus | null) => void,
  onWriteFailure?: () => void,
): OwnedRecordResult {
  const file = statusFilePath(projectName);
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  statusTestHooks.beforeLock?.();
  try {
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
        try {
          statusTestHooks.beforeWrite?.();
          atomicWrite(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        } catch (error) {
          onWriteFailure?.();
          throw new RecordWriteError(error instanceof Error ? error.message : String(error));
        }
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
  } finally {
    statusTestHooks.afterUnlock?.();
  }
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

export type PublishOutcome = "published" | "discarded" | "unsaved";

/**
 * `writeStatus` for the launcher: when the write itself fails, the record observed under the same
 * lock is discarded there (stale metadata must not target an older workspace, Phase 1), and a
 * record another launch publishes once the lock is released is never touched. `unsaved` means the
 * lock could not be taken or the discard failed: previous metadata may remain.
 */
export function publishStatus(status: WorkspaceStatus): PublishOutcome {
  let discarded = false;
  try {
    withOwnedRecord(status.project, "replace", () => status, undefined, () => { discarded = unlinkIgnoringMissing(statusFilePath(status.project)); });
    return "published";
  } catch {
    return discarded ? "discarded" : "unsaved";
  }
}

/** Remove files, tolerating absent ones; returns `path: reason` for every other failure. */
function removeFiles(files: readonly string[]): string[] {
  const failures: string[] = [];
  for (const file of files) {
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

export interface LaunchRemoval {
  /** Every failure as `path: reason`; empty when everything went. */
  failures: string[];
  /** The root token when its own removal failed after the manifest went: inert, and no longer discoverable by a retry. */
  stranded?: string;
}

/**
 * Remove a launch's files in steps, stopping at the first failure: the sidecars and other pane
 * files, then the manifest (discovery), then the root token (the proof of which session the launch
 * created). A partial removal thus keeps what a retry (`summon clean --orphans`, the next status
 * read) needs to verify the session again and finish. The one stray it can leave is a token whose
 * own removal failed after the manifest went (`stranded`): nothing reads it, and no retry finds it.
 */
export function removeLaunchFileSet(files: LaunchFileSet): LaunchRemoval {
  const others = removeFiles([...files.liveness, ...files.panes]);
  if (others.length > 0) return { failures: others };
  if (files.manifest) {
    const manifest = removeFiles([files.manifest]);
    if (manifest.length > 0) return { failures: manifest };
  }
  if (files.token) {
    const token = removeFiles([files.token]);
    if (token.length > 0) return { failures: token, ...(files.manifest ? { stranded: files.token } : {}) };
  }
  return { failures: [] };
}

export function unlinkIgnoringMissing(path: string): boolean {
  try { unlinkSync(path); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
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

export type LaunchLiveness = "alive" | "dead" | "unknown";

/**
 * Liveness of a launch from its own sidecars: `alive` when its `.active` names it and its `.pid` is
 * alive (what a record needs to count as active); `dead` when its `.pid` names a process that is
 * not alive (what a sweep needs before removing anything); `unknown` otherwise, which covers an
 * unreadable pid file and the bootstrap window between the pid and marker writes.
 */
export function launchLiveness(projectName: string, launchId: string): LaunchLiveness {
  const paths = launchArtifactPaths(projectName, launchId);
  const pid = readPidFile(paths.pid);
  if (pid === null) return "unknown";
  if (!isPidAlive(pid)) return "dead";
  let marker: string | undefined;
  try {
    marker = readFileSync(paths.active, "utf-8").trim();
  } catch {
    marker = undefined;
  }
  return marker === launchId ? "alive" : "unknown";
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


/** Ghostty liveness from the sidecars: a record with a launch id reads only its own per-launch files (P12). */
export function ghosttyLiveness(projectName: string, status: WorkspaceStatus): "active" | "stopped" {
  if (status.launchId) return launchLiveness(projectName, status.launchId) === "alive" ? "active" : "stopped";
  const markerExists = existsSync(markerFilePath(projectName));
  const shellPid = readPidFile(pidFilePath(projectName));
  return markerExists && shellPid !== null && isPidAlive(shellPid) ? "active" : "stopped";
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

  // Every pane element must be a pane identifier (BE-M5 #379, BE-L3: never a path that names another launch's file).
  // Otherwise the record keeps empty panes rather than being rejected.
  const validPanes = isPaneNameList(d["panes"]) ? d["panes"] : [];

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

  // BE-L3 #514: reconstruct explicitly from validated fields — no unknown keys leak through.
  // The key order is the one this parser has always produced, so a rewrite of a parsed record is byte-identical.
  const fields = {
    project: d["project"] as string,
    directory: d["directory"] as string,
    pid: d["pid"] as number,
    startedAt: d["startedAt"] as string,
    layout: d["layout"] as string,
    panes: validPanes,
    source: "summon" as const,
    version: 1 as const,
  };
  const tail = { ...(launchId ? { launchId } : {}) };
  const ended = { ...(endedAt ? { endedAt } : {}) };
  if (backend === "rex") return { ...fields, ...tail, backend, ...(rex ? { rex } : {}), ...ended };
  return { ...fields, ...(native ? { native } : {}), ...tail, ...(backend ? { backend } : {}), ...ended };
}
