/**
 * Status reader over both backends (plan P10): the four states of every recorded workspace and the
 * unverified-launch rows of manifests without a record. Each record is resolved by its own backend through the
 * record port (backends/workspace.ts, AR-M1). A read writes nothing unless it asks to reconcile
 * (`{ reconcile: true }`); the writing Rex steps (adoption, pane refresh, end of a launch) live in
 * backends/rex/reconcile.ts. The record layer is status-record.ts, imported directly.
 */
import { existsSync, readdirSync } from "node:fs";
import { STATUS_DIR } from "./paths.js";
import { gitOutput } from "./utils.js";
import { listLaunchManifests } from "./launch-identity.js";
import type { BackendId } from "./backend.js";
import type { ProgramStatus } from "./backends/rex/status.js";
import type { StatusRead } from "./backends/port.js";
import { workspaceBackendFor } from "./backends/workspace.js";
import { readStatusRecord } from "./status-record.js";
import type { WorkspaceState, WorkspaceStatus } from "./status-record.js";

// The monitor passes the `rex` binary its parent resolved to its child read (PE-H1); the memo is the Rex reader's.
export { rexBinaryPath, seedRexBinaryPath, resetRexBinaryMemo } from "./backends/rex/read.js";

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

export interface ReadOptions {
  /** Read the root pane's program status for live rows (one more `rex` call per row; the monitor and `inspect` want it). */
  programStatus?: boolean;
  /**
   * Run the Rex reconciliation steps (backends/rex/reconcile.ts): late adoption, the pane-file refresh
   * and the end of a launch that ended outside Summon, each of which may write the record, save a
   * snapshot and remove launch files. Without it a read writes nothing.
   */
  reconcile?: boolean;
}

/** One read: its options, each backend's per-read state, and dispatch of every record to its own backend. */
function newStatusRead(options: ReadOptions): StatusRead {
  const scratch = new Map<BackendId, unknown>();
  const read: StatusRead = {
    options: {
      ...(options.programStatus ? { programStatus: true } : {}),
      ...(options.reconcile ? { reconcile: true } : {}),
    },
    scratch<T>(id: BackendId, create: () => T): T {
      if (!scratch.has(id)) scratch.set(id, create());
      return scratch.get(id) as T;
    },
    resolveRecord: (projectName, record, notices) => workspaceBackendFor(record.backend).resolve(projectName, record, read, notices),
  };
  return read;
}

function unknownRow(record: Omit<WorkspaceStatus, "pid"> & { pid: number | null }, reason: string, notices: string[] = []): ResolvedStatus {
  return { ...record, state: "unknown", uptime: null, reason, ...(notices.length > 0 ? { notices } : {}) };
}

function resolveStatus(projectName: string, read: StatusRead): ResolvedStatus | null {
  const status = readStatusRecord(projectName);
  if (!status) return null;
  return read.resolveRecord(projectName, status, []);
}

/** One project's recorded status; `{ reconcile: true }` lets the read adopt, refresh and end Rex launches. */
export function readStatus(projectName: string, options: ReadOptions = {}): ResolvedStatus | null {
  return resolveStatus(projectName, newStatusRead(options));
}

const UNVERIFIED_LAUNCH = "unverified launch";

/**
 * Launches that have a manifest but no record (unknown creation outcome, plan P13 §6).
 * A reconciling read first tries adoption; either way they are surfaced so `summon status` can
 * list them and never hide a session Summon may have created.
 */
function unverifiedLaunchRows(launchDirProjects: string[], recordedProjects: Set<string>, read: StatusRead): ResolvedStatus[] {
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
    // Late adoption (P13, reconciling reads only) may publish a record for a launch whose outcome was unknown;
    // each backend that wrote one of these manifests tries it once.
    let attempted = false;
    const notices: string[] = [];
    for (const backend of new Set(manifests.map((m) => m.backend))) {
      const adoption = workspaceBackendFor(backend).adoptUnrecorded?.(projectName, read);
      if (!adoption) continue;
      attempted ||= adoption.attempted;
      notices.push(...adoption.notices);
    }
    if (attempted && readStatusRecord(projectName)) {
      const adopted = resolveStatus(projectName, read);
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
 * of a manifest without a record (after one late-adoption attempt when the read reconciles), or null when there is nothing.
 */
export function readProjectStatus(projectName: string, options: ReadOptions = {}): ResolvedStatus | null {
  const read = newStatusRead(options);
  return resolveStatus(projectName, read) ?? unverifiedLaunchRows([projectName], new Set(), read)[0] ?? null;
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

/** Every recorded workspace and unverified launch, live rows first; `{ reconcile: true }` as for `readStatus`. */
export function readAllStatuses(options: ReadOptions = {}): ResolvedStatus[] {
  const { recorded, launchDirProjects } = scanStatusDir();
  const statuses: ResolvedStatus[] = [];
  const read = newStatusRead(options);

  const recordedProjects = new Set(recorded);
  for (const projectName of recorded) {
    const status = resolveStatus(projectName, read);
    if (status) statuses.push(status);
  }
  statuses.push(...unverifiedLaunchRows(launchDirProjects, recordedProjects, read));

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
