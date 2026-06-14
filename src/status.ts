import { existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { STATUS_DIR } from "./paths.js";
import { debugLog, atomicWrite, gitOutput } from "./utils.js";

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
}

export type WorkspaceState = "active" | "stopped" | "unknown";

export interface ResolvedStatus extends WorkspaceStatus {
  /** Derived from marker file check at read time */
  state: WorkspaceState;
  /** Milliseconds since workspace started (if active), null if stopped */
  uptime: number | null;
}

// --- Paths ---

function statusArtifactPath(projectName: string, extension: "json" | "active" | "pid"): string {
  const filePath = join(STATUS_DIR, `${projectName}.${extension}`);
  if (!resolve(filePath).startsWith(resolve(STATUS_DIR) + sep)) {
    throw new Error(`Invalid status path: "${projectName}"`);
  }
  return filePath;
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

/**
 * Write workspace status JSON. Liveness artifacts (.active marker, .pid sidecar)
 * are created by the root shell bootstrap after the pid is durable — see
 * emitRootPanePidBootstrap in src/script.ts. Node never writes the marker; this
 * eliminates a launch-window race where a concurrent reader would observe
 * marker-without-pid and GC both artifacts. (2026-04-19 audit #2.)
 */
export function writeStatus(status: WorkspaceStatus): void {
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  atomicWrite(statusFilePath(status.project), JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
}

export function clearStatus(projectName: string): void {
  const statusPath = statusFilePath(projectName);
  const markerPath = markerFilePath(projectName);
  const pidPath = pidFilePath(projectName);
  try { unlinkSync(statusPath); } catch { /* ignore */ }
  try { unlinkSync(markerPath); } catch { /* ignore */ }
  try { unlinkSync(pidPath); } catch { /* ignore */ }
}

// --- Read ---

function readShellPid(projectName: string): number | null {
  try {
    const raw = readFileSync(pidFilePath(projectName), "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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
  };
}

export function readStatus(projectName: string): ResolvedStatus | null {
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

  const status = parseWorkspaceStatus(data);
  if (!status) return null;

  const markerExists = existsSync(markerFilePath(projectName));
  const shellPid = readShellPid(projectName);
  const active = markerExists && shellPid !== null && isPidAlive(shellPid);

  const now = Date.now();
  const started = Date.parse(status.startedAt);

  return {
    ...status,
    state: active ? "active" : "stopped",
    uptime: active && !isNaN(started) ? now - started : null,
  };
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
  const files = readdirSync(STATUS_DIR).filter(
    f => f.endsWith(".json") && !f.startsWith(".") && !f.endsWith(".tmp")
  );
  const statuses: ResolvedStatus[] = [];

  for (const file of files) {
    const projectName = file.replace(/\.json$/, "");
    const status = readStatus(projectName);
    if (status) statuses.push(status);
  }

  // Sort: active first (newest first), then stopped (newest first)
  const result = statuses.sort((a, b) => {
    if (a.state === "active" && b.state !== "active") return -1;
    if (a.state !== "active" && b.state === "active") return 1;
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

